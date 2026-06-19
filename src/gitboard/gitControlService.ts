import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createDashboardService, type DashboardScanPayload } from "./dashboardService.js";
import type { GitControlCardModel } from "./gitControlCardModel.js";
import { buildGitControlCardModel } from "./gitControlCardModel.js";
import type { GitProxy } from "./gitProxy.js";
import { createDefaultManifest } from "./manifest.js";
import type { MutationGitOperation, MutationGitRunner } from "./mutationGitProxy.js";
import { MutationGitProxy } from "./mutationGitProxy.js";
import { MutationSafetyGate } from "./mutationSafetyGate.js";
import { MutationSnapshotStore, type MutationPreflightSnapshot } from "./mutationSnapshotStore.js";
import { RealGitProxy } from "./realGitProxy.js";
import { RepoScanner } from "./repoScanner.js";
import type { RepoManifest, RepoManifestEntry, RepoSnapshot } from "./types.js";

const execFileAsync = promisify(execFile);

export interface GitControlCardResponse extends GitControlCardModel {
  id: string;
  label: string;
}

export interface GitControlScanResponse {
  dashboard: DashboardScanPayload;
  cards: GitControlCardResponse[];
}

export interface GitControlStashEntry {
  index: number;
  selector: string;
  message: string;
  branch: string | null;
  createdAt: string | null;
}

export interface GitControlRepoDetailResponse {
  snapshot: RepoSnapshot;
  stashList: GitControlStashEntry[];
}

export interface GitControlPrepareResponse {
  operationId: string;
  repoId: string;
  operation: MutationGitOperation;
  preflightSnapshotId: string;
  confirmationToken: string;
  expiresAtMs: number;
}

export interface GitControlMutationResponse {
  ok: boolean;
  operationId: string;
  repoId: string;
  operation: MutationGitOperation;
  beforeSnapshotId: string;
  output: string;
}

export interface GitControlMutationRequest {
  operationId?: string;
  preflightSnapshotId?: string;
  confirmationToken?: string;
  message?: string;
  files?: string[];
}

export interface GitControlServiceOptions {
  root?: string;
  manifest?: RepoManifest;
  git?: GitProxy;
  mutationProxy?: MutationGitProxy;
  now?: () => Date;
  nowMs?: () => number;
}

export interface GitControlService {
  scan(): Promise<GitControlScanResponse>;
  repoDetail(repoId: string): Promise<GitControlRepoDetailResponse>;
  mutationStatus(operationId: string): Promise<{ operationId: string; status: "unknown" }>;
  prepareMutation(repoId: string, operation: string): Promise<GitControlPrepareResponse>;
  mutate(repoId: string, operation: string, body: GitControlMutationRequest): Promise<GitControlMutationResponse>;
}

export function createGitControlService({
  root = "/Users/tristanzh/agent/agent08-gitboard",
  manifest = createDefaultManifest("/Users/tristanzh/agent"),
  git = new RealGitProxy(),
  mutationProxy = new MutationGitProxy(new ExecMutationGitRunner()),
  now = () => new Date(),
  nowMs = () => Date.now(),
}: GitControlServiceOptions = {}): GitControlService {
  const scanner = new RepoScanner(git);
  const dashboardService = createDashboardService({ manifest, git, now });
  const snapshotStore = new MutationSnapshotStore(root);
  const safetyGate = new MutationSafetyGate({
    allowedRepos: new Map(manifest.targets.map((target) => [target.id, target.path])),
    now: nowMs,
  });

  async function scan(): Promise<GitControlScanResponse> {
    const dashboard = await dashboardService.scan();
    const labelsById = new Map(manifest.targets.map((target) => [target.id, target.label]));
    return {
      dashboard,
      cards: dashboard.targets.map((target) => ({
        id: target.id,
        label: labelsById.get(target.id) ?? target.id,
        ...buildGitControlCardModel(target),
      })),
    };
  }

  async function repoDetail(repoId: string): Promise<GitControlRepoDetailResponse> {
    const target = findTarget(manifest, repoId);
    const [snapshot] = await scanner.scanAll({ ...manifest, targets: [target] });
    return {
      snapshot,
      stashList: parseStashList(await git.stashList(target.path)),
    };
  }

  async function prepareMutation(repoId: string, operationName: string): Promise<GitControlPrepareResponse> {
    const operation = assertMutationOperation(operationName);
    const target = findTarget(manifest, repoId);
    const [snapshot] = await scanner.scanAll({ ...manifest, targets: [target] });
    const operationId = randomUUID();
    await snapshotStore.savePreflightSnapshot(toPreflightSnapshot(operationId, operation, snapshot, now()));
    const token = safetyGate.createConfirmationToken({
      operationId,
      repoId,
      operation,
      preflightSnapshotId: operationId,
    });
    return {
      operationId,
      repoId,
      operation,
      preflightSnapshotId: operationId,
      confirmationToken: token.token,
      expiresAtMs: token.expiresAtMs,
    };
  }

  async function mutate(
    repoId: string,
    operationName: string,
    body: GitControlMutationRequest,
  ): Promise<GitControlMutationResponse> {
    const operation = assertMutationOperation(operationName);
    const target = findTarget(manifest, repoId);
    const [snapshot] = await scanner.scanAll({ ...manifest, targets: [target] });
    const preflightSnapshotId = requireString(body.preflightSnapshotId, "preflightSnapshotId");
    const confirmationToken = requireString(body.confirmationToken, "confirmationToken");
    safetyGate.assertCanMutate({
      repoId,
      repoPath: target.path,
      operation,
      preflightSnapshotId,
      confirmationToken,
      currentSnapshot: snapshot,
    });
    await snapshotStore.savePreflightSnapshot(toPreflightSnapshot(preflightSnapshotId, operation, snapshot, now()));
    const output = await runMutation(operation, snapshot, body);
    return {
      ok: true,
      operationId: body.operationId ?? preflightSnapshotId,
      repoId,
      operation,
      beforeSnapshotId: preflightSnapshotId,
      output,
    };
  }

  return {
    scan,
    repoDetail,
    async mutationStatus(operationId) {
      return { operationId, status: "unknown" };
    },
    prepareMutation,
    mutate,
  };

  async function runMutation(
    operation: MutationGitOperation,
    snapshot: RepoSnapshot,
    body: GitControlMutationRequest,
  ): Promise<string> {
    if (operation === "commit") {
      return mutationProxy.commit({
        repoPath: snapshot.path,
        message: requireString(body.message, "message"),
        files: body.files,
      });
    }
    if (operation === "push") return mutationProxy.push({ repoPath: snapshot.path });
    if (operation === "pull_ff_only") return mutationProxy.pullFastForward({ repoPath: snapshot.path });
    if (operation === "stash_rebase") {
      return mutationProxy.stashRebase({
        repoPath: snapshot.path,
        operationId: body.operationId ?? requireString(body.preflightSnapshotId, "preflightSnapshotId"),
        upstream: requireString(snapshot.upstream, "upstream"),
      });
    }
    throw new Error(`command not allowed: ${operation}`);
  }
}

export function parseStashList(raw: string): GitControlStashEntry[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(stash@\{(\d+)})\:\s*(?:WIP on ([^:]+):\s*)?(.*)$/);
      if (!match) {
        return { index: -1, selector: line, message: line, branch: null, createdAt: null };
      }
      return {
        index: Number(match[2]),
        selector: match[1],
        message: match[4],
        branch: match[3] ?? null,
        createdAt: null,
      };
    });
}

function findTarget(manifest: RepoManifest, repoId: string): RepoManifestEntry {
  const target = manifest.targets.find((item) => item.id === repoId);
  if (!target) throw new Error(`repo not allowed: ${repoId}`);
  return target;
}

function assertMutationOperation(operation: string): MutationGitOperation {
  if (
    operation === "commit" ||
    operation === "push" ||
    operation === "pull_ff_only" ||
    operation === "stash" ||
    operation === "rebase" ||
    operation === "stash_rebase"
  ) {
    return operation;
  }
  throw new Error(`command not allowed: ${operation}`);
}

function toPreflightSnapshot(
  operationId: string,
  operation: MutationGitOperation,
  snapshot: RepoSnapshot,
  createdAt: Date,
): MutationPreflightSnapshot {
  return {
    operationId,
    repoId: snapshot.id,
    repoPath: snapshot.path,
    operation,
    createdAt: createdAt.toISOString(),
    branch: snapshot.branch,
    upstream: snapshot.upstream,
    ahead: snapshot.ahead,
    behind: snapshot.behind,
    dirty: {
      modified: [...snapshot.dirty.modified],
      untracked: [...snapshot.dirty.untracked],
      deleted: [...snapshot.dirty.deleted],
      renamed: [...snapshot.dirty.renamed],
    },
    lastCommitSha: snapshot.lastCommit.sha,
    worktreeState: snapshot.branch ? (hasDirtyFiles(snapshot) ? "dirty" : "clean") : "detached",
  };
}

function hasDirtyFiles(snapshot: RepoSnapshot): boolean {
  return (
    snapshot.dirty.modified.length +
      snapshot.dirty.untracked.length +
      snapshot.dirty.deleted.length +
      snapshot.dirty.renamed.length >
    0
  );
}

function requireString(value: unknown, name: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`${name} is required`);
}

class ExecMutationGitRunner implements MutationGitRunner {
  async runGit(repoPath: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoPath,
      timeout: 20_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  }
}

export const gitControlService = createGitControlService();

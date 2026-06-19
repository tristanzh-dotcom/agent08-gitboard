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
import { MutationSafetyError, MutationSafetyGate } from "./mutationSafetyGate.js";
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
  branch?: string | null;
  remote?: "origin";
  remoteTrackingBranch?: string | null;
  currentUpstream?: string | null;
  ahead?: number;
  commitsToPushSubjects?: string[];
  warning?: string;
}

export interface GitControlMutationResponse {
  ok: boolean;
  operationId: string;
  repoId: string;
  operation: MutationGitOperation;
  beforeSnapshotId: string;
  output: string;
  outputSummary: string;
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
      ...prepareMutationDetails(operation, snapshot),
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
      outputSummary: summarizeMutationOutput(operation, output),
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
      try {
        return await mutationProxy.commit({
          repoPath: snapshot.path,
          message: requireString(body.message, "message"),
          files: body.files,
        });
      } catch (error) {
        if (error instanceof Error && error.message === "COMMIT_PATH_BLOCKED") {
          throw new MutationSafetyError("COMMIT_PATH_BLOCKED");
        }
        throw error;
      }
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
    if (operation === "set_upstream") {
      return mutationProxy.setUpstream({
        repoPath: snapshot.path,
        branch: requireString(snapshot.branch, "branch"),
        remote: "origin",
      });
    }
    if (operation === "push_with_upstream") {
      return mutationProxy.pushWithUpstream({
        repoPath: snapshot.path,
        branch: requireString(snapshot.branch, "branch"),
        remote: "origin",
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
    operation === "stash_rebase" ||
    operation === "set_upstream" ||
    operation === "push_with_upstream"
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
    remote: "origin",
    remoteTrackingBranch: snapshot.remoteTrackingBranch,
    remoteHasBranch: snapshot.remoteHasBranch,
    commitsToPushCount: snapshot.commitsToPushCount,
    commitsToPushSubjects: [...snapshot.commitsToPushSubjects],
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

function prepareMutationDetails(
  operation: MutationGitOperation,
  snapshot: RepoSnapshot,
): Partial<GitControlPrepareResponse> {
  if (operation === "set_upstream") {
    return {
      branch: snapshot.branch,
      remote: "origin",
      remoteTrackingBranch: snapshot.remoteTrackingBranch,
      currentUpstream: snapshot.upstream,
      warning: "This operation updates local Git tracking config and does not push commits.",
    };
  }
  if (operation === "push_with_upstream") {
    return {
      branch: snapshot.branch,
      remote: "origin",
      remoteTrackingBranch: snapshot.remoteTrackingBranch,
      currentUpstream: snapshot.upstream,
      ahead: snapshot.commitsToPushCount,
      commitsToPushSubjects: [...snapshot.commitsToPushSubjects],
      warning: "This operation pushes to origin AND sets upstream tracking.",
    };
  }
  return {};
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

function summarizeMutationOutput(operation: MutationGitOperation, output: string): string {
  if (operation !== "commit") return firstShortLine(output, `${operation} complete`);
  return firstShortLine(output, "commit complete");
}

function firstShortLine(output: string, fallback: string): string {
  const firstLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const summary = firstLine ?? fallback;
  return summary.length > 160 ? `${summary.slice(0, 157)}...` : summary;
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

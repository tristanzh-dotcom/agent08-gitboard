import {
  createFinalizationService,
  type FinalizationService,
} from "./finalizationService.js";
import type {
  CommitPlan,
  CommitProposal,
  FinalizationReceipt,
  FinalizationStatus,
  PushPlan,
  PushProposal,
} from "./finalizationContracts.js";
import { FinalizationPlanStore } from "./finalizationPlanStore.js";
import type { GitProxy } from "./gitProxy.js";
import { createDefaultManifest } from "./manifest.js";
import { RealGitProxy } from "./realGitProxy.js";
import { RepoScanner } from "./repoScanner.js";
import type {
  GitControlRepoDetailResponse,
  GitControlScanResponse,
  PublicRepositorySnapshot,
  RepoKind,
  RepoLifecycle,
  RepoManifest,
  RepoManifestEntry,
  RepoSnapshot,
} from "./types.js";

export interface GitControlStashEntry {
  index: number;
  selector: string;
  message: string;
  branch: string | null;
  createdAt: string | null;
}

export interface GitControlServiceOptions {
  root?: string;
  manifest?: RepoManifest;
  git?: GitProxy;
  finalizationService?: FinalizationService;
  now?: () => Date;
}

export interface GitControlService {
  scan(): Promise<GitControlScanResponse>;
  repoDetail(repoId: string): Promise<GitControlRepoDetailResponse>;
  prepareCommit(repoId: string, proposal: CommitProposal): Promise<CommitPlan>;
  preparePush(repoId: string, proposal?: PushProposal): Promise<PushPlan>;
  confirmFinalization(operationId: string): ReturnType<FinalizationService["confirmFinalization"]>;
  executeFinalization(
    operationId: string,
    confirmationToken: string,
  ): Promise<FinalizationReceipt>;
  finalizationStatus(operationId: string): Promise<FinalizationStatus>;
}

export function createGitControlService({
  root = "/Users/tristanzh/agent/agent08-gitboard",
  manifest = createDefaultManifest("/Users/tristanzh/agent"),
  git = new RealGitProxy(),
  finalizationService,
  now = () => new Date(),
}: GitControlServiceOptions = {}): GitControlService {
  const scanner = new RepoScanner(git);
  const finalization = finalizationService ?? createFinalizationService({
    manifest,
    store: new FinalizationPlanStore(root),
  });

  async function scan(): Promise<GitControlScanResponse> {
    const observedAt = now().toISOString();
    const snapshots = await scanner.scanAll(manifest);
    const targetsById = new Map(manifest.targets.map((target) => [target.id, target]));
    return {
      schemaVersion: 2,
      observation: { state: "verified", observedAt, reasonCode: null },
      repositories: snapshots.map((snapshot) =>
        toPublicRepositorySnapshot(
          targetsById.get(snapshot.id) ?? findTarget(manifest, snapshot.id),
          snapshot,
          observedAt,
        )),
    };
  }

  async function repoDetail(repoId: string): Promise<GitControlRepoDetailResponse> {
    const target = findTarget(manifest, repoId);
    const [snapshot] = await scanner.scanAll({ ...manifest, targets: [target] });
    return {
      schemaVersion: 2,
      repository: toPublicRepositorySnapshot(target, snapshot, now().toISOString()),
      stashCount: snapshot.observationState === "unverified" ? 0 : snapshot.dirty.stashCount,
    };
  }

  return {
    scan,
    repoDetail,
    prepareCommit: (repoId, proposal) => finalization.prepareCommit(repoId, proposal),
    preparePush: (repoId, proposal) => finalization.preparePush(repoId, proposal),
    confirmFinalization: (operationId) => finalization.confirmFinalization(operationId),
    executeFinalization: (operationId, confirmationToken) =>
      finalization.executeFinalization(operationId, confirmationToken),
    finalizationStatus: (operationId) => finalization.finalizationStatus(operationId),
  };
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

export const gitControlService = createGitControlService();

function toPublicRepositorySnapshot(
  target: RepoManifestEntry,
  snapshot: RepoSnapshot,
  observedAt: string,
): PublicRepositorySnapshot {
  const display = manifestDisplay(target);
  const observationState = snapshot.observationState ?? "verified";
  const observationReasonCode = snapshot.observationReasonCode ?? null;
  const changes = [
    ...(snapshot.dirty.added ?? []).map((path) => ({ path, status: "added" as const })),
    ...snapshot.dirty.modified.map((path) => ({ path, status: "modified" as const })),
    ...snapshot.dirty.untracked.map((path) => ({ path, status: "untracked" as const })),
    ...snapshot.dirty.deleted.map((path) => ({ path, status: "deleted" as const })),
    ...snapshot.dirty.renamed.map((path) => ({ path, status: "renamed" as const })),
    ...(snapshot.dirty.unmerged ?? []).map((path) => ({ path, status: "unmerged" as const })),
  ];
  const conflictCount = snapshot.dirty.unmerged?.length ?? 0;
  const availability = observationState === "unverified"
    ? "unknown"
    : snapshot.exists
    ? "git_repository"
    : snapshot.initializable
      ? "uninitialized_directory"
      : "missing";
  const branch = publicBranch(snapshot);
  const pushability = publicPushability(snapshot);
  const commitReasonCode = observationState === "unverified"
    ? "OBSERVATION_UNVERIFIED"
    : !snapshot.exists
    ? "NOT_GIT_REPOSITORY"
    : branch.state !== "attached"
      ? "BRANCH_NOT_ATTACHED"
      : conflictCount > 0
        ? "UNMERGED_PATHS"
        : changes.length === 0
          ? "NO_CHANGES"
          : null;

  return {
    repoId: target.id,
    label: target.label,
    ...display,
    availability,
    observation: {
      state: observationState,
      observedAt,
      reasonCode: observationReasonCode,
    },
    repoTruth: {
      state: observationState === "unverified"
        ? "unknown"
        : snapshot.exists
          ? (changes.length > 0 ? "dirty" : "clean")
          : "unknown",
      changeCount: observationState === "unverified" ? 0 : changes.length,
      conflictCount: observationState === "unverified" ? 0 : conflictCount,
      changes: observationState === "unverified" ? [] : changes,
    },
    branch,
    pushability,
    actions: {
      commit: {
        state: commitReasonCode === null ? "enabled" : "disabled",
        reasonCode: commitReasonCode,
      },
      push: {
        state: pushability.state === "pushable" ? "enabled" : "disabled",
        reasonCode: pushability.reasonCode,
      },
    },
  };
}

function manifestDisplay(target: RepoManifestEntry): {
  ownerId: string;
  kind: RepoKind;
  lifecycle: RepoLifecycle;
} {
  return {
    ownerId: target.ownerId ?? target.agent?.toLowerCase() ?? target.id,
    kind: target.kind ?? "business",
    lifecycle: target.lifecycle ?? "active",
  };
}

function publicBranch(snapshot: RepoSnapshot): PublicRepositorySnapshot["branch"] {
  if (snapshot.observationState === "unverified") return { state: "unknown", name: null };
  if (!snapshot.exists) return { state: "unknown", name: null };
  if (snapshot.branch) return { state: "attached", name: snapshot.branch };
  if (snapshot.lastCommit.sha === null) return { state: "unborn", name: null };
  return { state: "detached", name: null };
}

function publicPushability(snapshot: RepoSnapshot): PublicRepositorySnapshot["pushability"] {
  const base = {
    commitCount: snapshot.commitsToPushCount,
    ahead: snapshot.ahead,
    behind: snapshot.behind,
  };
  if (snapshot.observationState === "unverified") {
    return { ...base, state: "unknown", reasonCode: "OBSERVATION_UNVERIFIED" };
  }
  if (!snapshot.exists || !snapshot.branch) {
    return { ...base, state: "not_pushable", reasonCode: "BRANCH_NOT_ATTACHED" };
  }
  if (snapshot.upstreamState === "remote_check_failed" || snapshot.upstreamState === "unknown") {
    return { ...base, state: "unknown", reasonCode: "REMOTE_CHECK_FAILED" };
  }
  if (snapshot.behind > 0) {
    return { ...base, state: "not_pushable", reasonCode: "BRANCH_BEHIND_REMOTE" };
  }
  if (snapshot.commitsToPushCount > 0) {
    return { ...base, state: "pushable", reasonCode: null };
  }
  return { ...base, state: "not_pushable", reasonCode: "NO_COMMITS_TO_PUSH" };
}

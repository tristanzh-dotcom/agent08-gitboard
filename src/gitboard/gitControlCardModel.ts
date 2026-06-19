import type { RepoSnapshot } from "./types.js";

export type GitControlActionId = "commit" | "push" | "pull" | "stash+rebase" | "set-upstream" | "push-upstream";

export interface GitControlAction {
  id: GitControlActionId;
  enabled: boolean;
}

export interface GitControlCardModel {
  actions: GitControlAction[];
  blockedReason: string | null;
  dirtyLine: string;
  selfMutationWarning: string | null;
  stashLine: string | null;
  statusLine: string;
}

export interface GitControlCardOptions {
  postCommitRescanPending?: boolean;
}

export interface CommitConfirmationFileStat {
  path: string;
  insertions: number;
  deletions: number;
}

export interface CommitConfirmationModel {
  canConfirm: boolean;
  fileRows: string[];
  messageError: "COMMIT_MESSAGE_REQUIRED" | null;
}

export function buildGitControlCardModel(
  snapshot: RepoSnapshot,
  options: GitControlCardOptions = {},
): GitControlCardModel {
  const dirtyFileCount = countDirtyFiles(snapshot);
  const hasDirtyWorktree = dirtyFileCount > 0;
  const blockedReason = buildBlockedReason(snapshot, hasDirtyWorktree);
  const actions = blockedReason ? [] : buildActions(snapshot, hasDirtyWorktree, options);

  return {
    actions,
    blockedReason,
    dirtyLine: hasDirtyWorktree ? `${dirtyFileCount} dirty` : "clean",
    selfMutationWarning:
      snapshot.id === "agent08-gitboard" && actions.length > 0
        ? "Running service code will not change until restart after a self mutation."
        : null,
    stashLine: snapshot.dirty.stashCount > 0 ? `stash: ${snapshot.dirty.stashCount}` : null,
    statusLine: buildStatusLine(snapshot),
  };
}

export function buildCommitConfirmationModel(input: {
  message: string;
  files: CommitConfirmationFileStat[];
}): CommitConfirmationModel {
  const canConfirm = input.message.trim().length > 0;

  return {
    canConfirm,
    fileRows: input.files.map((file) => `${file.path} +${file.insertions} -${file.deletions}`),
    messageError: canConfirm ? null : "COMMIT_MESSAGE_REQUIRED",
  };
}

function buildActions(
  snapshot: RepoSnapshot,
  hasDirtyWorktree: boolean,
  options: GitControlCardOptions,
): GitControlAction[] {
  if (!hasDirtyWorktree && snapshot.upstreamState === "missing_upstream_remote_exists") {
    if (snapshot.commitsToPushCount > 0) return [{ id: "push-upstream", enabled: true }];
    return [{ id: "set-upstream", enabled: true }];
  }

  if (!hasDirtyWorktree && snapshot.upstreamState === "missing_upstream_remote_missing") {
    if (snapshot.commitsToPushCount > 0) return [{ id: "push-upstream", enabled: true }];
    return [];
  }

  if (hasDirtyWorktree && snapshot.behind > 0) {
    return [
      { id: "commit", enabled: true },
      { id: "stash+rebase", enabled: true },
    ];
  }

  if (hasDirtyWorktree && snapshot.ahead > 0) {
    return [
      { id: "commit", enabled: true },
      { id: "push", enabled: false },
    ];
  }

  if (hasDirtyWorktree) {
    return [{ id: "commit", enabled: true }];
  }

  if (snapshot.ahead > 0 && snapshot.behind === 0) {
    return [{ id: "push", enabled: options.postCommitRescanPending !== true }];
  }

  if (snapshot.behind > 0 && snapshot.ahead === 0) {
    return [{ id: "pull", enabled: true }];
  }

  return [];
}

function buildStatusLine(snapshot: RepoSnapshot): string {
  if (snapshot.branch === null) {
    return "detached HEAD";
  }

  if (snapshot.upstreamState === "orphaned_upstream") {
    return `${snapshot.branch} · upstream unreachable`;
  }

  if (
    snapshot.upstreamState === "missing_upstream_remote_exists" ||
    snapshot.upstreamState === "missing_upstream_remote_missing"
  ) {
    return `${snapshot.branch} · no upstream`;
  }

  if (snapshot.ahead > 0 && snapshot.behind > 0) {
    return `${snapshot.branch} ⇅`;
  }

  if (snapshot.ahead > 0) {
    return `${snapshot.branch} ↑${snapshot.ahead}`;
  }

  if (snapshot.behind > 0) {
    return `${snapshot.branch} ↓${snapshot.behind}`;
  }

  return `${snapshot.branch} ✓`;
}

function buildBlockedReason(snapshot: RepoSnapshot, hasDirtyWorktree: boolean): string | null {
  if (snapshot.branch === null) return "detached HEAD";
  if (snapshot.upstreamState === "orphaned_upstream") return "upstream unreachable";
  if (
    !hasDirtyWorktree &&
    snapshot.upstreamState === "missing_upstream_remote_missing" &&
    snapshot.commitsToPushCount === 0
  ) {
    return "no commits to publish";
  }
  return null;
}

function countDirtyFiles(snapshot: RepoSnapshot): number {
  return (
    snapshot.dirty.modified.length +
    snapshot.dirty.untracked.length +
    snapshot.dirty.deleted.length +
    snapshot.dirty.renamed.length
  );
}

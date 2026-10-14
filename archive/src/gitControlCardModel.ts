import type { RepoSnapshot } from "./types.js";

export type GitControlActionId = "commit" | "push";

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
  _options: GitControlCardOptions = {},
): GitControlCardModel {
  if (snapshot.initializable) {
    return {
      actions: [],
      blockedReason: "not a Git repository",
      dirtyLine: "not initialized",
      selfMutationWarning: null,
      stashLine: null,
      statusLine: "local directory · Git not initialized",
    };
  }
  const dirtyFileCount = countDirtyFiles(snapshot);
  const hasDirtyWorktree = dirtyFileCount > 0;
  const actions = buildActions(snapshot, hasDirtyWorktree);
  const blockedReason = buildBlockedReason(snapshot, actions);

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
): GitControlAction[] {
  if (snapshot.branch === null) return [];
  const actions: GitControlAction[] = [];
  if (hasDirtyWorktree && (snapshot.dirty.unmerged?.length ?? 0) === 0) {
    actions.push({ id: "commit", enabled: true });
  }
  const hasCommitsToPublish = snapshot.ahead > 0 || snapshot.commitsToPushCount > 0;
  if (
    hasCommitsToPublish &&
    snapshot.upstreamState !== "remote_check_failed" &&
    /^https:\/\/github\.com\//.test(snapshot.remote)
  ) {
    actions.push({ id: "push", enabled: true });
  }
  return actions;
}

function buildStatusLine(snapshot: RepoSnapshot): string {
  if (snapshot.branch === null) {
    return "detached HEAD";
  }

  if (snapshot.upstreamState === "orphaned_upstream") {
    return `${snapshot.branch} · upstream unreachable`;
  }

  if (snapshot.upstreamState === "remote_check_failed") {
    return `${snapshot.branch} · remote check failed`;
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

function buildBlockedReason(snapshot: RepoSnapshot, actions: GitControlAction[]): string | null {
  if (snapshot.branch === null) return "detached HEAD";
  if ((snapshot.dirty.unmerged?.length ?? 0) > 0 && actions.length === 0) return "unresolved conflicts";
  return null;
}

function countDirtyFiles(snapshot: RepoSnapshot): number {
  return (
    snapshot.dirty.modified.length +
    snapshot.dirty.untracked.length +
    snapshot.dirty.deleted.filter((path) => !/^HANDOVER_[^/]+\.md$/.test(path)).length +
    snapshot.dirty.renamed.length +
    (snapshot.dirty.unmerged?.length ?? 0)
  );
}

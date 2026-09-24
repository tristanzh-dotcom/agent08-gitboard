export interface LargeFile {
  path: string;
  bytes: number;
}

export type RemoteBranchState = "exists" | "missing" | "unknown";
export type RepoKind = "business" | "platform" | "governance";
export type RepoLifecycle = "active" | "retired" | "unpublished";
export type ObservationState = "verified" | "unverified";
export type RepoTruthState = "clean" | "dirty" | "unknown";
export type PushabilityState = "pushable" | "not_pushable" | "unknown";
export type ChangeStatus = "added" | "modified" | "untracked" | "deleted" | "renamed" | "unmerged";

export interface RepoManifestEntry {
  id: string;
  agent: string | null;
  ownerId?: string;
  kind?: RepoKind;
  lifecycle?: RepoLifecycle;
  label: string;
  path: string;
  remote: string;
  visibility: "public" | "private" | "local";
  required: boolean;
}

export interface RepoManifest {
  version: 1 | 2;
  root: string;
  generatedAt: string;
  targets: RepoManifestEntry[];
}

export interface PublicRepositorySnapshot {
  repoId: string;
  label: string;
  kind: RepoKind;
  ownerId: string;
  lifecycle: RepoLifecycle;
  availability: "git_repository" | "uninitialized_directory" | "missing" | "unknown";
  observation: {
    state: ObservationState;
    observedAt: string;
    reasonCode: string | null;
  };
  repoTruth: {
    state: RepoTruthState;
    changeCount: number;
    conflictCount: number;
    changes: Array<{ path: string; status: ChangeStatus }>;
  };
  branch: {
    state: "attached" | "detached" | "unborn" | "unknown";
    name: string | null;
  };
  pushability: {
    state: PushabilityState;
    commitCount: number;
    ahead: number;
    behind: number;
    reasonCode: string | null;
  };
  actions: {
    commit: { state: "enabled" | "disabled"; reasonCode: string | null };
    push: { state: "enabled" | "disabled"; reasonCode: string | null };
  };
}

export interface GitControlScanResponse {
  schemaVersion: 2;
  observation: {
    state: ObservationState;
    observedAt: string | null;
    reasonCode: string | null;
  };
  repositories: PublicRepositorySnapshot[];
}

export interface GitControlRepoDetailResponse {
  schemaVersion: 2;
  repository: PublicRepositorySnapshot;
  stashCount: number;
}

export interface RepoSnapshot {
  id: string;
  observationState?: ObservationState;
  observationReasonCode?: string | null;
  path: string;
  remote: string;
  exists: boolean;
  initializable: boolean;
  branch: string | null;
  upstream: string | null;
  remoteTrackingBranch: string | null;
  remoteHasBranch: boolean;
  upstreamState:
    | "tracked"
    | "orphaned_upstream"
    | "missing_upstream_remote_exists"
    | "missing_upstream_remote_missing"
    | "remote_check_failed"
    | "detached"
    | "unknown";
  ahead: number;
  behind: number;
  commitsToPushCount: number;
  commitsToPushSubjects: string[];
  lastCommit: {
    sha: string | null;
    subject: string | null;
    authorDate: string | null;
  };
  dirty: {
    added?: string[];
    modified: string[];
    untracked: string[];
    deleted: string[];
    renamed: string[];
    unmerged?: string[];
    stashCount: number;
    largeFiles: LargeFile[];
  };
  diffStat: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  healthScore: {
    total: number;
    cleanliness: number;
    commitFreshness: number;
    binaryRatio: number;
    conventionalCompliance: number;
    reasons: string[];
  };
}

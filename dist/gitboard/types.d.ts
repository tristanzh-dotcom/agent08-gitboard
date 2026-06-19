export interface LargeFile {
    path: string;
    bytes: number;
}
export interface RepoManifestEntry {
    id: string;
    agent: string | null;
    label: string;
    path: string;
    remote: string;
    visibility: "public" | "private" | "local";
    required: boolean;
}
export interface RepoManifest {
    version: 1;
    root: string;
    generatedAt: string;
    targets: RepoManifestEntry[];
}
export interface RepoSnapshot {
    id: string;
    path: string;
    remote: string;
    exists: boolean;
    branch: string | null;
    upstream: string | null;
    remoteTrackingBranch: string | null;
    remoteHasBranch: boolean;
    upstreamState: "tracked" | "orphaned_upstream" | "missing_upstream_remote_exists" | "missing_upstream_remote_missing" | "detached" | "unknown";
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
        modified: string[];
        untracked: string[];
        deleted: string[];
        renamed: string[];
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

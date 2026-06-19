import type { GitProxy } from "./gitProxy.js";
import type { RepoManifest, RepoManifestEntry, RepoSnapshot } from "./types.js";

export class RepoScanner {
  constructor(private readonly git: GitProxy) {}

  async scanAll(manifest: RepoManifest): Promise<RepoSnapshot[]> {
    return Promise.all(manifest.targets.map((target) => this.scanOne(target)));
  }

  private async scanOne(target: RepoManifestEntry): Promise<RepoSnapshot> {
    try {
      const [status, lastCommit, diffStat, stashList, largeFiles] = await Promise.all([
        this.git.statusPorcelain(target.path),
        this.git.lastCommit(target.path),
        this.git.diffStat(target.path),
        this.git.stashList(target.path),
        this.git.listLargeFiles(target.path, 1_000_000)
      ]);

      const parsedStatus = parseStatusPorcelain(status);
      const parsedCommit = parseLastCommit(lastCommit);
      const branch = normalizeBranch(parsedStatus.branch);
      const remoteTrackingBranch = branch ? `origin/${branch}` : null;
      const remoteHasBranch =
        branch && this.git.remoteHasBranch ? await this.git.remoteHasBranch(target.path, branch) : false;
      const commitsToPushSubjects =
        branch && this.git.commitsToPushSubjects
          ? (await this.git.commitsToPushSubjects(target.path, branch, remoteHasBranch)).slice(0, 5)
          : [];
      const upstreamState = determineUpstreamState({
        branch,
        upstream: parsedStatus.upstream,
        remoteHasBranch
      });

      return {
        id: target.id,
        path: target.path,
        remote: target.remote,
        exists: true,
        branch,
        upstream: parsedStatus.upstream,
        remoteTrackingBranch,
        remoteHasBranch,
        upstreamState,
        ahead: parsedStatus.ahead,
        behind: parsedStatus.behind,
        commitsToPushCount: commitsToPushSubjects.length,
        commitsToPushSubjects,
        lastCommit: parsedCommit,
        dirty: {
          ...parsedStatus.dirty,
          stashCount: countStashes(stashList),
          largeFiles
        },
        diffStat: parseDiffStat(diffStat),
        healthScore: emptyHealthScore()
      };
    } catch (error) {
      if (isMissingRepoError(error)) {
        return missingRepoSnapshot(target);
      }
      throw error;
    }
  }
}

function parseStatusPorcelain(status: string): Pick<
  RepoSnapshot,
  "branch" | "upstream" | "ahead" | "behind" | "dirty"
> {
  const dirty = {
    modified: [] as string[],
    untracked: [] as string[],
    deleted: [] as string[],
    renamed: [] as string[],
    stashCount: 0,
    largeFiles: []
  };
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;

  for (const line of status.split("\n").filter(Boolean)) {
    if (line.startsWith("# branch.head ")) {
      branch = line.slice("# branch.head ".length);
      continue;
    }
    if (line.startsWith("# branch.upstream ")) {
      upstream = line.slice("# branch.upstream ".length);
      continue;
    }
    if (line.startsWith("# branch.ab ")) {
      const match = line.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
      continue;
    }
    if (line.startsWith("? ")) {
      dirty.untracked.push(line.slice(2));
      continue;
    }
    if (line.startsWith("1 ")) {
      const parts = line.split(" ");
      const xy = parts[1] ?? "";
      const filePath = parts.slice(8).join(" ");
      if (!filePath) continue;
      if (xy.includes("D")) dirty.deleted.push(filePath);
      else if (xy.includes("M")) dirty.modified.push(filePath);
      continue;
    }
    if (line.startsWith("2 ")) {
      const tabIndex = line.indexOf("\t");
      if (tabIndex >= 0) {
        dirty.renamed.push(line.slice(tabIndex + 1));
      }
    }
  }

  return { branch, upstream, ahead, behind, dirty };
}

function parseLastCommit(raw: string): RepoSnapshot["lastCommit"] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { sha: null, subject: null, authorDate: null };
  }
  const [sha = null, subject = null, authorDate = null] = trimmed.split("|");
  return { sha, subject, authorDate };
}

function parseDiffStat(raw: string): RepoSnapshot["diffStat"] {
  return {
    filesChanged: numberBefore(raw, /(\d+)\s+files?\s+changed/),
    insertions: numberBefore(raw, /(\d+)\s+insertions?\(\+\)/),
    deletions: numberBefore(raw, /(\d+)\s+deletions?\(-\)/)
  };
}

function numberBefore(raw: string, pattern: RegExp): number {
  return Number(raw.match(pattern)?.[1] ?? 0);
}

function countStashes(raw: string): number {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function isMissingRepoError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /ENOENT|not a git repository|No such file|index\.lock|cannot read|Unable to read current working directory/i.test(
      error.message
    )
  );
}

function missingRepoSnapshot(target: RepoManifestEntry): RepoSnapshot {
  return {
    id: target.id,
    path: target.path,
    remote: target.remote,
    exists: false,
    branch: null,
    upstream: null,
    remoteTrackingBranch: null,
    remoteHasBranch: false,
    upstreamState: "unknown",
    ahead: 0,
    behind: 0,
    commitsToPushCount: 0,
    commitsToPushSubjects: [],
    lastCommit: { sha: null, subject: null, authorDate: null },
    dirty: {
      modified: [],
      untracked: [],
      deleted: [],
      renamed: [],
      stashCount: 0,
      largeFiles: []
    },
    diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    healthScore: emptyHealthScore()
  };
}

function normalizeBranch(branch: string | null): string | null {
  if (!branch || branch === "(detached)") return null;
  return branch;
}

function determineUpstreamState(input: {
  branch: string | null;
  upstream: string | null;
  remoteHasBranch: boolean;
}): RepoSnapshot["upstreamState"] {
  if (!input.branch) return "detached";
  if (input.upstream && input.remoteHasBranch) return "tracked";
  if (input.upstream && !input.remoteHasBranch) return "orphaned_upstream";
  if (!input.upstream && input.remoteHasBranch) return "missing_upstream_remote_exists";
  if (!input.upstream && !input.remoteHasBranch) return "missing_upstream_remote_missing";
  return "unknown";
}

function emptyHealthScore(): RepoSnapshot["healthScore"] {
  return {
    total: 0,
    cleanliness: 0,
    commitFreshness: 0,
    binaryRatio: 0,
    conventionalCompliance: 0,
    reasons: []
  };
}

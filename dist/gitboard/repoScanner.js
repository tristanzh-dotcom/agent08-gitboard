import { stat } from "node:fs/promises";
const realRepoPathProbe = {
    async exists(path) {
        try {
            return (await stat(path)).isDirectory();
        }
        catch {
            return false;
        }
    },
};
export class RepoScanner {
    git;
    pathProbe;
    constructor(git, pathProbe = realRepoPathProbe) {
        this.git = git;
        this.pathProbe = pathProbe;
    }
    async scanAll(manifest) {
        return Promise.all(manifest.targets.map((target) => this.scanOne(target)));
    }
    async scanOne(target) {
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
            const remoteBranchState = branch ? await this.remoteBranchState(target.path, branch) : "unknown";
            const remoteHasBranch = remoteBranchState === "exists";
            const commitsToPushSubjects = branch && remoteBranchState !== "unknown" && this.git.commitsToPushSubjects
                ? (await this.git.commitsToPushSubjects(target.path, branch, remoteHasBranch)).slice(0, 5)
                : [];
            const upstreamState = determineUpstreamState({
                branch,
                upstream: parsedStatus.upstream,
                remoteBranchState
            });
            return {
                id: target.id,
                path: target.path,
                remote: target.remote,
                exists: true,
                initializable: false,
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
        }
        catch (error) {
            if (isNotGitRepositoryError(error)) {
                return missingRepoSnapshot(target, await this.pathProbe.exists(target.path));
            }
            if (isMissingRepoError(error)) {
                return missingRepoSnapshot(target);
            }
            throw error;
        }
    }
    async remoteBranchState(repoPath, branch) {
        if (this.git.remoteBranchState)
            return this.git.remoteBranchState(repoPath, branch);
        if (this.git.remoteHasBranch)
            return (await this.git.remoteHasBranch(repoPath, branch)) ? "exists" : "missing";
        return "unknown";
    }
}
function parseStatusPorcelain(status) {
    const dirty = {
        modified: [],
        untracked: [],
        deleted: [],
        renamed: [],
        unmerged: [],
        stashCount: 0,
        largeFiles: []
    };
    let branch = null;
    let upstream = null;
    let ahead = 0;
    let behind = 0;
    const records = status.includes("\0") ? status.split("\0") : status.split("\n");
    for (const line of records.filter(Boolean)) {
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
            if (!filePath)
                continue;
            if (xy.includes("D"))
                dirty.deleted.push(filePath);
            else if (xy.includes("M"))
                dirty.modified.push(filePath);
            continue;
        }
        if (line.startsWith("2 ")) {
            const tabIndex = line.indexOf("\t");
            const filePath = tabIndex >= 0 ? line.slice(tabIndex + 1) : line.split(" ").slice(9).join(" ");
            if (filePath)
                dirty.renamed.push(filePath);
            continue;
        }
        if (line.startsWith("u ")) {
            const filePath = line.split(" ").slice(10).join(" ");
            if (filePath)
                dirty.unmerged.push(filePath);
        }
    }
    return { branch, upstream, ahead, behind, dirty };
}
function parseLastCommit(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
        return { sha: null, subject: null, authorDate: null };
    }
    const [sha = null, subject = null, authorDate = null] = trimmed.split("|");
    return { sha, subject, authorDate };
}
function parseDiffStat(raw) {
    return {
        filesChanged: numberBefore(raw, /(\d+)\s+files?\s+changed/),
        insertions: numberBefore(raw, /(\d+)\s+insertions?\(\+\)/),
        deletions: numberBefore(raw, /(\d+)\s+deletions?\(-\)/)
    };
}
function numberBefore(raw, pattern) {
    return Number(raw.match(pattern)?.[1] ?? 0);
}
function countStashes(raw) {
    return raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean).length;
}
function isMissingRepoError(error) {
    return (error instanceof Error &&
        /ENOENT|not a git repository|No such file|index\.lock|cannot read|Unable to read current working directory/i.test(error.message));
}
function isNotGitRepositoryError(error) {
    return error instanceof Error && /not a git repository/i.test(error.message);
}
function missingRepoSnapshot(target, initializable = false) {
    return {
        id: target.id,
        path: target.path,
        remote: target.remote,
        exists: false,
        initializable,
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
            unmerged: [],
            stashCount: 0,
            largeFiles: []
        },
        diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
        healthScore: emptyHealthScore()
    };
}
function normalizeBranch(branch) {
    if (!branch || branch === "(detached)")
        return null;
    return branch;
}
function determineUpstreamState(input) {
    if (!input.branch)
        return "detached";
    if (input.remoteBranchState === "unknown")
        return "remote_check_failed";
    if (input.upstream && input.remoteBranchState === "exists")
        return "tracked";
    if (input.upstream && input.remoteBranchState === "missing")
        return "orphaned_upstream";
    if (!input.upstream && input.remoteBranchState === "exists")
        return "missing_upstream_remote_exists";
    if (!input.upstream && input.remoteBranchState === "missing")
        return "missing_upstream_remote_missing";
    return "unknown";
}
function emptyHealthScore() {
    return {
        total: 0,
        cleanliness: 0,
        commitFreshness: 0,
        binaryRatio: 0,
        conventionalCompliance: 0,
        reasons: []
    };
}
//# sourceMappingURL=repoScanner.js.map
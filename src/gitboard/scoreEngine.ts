import type { RepoSnapshot } from "./types.js";

export class ScoreEngine {
  static score(snapshot: RepoSnapshot, now: Date): RepoSnapshot["healthScore"] {
    const reasons: string[] = [];

    const cleanliness = scoreCleanliness(snapshot, reasons);
    const commitFreshness = scoreCommitFreshness(snapshot, now, reasons);
    const binaryRatio = scoreBinaryRatio(snapshot, reasons);
    const conventionalCompliance = scoreConventionalCompliance(snapshot, reasons);

    return {
      total: cleanliness + commitFreshness + binaryRatio + conventionalCompliance,
      cleanliness,
      commitFreshness,
      binaryRatio,
      conventionalCompliance,
      reasons
    };
  }
}

function scoreCleanliness(snapshot: RepoSnapshot, reasons: string[]): number {
  const dirtyCount =
    snapshot.dirty.modified.length +
    snapshot.dirty.untracked.length +
    snapshot.dirty.deleted.length +
    snapshot.dirty.renamed.length +
    snapshot.dirty.stashCount;

  if (dirtyCount === 0) return 40;

  reasons.push("dirty working tree");
  return Math.max(0, 40 - dirtyCount * 10);
}

function scoreCommitFreshness(snapshot: RepoSnapshot, now: Date, reasons: string[]): number {
  if (!snapshot.lastCommit.sha || !snapshot.lastCommit.authorDate) {
    reasons.push("no commits");
    return 0;
  }

  const authorDate = new Date(snapshot.lastCommit.authorDate);
  if (Number.isNaN(authorDate.getTime())) {
    reasons.push("invalid commit date");
    return 0;
  }

  const ageDays = Math.max(0, (now.getTime() - authorDate.getTime()) / 86_400_000);
  if (ageDays <= 14) return 30;

  reasons.push("stale commit");
  return Math.max(0, 30 - Math.ceil(ageDays - 14) * 2);
}

function scoreBinaryRatio(snapshot: RepoSnapshot, reasons: string[]): number {
  if (snapshot.dirty.largeFiles.length === 0) return 20;

  reasons.push("large files over 1MB");
  return Math.max(0, 20 - snapshot.dirty.largeFiles.length * 10);
}

function scoreConventionalCompliance(snapshot: RepoSnapshot, reasons: string[]): number {
  if (!snapshot.lastCommit.sha || !snapshot.lastCommit.subject) {
    if (!reasons.includes("no commits")) reasons.push("no commits");
    return 0;
  }

  if (/^(feat|fix|docs|test|chore|refactor|perf|build|ci)(\(.+\))?: .+/.test(snapshot.lastCommit.subject)) {
    return 10;
  }

  reasons.push("non-conventional commit subject");
  return 0;
}

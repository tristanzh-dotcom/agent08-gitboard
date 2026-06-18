import type { RepoSnapshot } from "./types.js";

export interface ReleaseChecklistItem {
  id: string;
  ready: boolean;
  blockers: string[];
  warnings: string[];
}

export class ReleaseChecklist {
  static check(snapshots: RepoSnapshot[], now: Date): ReleaseChecklistItem[] {
    return snapshots.map((snapshot) => {
      const blockers: string[] = [];
      const warnings: string[] = [];

      if (dirtyFileCount(snapshot) > 0) blockers.push("dirty files present");
      if (snapshot.behind > 0) blockers.push("remote is ahead");
      if (isStale(snapshot, now)) warnings.push("last commit older than 14 days");
      if (snapshot.dirty.largeFiles.length > 0) blockers.push("large files over 1MB present");

      return {
        id: snapshot.id,
        ready: blockers.length === 0,
        blockers,
        warnings
      };
    });
  }
}

function dirtyFileCount(snapshot: RepoSnapshot): number {
  return (
    snapshot.dirty.modified.length +
    snapshot.dirty.untracked.length +
    snapshot.dirty.deleted.length +
    snapshot.dirty.renamed.length
  );
}

function isStale(snapshot: RepoSnapshot, now: Date): boolean {
  if (!snapshot.lastCommit.authorDate) return false;
  const authorDate = new Date(snapshot.lastCommit.authorDate);
  if (Number.isNaN(authorDate.getTime())) return false;
  return (now.getTime() - authorDate.getTime()) / 86_400_000 > 14;
}

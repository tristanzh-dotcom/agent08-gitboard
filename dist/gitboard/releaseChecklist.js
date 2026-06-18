export class ReleaseChecklist {
    static check(snapshots, now) {
        return snapshots.map((snapshot) => {
            const blockers = [];
            const warnings = [];
            if (dirtyFileCount(snapshot) > 0)
                blockers.push("dirty files present");
            if (snapshot.behind > 0)
                blockers.push("remote is ahead");
            if (isStale(snapshot, now))
                warnings.push("last commit older than 14 days");
            if (snapshot.dirty.largeFiles.length > 0)
                blockers.push("large files over 1MB present");
            return {
                id: snapshot.id,
                ready: blockers.length === 0,
                blockers,
                warnings
            };
        });
    }
}
function dirtyFileCount(snapshot) {
    return (snapshot.dirty.modified.length +
        snapshot.dirty.untracked.length +
        snapshot.dirty.deleted.length +
        snapshot.dirty.renamed.length);
}
function isStale(snapshot, now) {
    if (!snapshot.lastCommit.authorDate)
        return false;
    const authorDate = new Date(snapshot.lastCommit.authorDate);
    if (Number.isNaN(authorDate.getTime()))
        return false;
    return (now.getTime() - authorDate.getTime()) / 86_400_000 > 14;
}
//# sourceMappingURL=releaseChecklist.js.map
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
export class SnapshotStore {
    root;
    constructor(root) {
        this.root = root;
    }
    static diff(before, after) {
        const beforeById = new Map(before.map((snapshot) => [snapshot.id, snapshot]));
        return after.map((current) => {
            const previous = beforeById.get(current.id);
            return {
                id: current.id,
                dirtyDelta: dirtyCount(current) - dirtyCount(previous),
                aheadDelta: current.ahead - (previous?.ahead ?? 0),
                behindDelta: current.behind - (previous?.behind ?? 0),
                scoreDelta: current.healthScore.total - (previous?.healthScore.total ?? 0)
            };
        });
    }
    async save(snapshotId, snapshots) {
        const dir = join(this.root, "storage", "snapshots");
        await mkdir(dir, { recursive: true });
        const filePath = join(dir, `${snapshotId}.json`);
        await writeFile(filePath, `${JSON.stringify({ version: 1, snapshotId, generatedAt: new Date().toISOString(), snapshots }, null, 2)}\n`, "utf8");
        return filePath;
    }
}
function dirtyCount(snapshot) {
    if (!snapshot)
        return 0;
    return (snapshot.dirty.modified.length +
        snapshot.dirty.untracked.length +
        snapshot.dirty.deleted.length +
        snapshot.dirty.renamed.length +
        (snapshot.dirty.unmerged?.length ?? 0) +
        snapshot.dirty.stashCount +
        snapshot.dirty.largeFiles.length);
}
//# sourceMappingURL=snapshotStore.js.map
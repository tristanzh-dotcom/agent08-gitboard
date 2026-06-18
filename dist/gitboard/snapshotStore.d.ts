import type { RepoSnapshot } from "./types.js";
export interface SnapshotDelta {
    id: string;
    dirtyDelta: number;
    aheadDelta: number;
    behindDelta: number;
    scoreDelta: number;
}
export declare class SnapshotStore {
    private readonly root;
    constructor(root: string);
    static diff(before: RepoSnapshot[], after: RepoSnapshot[]): SnapshotDelta[];
    save(snapshotId: string, snapshots: RepoSnapshot[]): Promise<string>;
}

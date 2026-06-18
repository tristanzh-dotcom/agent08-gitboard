import type { RepoSnapshot } from "./types.js";
export interface ReleaseChecklistItem {
    id: string;
    ready: boolean;
    blockers: string[];
    warnings: string[];
}
export declare class ReleaseChecklist {
    static check(snapshots: RepoSnapshot[], now: Date): ReleaseChecklistItem[];
}

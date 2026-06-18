import type { RepoSnapshot } from "./types.js";
export declare class ScoreEngine {
    static score(snapshot: RepoSnapshot, now: Date): RepoSnapshot["healthScore"];
}

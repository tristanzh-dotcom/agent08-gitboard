import type { LargeFile } from "./types.js";
export interface GitProxy {
    statusPorcelain(repoPath: string): Promise<string>;
    lastCommit(repoPath: string): Promise<string>;
    diffStat(repoPath: string): Promise<string>;
    stashList(repoPath: string): Promise<string>;
    listLargeFiles(repoPath: string, thresholdBytes: number): Promise<LargeFile[]>;
}

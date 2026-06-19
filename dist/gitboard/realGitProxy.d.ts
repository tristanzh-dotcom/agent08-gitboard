import type { GitProxy } from "./gitProxy.js";
import type { LargeFile } from "./types.js";
export declare class RealGitProxy implements GitProxy {
    statusPorcelain(repoPath: string): Promise<string>;
    lastCommit(repoPath: string): Promise<string>;
    diffStat(repoPath: string): Promise<string>;
    stashList(repoPath: string): Promise<string>;
    remoteHasBranch(repoPath: string, branch: string): Promise<boolean>;
    commitsToPushSubjects(repoPath: string, branch: string, remoteHasBranch: boolean): Promise<string[]>;
    listLargeFiles(repoPath: string, thresholdBytes: number): Promise<LargeFile[]>;
}
export declare function assertReadOnlyGitArgs(args: string[]): void;

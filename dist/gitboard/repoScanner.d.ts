import type { GitProxy } from "./gitProxy.js";
import type { RepoManifest, RepoSnapshot } from "./types.js";
export interface RepoPathProbe {
    exists(path: string): Promise<boolean>;
}
export declare class RepoScanner {
    private readonly git;
    private readonly pathProbe;
    constructor(git: GitProxy, pathProbe?: RepoPathProbe);
    scanAll(manifest: RepoManifest): Promise<RepoSnapshot[]>;
    private scanOne;
    private remoteBranchState;
}

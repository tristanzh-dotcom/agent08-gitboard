import type { GitProxy } from "./gitProxy.js";
import type { RepoManifest, RepoSnapshot } from "./types.js";
export declare class RepoScanner {
    private readonly git;
    constructor(git: GitProxy);
    scanAll(manifest: RepoManifest): Promise<RepoSnapshot[]>;
    private scanOne;
}

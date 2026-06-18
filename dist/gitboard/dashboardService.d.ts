import type { GitProxy } from "./gitProxy.js";
import type { RepoManifest, RepoSnapshot } from "./types.js";
export interface DashboardTarget extends RepoSnapshot {
    name: string;
    health: RepoSnapshot["healthScore"];
}
export interface DashboardScanPayload {
    id: "agent08";
    name: "Git控制台";
    route: "/agent08";
    generated_at: string;
    targets: DashboardTarget[];
    summary: {
        total: number;
        ready: number;
        blocked: number;
        warnings: number;
        missing: number;
        average_health: number;
    };
}
export interface DashboardChecklistItem {
    id: string;
    name: string;
    ready: boolean;
    blockers: string[];
    warnings: string[];
    score: number;
}
export interface DashboardChecklistPayload {
    id: "agent08";
    generated_at: string;
    items: DashboardChecklistItem[];
    summary: {
        total: number;
        ready: number;
        blocked: number;
        warnings: number;
    };
}
export interface DashboardService {
    scan(): Promise<DashboardScanPayload>;
    checklist(): Promise<DashboardChecklistPayload>;
}
export interface DashboardServiceOptions {
    root?: string;
    manifest?: RepoManifest;
    git?: GitProxy;
    now?: () => Date;
}
export declare function createDashboardService({ root, manifest, git, now }?: DashboardServiceOptions): DashboardService;
export declare const dashboardService: DashboardService;

import { createDefaultManifest } from "./manifest.js";
import { RealGitProxy } from "./realGitProxy.js";
import { ReleaseChecklist } from "./releaseChecklist.js";
import { RepoScanner } from "./repoScanner.js";
import { ScoreEngine } from "./scoreEngine.js";
export function createDashboardService({ root = "/Users/tristanzh/agent", manifest = createDefaultManifest(root), git = new RealGitProxy(), now = () => new Date() } = {}) {
    const scanner = new RepoScanner(git);
    async function scoredTargets(currentTime) {
        const snapshots = await scanner.scanAll(manifest);
        return snapshots.map((snapshot) => {
            const health = ScoreEngine.score(snapshot, currentTime);
            return {
                ...snapshot,
                name: snapshot.id,
                healthScore: health,
                health
            };
        });
    }
    function checklistItems(targets, currentTime) {
        const scoresById = new Map(targets.map((target) => [target.id, target.health.total]));
        return ReleaseChecklist.check(targets, currentTime).map((item) => ({
            ...item,
            name: item.id,
            score: scoresById.get(item.id) ?? 0
        }));
    }
    async function scan() {
        const currentTime = now();
        const generatedAt = currentTime.toISOString();
        const targets = await scoredTargets(currentTime);
        const items = checklistItems(targets, currentTime);
        return {
            id: "agent08",
            name: "Git控制台",
            route: "/agent08",
            generated_at: generatedAt,
            targets,
            summary: summarizeScan(targets, items)
        };
    }
    async function checklist() {
        const currentTime = now();
        const targets = await scoredTargets(currentTime);
        const items = checklistItems(targets, currentTime);
        return {
            id: "agent08",
            generated_at: currentTime.toISOString(),
            items,
            summary: summarizeChecklist(items)
        };
    }
    return { scan, checklist };
}
export const dashboardService = createDashboardService();
function summarizeChecklist(items) {
    return {
        total: items.length,
        ready: items.filter((item) => item.ready).length,
        blocked: items.filter((item) => !item.ready).length,
        warnings: items.reduce((sum, item) => sum + item.warnings.length, 0)
    };
}
function summarizeScan(targets, items) {
    const totalScore = targets.reduce((sum, target) => sum + target.health.total, 0);
    return {
        ...summarizeChecklist(items),
        missing: targets.filter((target) => !target.exists).length,
        average_health: targets.length ? Math.round(totalScore / targets.length) : 0
    };
}
//# sourceMappingURL=dashboardService.js.map
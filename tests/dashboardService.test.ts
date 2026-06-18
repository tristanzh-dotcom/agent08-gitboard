import { describe, expect, test } from "vitest";
import { createDashboardService } from "../src/gitboard/dashboardService.js";
import type { GitProxy } from "../src/gitboard/gitProxy.js";

const cleanGit: GitProxy = {
  async statusPorcelain(_repoPath) {
    return [
      "# branch.oid abcdef1234567890",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +0 -0"
    ].join("\n");
  },
  async lastCommit(_repoPath) {
    return "abcdef1|feat(gitboard): expose dashboard service|2026-06-18T15:00:00.000Z";
  },
  async diffStat(_repoPath) {
    return "";
  },
  async stashList(_repoPath) {
    return "";
  },
  async listLargeFiles(_repoPath, _thresholdBytes) {
    return [];
  }
};

describe("dashboard service web adapter", () => {
  test("returns 9 repo scan payloads with scored health and release checklist summaries", async () => {
    const service = createDashboardService({
      root: "/Users/tristanzh/agent",
      git: cleanGit,
      now: () => new Date("2026-06-18T16:00:00.000Z")
    });

    const scan = await service.scan();
    const checklist = await service.checklist();

    expect(scan).toMatchObject({
      id: "agent08",
      name: "Git控制台",
      route: "/agent08",
      generated_at: "2026-06-18T16:00:00.000Z",
      summary: {
        total: 9,
        ready: 9,
        blocked: 0,
        warnings: 0,
        missing: 0,
        average_health: 100
      }
    });
    expect(scan.targets).toHaveLength(9);
    expect(scan.targets.map((target) => target.id)).toContain("agent08-gitboard");
    expect(scan.targets[0].health).toEqual({
      total: 100,
      cleanliness: 40,
      commitFreshness: 30,
      binaryRatio: 20,
      conventionalCompliance: 10,
      reasons: []
    });

    expect(checklist.summary).toEqual({
      total: 9,
      ready: 9,
      blocked: 0,
      warnings: 0
    });
    expect(checklist.items[0]).toEqual({
      id: "agent-tooling",
      name: "agent-tooling",
      ready: true,
      blockers: [],
      warnings: [],
      score: 100
    });
  });
});

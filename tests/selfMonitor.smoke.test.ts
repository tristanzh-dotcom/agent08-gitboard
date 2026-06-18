import { describe, expect, test } from "vitest";
import { RealGitProxy } from "../src/gitboard/realGitProxy.js";
import { RepoScanner } from "../src/gitboard/repoScanner.js";
import { ScoreEngine } from "../src/gitboard/scoreEngine.js";
import type { RepoManifest } from "../src/gitboard/types.js";

describe("Agent08 self-monitoring smoke", () => {
  test("scans agent08-gitboard itself with real read-only git commands", async () => {
    const repoPath = process.cwd();
    const manifest: RepoManifest = {
      version: 1,
      root: "/Users/tristanzh/agent",
      generatedAt: "2026-06-18T00:00:00.000Z",
      targets: [
        {
          id: "agent08-gitboard",
          agent: "Agent08",
          label: "Git Console",
          path: repoPath,
          remote: "https://github.com/tristanzh-dotcom/agent08-gitboard.git",
          visibility: "public",
          required: true
        }
      ]
    };

    const [snapshot] = await new RepoScanner(new RealGitProxy()).scanAll(manifest);
    const score = ScoreEngine.score(snapshot, new Date());

    expect(snapshot.id).toBe("agent08-gitboard");
    expect(snapshot.exists).toBe(true);
    expect(snapshot.branch).toBe("main");
    expect(snapshot.lastCommit.sha).toMatch(/^[0-9a-f]{7,}$/);
    expect(snapshot.lastCommit.subject).toBeTruthy();
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(100);
    expect(score.cleanliness + score.commitFreshness + score.binaryRatio + score.conventionalCompliance).toBe(
      score.total
    );
  });
});

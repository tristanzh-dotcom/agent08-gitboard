import { describe, expect, test } from "vitest";
import { createDefaultManifest } from "../src/gitboard/manifest.js";
import { RepoScanner } from "../src/gitboard/repoScanner.js";
import type { GitProxy } from "../src/gitboard/gitProxy.js";

const fakeGit: GitProxy = {
  async statusPorcelain(_repoPath) {
    return [
      "# branch.oid abcdef1234567890",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1"
    ].join("\n");
  },
  async lastCommit(_repoPath) {
    return "abcdef1|docs: restore repo split state|2026-06-18T15:00:00.000Z";
  },
  async diffStat(_repoPath) {
    return "3 files changed, 20 insertions(+), 4 deletions(-)";
  },
  async stashList(_repoPath) {
    return "";
  },
  async listLargeFiles(_repoPath, _thresholdBytes) {
    return [];
  }
};

describe("RepoScanner M1 multi-repo dashboard scan", () => {
  test("scans all 9 manifest targets including self-monitoring agent08", async () => {
    const manifest = createDefaultManifest("/Users/tristanzh/agent");
    const scanner = new RepoScanner(fakeGit);

    const snapshots = await scanner.scanAll(manifest);

    expect(snapshots).toHaveLength(9);
    expect(snapshots.map((snapshot) => snapshot.id)).toContain("agent08-gitboard");
    expect(snapshots[0]).toMatchObject({
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
      lastCommit: {
        sha: "abcdef1",
        subject: "docs: restore repo split state",
        authorDate: "2026-06-18T15:00:00.000Z"
      }
    });
  });
});

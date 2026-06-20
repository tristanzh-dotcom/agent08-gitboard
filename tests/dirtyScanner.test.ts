import { describe, expect, test } from "vitest";
import { RepoScanner } from "../src/gitboard/repoScanner.js";
import type { GitProxy } from "../src/gitboard/gitProxy.js";
import type { RepoManifest } from "../src/gitboard/types.js";

const manifest: RepoManifest = {
  version: 1,
  root: "/Users/tristanzh/agent",
  generatedAt: "2026-06-18T00:00:00.000Z",
  targets: [
    {
      id: "agent03-prs",
      agent: "Agent03",
      label: "Pet Services",
      path: "/Users/tristanzh/agent/agent03-prs",
      remote: "https://github.com/tristanzh-dotcom/agent03-prs.git",
      visibility: "public",
      required: true
    }
  ]
};

const fakeGit: GitProxy = {
  async statusPorcelain(_repoPath) {
    return [
      "# branch.head main",
      "1 .M N... 100644 100644 100644 a b workflows/mantou-dog/mcht_app.py",
      "? workflows/mantou-dog/data/timeseries_metrics.json"
    ].join("\n");
  },
  async lastCommit(_repoPath) {
    return "1234567|chore: restore repo split stash changes|2026-06-18T14:00:00.000Z";
  },
  async diffStat(_repoPath) {
    return "2 files changed, 12 insertions(+), 3 deletions(-)";
  },
  async stashList(_repoPath) {
    return "stash@{0}: On main: frozen\nstash@{1}: On main: residual";
  },
  async listLargeFiles(_repoPath, _thresholdBytes) {
    return [{ path: "workflows/mantou-dog/data/photo-export.bin", bytes: 1_200_000 }];
  }
};

describe("RepoScanner M2 dirty data scan", () => {
  test("reports modified files, untracked files, stash count, diff stat, and files over 1 MB", async () => {
    const scanner = new RepoScanner(fakeGit);

    const [snapshot] = await scanner.scanAll(manifest);

    expect(snapshot.dirty.modified).toEqual(["workflows/mantou-dog/mcht_app.py"]);
    expect(snapshot.dirty.untracked).toEqual(["workflows/mantou-dog/data/timeseries_metrics.json"]);
    expect(snapshot.dirty.stashCount).toBe(2);
    expect(snapshot.dirty.largeFiles).toEqual([
      { path: "workflows/mantou-dog/data/photo-export.bin", bytes: 1_200_000 }
    ]);
    expect(snapshot.diffStat).toEqual({ filesChanged: 2, insertions: 12, deletions: 3 });
  });

  test("returns exists:false when repo path is missing", async () => {
    const missingGit: GitProxy = {
      async statusPorcelain(_repoPath) {
        throw new Error("ENOENT");
      },
      async lastCommit(_repoPath) {
        throw new Error("ENOENT");
      },
      async diffStat(_repoPath) {
        throw new Error("ENOENT");
      },
      async stashList(_repoPath) {
        throw new Error("ENOENT");
      },
      async listLargeFiles(_repoPath, _thresholdBytes) {
        throw new Error("ENOENT");
      }
    };

    const [snapshot] = await new RepoScanner(missingGit).scanAll(manifest);

    expect(snapshot).toMatchObject({
      id: "agent03-prs",
      exists: false,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0
    });
    expect(snapshot.dirty.modified).toEqual([]);
    expect(snapshot.dirty.untracked).toEqual([]);
  });

  test("parses porcelain v2 rename rows using tab-delimited old and new paths", async () => {
    const renameGit: GitProxy = {
      async statusPorcelain(_repoPath) {
        return [
          "# branch.head main",
          "2 R. N... 100644 100644 100644 a b R100 workflows/old name.ts\tworkflows/new name.ts"
        ].join("\n");
      },
      async lastCommit(_repoPath) {
        return "1234567|chore: restore repo split stash changes|2026-06-18T14:00:00.000Z";
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

    const [snapshot] = await new RepoScanner(renameGit).scanAll(manifest);

    expect(snapshot.dirty.renamed).toEqual(["workflows/new name.ts"]);
  });

  test("reports porcelain v2 unmerged rows as conflicted dirty files", async () => {
    const unmergedGit: GitProxy = {
      async statusPorcelain(_repoPath) {
        return [
          "# branch.head main",
          "u UU N... 100644 100644 100644 100644 base ours theirs workflows/foreign-jv-china-watch/data/latest_card_payload.json"
        ].join("\n");
      },
      async lastCommit(_repoPath) {
        return "1234567|chore: restore repo split stash changes|2026-06-18T14:00:00.000Z";
      },
      async diffStat(_repoPath) {
        return "1 file changed, 12 insertions(+), 3 deletions(-)";
      },
      async stashList(_repoPath) {
        return "";
      },
      async listLargeFiles(_repoPath, _thresholdBytes) {
        return [];
      }
    };

    const [snapshot] = await new RepoScanner(unmergedGit).scanAll(manifest);

    expect(snapshot.dirty.unmerged).toEqual([
      "workflows/foreign-jv-china-watch/data/latest_card_payload.json"
    ]);
  });

  test("returns exists:false when git cannot acquire a stale index lock", async () => {
    const lockedGit: GitProxy = {
      async statusPorcelain(_repoPath) {
        throw new Error("fatal: Unable to create '.git/index.lock': File exists.");
      },
      async lastCommit(_repoPath) {
        return "";
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

    const [snapshot] = await new RepoScanner(lockedGit).scanAll(manifest);

    expect(snapshot.exists).toBe(false);
    expect(snapshot.dirty.modified).toEqual([]);
  });
});

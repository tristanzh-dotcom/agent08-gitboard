import { describe, expect, test } from "vitest";
import { ReleaseChecklist } from "../src/gitboard/releaseChecklist.js";
import type { RepoSnapshot } from "../src/gitboard/types.js";

const cleanSnapshot: RepoSnapshot = {
  id: "agent08-gitboard",
  path: "/Users/tristanzh/agent/agent08-gitboard",
  remote: "https://github.com/tristanzh-dotcom/agent08-gitboard.git",
  exists: true,
  branch: "main",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  lastCommit: {
    sha: "ed77a7f",
    subject: "fix(gitboard): harden real git proxy edge cases",
    authorDate: "2026-06-18T14:00:00.000Z"
  },
  dirty: {
    modified: [],
    untracked: [],
    deleted: [],
    renamed: [],
    stashCount: 0,
    largeFiles: []
  },
  diffStat: {
    filesChanged: 0,
    insertions: 0,
    deletions: 0
  },
  healthScore: {
    total: 100,
    cleanliness: 40,
    commitFreshness: 30,
    binaryRatio: 20,
    conventionalCompliance: 10,
    reasons: []
  }
};

describe("ReleaseChecklist S1 publishing checklist", () => {
  test("marks a clean current repo as ready", () => {
    const [item] = ReleaseChecklist.check([cleanSnapshot], new Date("2026-06-18T15:00:00.000Z"));

    expect(item).toEqual({
      id: "agent08-gitboard",
      ready: true,
      blockers: [],
      warnings: []
    });
  });

  test("blocks dirty, behind, and large-file repos while warning on stale commits", () => {
    const dirtyDivergedSnapshot: RepoSnapshot = {
      ...cleanSnapshot,
      id: "agent03-prs",
      behind: 2,
      lastCommit: {
        ...cleanSnapshot.lastCommit,
        authorDate: "2026-06-01T00:00:00.000Z"
      },
      dirty: {
        ...cleanSnapshot.dirty,
        modified: ["workflows/mantou-dog/mcht_app.py"],
        untracked: ["workflows/mantou-dog/data/timeseries_metrics.json"],
        largeFiles: [{ path: "workflows/mantou-dog/data/export.bin", bytes: 1_500_000 }]
      }
    };

    const [, item] = ReleaseChecklist.check(
      [cleanSnapshot, dirtyDivergedSnapshot],
      new Date("2026-06-18T15:00:00.000Z")
    );

    expect(item.ready).toBe(false);
    expect(item.blockers).toEqual([
      "dirty files present",
      "remote is ahead",
      "large files over 1MB present"
    ]);
    expect(item.warnings).toEqual(["last commit older than 14 days"]);
  });
});

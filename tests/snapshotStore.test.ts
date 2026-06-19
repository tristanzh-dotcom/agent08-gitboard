import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { SnapshotStore } from "../src/gitboard/snapshotStore.js";
import type { RepoSnapshot } from "../src/gitboard/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const baseSnapshot: RepoSnapshot = {
  id: "agent08-gitboard",
  path: "/Users/tristanzh/agent/agent08-gitboard",
  remote: "https://github.com/tristanzh-dotcom/agent08-gitboard.git",
  exists: true,
  branch: "main",
  upstream: "origin/main",
  remoteTrackingBranch: "origin/main",
  remoteHasBranch: true,
  upstreamState: "tracked",
  ahead: 0,
  behind: 0,
  commitsToPushCount: 0,
  commitsToPushSubjects: [],
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
    total: 95,
    cleanliness: 40,
    commitFreshness: 25,
    binaryRatio: 20,
    conventionalCompliance: 10,
    reasons: []
  }
};

describe("SnapshotStore S2 snapshot comparison", () => {
  test("diff returns per-repo dirty, ahead/behind, and score deltas", () => {
    const before = [
      baseSnapshot,
      { ...baseSnapshot, id: "agent03-prs", ahead: 1, healthScore: { ...baseSnapshot.healthScore, total: 80 } }
    ];
    const after = [
      {
        ...baseSnapshot,
        dirty: {
          ...baseSnapshot.dirty,
          modified: ["src/gitboard/repoScanner.ts"],
          untracked: ["storage/latest.json"]
        },
        ahead: 2,
        behind: 1,
        healthScore: { ...baseSnapshot.healthScore, total: 70 }
      },
      { ...baseSnapshot, id: "agent03-prs", ahead: 1, healthScore: { ...baseSnapshot.healthScore, total: 85 } }
    ];

    const diff = SnapshotStore.diff(before, after);

    expect(diff).toEqual([
      {
        id: "agent08-gitboard",
        dirtyDelta: 2,
        aheadDelta: 2,
        behindDelta: 1,
        scoreDelta: -25
      },
      {
        id: "agent03-prs",
        dirtyDelta: 0,
        aheadDelta: 0,
        behindDelta: 0,
        scoreDelta: 5
      }
    ]);
  });

  test("saves snapshots as JSON under Agent08-owned storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-storage-"));
    tempDirs.push(root);
    const store = new SnapshotStore(root);

    const filePath = await store.save("2026-06-18T15-00-00Z", [baseSnapshot]);
    const json = JSON.parse(await readFile(filePath, "utf8")) as { snapshots: RepoSnapshot[] };

    expect(filePath).toBe(join(root, "storage", "snapshots", "2026-06-18T15-00-00Z.json"));
    expect(json.snapshots).toHaveLength(1);
    expect(json.snapshots[0].id).toBe("agent08-gitboard");
  });
});

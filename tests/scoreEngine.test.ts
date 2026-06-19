import { describe, expect, test } from "vitest";
import { ScoreEngine } from "../src/gitboard/scoreEngine.js";
import type { RepoSnapshot } from "../src/gitboard/types.js";

const baseSnapshot: RepoSnapshot = {
  id: "agent-tooling",
  path: "/Users/tristanzh/agent/agent-tooling",
  remote: "https://github.com/tristanzh-dotcom/agent-tooling.git",
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
    sha: "abcdef1",
    subject: "chore: restore repo split stash changes",
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
    total: 0,
    cleanliness: 0,
    commitFreshness: 0,
    binaryRatio: 0,
    conventionalCompliance: 0,
    reasons: []
  }
};

describe("ScoreEngine M3 health scoring", () => {
  test("scores a clean fresh conventional repo at 100", () => {
    const score = ScoreEngine.score(baseSnapshot, new Date("2026-06-18T15:00:00.000Z"));

    expect(score).toEqual({
      total: 100,
      cleanliness: 40,
      commitFreshness: 30,
      binaryRatio: 20,
      conventionalCompliance: 10,
      reasons: []
    });
  });

  test("penalizes dirty state and large files with explicit reasons", () => {
    const dirtySnapshot: RepoSnapshot = {
      ...baseSnapshot,
      dirty: {
        ...baseSnapshot.dirty,
        modified: ["src/index.ts"],
        untracked: ["tmp/raw-export.json"],
        largeFiles: [{ path: "tmp/raw-export.json", bytes: 2_500_000 }]
      }
    };

    const score = ScoreEngine.score(dirtySnapshot, new Date("2026-06-18T15:00:00.000Z"));

    expect(score.total).toBeLessThan(100);
    expect(score.cleanliness).toBeLessThan(40);
    expect(score.binaryRatio).toBeLessThan(20);
    expect(score.reasons).toContain("dirty working tree");
    expect(score.reasons).toContain("large files over 1MB");
  });

  test("penalizes stale commits older than 14 days", () => {
    const staleSnapshot: RepoSnapshot = {
      ...baseSnapshot,
      lastCommit: {
        ...baseSnapshot.lastCommit,
        authorDate: "2026-06-01T00:00:00.000Z"
      }
    };

    const score = ScoreEngine.score(staleSnapshot, new Date("2026-06-18T00:00:00.000Z"));

    expect(score.commitFreshness).toBeLessThan(30);
    expect(score.reasons).toContain("stale commit");
  });

  test("penalizes non-conventional commit subjects", () => {
    const nonConventionalSnapshot: RepoSnapshot = {
      ...baseSnapshot,
      lastCommit: {
        ...baseSnapshot.lastCommit,
        subject: "updated stuff"
      }
    };

    const score = ScoreEngine.score(
      nonConventionalSnapshot,
      new Date("2026-06-18T15:00:00.000Z")
    );

    expect(score.conventionalCompliance).toBeLessThan(10);
    expect(score.reasons).toContain("non-conventional commit subject");
  });

  test("scores zero commits as 0 for commitFreshness and conventionalCompliance", () => {
    const emptySnapshot: RepoSnapshot = {
      ...baseSnapshot,
      lastCommit: {
        sha: null,
        subject: null,
        authorDate: null
      }
    };

    const score = ScoreEngine.score(emptySnapshot, new Date("2026-06-18T15:00:00.000Z"));

    expect(score.commitFreshness).toBe(0);
    expect(score.conventionalCompliance).toBe(0);
    expect(score.reasons).toContain("no commits");
  });
});

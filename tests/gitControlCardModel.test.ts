import { describe, expect, test } from "vitest";
import {
  buildCommitConfirmationModel,
  buildGitControlCardModel,
} from "../src/gitboard/gitControlCardModel.js";
import type { RepoSnapshot } from "../src/gitboard/types.js";

function snapshot(overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    id: "agent02-pvi",
    path: "/Users/tristanzh/agent/agent02-pvi",
    remote: "https://github.com/tristanzh-dotcom/agent02-pvi.git",
    exists: true,
    initializable: false,
    branch: "main",
    upstream: "origin/main",
    remoteTrackingBranch: "origin/main",
    remoteHasBranch: true,
    upstreamState: "tracked",
    ahead: 0,
    behind: 0,
    commitsToPushCount: 0,
    commitsToPushSubjects: [],
    lastCommit: { sha: "abc123", subject: "test: fixture", authorDate: "2026-07-30T00:00:00.000Z" },
    dirty: { modified: [], untracked: [], deleted: [], renamed: [], stashCount: 0, largeFiles: [] },
    diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    healthScore: {
      total: 100,
      cleanliness: 40,
      commitFreshness: 30,
      binaryRatio: 20,
      conventionalCompliance: 10,
      reasons: [],
    },
    ...overrides,
  };
}

describe("Git Control v1.4 card model", () => {
  test("exposes no Agent08 mutation for a non-Git development directory", () => {
    const card = buildGitControlCardModel(snapshot({
      exists: false,
      initializable: true,
      branch: null,
      upstream: null,
      upstreamState: "unknown",
    }));

    expect(card.actions).toEqual([]);
    expect(card.blockedReason).toBe("not a Git repository");
  });

  test("dirty repository exposes only final commit", () => {
    const card = buildGitControlCardModel(snapshot({
      dirty: { ...snapshot().dirty, modified: ["src/index.ts"], untracked: ["notes.md"] },
    }));

    expect(card.actions).toEqual([{ id: "commit", enabled: true }]);
    expect(card.dirtyLine).toBe("2 dirty");
  });

  test("dirty repository with existing commits to publish exposes commit and push", () => {
    const card = buildGitControlCardModel(snapshot({
      ahead: 2,
      commitsToPushCount: 2,
      dirty: { ...snapshot().dirty, modified: ["src/index.ts"] },
    }));

    expect(card.actions).toEqual([
      { id: "commit", enabled: true },
      { id: "push", enabled: true },
    ]);
  });

  test("unmerged development state blocks commit but not an existing final push", () => {
    const card = buildGitControlCardModel(snapshot({
      ahead: 1,
      commitsToPushCount: 1,
      dirty: { ...snapshot().dirty, unmerged: ["src/conflict.ts"] },
    }));

    expect(card.actions).toEqual([{ id: "push", enabled: true }]);
    expect(card.blockedReason).toBeNull();
  });

  test("behind state does not expose pull or rebase orchestration", () => {
    const clean = buildGitControlCardModel(snapshot({ behind: 1 }));
    const dirty = buildGitControlCardModel(snapshot({
      behind: 1,
      dirty: { ...snapshot().dirty, modified: ["src/index.ts"] },
    }));

    expect(clean.actions).toEqual([]);
    expect(dirty.actions).toEqual([{ id: "commit", enabled: true }]);
  });

  test("a new remote branch with local commits uses the same final push action", () => {
    const card = buildGitControlCardModel(snapshot({
      upstream: null,
      upstreamState: "missing_upstream_remote_missing",
      remoteHasBranch: false,
      commitsToPushCount: 1,
      commitsToPushSubjects: ["feat: local commit"],
    }));

    expect(card.actions).toEqual([{ id: "push", enabled: true }]);
    expect(card.actions.map((action) => action.id)).not.toContain("bootstrap_push");
  });

  test("detached HEAD exposes no finalization action", () => {
    const card = buildGitControlCardModel(snapshot({
      branch: null,
      ahead: 1,
      dirty: { ...snapshot().dirty, modified: ["README.md"] },
    }));

    expect(card.actions).toEqual([]);
    expect(card.blockedReason).toBe("detached HEAD");
  });

  test("requires a non-empty commit message in the confirmation model", () => {
    const model = buildCommitConfirmationModel({
      message: "  ",
      files: [{ path: "src/app.ts", insertions: 4, deletions: 1 }],
    });

    expect(model.canConfirm).toBe(false);
    expect(model.messageError).toBe("COMMIT_MESSAGE_REQUIRED");
    expect(model.fileRows).toEqual(["src/app.ts +4 -1"]);
  });
});

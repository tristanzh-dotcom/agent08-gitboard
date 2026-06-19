import { describe, expect, test } from "vitest";
import type { RepoSnapshot } from "../src/gitboard/types.js";

async function cardModels() {
  return import("../src/gitboard/gitControlCardModel.js");
}

function snapshot(overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    id: "agent02-pvi",
    path: "/Users/tristanzh/agent/agent02-pvi",
    remote: "https://github.com/tristanzh-dotcom/agent02-pvi.git",
    exists: true,
    branch: "main",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    lastCommit: { sha: "abc123", subject: "test: fixture", authorDate: "2026-06-19T00:00:00.000Z" },
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

describe("Git Control card model", () => {
  test("clean synced repo shows no mutation buttons", async () => {
    const { buildGitControlCardModel } = await cardModels();
    const card = buildGitControlCardModel(snapshot());

    expect(card.actions).toEqual([]);
    expect(card.statusLine).toBe("main ✓");
    expect(card.dirtyLine).toBe("clean");
  });

  test("dirty synced repo shows commit", async () => {
    const { buildGitControlCardModel } = await cardModels();
    const card = buildGitControlCardModel(
      snapshot({ dirty: { ...snapshot().dirty, modified: ["src/index.ts"], untracked: ["notes.md"] } }),
    );

    expect(card.actions.map((action) => [action.id, action.enabled])).toEqual([["commit", true]]);
    expect(card.dirtyLine).toBe("2 dirty");
  });

  test("clean ahead repo shows push", async () => {
    const { buildGitControlCardModel } = await cardModels();
    const card = buildGitControlCardModel(snapshot({ ahead: 2 }));

    expect(card.statusLine).toBe("main ↑2");
    expect(card.actions.map((action) => [action.id, action.enabled])).toEqual([["push", true]]);
  });

  test("dirty ahead repo keeps push disabled until post-commit rescan confirms clean", async () => {
    const { buildGitControlCardModel } = await cardModels();
    const dirtyAhead = buildGitControlCardModel(
      snapshot({ ahead: 2, dirty: { ...snapshot().dirty, modified: ["src/index.ts"] } }),
      { postCommitRescanPending: true },
    );
    expect(dirtyAhead.actions.map((action) => [action.id, action.enabled])).toEqual([
      ["commit", true],
      ["push", false],
    ]);

    const cleanAfterRescan = buildGitControlCardModel(snapshot({ ahead: 3 }), { postCommitRescanPending: false });
    expect(cleanAfterRescan.actions.map((action) => [action.id, action.enabled])).toEqual([["push", true]]);
  });

  test("clean behind repo shows pull", async () => {
    const { buildGitControlCardModel } = await cardModels();
    const card = buildGitControlCardModel(snapshot({ behind: 1 }));

    expect(card.statusLine).toBe("main ↓1");
    expect(card.actions.map((action) => [action.id, action.enabled])).toEqual([["pull", true]]);
  });

  test("dirty behind repo shows commit and stash+rebase", async () => {
    const { buildGitControlCardModel } = await cardModels();
    const card = buildGitControlCardModel(
      snapshot({ behind: 1, dirty: { ...snapshot().dirty, modified: ["src/index.ts"] } }),
    );

    expect(card.actions.map((action) => [action.id, action.enabled])).toEqual([
      ["commit", true],
      ["stash+rebase", true],
    ]);
  });

  test("stash line appears only when stash count is greater than zero", async () => {
    const { buildGitControlCardModel } = await cardModels();
    expect(buildGitControlCardModel(snapshot()).stashLine).toBeNull();
    expect(buildGitControlCardModel(snapshot({ dirty: { ...snapshot().dirty, stashCount: 2 } })).stashLine).toBe("stash: 2");
  });

  test("detached HEAD shows no mutation buttons and a blocked reason", async () => {
    const { buildGitControlCardModel } = await cardModels();
    const card = buildGitControlCardModel(snapshot({ branch: null, dirty: { ...snapshot().dirty, modified: ["README.md"] } }));

    expect(card.actions).toEqual([]);
    expect(card.blockedReason).toBe("detached HEAD");
  });

  test("agent08 self card shows running-code warning before self mutation", async () => {
    const { buildGitControlCardModel } = await cardModels();
    const card = buildGitControlCardModel(
      snapshot({
        id: "agent08-gitboard",
        path: "/Users/tristanzh/agent/agent08-gitboard",
        dirty: { ...snapshot().dirty, modified: ["src/gitboard/index.ts"] },
      }),
    );

    expect(card.selfMutationWarning).toMatch(/Running service code will not change until restart/);
  });
});

describe("commit confirmation model", () => {
  test("requires a non-empty commit message and shows per-file insertion and deletion counts", async () => {
    const { buildCommitConfirmationModel } = await cardModels();
    const model = buildCommitConfirmationModel({
      message: "  ",
      files: [
        { path: "src/gitboard/mutationSafetyGate.ts", insertions: 84, deletions: 2 },
        { path: "tests/mutationSafetyGate.test.ts", insertions: 211, deletions: 0 },
      ],
    });

    expect(model.canConfirm).toBe(false);
    expect(model.messageError).toBe("COMMIT_MESSAGE_REQUIRED");
    expect(model.fileRows).toEqual([
      "src/gitboard/mutationSafetyGate.ts +84 -2",
      "tests/mutationSafetyGate.test.ts +211 -0",
    ]);
  });
});

import { describe, expect, test } from "vitest";
import type { RepoSnapshot } from "../src/gitboard/types.js";

const allowedRepos = new Map([["agent02-pvi", "/Users/tristanzh/agent/agent02-pvi"]]);

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

async function gate(nowMs: number | (() => number) = 0) {
  const { MutationSafetyGate } = await import("../src/gitboard/mutationSafetyGate.js");
  return new MutationSafetyGate({ allowedRepos, now: typeof nowMs === "function" ? nowMs : () => nowMs });
}

function tokenFor(
  safetyGate: any,
  operation: "commit" | "push" | "pull_ff_only" | "stash_rebase",
  preflightSnapshotId = "snap-1",
): string {
  return safetyGate.createConfirmationToken({
    repoId: "agent02-pvi",
    operation,
    preflightSnapshotId,
    operationId: "op-1",
  }).token;
}

describe("MutationSafetyGate", () => {
  test("blocks repos outside the allowlist", async () => {
    const safetyGate = await gate();
    const confirmationToken = tokenFor(safetyGate, "commit");

    expect(() =>
      safetyGate.assertCanMutate({
        repoId: "unknown-repo",
        repoPath: "/Users/tristanzh/agent/unknown-repo",
        operation: "commit",
        preflightSnapshotId: "snap-1",
        confirmationToken,
        currentSnapshot: snapshot({ dirty: { ...snapshot().dirty, modified: ["README.md"] } }),
      }),
    ).toThrow(/REPO_NOT_ALLOWED/);
  });

  test("blocks repo paths that do not match the manifest allowlist", async () => {
    const safetyGate = await gate();
    const confirmationToken = tokenFor(safetyGate, "commit");

    expect(() =>
      safetyGate.assertCanMutate({
        repoId: "agent02-pvi",
        repoPath: "/Users/tristanzh/agent/agent02-pvi/../agent03-prs",
        operation: "commit",
        preflightSnapshotId: "snap-1",
        confirmationToken,
        currentSnapshot: snapshot({ dirty: { ...snapshot().dirty, modified: ["README.md"] } }),
      }),
    ).toThrow(/REPO_NOT_ALLOWED/);
  });

  test("blocks dirty pull", async () => {
    const safetyGate = await gate();
    const confirmationToken = tokenFor(safetyGate, "pull_ff_only");

    expect(() =>
      safetyGate.assertCanMutate({
        repoId: "agent02-pvi",
        repoPath: "/Users/tristanzh/agent/agent02-pvi",
        operation: "pull_ff_only",
        preflightSnapshotId: "snap-1",
        confirmationToken,
        currentSnapshot: snapshot({
          behind: 1,
          dirty: { ...snapshot().dirty, modified: ["src/index.ts"] },
        }),
      }),
    ).toThrow(/DIRTY_BLOCKS_PULL/);
  });

  test("blocks simple push and pull for diverged repos", async () => {
    const pushGate = await gate();
    const pushToken = tokenFor(pushGate, "push");
    expect(() =>
      pushGate.assertCanMutate({
        repoId: "agent02-pvi",
        repoPath: "/Users/tristanzh/agent/agent02-pvi",
        operation: "push",
        preflightSnapshotId: "snap-1",
        confirmationToken: pushToken,
        currentSnapshot: snapshot({ ahead: 1, behind: 1 }),
      }),
    ).toThrow(/DIVERGED_BLOCKS_SIMPLE_PUSH/);

    const pullGate = await gate();
    const pullToken = tokenFor(pullGate, "pull_ff_only");
    expect(() =>
      pullGate.assertCanMutate({
        repoId: "agent02-pvi",
        repoPath: "/Users/tristanzh/agent/agent02-pvi",
        operation: "pull_ff_only",
        preflightSnapshotId: "snap-1",
        confirmationToken: pullToken,
        currentSnapshot: snapshot({ ahead: 1, behind: 1 }),
      }),
    ).toThrow(/DIVERGED_BLOCKS_SIMPLE_PULL/);
  });

  test("blocks push when the branch is behind remote even without local commits", async () => {
    const safetyGate = await gate();
    const confirmationToken = tokenFor(safetyGate, "push");

    expect(() =>
      safetyGate.assertCanMutate({
        repoId: "agent02-pvi",
        repoPath: "/Users/tristanzh/agent/agent02-pvi",
        operation: "push",
        preflightSnapshotId: "snap-1",
        confirmationToken,
        currentSnapshot: snapshot({ ahead: 0, behind: 1 }),
      }),
    ).toThrow(/DIVERGED_BLOCKS_SIMPLE_PUSH/);
  });

  test("blocks dirty push with a push-specific error code", async () => {
    const safetyGate = await gate();
    const confirmationToken = tokenFor(safetyGate, "push");

    expect(() =>
      safetyGate.assertCanMutate({
        repoId: "agent02-pvi",
        repoPath: "/Users/tristanzh/agent/agent02-pvi",
        operation: "push",
        preflightSnapshotId: "snap-1",
        confirmationToken,
        currentSnapshot: snapshot({
          ahead: 1,
          dirty: { ...snapshot().dirty, modified: ["src/index.ts"] },
        }),
      }),
    ).toThrow(/DIRTY_BLOCKS_PUSH/);
  });

  test("blocks detached HEAD and in-progress merge or rebase states", async () => {
    const detachedGate = await gate();
    const detachedToken = tokenFor(detachedGate, "commit");
    expect(() =>
      detachedGate.assertCanMutate({
        repoId: "agent02-pvi",
        repoPath: "/Users/tristanzh/agent/agent02-pvi",
        operation: "commit",
        preflightSnapshotId: "snap-1",
        confirmationToken: detachedToken,
        currentSnapshot: snapshot({
          branch: null,
          dirty: { ...snapshot().dirty, modified: ["README.md"] },
        }),
      }),
    ).toThrow(/DETACHED_HEAD_BLOCKS_MUTATION/);

    const mergeGate = await gate();
    const mergeToken = tokenFor(mergeGate, "push");
    expect(() =>
      mergeGate.assertCanMutate({
        repoId: "agent02-pvi",
        repoPath: "/Users/tristanzh/agent/agent02-pvi",
        operation: "push",
        preflightSnapshotId: "snap-1",
        confirmationToken: mergeToken,
        currentSnapshot: snapshot({ ahead: 1 }),
        mergeInProgress: true,
      }),
    ).toThrow(/MERGE_OR_REBASE_IN_PROGRESS/);
  });

  test("blocks upstream-required operations when upstream is missing", async () => {
    const safetyGate = await gate();
    const confirmationToken = tokenFor(safetyGate, "push");

    expect(() =>
      safetyGate.assertCanMutate({
        repoId: "agent02-pvi",
        repoPath: "/Users/tristanzh/agent/agent02-pvi",
        operation: "push",
        preflightSnapshotId: "snap-1",
        confirmationToken,
        currentSnapshot: snapshot({ upstream: null, ahead: 1 }),
      }),
    ).toThrow(/UPSTREAM_MISSING/);
  });

  test("blocks missing, expired, reused, and mismatched confirmation tokens", async () => {
    const missingGate = await gate();
    expect(() =>
      missingGate.assertCanMutate({
        repoId: "agent02-pvi",
        repoPath: "/Users/tristanzh/agent/agent02-pvi",
        operation: "push",
        preflightSnapshotId: "snap-1",
        confirmationToken: "",
        currentSnapshot: snapshot({ ahead: 1 }),
      }),
    ).toThrow(/CONFIRMATION_TOKEN_REQUIRED/);

    let clockMs = 0;
    const expiredGate = await gate(() => clockMs);
    const expiredToken = tokenFor(expiredGate, "push");
    clockMs = 61_000;
    expect(() =>
      expiredGate.assertCanMutate({
        repoId: "agent02-pvi",
        repoPath: "/Users/tristanzh/agent/agent02-pvi",
        operation: "push",
        preflightSnapshotId: "snap-1",
        confirmationToken: expiredToken,
        currentSnapshot: snapshot({ ahead: 1 }),
      }),
    ).toThrow(/CONFIRMATION_TOKEN_EXPIRED/);

    const reusedGate = await gate();
    const reusedToken = tokenFor(reusedGate, "push");
    const request = {
      repoId: "agent02-pvi",
      repoPath: "/Users/tristanzh/agent/agent02-pvi",
      operation: "push" as const,
      preflightSnapshotId: "snap-1",
      confirmationToken: reusedToken,
      currentSnapshot: snapshot({ ahead: 1 }),
    };
    expect(() => reusedGate.assertCanMutate(request)).not.toThrow();
    expect(() => reusedGate.assertCanMutate(request)).toThrow(/CONFIRMATION_TOKEN_USED/);

    const mismatchGate = await gate();
    const mismatchToken = tokenFor(mismatchGate, "push", "snap-1");
    expect(() =>
      mismatchGate.assertCanMutate({
        repoId: "agent02-pvi",
        repoPath: "/Users/tristanzh/agent/agent02-pvi",
        operation: "push",
        preflightSnapshotId: "snap-2",
        confirmationToken: mismatchToken,
        currentSnapshot: snapshot({ ahead: 1 }),
      }),
    ).toThrow(/CONFIRMATION_TOKEN_MISMATCH/);
  });
});

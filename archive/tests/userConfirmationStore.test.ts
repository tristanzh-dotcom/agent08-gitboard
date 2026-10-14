import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ExecutionCapabilityStore } from "../src/gitboard/executionCapabilityStore.js";
import type { PolicyDecision } from "../src/gitboard/machineOperationContracts.js";
import { UserConfirmationStore } from "../src/gitboard/userConfirmationStore.js";

const tempDirs: string[] = [];
let nowMs = Date.parse("2026-07-30T00:00:00.000Z");

afterEach(async () => {
  nowMs = Date.parse("2026-07-30T00:00:00.000Z");
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function decision(tier: 1 | 2 | 3 = 2): PolicyDecision {
  return {
    schemaVersion: 1,
    policyDecisionId: "decision-1",
    policyVersion: "agent08-git-control-v1.3-phase-b",
    operationId: "operation-1",
    operation: tier === 2 ? "promote_isolated_branch" : "prepare_isolated_worktree",
    operationTier: tier,
    authorizationMode: tier === 2 ? "user_confirmed" : tier === 3 ? "explicit_destructive_approval" : "machine_policy",
    principal: {
      kind: "codex_task",
      principalId: "principal-1",
      taskId: "task-1",
      sessionId: "session-1",
      credentialId: "credential-1",
    },
    repoId: "agent08-gitboard",
    repositoryIdentityDigest: "repo-identity-digest",
    taskId: "task-1",
    leaseId: null,
    parameterDigest: "parameter-digest",
    preflightDigest: "preflight-digest",
    decision: "allow",
    reasons: [],
    createdAt: "2026-07-30T00:00:00.000Z",
    expiresAt: "2026-07-30T00:01:00.000Z",
  };
}

async function createStore() {
  const root = await mkdtemp(join(tmpdir(), "agent08-phase-b-confirmation-"));
  tempDirs.push(root);
  return {
    root,
    store: new UserConfirmationStore(root, {
      now: () => new Date(nowMs),
      idGenerator: () => "confirmation-1",
      ttlMs: 30_000,
    }),
  };
}

describe("UserConfirmationStore", () => {
  test("issues only for Tier 2 or Tier 3 and remains separate from capability", async () => {
    const { root, store } = await createStore();
    await expect(
      store.issue({
        policyDecision: decision(1),
        confirmedBy: "TZ",
        confirmationSurface: "agent08_git_control",
        confirmedImpact: ["local branch promotion"],
      }),
    ).rejects.toMatchObject({ code: "USER_CONFIRMATION_NOT_ALLOWED" });

    const confirmation = await store.issue({
      policyDecision: decision(2),
      confirmedBy: "TZ",
      confirmationSurface: "agent08_git_control",
      confirmedImpact: ["local branch promotion"],
    });
    expect(confirmation).toMatchObject({
      userConfirmationId: "confirmation-1",
      operationId: "operation-1",
      policyDecisionId: "decision-1",
      confirmedParameterDigest: "parameter-digest",
      consumedAt: null,
    });

    await expect(
      new ExecutionCapabilityStore(root).consume({
        rawCapability: confirmation.userConfirmationId,
        expected: {
          policyDecisionId: "decision-1",
          operationId: "operation-1",
          operation: "promote_isolated_branch",
          principalId: "principal-1",
          repoId: "agent08-gitboard",
          repositoryIdentityDigest: "repo-identity-digest",
          taskId: "task-1",
          leaseId: null,
          parameterDigest: "parameter-digest",
          preflightDigest: "preflight-digest",
        },
      }),
    ).rejects.toMatchObject({ code: "CAPABILITY_MISMATCH" });
  });

  test("detects mismatch, expiry, single use, and restart state", async () => {
    const { root, store } = await createStore();
    const confirmation = await store.issue({
      policyDecision: decision(2),
      confirmedBy: "TZ",
      confirmationSurface: "agent08_git_control",
      confirmedImpact: ["local branch promotion"],
    });

    await expect(
      store.consume({
        userConfirmationId: confirmation.userConfirmationId,
        expected: {
          operationId: "operation-1",
          policyDecisionId: "decision-1",
          confirmedParameterDigest: "wrong-digest",
          confirmedImpact: ["local branch promotion"],
        },
      }),
    ).rejects.toMatchObject({ code: "USER_CONFIRMATION_MISMATCH" });

    const consumed = await store.consume({
      userConfirmationId: confirmation.userConfirmationId,
      expected: {
        operationId: "operation-1",
        policyDecisionId: "decision-1",
        confirmedParameterDigest: "parameter-digest",
        confirmedImpact: ["local branch promotion"],
      },
    });
    expect(consumed.consumedAt).toBe("2026-07-30T00:00:00.000Z");
    await expect(
      new UserConfirmationStore(root, { now: () => new Date(nowMs) }).consume({
        userConfirmationId: confirmation.userConfirmationId,
        expected: {
          operationId: "operation-1",
          policyDecisionId: "decision-1",
          confirmedParameterDigest: "parameter-digest",
          confirmedImpact: ["local branch promotion"],
        },
      }),
    ).rejects.toMatchObject({ code: "USER_CONFIRMATION_USED" });

    const secondRoot = await mkdtemp(join(tmpdir(), "agent08-phase-b-confirmation-expired-"));
    tempDirs.push(secondRoot);
    const expiring = new UserConfirmationStore(secondRoot, {
      now: () => new Date(nowMs),
      idGenerator: () => "confirmation-expired",
      ttlMs: 1_000,
    });
    const expired = await expiring.issue({
      policyDecision: decision(3),
      confirmedBy: "TZ",
      confirmationSurface: "agent08_git_control",
      confirmedImpact: ["external impact"],
    });
    nowMs += 1_001;
    await expect(
      expiring.consume({
        userConfirmationId: expired.userConfirmationId,
        expected: {
          operationId: "operation-1",
          policyDecisionId: "decision-1",
          confirmedParameterDigest: "parameter-digest",
          confirmedImpact: ["external impact"],
        },
      }),
    ).rejects.toMatchObject({ code: "USER_CONFIRMATION_EXPIRED" });
  });
});

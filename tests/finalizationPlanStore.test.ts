import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  FinalizationError,
  type FinalizationAttempt,
  type CommitPlan,
  type FinalizationReceipt,
} from "../src/gitboard/finalizationContracts.js";
import { FinalizationPlanStore } from "../src/gitboard/finalizationPlanStore.js";

const commitPlan: CommitPlan = {
  schemaVersion: 1,
  operationId: "op-commit-1",
  operation: "commit",
  repoId: "agent08-gitboard",
  canonicalRepoPath: "/Users/tristanzh/agent/agent08-gitboard",
  branch: "main",
  expectedHead: "a".repeat(40),
  proposalSource: "codex",
  selectedPaths: ["src/gitboard/gitControlService.ts"],
  selectedStateDigest: "b".repeat(64),
  commitMessage: "feat(agent08): finalize selected files",
  rationale: "Final reviewed change",
  planDigest: "c".repeat(64),
  createdAt: "2026-07-30T10:00:00.000Z",
  expiresAt: "2026-07-30T10:05:00.000Z",
};

describe("FinalizationPlanStore", () => {
  test("reads an immutable rejected attempt without a finalization plan or raw detail", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-attempt-"));
    const store = new FinalizationPlanStore(root);
    const attempt: FinalizationAttempt = {
      schemaVersion: 1,
      operationId: "attempt-1",
      operation: "commit",
      repoId: "agent08-gitboard",
      proposalSource: "codex",
      status: "rejected",
      outcome: "proposal_rejected",
      resultCode: "FINALIZATION_SECRET_DETECTED",
      createdAt: "2026-08-01T00:00:00.000Z",
      completedAt: "2026-08-01T00:00:00.000Z",
    };

    await store.createAttempt(attempt);

    await expect(store.status(attempt.operationId)).resolves.toMatchObject({
      status: "rejected",
      plan: null,
      receipt: null,
      attempt: {
        outcome: "proposal_rejected",
        resultCode: "FINALIZATION_SECRET_DETECTED",
      },
    });
    await expect(store.createAttempt(attempt)).rejects.toMatchObject({
      code: "FINALIZATION_ATTEMPT_EXISTS",
    });
    const raw = await readFile(
      join(root, "storage", "finalization", "attempts", `${attempt.operationId}.json`),
      "utf8",
    );
    expect(raw).not.toContain('"detail"');
    expect(raw).not.toContain("token=https://secret@example.invalid");
  });

  test("reports a ready attempt together with its immutable proposal plan", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-ready-attempt-"));
    const store = new FinalizationPlanStore(root);
    const plan = { ...commitPlan, operationId: "attempt-ready" };
    const attempt: FinalizationAttempt = {
      schemaVersion: 1,
      operationId: plan.operationId,
      operation: "commit",
      repoId: plan.repoId,
      proposalSource: "codex",
      status: "ready",
      outcome: "ready_for_confirmation",
      resultCode: "FINALIZATION_PLAN_PREPARED",
      createdAt: plan.createdAt,
      completedAt: plan.createdAt,
    };

    await store.createAttempt(attempt);
    await store.createPlan(plan);

    await expect(store.status(plan.operationId)).resolves.toMatchObject({
      status: "ready",
      attempt,
      plan,
      receipt: null,
    });
  });

  test("persists an immutable plan without creating confirmation", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-store-"));
    const store = new FinalizationPlanStore(root, {
      now: () => new Date("2026-07-30T10:00:00.000Z"),
      tokenGenerator: () => "confirm-token-1",
    });

    await store.createPlan(commitPlan);

    await expect(store.readPlan(commitPlan.operationId)).resolves.toEqual(commitPlan);
    await expect(store.readConfirmation(commitPlan.operationId)).resolves.toBeNull();
    await expect(store.createPlan(commitPlan)).rejects.toMatchObject({ code: "FINALIZATION_PLAN_EXISTS" });
  });

  test("records confirmation separately and stores only its token hash", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-confirm-"));
    const store = new FinalizationPlanStore(root, {
      now: () => new Date("2026-07-30T10:01:00.000Z"),
      tokenGenerator: () => "confirm-token-1",
    });
    await store.createPlan(commitPlan);

    const confirmation = await store.confirm(commitPlan.operationId);

    expect(confirmation).toEqual({
      operationId: commitPlan.operationId,
      confirmationToken: "confirm-token-1",
      expiresAt: "2026-07-30T10:02:00.000Z",
    });
    const persisted = await store.readConfirmation(commitPlan.operationId);
    expect(persisted).toMatchObject({
      operationId: commitPlan.operationId,
      confirmationSurface: "local_agent08_ui",
      confirmedBy: "local_operator",
    });
    expect(persisted?.confirmationTokenDigest).toMatch(/^[a-f0-9]{64}$/);
    const raw = await readFile(
      join(root, "storage", "finalization", "confirmations", `${commitPlan.operationId}.json`),
      "utf8",
    );
    expect(raw).not.toContain("confirm-token-1");
  });

  test("consumes confirmation exactly once and rejects an expired or mismatched token", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-consume-"));
    let now = new Date("2026-07-30T10:01:00.000Z");
    const store = new FinalizationPlanStore(root, {
      now: () => now,
      tokenGenerator: () => "confirm-token-1",
    });
    await store.createPlan(commitPlan);
    await store.confirm(commitPlan.operationId);

    await expect(store.consume(commitPlan.operationId, "wrong-token")).rejects.toMatchObject({
      code: "FINALIZATION_CONFIRMATION_MISMATCH",
    });
    await expect(store.consume(commitPlan.operationId, "confirm-token-1")).resolves.toEqual(commitPlan);
    await expect(store.consume(commitPlan.operationId, "confirm-token-1")).rejects.toMatchObject({
      code: "FINALIZATION_CONFIRMATION_USED",
    });

    const expiredRoot = await mkdtemp(join(tmpdir(), "agent08-finalization-expired-"));
    const expiredStore = new FinalizationPlanStore(expiredRoot, {
      now: () => now,
      tokenGenerator: () => "confirm-token-2",
    });
    await expiredStore.createPlan({ ...commitPlan, operationId: "op-commit-2" });
    await expiredStore.confirm("op-commit-2");
    now = new Date("2026-07-30T10:03:00.001Z");
    await expect(expiredStore.consume("op-commit-2", "confirm-token-2")).rejects.toMatchObject({
      code: "FINALIZATION_CONFIRMATION_EXPIRED",
    });
  });

  test("never lets confirmation extend execution beyond the immutable plan expiry", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-plan-expired-"));
    let now = new Date("2026-07-30T10:04:30.000Z");
    const store = new FinalizationPlanStore(root, {
      now: () => now,
      tokenGenerator: () => "confirm-token-late",
    });
    await store.createPlan(commitPlan);
    await store.confirm(commitPlan.operationId);
    now = new Date("2026-07-30T10:05:00.001Z");

    await expect(store.consume(commitPlan.operationId, "confirm-token-late")).rejects.toMatchObject({
      code: "FINALIZATION_PLAN_EXPIRED",
    });
  });

  test("persists a secret-free terminal receipt and reports status", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-receipt-"));
    const store = new FinalizationPlanStore(root);
    await store.createAttempt({
      schemaVersion: 1,
      operationId: commitPlan.operationId,
      operation: "commit",
      repoId: commitPlan.repoId,
      proposalSource: "codex",
      status: "ready",
      outcome: "ready_for_confirmation",
      resultCode: "FINALIZATION_PLAN_PREPARED",
      createdAt: commitPlan.createdAt,
      completedAt: commitPlan.createdAt,
    });
    await store.createPlan(commitPlan);
    const receipt: FinalizationReceipt = {
      schemaVersion: 1,
      operationId: commitPlan.operationId,
      operation: "commit",
      repoId: commitPlan.repoId,
      status: "succeeded",
      resultCode: "COMMITTED",
      beforeOid: commitPlan.expectedHead,
      afterOid: "d".repeat(40),
      branch: "main",
      completedAt: "2026-07-30T10:01:30.000Z",
      outputSummary: "[main ddddddd] feat(agent08): finalize selected files",
    };

    await store.recordReceipt(receipt);

    await expect(store.status(commitPlan.operationId)).resolves.toEqual({
      operationId: commitPlan.operationId,
      status: "succeeded",
      plan: commitPlan,
      attempt: expect.any(Object),
      receipt,
    });
    await expect(store.recordReceipt(receipt)).rejects.toBeInstanceOf(FinalizationError);
    const raw = await readFile(
      join(root, "storage", "finalization", "receipts", `${commitPlan.operationId}.json`),
      "utf8",
    );
    expect(raw).not.toMatch(/confirmationToken|private[_-]?key/i);
  });
});

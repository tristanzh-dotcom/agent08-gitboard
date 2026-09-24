import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type {
  CommitExecutionInput,
  CommitExecutionResult,
  CommitInspection,
  FinalizationGit,
  PushExecutionResult,
  PushInspection,
} from "../src/gitboard/finalizationGit.js";
import { FinalizationError } from "../src/gitboard/finalizationContracts.js";
import { FinalizationPlanStore } from "../src/gitboard/finalizationPlanStore.js";
import { createFinalizationService } from "../src/gitboard/finalizationService.js";
import type { RepoManifest } from "../src/gitboard/types.js";

const repoPath = "/Users/tristanzh/agent/agent08-gitboard";
const remoteUrl = "https://github.com/tristanzh-dotcom/agent08-gitboard.git";
const head = "a".repeat(40);
const nextHead = "b".repeat(40);
const stateDigest = "c".repeat(64);
const manifest: RepoManifest = {
  version: 1,
  root: "/Users/tristanzh/agent",
  generatedAt: "2026-07-30T00:00:00.000Z",
  targets: [{
    id: "agent08-gitboard",
    agent: "Agent08",
    label: "Git Console",
    path: repoPath,
    remote: remoteUrl,
    visibility: "public",
    required: true,
  }],
};

const commitInspection: CommitInspection = {
  canonicalRepoPath: repoPath,
  branch: "main",
  head,
  selectedPaths: ["src/gitboard/gitControlService.ts"],
  changedPaths: ["src/gitboard/gitControlService.ts"],
  selectedStateDigest: stateDigest,
};

const pushInspection: PushInspection = {
  canonicalRepoPath: repoPath,
  branch: "main",
  head,
  remote: "origin",
  remoteUrl,
  remoteRef: "refs/heads/main",
  remoteOid: "d".repeat(40),
};

describe("FinalizationService", () => {
  test("prepares an immutable Codex commit proposal without creating confirmation", async () => {
    const fixture = await createFixture();

    const prepared = await fixture.service.prepareCommit("agent08-gitboard", {
      selectedPaths: commitInspection.selectedPaths,
      commitMessage: "feat(agent08): proposal handoff",
      source: "codex",
      taskIntentId: "agent08/repository-task-isolation",
      selectionDeclaration: "exact_paths",
    });

    expect(prepared).toMatchObject({
      operation: "commit",
      repoId: "agent08-gitboard",
      expectedHead: head,
      selectedPaths: commitInspection.selectedPaths,
      selectedStateDigest: stateDigest,
      commitMessage: "feat(agent08): proposal handoff",
      proposalSource: "codex",
      taskIntentId: "agent08/repository-task-isolation",
      selectionDeclaration: "exact_paths",
    });
    expect(prepared).not.toHaveProperty("confirmationToken");
    await expect(fixture.store.status(prepared.operationId)).resolves.toMatchObject({ status: "ready" });
  });

  test("requires bounded task intent and exact path declaration for Codex proposals", async () => {
    const missingIntent = await createFixture();
    await expect(missingIntent.service.prepareCommit("agent08-gitboard", {
      selectedPaths: commitInspection.selectedPaths,
      commitMessage: "feat: missing intent",
      source: "codex",
      selectionDeclaration: "exact_paths",
    })).rejects.toMatchObject({ code: "FINALIZATION_TASK_INTENT_REQUIRED" });

    const missingDeclaration = await createFixture();
    await expect(missingDeclaration.service.prepareCommit("agent08-gitboard", {
      selectedPaths: commitInspection.selectedPaths,
      commitMessage: "feat: missing declaration",
      source: "codex",
      taskIntentId: "agent08/task",
    })).rejects.toMatchObject({ code: "FINALIZATION_SELECTION_DECLARATION_REQUIRED" });

    const invalidIntent = await createFixture();
    await expect(invalidIntent.service.preparePush("agent08-gitboard", {
      source: "codex",
      taskIntentId: "contains whitespace",
    })).rejects.toMatchObject({ code: "FINALIZATION_TASK_INTENT_INVALID" });

    const missingPushIntent = await createFixture();
    await expect(missingPushIntent.service.preparePush("agent08-gitboard", {
      source: "codex",
    })).rejects.toMatchObject({ code: "FINALIZATION_TASK_INTENT_REQUIRED" });
  });

  test("rejects declared mixed paths before creating an executable plan", async () => {
    const fixture = await createFixture();

    await expect(fixture.service.prepareCommit("agent08-gitboard", {
      selectedPaths: commitInspection.selectedPaths,
      commitMessage: "feat: mixed path",
      source: "codex",
      taskIntentId: "agent14/web-publish",
      selectionDeclaration: "mixed_or_indeterminate",
    })).rejects.toMatchObject({
      code: "MIXED_PATH_REQUIRES_OWNER_SPLIT",
      operationId: "operation-1",
    });

    await expect(fixture.store.status("operation-1")).resolves.toMatchObject({
      plan: null,
      attempt: {
        taskIntentId: "agent14/web-publish",
        outcome: "proposal_rejected",
        resultCode: "MIXED_PATH_REQUIRES_OWNER_SPLIT",
      },
    });
  });

  test("allows unassociated manual proposals but requires a declaration when manual supplies task intent", async () => {
    const unassociated = await createFixture();
    const manualPlan = await unassociated.service.prepareCommit("agent08-gitboard", {
      selectedPaths: commitInspection.selectedPaths,
      commitMessage: "chore: manual",
      source: "manual",
    });
    expect(manualPlan).toMatchObject({ taskIntentId: null, selectionDeclaration: null });

    const associated = await createFixture();
    await expect(associated.service.prepareCommit("agent08-gitboard", {
      selectedPaths: commitInspection.selectedPaths,
      commitMessage: "chore: associated manual",
      source: "manual",
      taskIntentId: "manual/owned-task",
    })).rejects.toMatchObject({ code: "FINALIZATION_SELECTION_DECLARATION_REQUIRED" });
  });

  test("records a manual rejected commit proposal as a queryable attempt", async () => {
    const fixture = await createFixture();

    await expect(fixture.service.prepareCommit("agent08-gitboard", {
      selectedPaths: ["missing.ts"],
      commitMessage: "test",
      source: "manual",
    })).rejects.toMatchObject({ code: "FINALIZATION_PATH_UNCHANGED", operationId: "operation-1" });

    await expect(fixture.store.status("operation-1")).resolves.toMatchObject({
      status: "rejected",
      plan: null,
      attempt: {
        proposalSource: "manual",
        outcome: "proposal_rejected",
        resultCode: "FINALIZATION_PATH_UNCHANGED",
      },
    });
  });

  test("classifies a FinalizationError execution code during preparation as a rejected proposal", async () => {
    const fixture = await createFixture();
    fixture.git.inspectCommit = async () => {
      throw new FinalizationError("FINALIZATION_EXECUTION_FAILED");
    };

    await expect(fixture.service.prepareCommit("agent08-gitboard", {
      selectedPaths: commitInspection.selectedPaths,
      commitMessage: "test",
    })).rejects.toMatchObject({ code: "FINALIZATION_EXECUTION_FAILED" });

    await expect(fixture.store.status("operation-1")).resolves.toMatchObject({
      status: "rejected",
      plan: null,
      attempt: {
        status: "rejected",
        outcome: "proposal_rejected",
        resultCode: "FINALIZATION_EXECUTION_FAILED",
      },
    });
  });

  test("does not externally report preparation as ready before its immutable plan exists", async () => {
    const fixture = await createFixture();
    const createAttempt = fixture.store.createAttempt.bind(fixture.store);
    let initialStatus: Awaited<ReturnType<typeof fixture.store.status>> | undefined;
    fixture.store.createAttempt = async (attempt) => {
      const persisted = await createAttempt(attempt);
      initialStatus = await fixture.store.status(attempt.operationId);
      return persisted;
    };

    await fixture.service.prepareCommit("agent08-gitboard", {
      selectedPaths: commitInspection.selectedPaths,
      commitMessage: "test",
    });

    expect(initialStatus).toMatchObject({
      status: "failed",
      plan: null,
      attempt: {
        status: "failed",
        outcome: "execution_failed",
        completedAt: null,
      },
    });
  });

  test("requires separate confirmation before commit execution", async () => {
    const fixture = await createFixture();
    const prepared = await fixture.service.prepareCommit("agent08-gitboard", {
      selectedPaths: commitInspection.selectedPaths,
      commitMessage: "feat(agent08): thin finalization",
      source: "codex",
      taskIntentId: "agent08/thin-finalization",
      selectionDeclaration: "exact_paths",
    });

    await expect(fixture.service.executeFinalization(prepared.operationId, "not-confirmed")).rejects.toMatchObject({
      code: "FINALIZATION_CONFIRMATION_REQUIRED",
    });
    expect(fixture.commitCalls).toHaveLength(0);

    const confirmation = await fixture.service.confirmFinalization(prepared.operationId);
    const receipt = await fixture.service.executeFinalization(
      prepared.operationId,
      confirmation.confirmationToken,
    );

    expect(receipt).toMatchObject({
      status: "succeeded",
      resultCode: "COMMITTED",
      beforeOid: head,
      afterOid: nextHead,
      taskIntentId: "agent08/thin-finalization",
    });
    expect(fixture.commitCalls).toEqual([{
      branch: "main",
      expectedHead: head,
      selectedPaths: commitInspection.selectedPaths,
      selectedStateDigest: stateDigest,
      commitMessage: "feat(agent08): thin finalization",
    }]);
  });

  test("consumes confirmation then fails closed when selected content drifts", async () => {
    const fixture = await createFixture({
      commitInspections: [
        commitInspection,
        { ...commitInspection, selectedStateDigest: "e".repeat(64) },
      ],
    });
    const prepared = await fixture.service.prepareCommit("agent08-gitboard", {
      selectedPaths: commitInspection.selectedPaths,
      commitMessage: "fix(agent08): bind selected content",
    });
    const confirmation = await fixture.service.confirmFinalization(prepared.operationId);

    await expect(
      fixture.service.executeFinalization(prepared.operationId, confirmation.confirmationToken),
    ).rejects.toMatchObject({ code: "FINALIZATION_SELECTED_STATE_DRIFT" });

    expect(fixture.commitCalls).toHaveLength(0);
    await expect(fixture.store.status(prepared.operationId)).resolves.toMatchObject({
      status: "failed",
      receipt: {
        resultCode: "FINALIZATION_SELECTED_STATE_DRIFT",
        afterOid: null,
        outputSummary: "Finalization blocked before a verified result.",
      },
    });
  });

  test("keeps an observed new OID in a failed receipt after postcondition failure", async () => {
    const fixture = await createFixture();
    const prepared = await fixture.service.prepareCommit("agent08-gitboard", {
      selectedPaths: commitInspection.selectedPaths,
      commitMessage: "fix: preserve uncertain commit outcome",
    });
    const confirmation = await fixture.service.confirmFinalization(prepared.operationId);
    fixture.git.commitSelected = async () => {
      throw Object.assign(new FinalizationError("FINALIZATION_COMMITTED_PATHS_MISMATCH"), {
        afterOid: nextHead,
      });
    };

    await expect(
      fixture.service.executeFinalization(prepared.operationId, confirmation.confirmationToken),
    ).rejects.toMatchObject({ code: "FINALIZATION_COMMITTED_PATHS_MISMATCH" });
    await expect(fixture.store.status(prepared.operationId)).resolves.toMatchObject({
      status: "failed",
      receipt: {
        status: "failed",
        afterOid: nextHead,
      },
    });
  });

  test("prepares and executes push without considering dirty working-tree state", async () => {
    const fixture = await createFixture();

    const prepared = await fixture.service.preparePush("agent08-gitboard");
    expect(prepared).toMatchObject({
      operation: "push",
      expectedHead: head,
      branch: "main",
      remote: "origin",
      remoteUrl,
      expectedRemoteOid: pushInspection.remoteOid,
    });
    expect(prepared).not.toHaveProperty("dirty");

    const confirmation = await fixture.service.confirmFinalization(prepared.operationId);
    const receipt = await fixture.service.executeFinalization(
      prepared.operationId,
      confirmation.confirmationToken,
    );

    expect(receipt).toMatchObject({
      status: "succeeded",
      resultCode: "PUSHED",
      beforeOid: pushInspection.remoteOid,
      afterOid: head,
    });
    expect(fixture.pushCalls).toEqual([pushInspection]);
  });

  test("rejects local or remote push drift before invoking Git push", async () => {
    const fixture = await createFixture({
      pushInspections: [
        pushInspection,
        { ...pushInspection, remoteOid: "f".repeat(40) },
      ],
    });
    const prepared = await fixture.service.preparePush("agent08-gitboard");
    const confirmation = await fixture.service.confirmFinalization(prepared.operationId);

    await expect(
      fixture.service.executeFinalization(prepared.operationId, confirmation.confirmationToken),
    ).rejects.toMatchObject({ code: "FINALIZATION_REMOTE_DRIFT" });
    expect(fixture.pushCalls).toHaveLength(0);
  });
});

async function createFixture(options: {
  commitInspections?: CommitInspection[];
  pushInspections?: PushInspection[];
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "agent08-finalization-service-"));
  const commitInspections = [...(options.commitInspections ?? [commitInspection, commitInspection])];
  const pushInspections = [...(options.pushInspections ?? [pushInspection, pushInspection])];
  const commitCalls: CommitExecutionInput[] = [];
  const pushCalls: PushInspection[] = [];
  const git = {
    async inspectCommit(_repoPath: string, selectedPaths: string[]) {
      if (selectedPaths.includes("missing.ts")) {
        throw new FinalizationError("FINALIZATION_PATH_UNCHANGED");
      }
      const inspection = commitInspections.shift();
      if (!inspection) throw new Error("missing scripted commit inspection");
      return inspection;
    },
    async commitSelected(_repoPath: string, input: CommitExecutionInput): Promise<CommitExecutionResult> {
      commitCalls.push(input);
      return {
        commitOid: nextHead,
        parentOid: head,
        committedPaths: [...input.selectedPaths],
        outputSummary: "[main bbbbbbb] finalization",
      };
    },
    async inspectPush() {
      const inspection = pushInspections.shift();
      if (!inspection) throw new Error("missing scripted push inspection");
      return inspection;
    },
    async pushExact(_repoPath: string, inspection: PushInspection): Promise<PushExecutionResult> {
      pushCalls.push(inspection);
      return { remoteAfterOid: inspection.head, outputSummary: "pushed" };
    },
  } satisfies Pick<FinalizationGit, "inspectCommit" | "commitSelected" | "inspectPush" | "pushExact">;
  let id = 0;
  const store = new FinalizationPlanStore(root, {
    now: () => new Date("2026-07-30T10:00:00.000Z"),
    tokenGenerator: () => "confirmation-token",
  });
  const service = createFinalizationService({
    manifest,
    store,
    git,
    now: () => new Date("2026-07-30T10:00:00.000Z"),
    idGenerator: () => `operation-${++id}`,
  });
  return { service, store, git, commitCalls, pushCalls };
}

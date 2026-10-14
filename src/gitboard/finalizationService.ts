import { createHash, randomUUID } from "node:crypto";
import {
  FinalizationError,
  type CommitPlan,
  type CommitProposal,
  type FinalizationAttempt,
  type FinalizationPlan,
  type FinalizationReceipt,
  type FinalizationStatus,
  type PushPlan,
  type PushProposal,
} from "./finalizationContracts.js";
import { FinalizationGit } from "./finalizationGit.js";
import { FinalizationPlanStore } from "./finalizationPlanStore.js";
import { canonicalJson } from "./storageUtils.js";
import type { RepoManifest, RepoManifestEntry } from "./types.js";

const PLAN_TTL_MS = 5 * 60_000;
const FULL_OID = /^[a-f0-9]{40}$/;
const TASK_INTENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

export interface FinalizationServiceOptions {
  manifest: RepoManifest;
  store: FinalizationPlanStore;
  git?: Pick<FinalizationGit, "inspectCommit" | "commitSelected" | "inspectPush" | "pushExact">;
  now?: () => Date;
  idGenerator?: () => string;
}

export interface FinalizationService {
  prepareCommit(repoId: string, proposal: CommitProposal): Promise<CommitPlan>;
  preparePush(repoId: string, proposal?: PushProposal): Promise<PushPlan>;
  confirmFinalization(operationId: string): Promise<{
    operationId: string;
    confirmationToken: string;
    expiresAt: string;
  }>;
  executeFinalization(operationId: string, confirmationToken: string): Promise<FinalizationReceipt>;
  finalizationStatus(operationId: string): Promise<FinalizationStatus>;
}

export function createFinalizationService({
  manifest,
  store,
  git = new FinalizationGit(),
  now = () => new Date(),
  idGenerator = randomUUID,
}: FinalizationServiceOptions): FinalizationService {
  async function prepareCommit(repoId: string, proposal: CommitProposal): Promise<CommitPlan> {
    const target = findTarget(manifest, repoId);
    const commitMessage = normalizeCommitMessage(proposal.commitMessage);
    const rationale = normalizeOptionalText(proposal.rationale);
    const proposalSource = resolveProposalSource(proposal.source);
    const taskIntentId = normalizeTaskIntentId(proposal.taskIntentId);
    const selectionDeclaration = normalizeSelectionDeclaration(proposal.selectionDeclaration);
    const operationId = idGenerator();
    const createdAt = now();
    await store.createAttempt(preparationAttempt({
      operationId,
      operation: "commit",
      repoId,
      proposalSource,
      taskIntentId,
      createdAt,
    }));
    try {
      requireTaskIntent(proposalSource, taskIntentId);
      requireSelectionDeclaration(proposalSource, taskIntentId, selectionDeclaration);
      if (selectionDeclaration === "mixed_or_indeterminate") {
        throw new FinalizationError("MIXED_PATH_REQUIRES_OWNER_SPLIT");
      }
      const inspection = await git.inspectCommit(target.path, proposal.selectedPaths);
      if (proposal.expectedHead !== undefined) {
        if (!FULL_OID.test(proposal.expectedHead) || proposal.expectedHead !== inspection.head) {
          throw new FinalizationError("FINALIZATION_HEAD_DRIFT");
        }
      }
      const fields = {
        schemaVersion: 1 as const,
        operationId,
        operation: "commit" as const,
        repoId,
        canonicalRepoPath: inspection.canonicalRepoPath,
        branch: inspection.branch,
        expectedHead: inspection.head,
        proposalSource,
        taskIntentId,
        selectedPaths: [...inspection.selectedPaths],
        selectedStateDigest: inspection.selectedStateDigest,
        commitMessage,
        rationale,
        selectionDeclaration,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + PLAN_TTL_MS).toISOString(),
      };
      const plan: CommitPlan = { ...fields, planDigest: planDigest(fields) };
      await store.createPlan(plan);
      await completePreparedAttempt(store, operationId, now());
      return plan;
    } catch (error) {
      return rejectPreparation(store, operationId, error, now());
    }
  }

  async function preparePush(repoId: string, proposal: PushProposal = {}): Promise<PushPlan> {
    const target = findTarget(manifest, repoId);
    const proposalSource = resolveProposalSource(proposal.source);
    const taskIntentId = normalizeTaskIntentId(proposal.taskIntentId);
    const operationId = idGenerator();
    const createdAt = now();
    await store.createAttempt(preparationAttempt({
      operationId,
      operation: "push",
      repoId,
      proposalSource,
      taskIntentId,
      createdAt,
    }));
    try {
      requireTaskIntent(proposalSource, taskIntentId);
      const inspection = await git.inspectPush(target.path, target.remote);
      if (
        proposal.expectedHead !== undefined &&
        (!FULL_OID.test(proposal.expectedHead) || proposal.expectedHead !== inspection.head)
      ) {
        throw new FinalizationError("FINALIZATION_HEAD_DRIFT");
      }
      const fields = {
        schemaVersion: 1 as const,
        operationId,
        operation: "push" as const,
        repoId,
        canonicalRepoPath: inspection.canonicalRepoPath,
        branch: inspection.branch,
        expectedHead: inspection.head,
        proposalSource,
        taskIntentId,
        remote: "origin" as const,
        remoteUrl: inspection.remoteUrl,
        remoteRef: inspection.remoteRef,
        expectedRemoteOid: inspection.remoteOid,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + PLAN_TTL_MS).toISOString(),
      };
      const plan: PushPlan = { ...fields, planDigest: planDigest(fields) };
      await store.createPlan(plan);
      await completePreparedAttempt(store, operationId, now());
      return plan;
    } catch (error) {
      return rejectPreparation(store, operationId, error, now());
    }
  }

  async function executeFinalization(
    operationId: string,
    confirmationToken: string,
  ): Promise<FinalizationReceipt> {
    const plan = await store.consume(operationId, confirmationToken);
    try {
      const receipt = plan.operation === "commit"
        ? await executeCommit(plan)
        : await executePush(plan);
      return store.recordReceipt(receipt);
    } catch (error) {
      const receipt: FinalizationReceipt = {
        schemaVersion: 1,
        operationId: plan.operationId,
        operation: plan.operation,
        repoId: plan.repoId,
        taskIntentId: plan.taskIntentId ?? null,
        status: "failed",
        resultCode: error instanceof FinalizationError ? error.code : "FINALIZATION_EXECUTION_FAILED",
        beforeOid: plan.operation === "commit" ? plan.expectedHead : plan.expectedRemoteOid,
        afterOid: error instanceof FinalizationError ? error.afterOid : null,
        branch: plan.branch,
        completedAt: now().toISOString(),
        outputSummary: error instanceof FinalizationError && error.afterOid
          ? "Execution failed after the repository or remote state changed; inspect it before retrying."
          : "Finalization blocked before a verified result.",
      };
      await store.recordReceipt(receipt);
      if (error instanceof FinalizationError) throw error;
      throw new FinalizationError(
        "FINALIZATION_EXECUTION_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function executeCommit(plan: CommitPlan): Promise<FinalizationReceipt> {
    const current = await git.inspectCommit(plan.canonicalRepoPath, plan.selectedPaths);
    assertEqual(current.canonicalRepoPath, plan.canonicalRepoPath, "FINALIZATION_REPOSITORY_DRIFT");
    assertEqual(current.branch, plan.branch, "FINALIZATION_BRANCH_DRIFT");
    assertEqual(current.head, plan.expectedHead, "FINALIZATION_HEAD_DRIFT");
    assertEqual(
      current.selectedStateDigest,
      plan.selectedStateDigest,
      "FINALIZATION_SELECTED_STATE_DRIFT",
    );
    assertStringArrayEqual(
      current.selectedPaths,
      plan.selectedPaths,
      "FINALIZATION_SELECTED_PATHS_DRIFT",
    );
    const result = await git.commitSelected(plan.canonicalRepoPath, {
      branch: plan.branch,
      expectedHead: plan.expectedHead,
      selectedPaths: plan.selectedPaths,
      selectedStateDigest: plan.selectedStateDigest,
      commitMessage: plan.commitMessage,
    });
    return {
      schemaVersion: 1,
      operationId: plan.operationId,
      operation: "commit",
      repoId: plan.repoId,
      taskIntentId: plan.taskIntentId ?? null,
      status: "succeeded",
      resultCode: "COMMITTED",
      beforeOid: plan.expectedHead,
      afterOid: result.commitOid,
      branch: plan.branch,
      completedAt: now().toISOString(),
      outputSummary: result.outputSummary,
    };
  }

  async function executePush(plan: PushPlan): Promise<FinalizationReceipt> {
    const current = await git.inspectPush(plan.canonicalRepoPath, plan.remoteUrl);
    assertEqual(current.canonicalRepoPath, plan.canonicalRepoPath, "FINALIZATION_REPOSITORY_DRIFT");
    assertEqual(current.branch, plan.branch, "FINALIZATION_BRANCH_DRIFT");
    assertEqual(current.head, plan.expectedHead, "FINALIZATION_HEAD_DRIFT");
    assertEqual(current.remoteUrl, plan.remoteUrl, "FINALIZATION_REMOTE_DRIFT");
    assertEqual(current.remoteRef, plan.remoteRef, "FINALIZATION_REMOTE_DRIFT");
    assertEqual(current.remoteOid, plan.expectedRemoteOid, "FINALIZATION_REMOTE_DRIFT");
    const result = await git.pushExact(plan.canonicalRepoPath, current);
    return {
      schemaVersion: 1,
      operationId: plan.operationId,
      operation: "push",
      repoId: plan.repoId,
      taskIntentId: plan.taskIntentId ?? null,
      status: "succeeded",
      resultCode: "PUSHED",
      beforeOid: plan.expectedRemoteOid,
      afterOid: result.remoteAfterOid,
      branch: plan.branch,
      completedAt: now().toISOString(),
      outputSummary: result.outputSummary,
    };
  }

  return {
    prepareCommit,
    preparePush,
    confirmFinalization: (operationId) => store.confirm(operationId),
    executeFinalization,
    finalizationStatus: (operationId) => store.status(operationId),
  };
}

function preparationAttempt({
  operationId,
  operation,
  repoId,
  proposalSource,
  taskIntentId,
  createdAt,
}: {
  operationId: string;
  operation: FinalizationAttempt["operation"];
  repoId: string;
  proposalSource: FinalizationAttempt["proposalSource"];
  taskIntentId: string | null;
  createdAt: Date;
}): FinalizationAttempt {
  return {
    schemaVersion: 1,
    operationId,
    operation,
    repoId,
    proposalSource,
    taskIntentId,
    status: "failed",
    outcome: "execution_failed",
    resultCode: "FINALIZATION_PREPARATION_INCOMPLETE",
    createdAt: createdAt.toISOString(),
    completedAt: null,
  };
}

async function completePreparedAttempt(
  store: FinalizationPlanStore,
  operationId: string,
  completedAt: Date,
): Promise<void> {
  await store.completeAttempt(operationId, {
    status: "ready",
    outcome: "ready_for_confirmation",
    resultCode: "FINALIZATION_PLAN_PREPARED",
    completedAt: completedAt.toISOString(),
  });
}

async function rejectPreparation<T>(
  store: FinalizationPlanStore,
  operationId: string,
  error: unknown,
  completedAt: Date,
): Promise<T> {
  const isProposalRejection = error instanceof FinalizationError;
  const finalizationError = isProposalRejection
    ? error
    : new FinalizationError("FINALIZATION_EXECUTION_FAILED");
  await store.completeAttempt(operationId, {
    status: isProposalRejection ? "rejected" : "failed",
    outcome: isProposalRejection ? "proposal_rejected" : "execution_failed",
    resultCode: finalizationError.code,
    completedAt: completedAt.toISOString(),
  });
  throw new FinalizationError(finalizationError.code, undefined, operationId);
}

function findTarget(manifest: RepoManifest, repoId: string): RepoManifestEntry {
  const target = manifest.targets.find((candidate) => candidate.id === repoId);
  if (!target) throw new FinalizationError("FINALIZATION_REPOSITORY_NOT_ALLOWED");
  return target;
}

function planDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function normalizeCommitMessage(message: string): string {
  const normalized = typeof message === "string" ? message.trim() : "";
  if (!normalized) throw new FinalizationError("FINALIZATION_COMMIT_MESSAGE_REQUIRED");
  if (normalized.includes("\0") || normalized.length > 500) {
    throw new FinalizationError("FINALIZATION_COMMIT_MESSAGE_INVALID");
  }
  return normalized;
}

function normalizeOptionalText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.includes("\0") || normalized.length > 1_000) {
    throw new FinalizationError("FINALIZATION_RATIONALE_INVALID");
  }
  return normalized;
}

function resolveProposalSource(value: unknown): "codex" | "manual" {
  if (value === undefined) return "manual";
  if (value === "codex" || value === "manual") return value;
  throw new FinalizationError("FINALIZATION_PROPOSAL_SOURCE_INVALID");
}

function normalizeTaskIntentId(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !TASK_INTENT_ID.test(value)) {
    throw new FinalizationError("FINALIZATION_TASK_INTENT_INVALID");
  }
  return value;
}

function normalizeSelectionDeclaration(
  value: unknown,
): "exact_paths" | "mixed_or_indeterminate" | null {
  if (value === undefined) return null;
  if (value === "exact_paths" || value === "mixed_or_indeterminate") return value;
  throw new FinalizationError("FINALIZATION_SELECTION_DECLARATION_INVALID");
}

function requireTaskIntent(
  source: "codex" | "manual",
  taskIntentId: string | null,
): void {
  if (source === "codex" && taskIntentId === null) {
    throw new FinalizationError("FINALIZATION_TASK_INTENT_REQUIRED");
  }
}

function requireSelectionDeclaration(
  source: "codex" | "manual",
  taskIntentId: string | null,
  selectionDeclaration: "exact_paths" | "mixed_or_indeterminate" | null,
): void {
  if ((source === "codex" || taskIntentId !== null) && selectionDeclaration === null) {
    throw new FinalizationError("FINALIZATION_SELECTION_DECLARATION_REQUIRED");
  }
}

function assertEqual<T>(actual: T, expected: T, code: string): void {
  if (actual !== expected) throw new FinalizationError(code);
}

function assertStringArrayEqual(actual: string[], expected: string[], code: string): void {
  if (
    actual.length !== expected.length ||
    [...actual].sort().some((value, index) => value !== [...expected].sort()[index])
  ) {
    throw new FinalizationError(code);
  }
}

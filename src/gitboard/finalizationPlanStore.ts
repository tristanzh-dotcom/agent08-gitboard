import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import {
  FinalizationError,
  type FinalizationAttempt,
  type FinalizationConfirmation,
  type FinalizationPlan,
  type FinalizationReceipt,
  type FinalizationStatus,
} from "./finalizationContracts.js";
import {
  isRecordAlreadyExists,
  readJson,
  readJsonIfExists,
  writeJsonExclusive,
} from "./storageUtils.js";

const CONFIRMATION_TTL_MS = 60_000;

export interface FinalizationPlanStoreOptions {
  now?: () => Date;
  tokenGenerator?: () => string;
}

interface ConsumptionRecord {
  schemaVersion: 1;
  operationId: string;
  planDigest: string;
  consumedAt: string;
}

interface AttemptCompletion {
  schemaVersion: 1;
  operationId: string;
  status: FinalizationAttempt["status"];
  outcome: FinalizationAttempt["outcome"];
  resultCode: string;
  completedAt: string;
}

export class FinalizationPlanStore {
  readonly #now: () => Date;
  readonly #tokenGenerator: () => string;

  constructor(
    private readonly root: string,
    options: FinalizationPlanStoreOptions = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#tokenGenerator = options.tokenGenerator ?? randomUUID;
  }

  async createPlan<T extends FinalizationPlan>(plan: T): Promise<T> {
    assertRecordId(plan.operationId);
    try {
      await writeJsonExclusive(this.path("plans", plan.operationId), plan);
    } catch (error) {
      if (isRecordAlreadyExists(error)) throw new FinalizationError("FINALIZATION_PLAN_EXISTS");
      throw error;
    }
    return plan;
  }

  async createAttempt(attempt: FinalizationAttempt): Promise<FinalizationAttempt> {
    assertRecordId(attempt.operationId);
    const persisted = persistedAttempt(attempt);
    try {
      await writeJsonExclusive(this.path("attempts", attempt.operationId), persisted);
    } catch (error) {
      if (isRecordAlreadyExists(error)) throw new FinalizationError("FINALIZATION_ATTEMPT_EXISTS");
      throw error;
    }
    return persisted;
  }

  async completeAttempt(
    operationId: string,
    completion: Omit<AttemptCompletion, "schemaVersion" | "operationId">,
  ): Promise<FinalizationAttempt> {
    assertRecordId(operationId);
    const attempt = await this.readAttempt(operationId);
    const record: AttemptCompletion = {
      schemaVersion: 1,
      operationId,
      status: completion.status,
      outcome: completion.outcome,
      resultCode: completion.resultCode,
      completedAt: completion.completedAt,
    };
    try {
      await writeJsonExclusive(this.path("attempt-completions", operationId), record);
    } catch (error) {
      if (isRecordAlreadyExists(error)) throw new FinalizationError("FINALIZATION_ATTEMPT_COMPLETED");
      throw error;
    }
    return { ...attempt, ...record };
  }

  async readPlan(operationId: string): Promise<FinalizationPlan> {
    assertRecordId(operationId);
    try {
      return await readJson<FinalizationPlan>(
        this.path("plans", operationId),
        "FINALIZATION_PLAN_NOT_FOUND",
      );
    } catch (error) {
      if (hasCode(error, "FINALIZATION_PLAN_NOT_FOUND")) {
        throw new FinalizationError("FINALIZATION_PLAN_NOT_FOUND");
      }
      throw error;
    }
  }

  async readConfirmation(operationId: string): Promise<FinalizationConfirmation | null> {
    assertRecordId(operationId);
    return readJsonIfExists<FinalizationConfirmation>(this.path("confirmations", operationId));
  }

  async confirm(operationId: string): Promise<{
    operationId: string;
    confirmationToken: string;
    expiresAt: string;
  }> {
    const plan = await this.readPlan(operationId);
    const now = this.#now();
    if (now.getTime() > Date.parse(plan.expiresAt)) {
      throw new FinalizationError("FINALIZATION_PLAN_EXPIRED");
    }
    if (await this.readConfirmation(operationId)) {
      throw new FinalizationError("FINALIZATION_ALREADY_CONFIRMED");
    }
    const confirmationToken = this.#tokenGenerator();
    const expiresAt = new Date(now.getTime() + CONFIRMATION_TTL_MS).toISOString();
    const record: FinalizationConfirmation = {
      schemaVersion: 1,
      operationId,
      planDigest: plan.planDigest,
      confirmationSurface: "local_agent08_ui",
      confirmedBy: "local_operator",
      confirmationTokenDigest: digest(confirmationToken),
      confirmedAt: now.toISOString(),
      expiresAt,
    };
    try {
      await writeJsonExclusive(this.path("confirmations", operationId), record);
    } catch (error) {
      if (isRecordAlreadyExists(error)) throw new FinalizationError("FINALIZATION_ALREADY_CONFIRMED");
      throw error;
    }
    return { operationId, confirmationToken, expiresAt };
  }

  async consume(operationId: string, confirmationToken: string): Promise<FinalizationPlan> {
    const plan = await this.readPlan(operationId);
    if (this.#now().getTime() > Date.parse(plan.expiresAt)) {
      throw new FinalizationError("FINALIZATION_PLAN_EXPIRED");
    }
    if (await this.readConsumption(operationId)) {
      throw new FinalizationError("FINALIZATION_CONFIRMATION_USED");
    }
    const confirmation = await this.readConfirmation(operationId);
    if (!confirmation) throw new FinalizationError("FINALIZATION_CONFIRMATION_REQUIRED");
    if (this.#now().getTime() > Date.parse(confirmation.expiresAt)) {
      throw new FinalizationError("FINALIZATION_CONFIRMATION_EXPIRED");
    }
    if (
      confirmation.planDigest !== plan.planDigest ||
      !equalDigest(confirmation.confirmationTokenDigest, digest(confirmationToken))
    ) {
      throw new FinalizationError("FINALIZATION_CONFIRMATION_MISMATCH");
    }
    const consumption: ConsumptionRecord = {
      schemaVersion: 1,
      operationId,
      planDigest: plan.planDigest,
      consumedAt: this.#now().toISOString(),
    };
    try {
      await writeJsonExclusive(this.path("consumptions", operationId), consumption);
    } catch (error) {
      if (isRecordAlreadyExists(error)) throw new FinalizationError("FINALIZATION_CONFIRMATION_USED");
      throw error;
    }
    return plan;
  }

  async recordReceipt(receipt: FinalizationReceipt): Promise<FinalizationReceipt> {
    assertRecordId(receipt.operationId);
    try {
      await writeJsonExclusive(this.path("receipts", receipt.operationId), receipt);
    } catch (error) {
      if (isRecordAlreadyExists(error)) throw new FinalizationError("FINALIZATION_RECEIPT_EXISTS");
      throw error;
    }
    return receipt;
  }

  async status(operationId: string): Promise<FinalizationStatus> {
    assertRecordId(operationId);
    const attempt = await this.readAttempt(operationId);
    const completion = await this.readAttemptCompletion(operationId);
    const completedAttempt = completion ? { ...attempt, ...completion } : attempt;
    const plan = await readJsonIfExists<FinalizationPlan>(this.path("plans", operationId));
    const receipt = await readJsonIfExists<FinalizationReceipt>(this.path("receipts", operationId));
    if (receipt) {
      return { operationId, status: receipt.status, attempt: completedAttempt, plan, receipt };
    }
    if (completedAttempt.status === "rejected") {
      return { operationId, status: "rejected", attempt: completedAttempt, plan, receipt: null };
    }
    if (await this.readConsumption(operationId)) {
      return { operationId, status: "consumed", attempt: completedAttempt, plan, receipt: null };
    }
    if (await this.readConfirmation(operationId)) {
      return { operationId, status: "confirmed", attempt: completedAttempt, plan, receipt: null };
    }
    return { operationId, status: completedAttempt.status, attempt: completedAttempt, plan, receipt: null };
  }

  private async readAttempt(operationId: string): Promise<FinalizationAttempt> {
    try {
      return await readJson<FinalizationAttempt>(
        this.path("attempts", operationId),
        "FINALIZATION_ATTEMPT_NOT_FOUND",
      );
    } catch (error) {
      if (hasCode(error, "FINALIZATION_ATTEMPT_NOT_FOUND")) {
        throw new FinalizationError("FINALIZATION_ATTEMPT_NOT_FOUND");
      }
      throw error;
    }
  }

  private async readAttemptCompletion(operationId: string): Promise<AttemptCompletion | null> {
    return readJsonIfExists<AttemptCompletion>(this.path("attempt-completions", operationId));
  }

  private async readConsumption(operationId: string): Promise<ConsumptionRecord | null> {
    return readJsonIfExists<ConsumptionRecord>(this.path("consumptions", operationId));
  }

  private path(
    kind: "plans" | "confirmations" | "consumptions" | "receipts" | "attempts" | "attempt-completions",
    operationId: string,
  ): string {
    return join(this.root, "storage", "finalization", kind, `${operationId}.json`);
  }
}

function persistedAttempt(attempt: FinalizationAttempt): FinalizationAttempt {
  return {
    schemaVersion: 1,
    operationId: attempt.operationId,
    operation: attempt.operation,
    repoId: attempt.repoId,
    proposalSource: attempt.proposalSource,
    taskIntentId: attempt.taskIntentId ?? null,
    status: attempt.status,
    outcome: attempt.outcome,
    resultCode: attempt.resultCode,
    createdAt: attempt.createdAt,
    completedAt: attempt.completedAt,
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function equalDigest(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function assertRecordId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value.includes("..")) {
    throw new FinalizationError("FINALIZATION_ID_INVALID");
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  PhaseBError,
  assertSafeRecordId,
  digestCanonicalJson,
  type PolicyDecision,
} from "./machineOperationContracts.js";
import {
  isRecordAlreadyExists,
  readJson,
  readJsonIfExists,
  writeJsonExclusive,
} from "./phaseBFileStore.js";

export interface UserConfirmation {
  schemaVersion: 1;
  userConfirmationId: string;
  operationId: string;
  policyDecisionId: string;
  confirmedBy: "TZ";
  confirmationSurface: "agent08_git_control";
  confirmedParameterDigest: string;
  confirmedImpact: string[];
  confirmedImpactDigest: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

interface StoredUserConfirmation extends Omit<UserConfirmation, "consumedAt"> {}

interface UserConfirmationConsumption {
  schemaVersion: 1;
  userConfirmationId: string;
  consumedAt: string;
}

export interface UserConfirmationStoreOptions {
  now?: () => Date;
  idGenerator?: () => string;
  ttlMs?: number;
}

export class UserConfirmationStore {
  readonly #now: () => Date;
  readonly #idGenerator: () => string;
  readonly #ttlMs: number;

  constructor(
    private readonly root: string,
    options: UserConfirmationStoreOptions = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#idGenerator = options.idGenerator ?? (() => randomUUID());
    this.#ttlMs = options.ttlMs ?? 5 * 60_000;
  }

  async issue(input: {
    policyDecision: PolicyDecision;
    confirmedBy: "TZ";
    confirmationSurface: "agent08_git_control";
    confirmedImpact: string[];
  }): Promise<UserConfirmation> {
    const decision = input.policyDecision;
    if (
      decision.decision !== "allow" ||
      ![2, 3].includes(decision.operationTier) ||
      !["user_confirmed", "explicit_destructive_approval"].includes(decision.authorizationMode)
    ) {
      throw new PhaseBError("USER_CONFIRMATION_NOT_ALLOWED");
    }
    const now = this.#now();
    if (Date.parse(decision.expiresAt) <= now.getTime()) throw new PhaseBError("POLICY_DECISION_EXPIRED");
    const userConfirmationId = this.#idGenerator();
    assertSafeRecordId(userConfirmationId);
    const stored: StoredUserConfirmation = {
      schemaVersion: 1,
      userConfirmationId,
      operationId: decision.operationId,
      policyDecisionId: decision.policyDecisionId,
      confirmedBy: input.confirmedBy,
      confirmationSurface: input.confirmationSurface,
      confirmedParameterDigest: decision.parameterDigest,
      confirmedImpact: [...input.confirmedImpact],
      confirmedImpactDigest: digestCanonicalJson(input.confirmedImpact),
      createdAt: now.toISOString(),
      expiresAt: new Date(
        Math.min(now.getTime() + this.#ttlMs, Date.parse(decision.expiresAt)),
      ).toISOString(),
    };
    try {
      await writeJsonExclusive(this.issuedPath(userConfirmationId), stored);
    } catch (error) {
      if (isRecordAlreadyExists(error)) throw new PhaseBError("USER_CONFIRMATION_ALREADY_EXISTS");
      throw error;
    }
    return { ...stored, consumedAt: null };
  }

  async consume(input: {
    userConfirmationId: string;
    expected: {
      operationId: string;
      policyDecisionId: string;
      confirmedParameterDigest: string;
      confirmedImpact: string[];
    };
  }): Promise<UserConfirmation> {
    assertSafeRecordId(input.userConfirmationId);
    const stored = await readJson<StoredUserConfirmation>(
      this.issuedPath(input.userConfirmationId),
      "USER_CONFIRMATION_NOT_FOUND",
    );
    if (await readJsonIfExists<UserConfirmationConsumption>(this.consumedPath(input.userConfirmationId))) {
      throw new PhaseBError("USER_CONFIRMATION_USED");
    }
    if (Date.parse(stored.expiresAt) <= this.#now().getTime()) {
      throw new PhaseBError("USER_CONFIRMATION_EXPIRED");
    }
    if (
      stored.operationId !== input.expected.operationId ||
      stored.policyDecisionId !== input.expected.policyDecisionId ||
      stored.confirmedParameterDigest !== input.expected.confirmedParameterDigest ||
      stored.confirmedImpactDigest !== digestCanonicalJson(input.expected.confirmedImpact)
    ) {
      throw new PhaseBError("USER_CONFIRMATION_MISMATCH");
    }
    const consumedAt = this.#now().toISOString();
    try {
      await writeJsonExclusive(this.consumedPath(input.userConfirmationId), {
        schemaVersion: 1,
        userConfirmationId: input.userConfirmationId,
        consumedAt,
      } satisfies UserConfirmationConsumption);
    } catch (error) {
      if (isRecordAlreadyExists(error)) throw new PhaseBError("USER_CONFIRMATION_USED");
      throw error;
    }
    return { ...stored, consumedAt };
  }

  async read(userConfirmationId: string): Promise<UserConfirmation> {
    assertSafeRecordId(userConfirmationId);
    const stored = await readJson<StoredUserConfirmation>(
      this.issuedPath(userConfirmationId),
      "USER_CONFIRMATION_NOT_FOUND",
    );
    const consumed = await readJsonIfExists<UserConfirmationConsumption>(
      this.consumedPath(userConfirmationId),
    );
    return { ...stored, consumedAt: consumed?.consumedAt ?? null };
  }

  private issuedPath(userConfirmationId: string): string {
    return join(this.root, "phase-b", "confirmations", userConfirmationId, "issued.json");
  }

  private consumedPath(userConfirmationId: string): string {
    return join(this.root, "phase-b", "confirmations", userConfirmationId, "consumed.json");
  }
}

// The legacy active confirmation-token path remains separate and is not
// evidence that the current production path complies with v1.3 authorization.

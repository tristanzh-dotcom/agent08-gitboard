import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import {
  PhaseBError,
  assertSafeRecordId,
  type GitControlMachineOperation,
  type PolicyDecision,
} from "./machineOperationContracts.js";
import {
  isRecordAlreadyExists,
  readJson,
  readJsonIfExists,
  writeJsonExclusive,
} from "./phaseBFileStore.js";

export interface ExecutionCapability {
  schemaVersion: 1;
  capabilityId: string;
  policyDecisionId: string;
  operationId: string;
  operation: GitControlMachineOperation;
  principalId: string;
  repoId: string;
  repositoryIdentityDigest: string;
  taskId: string;
  leaseId: string | null;
  parameterDigest: string;
  preflightDigest: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

interface StoredExecutionCapability extends Omit<ExecutionCapability, "consumedAt"> {
  verifierHash: string;
}

interface CapabilityConsumption {
  schemaVersion: 1;
  capabilityId: string;
  consumedAt: string;
}

interface CapabilityRevocation {
  schemaVersion: 1;
  capabilityId: string;
  revokedAt: string;
}

export type CapabilityBindingExpectation = Pick<
  ExecutionCapability,
  | "policyDecisionId"
  | "operationId"
  | "operation"
  | "principalId"
  | "repoId"
  | "repositoryIdentityDigest"
  | "taskId"
  | "leaseId"
  | "parameterDigest"
  | "preflightDigest"
>;

export interface IssuedExecutionCapability {
  rawCapability: string;
  capability: ExecutionCapability;
}

export interface ExecutionCapabilityStoreOptions {
  now?: () => Date;
  idGenerator?: () => string;
  tokenGenerator?: () => string;
  ttlMs?: number;
}

export class ExecutionCapabilityStore {
  readonly #now: () => Date;
  readonly #idGenerator: () => string;
  readonly #tokenGenerator: () => string;
  readonly #ttlMs: number;

  constructor(
    private readonly root: string,
    options: ExecutionCapabilityStoreOptions = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#idGenerator = options.idGenerator ?? (() => randomUUID());
    this.#tokenGenerator = options.tokenGenerator ?? (() => randomBytes(32).toString("base64url"));
    this.#ttlMs = options.ttlMs ?? 30_000;
  }

  async issue(decision: PolicyDecision): Promise<IssuedExecutionCapability> {
    if (decision.decision !== "allow") throw new PhaseBError("POLICY_DENIED");
    const now = this.#now();
    if (Date.parse(decision.expiresAt) <= now.getTime()) throw new PhaseBError("POLICY_DECISION_EXPIRED");
    const capabilityId = this.#idGenerator();
    assertSafeRecordId(capabilityId);
    const secret = this.#tokenGenerator();
    if (secret.length < 24) throw new PhaseBError("CAPABILITY_ENTROPY_INSUFFICIENT");
    const rawCapability = `${capabilityId}.${secret}`;
    const expiresAt = new Date(
      Math.min(now.getTime() + this.#ttlMs, Date.parse(decision.expiresAt)),
    ).toISOString();
    const stored: StoredExecutionCapability = {
      schemaVersion: 1,
      capabilityId,
      policyDecisionId: decision.policyDecisionId,
      operationId: decision.operationId,
      operation: decision.operation,
      principalId: decision.principal.principalId,
      repoId: decision.repoId,
      repositoryIdentityDigest: decision.repositoryIdentityDigest,
      taskId: decision.taskId,
      leaseId: decision.leaseId,
      parameterDigest: decision.parameterDigest,
      preflightDigest: decision.preflightDigest,
      createdAt: now.toISOString(),
      expiresAt,
      verifierHash: hashRawCapability(rawCapability),
    };
    try {
      await writeJsonExclusive(this.issuedPath(capabilityId), stored);
    } catch (error) {
      if (isRecordAlreadyExists(error)) throw new PhaseBError("CAPABILITY_ALREADY_EXISTS");
      throw error;
    }
    return {
      rawCapability,
      capability: { ...withoutVerifier(stored), consumedAt: null },
    };
  }

  async consume(input: {
    rawCapability: string;
    expected: CapabilityBindingExpectation;
  }): Promise<ExecutionCapability> {
    if (!input.rawCapability) throw new PhaseBError("CAPABILITY_REQUIRED");
    const [capabilityId, secret, extra] = input.rawCapability.split(".");
    if (!capabilityId || !secret || extra !== undefined) throw new PhaseBError("CAPABILITY_MISMATCH");
    try {
      assertSafeRecordId(capabilityId);
    } catch {
      throw new PhaseBError("CAPABILITY_MISMATCH");
    }
    let stored: StoredExecutionCapability;
    try {
      stored = await readJson<StoredExecutionCapability>(
        this.issuedPath(capabilityId),
        "CAPABILITY_MISMATCH",
      );
    } catch (error) {
      if (error instanceof PhaseBError && error.code === "CAPABILITY_MISMATCH") throw error;
      throw error;
    }
    if (!hashesEqual(stored.verifierHash, hashRawCapability(input.rawCapability))) {
      throw new PhaseBError("CAPABILITY_MISMATCH");
    }
    if (await readJsonIfExists<CapabilityConsumption>(this.consumedPath(capabilityId))) {
      throw new PhaseBError("CAPABILITY_USED");
    }
    if (await readJsonIfExists<CapabilityRevocation>(this.revokedPath(capabilityId))) {
      throw new PhaseBError("CAPABILITY_REVOKED");
    }
    if (Date.parse(stored.expiresAt) <= this.#now().getTime()) throw new PhaseBError("CAPABILITY_EXPIRED");
    assertBindings(stored, input.expected);
    const consumedAt = this.#now().toISOString();
    try {
      await writeJsonExclusive(this.consumedPath(capabilityId), {
        schemaVersion: 1,
        capabilityId,
        consumedAt,
      } satisfies CapabilityConsumption);
    } catch (error) {
      if (isRecordAlreadyExists(error)) throw new PhaseBError("CAPABILITY_USED");
      throw error;
    }
    return { ...withoutVerifier(stored), consumedAt };
  }

  async revoke(capabilityId: string): Promise<void> {
    assertSafeRecordId(capabilityId);
    await readJson<StoredExecutionCapability>(
      this.issuedPath(capabilityId),
      "CAPABILITY_NOT_FOUND",
    );
    try {
      await writeJsonExclusive(this.revokedPath(capabilityId), {
        schemaVersion: 1,
        capabilityId,
        revokedAt: this.#now().toISOString(),
      } satisfies CapabilityRevocation);
    } catch (error) {
      if (!isRecordAlreadyExists(error)) throw error;
    }
  }

  async read(capabilityId: string): Promise<ExecutionCapability> {
    assertSafeRecordId(capabilityId);
    const stored = await readJson<StoredExecutionCapability>(
      this.issuedPath(capabilityId),
      "CAPABILITY_NOT_FOUND",
    );
    const consumption = await readJsonIfExists<CapabilityConsumption>(this.consumedPath(capabilityId));
    return {
      ...withoutVerifier(stored),
      consumedAt: consumption?.consumedAt ?? null,
    };
  }

  private issuedPath(capabilityId: string): string {
    return join(this.root, "phase-b", "capabilities", capabilityId, "issued.json");
  }

  private consumedPath(capabilityId: string): string {
    return join(this.root, "phase-b", "capabilities", capabilityId, "consumed.json");
  }

  private revokedPath(capabilityId: string): string {
    return join(this.root, "phase-b", "capabilities", capabilityId, "revoked.json");
  }
}

export function capabilityIdHash(capabilityId: string): string {
  return `sha256:${createHash("sha256").update(capabilityId).digest("hex")}`;
}

function hashRawCapability(rawCapability: string): string {
  return createHash("sha256").update(rawCapability).digest("hex");
}

function hashesEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function withoutVerifier(stored: StoredExecutionCapability): Omit<ExecutionCapability, "consumedAt"> {
  const { verifierHash: _verifierHash, ...capability } = stored;
  return capability;
}

function assertBindings(
  stored: StoredExecutionCapability,
  expected: CapabilityBindingExpectation,
): void {
  for (const key of [
    "policyDecisionId",
    "operationId",
    "operation",
    "principalId",
    "repoId",
    "repositoryIdentityDigest",
    "taskId",
    "leaseId",
    "parameterDigest",
    "preflightDigest",
  ] as const) {
    if (stored[key] !== expected[key]) throw new PhaseBError("CAPABILITY_MISMATCH");
  }
}

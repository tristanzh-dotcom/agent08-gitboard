import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  PhaseBError,
  assertSafePersistedValue,
  assertSafeRecordId,
  digestCanonicalJson,
  type RepositoryIdentity,
} from "./machineOperationContracts.js";
import {
  isRecordAlreadyExists,
  listJsonFileNames,
  readJson,
  readJsonIfExists,
  writeJsonExclusive,
} from "./phaseBFileStore.js";

export type WorktreeLeaseLifecycle =
  | "reserved"
  | "creating"
  | "active"
  | "removing"
  | "removed"
  | "failed"
  | "quarantined";

export interface WorktreeLease {
  schemaVersion: 1;
  leaseId: string;
  repoId: string;
  repositoryIdentity: RepositoryIdentity;
  principalId: string;
  taskId: string;
  sessionId: string;
  canonicalWorktreePath: string;
  creationOperationId: string;
  baseCommitOid: string;
  branchMode: "detached" | "managed_branch";
  branchName: string | null;
  createdAt: string;
  expiresAt: string;
  expiryGraceAt: string;
  leaseVersion: number;
  lifecycle: WorktreeLeaseLifecycle;
  lastAuditId: string;
  idempotencyKeyDigest: string;
  requestDigest: string;
}

export interface WorktreeLeaseReserveInput {
  leaseId?: string;
  operationName?: string;
  idempotencyKey: string;
  requestDigest: string;
  repoId: string;
  repositoryIdentity: RepositoryIdentity;
  principalId: string;
  taskId: string;
  sessionId: string;
  canonicalWorktreePath: string;
  creationOperationId: string;
  baseCommitOid: string;
  branchMode: "detached" | "managed_branch";
  branchName: string | null;
  requestedLeaseSeconds?: number;
  lastAuditId: string;
}

export interface WorktreeLeaseStoreOptions {
  now?: () => Date;
  idGenerator?: () => string;
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const MAX_CUMULATIVE_SECONDS = 7 * 24 * 60 * 60;
const EXPIRY_GRACE_SECONDS = 24 * 60 * 60;

interface IdempotencyReservation {
  schemaVersion: 1;
  idempotencyKeyDigest: string;
  requestDigest: string;
  leaseId: string;
  lease: WorktreeLease;
}

export class WorktreeLeaseStore {
  readonly #now: () => Date;
  readonly #idGenerator: () => string;

  constructor(
    private readonly root: string,
    options: WorktreeLeaseStoreOptions = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#idGenerator = options.idGenerator ?? (() => randomUUID());
  }

  async reserve(input: WorktreeLeaseReserveInput): Promise<WorktreeLease> {
    validateReserveInput(input);
    const now = this.#now();
    const requestedSeconds = input.requestedLeaseSeconds ?? DEFAULT_TTL_SECONDS;
    if (!Number.isInteger(requestedSeconds) || requestedSeconds <= 0) {
      throw new PhaseBError("LEASE_TTL_INVALID");
    }
    if (requestedSeconds > MAX_CUMULATIVE_SECONDS) {
      throw new PhaseBError("LEASE_RENEWAL_LIMIT_EXCEEDED");
    }
    let leaseId = input.leaseId ?? this.#idGenerator();
    assertSafeRecordId(leaseId);
    const idempotencyKeyDigest = digestCanonicalJson({
      principalId: input.principalId,
      taskId: input.taskId,
      repoId: input.repoId,
      operation: input.operationName ?? "prepare_isolated_worktree",
      idempotencyKey: input.idempotencyKey,
    });
    const expiresAt = new Date(now.getTime() + requestedSeconds * 1_000);
    const lease: WorktreeLease = {
      schemaVersion: 1,
      leaseId,
      repoId: input.repoId,
      repositoryIdentity: { ...input.repositoryIdentity },
      principalId: input.principalId,
      taskId: input.taskId,
      sessionId: input.sessionId,
      canonicalWorktreePath: input.canonicalWorktreePath,
      creationOperationId: input.creationOperationId,
      baseCommitOid: input.baseCommitOid,
      branchMode: input.branchMode,
      branchName: input.branchName,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      expiryGraceAt: new Date(expiresAt.getTime() + EXPIRY_GRACE_SECONDS * 1_000).toISOString(),
      leaseVersion: 0,
      lifecycle: "reserved",
      lastAuditId: input.lastAuditId,
      idempotencyKeyDigest,
      requestDigest: input.requestDigest,
    };
    const reservation: IdempotencyReservation = {
      schemaVersion: 1,
      idempotencyKeyDigest,
      requestDigest: input.requestDigest,
      leaseId,
      lease,
    };
    const idempotencyPath = this.idempotencyPath(idempotencyKeyDigest);
    try {
      await writeJsonExclusive(idempotencyPath, reservation);
    } catch (error) {
      if (!isRecordAlreadyExists(error)) throw error;
      const existing = await readJson<IdempotencyReservation>(idempotencyPath);
      if (existing.requestDigest !== input.requestDigest) throw new PhaseBError("IDEMPOTENCY_CONFLICT");
      leaseId = existing.leaseId;
      return this.ensureLeaseFromReservation(existing);
    }
    try {
      await writeJsonExclusive(this.versionPath(leaseId, 0), lease);
    } catch (error) {
      if (isRecordAlreadyExists(error)) return this.read(leaseId);
      throw error;
    }
    return lease;
  }

  async read(leaseId: string): Promise<WorktreeLease> {
    assertSafeRecordId(leaseId);
    const versions = await listJsonFileNames(this.versionsPath(leaseId));
    if (versions.length === 0) throw new PhaseBError("LEASE_NOT_FOUND");
    const latest = versions.at(-1);
    if (!latest) throw new PhaseBError("LEASE_NOT_FOUND");
    return readJson<WorktreeLease>(join(this.versionsPath(leaseId), latest), "LEASE_NOT_FOUND");
  }

  async transition(
    leaseId: string,
    expectedLeaseVersion: number,
    lifecycle: WorktreeLeaseLifecycle,
    lastAuditId: string,
  ): Promise<WorktreeLease> {
    const current = await this.assertVersion(leaseId, expectedLeaseVersion);
    if (!isAllowedTransition(current.lifecycle, lifecycle)) {
      throw new PhaseBError("LEASE_LIFECYCLE_TRANSITION_INVALID");
    }
    return this.appendVersion({
      ...current,
      lifecycle,
      leaseVersion: current.leaseVersion + 1,
      lastAuditId,
    });
  }

  async recordAudit(
    leaseId: string,
    expectedLeaseVersion: number,
    lastAuditId: string,
  ): Promise<WorktreeLease> {
    const current = await this.assertVersion(leaseId, expectedLeaseVersion);
    return this.appendVersion({
      ...current,
      leaseVersion: current.leaseVersion + 1,
      lastAuditId,
    });
  }

  async renew(
    leaseId: string,
    expectedLeaseVersion: number,
    requestedLeaseSeconds: number,
    lastAuditId: string,
  ): Promise<WorktreeLease> {
    const current = await this.assertVersion(leaseId, expectedLeaseVersion);
    if (current.lifecycle !== "active") throw new PhaseBError("LEASE_NOT_ACTIVE");
    const now = this.#now();
    if (Date.parse(current.expiresAt) <= now.getTime()) throw new PhaseBError("LEASE_EXPIRED");
    if (!Number.isInteger(requestedLeaseSeconds) || requestedLeaseSeconds <= 0) {
      throw new PhaseBError("LEASE_TTL_INVALID");
    }
    const maximumExpiry = Date.parse(current.createdAt) + MAX_CUMULATIVE_SECONDS * 1_000;
    const requestedExpiry = now.getTime() + requestedLeaseSeconds * 1_000;
    if (requestedExpiry > maximumExpiry) throw new PhaseBError("LEASE_RENEWAL_LIMIT_EXCEEDED");
    const expiresAt = new Date(requestedExpiry);
    return this.appendVersion({
      ...current,
      expiresAt: expiresAt.toISOString(),
      expiryGraceAt: new Date(expiresAt.getTime() + EXPIRY_GRACE_SECONDS * 1_000).toISOString(),
      leaseVersion: current.leaseVersion + 1,
      lastAuditId,
    });
  }

  async isExpired(leaseId: string): Promise<boolean> {
    return Date.parse((await this.read(leaseId)).expiresAt) <= this.#now().getTime();
  }

  async tombstone(
    leaseId: string,
    expectedLeaseVersion: number,
    lastAuditId: string,
  ): Promise<WorktreeLease> {
    const current = await this.assertVersion(leaseId, expectedLeaseVersion);
    if (current.lifecycle !== "removing") throw new PhaseBError("LEASE_LIFECYCLE_TRANSITION_INVALID");
    return this.appendVersion({
      ...current,
      lifecycle: "removed",
      leaseVersion: current.leaseVersion + 1,
      lastAuditId,
    });
  }

  async quarantine(
    leaseId: string,
    expectedLeaseVersion: number,
    lastAuditId: string,
  ): Promise<WorktreeLease> {
    const current = await this.assertVersion(leaseId, expectedLeaseVersion);
    if (["removed", "failed"].includes(current.lifecycle)) {
      throw new PhaseBError("LEASE_LIFECYCLE_TRANSITION_INVALID");
    }
    return this.appendVersion({
      ...current,
      lifecycle: "quarantined",
      leaseVersion: current.leaseVersion + 1,
      lastAuditId,
    });
  }

  private async assertVersion(leaseId: string, expectedLeaseVersion: number): Promise<WorktreeLease> {
    const current = await this.read(leaseId);
    if (current.leaseVersion !== expectedLeaseVersion) throw new PhaseBError("LEASE_VERSION_CONFLICT");
    return current;
  }

  private async appendVersion(next: WorktreeLease): Promise<WorktreeLease> {
    try {
      await writeJsonExclusive(this.versionPath(next.leaseId, next.leaseVersion), next);
    } catch (error) {
      if (isRecordAlreadyExists(error)) throw new PhaseBError("LEASE_VERSION_CONFLICT");
      throw error;
    }
    return next;
  }

  private async ensureLeaseFromReservation(reservation: IdempotencyReservation): Promise<WorktreeLease> {
    try {
      return await this.read(reservation.leaseId);
    } catch (error) {
      if (!(error instanceof PhaseBError) || error.code !== "LEASE_NOT_FOUND") throw error;
      try {
        await writeJsonExclusive(this.versionPath(reservation.leaseId, 0), reservation.lease);
      } catch (writeError) {
        if (!isRecordAlreadyExists(writeError)) throw writeError;
      }
      return this.read(reservation.leaseId);
    }
  }

  private versionsPath(leaseId: string): string {
    return join(this.root, "phase-b", "leases", leaseId, "versions");
  }

  private versionPath(leaseId: string, version: number): string {
    return join(this.versionsPath(leaseId), `${String(version).padStart(6, "0")}.json`);
  }

  private idempotencyPath(idempotencyKeyDigest: string): string {
    return join(this.root, "phase-b", "lease-idempotency", `${idempotencyKeyDigest}.json`);
  }
}

function validateReserveInput(input: WorktreeLeaseReserveInput): void {
  for (const [value, code] of [
    [input.idempotencyKey, "IDEMPOTENCY_KEY_REQUIRED"],
    [input.requestDigest, "REQUEST_DIGEST_REQUIRED"],
    [input.repoId, "REPO_NOT_ALLOWED"],
    [input.principalId, "PRINCIPAL_NOT_TRUSTED"],
    [input.taskId, "TASK_ID_MISMATCH"],
    [input.sessionId, "SESSION_ID_MISMATCH"],
    [input.canonicalWorktreePath, "WORKTREE_PATH_REQUIRED"],
    [input.creationOperationId, "OPERATION_ID_REQUIRED"],
    [input.lastAuditId, "AUDIT_ID_REQUIRED"],
  ] as const) {
    if (!value.trim()) throw new PhaseBError(code);
  }
  if (input.branchMode !== "detached") throw new PhaseBError("BRANCH_MODE_UNSUPPORTED");
  if (!/^[0-9a-f]{40}$/i.test(input.baseCommitOid)) throw new PhaseBError("BASE_REVISION_INVALID");
  assertSafePersistedValue(input.repositoryIdentity);
}

function isAllowedTransition(
  from: WorktreeLeaseLifecycle,
  to: WorktreeLeaseLifecycle,
): boolean {
  const transitions: Record<WorktreeLeaseLifecycle, WorktreeLeaseLifecycle[]> = {
    reserved: ["creating", "active", "failed", "quarantined"],
    creating: ["active", "failed", "quarantined"],
    active: ["removing", "failed", "quarantined"],
    removing: ["removed", "failed", "quarantined"],
    removed: [],
    failed: [],
    quarantined: [],
  };
  return transitions[from].includes(to);
}

import { createHash } from "node:crypto";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type GitControlMachineOperation =
  | "prepare_isolated_worktree"
  | "inspect_worktree_lease"
  | "renew_worktree_lease"
  | "remove_owned_worktree"
  | "prune_owned_worktree_metadata"
  | "promote_isolated_branch";

export type OperationTier = 0 | 1 | 2 | 3;
export type AuthorizationMode =
  | "read_only"
  | "machine_policy"
  | "user_confirmed"
  | "explicit_destructive_approval";
export type EnabledPhase = "B" | "C" | "D" | "E" | "F";
export type RuntimeAvailability = "disabled" | "phase_b_test_simulation";
export type MachineExecutionKind = "authenticated_read_only" | "mutation" | "future_tier_2";

export interface MachineOperationDefinition {
  operation: GitControlMachineOperation;
  operationTier: OperationTier;
  authorizationMode: AuthorizationMode;
  enabledPhase: EnabledPhase;
  runtimeAvailability: RuntimeAvailability;
  executionKind: MachineExecutionKind;
  requiresExecutionCapability: boolean;
}

export interface TaskPrincipal {
  kind: "codex_task";
  principalId: string;
  taskId: string;
  sessionId: string;
  credentialId: string;
}

export interface PrincipalClaimsPresentation {
  credential: string | undefined;
  claims: TaskPrincipal;
}

export interface PrincipalAuthenticationExpectation {
  taskId: string;
  sessionId: string;
}

export interface AuthenticatedPrincipalContext {
  principal: TaskPrincipal;
  authenticatedAt: string;
  credentialFingerprint: string;
  authenticationMethod: "deterministic_test_double";
}

export interface PrincipalAuthenticator {
  authenticate(
    presentation: PrincipalClaimsPresentation,
    expected: PrincipalAuthenticationExpectation,
  ): Promise<AuthenticatedPrincipalContext>;
}

export interface RepositoryIdentity {
  repoId: string;
  canonicalRepositoryPath: string;
  canonicalTopLevelPath: string;
  canonicalCommonGitDir: string;
  commonGitDirDevice: number;
  commonGitDirInode: number;
}

export interface PolicyDecision {
  schemaVersion: 1;
  policyDecisionId: string;
  policyVersion: string;
  operationId: string;
  operation: GitControlMachineOperation;
  operationTier: OperationTier;
  authorizationMode: AuthorizationMode;
  principal: TaskPrincipal;
  repoId: string;
  repositoryIdentityDigest: string;
  taskId: string;
  leaseId: string | null;
  parameterDigest: string;
  preflightDigest: string;
  decision: "allow" | "deny";
  reasons: string[];
  createdAt: string;
  expiresAt: string;
}

export class PhaseBError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = "PhaseBError";
    this.code = code;
  }
}

export function digestCanonicalJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(toCanonicalJsonValue(value));
}

export function toCanonicalJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PhaseBError("NON_CANONICAL_VALUE");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => toCanonicalJsonValue(item));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) throw new PhaseBError("NON_CANONICAL_VALUE");
      result[key] = toCanonicalJsonValue(record[key]);
    }
    return result;
  }
  throw new PhaseBError("NON_CANONICAL_VALUE");
}

export function assertSafePersistedValue(value: unknown): void {
  visitPersistedValue(value, []);
}

function visitPersistedValue(value: unknown, path: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitPersistedValue(item, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    const safeDerivedField =
      normalized.endsWith("id") ||
      normalized.endsWith("idhash") ||
      normalized.endsWith("digest") ||
      normalized.endsWith("fingerprint");
    if (
      !safeDerivedField &&
      /(credential|secret|rawcapability|confirmationtoken|privatefile|unrestrictedstderr)/i.test(key)
    ) {
      throw new PhaseBError("SENSITIVE_MATERIAL_FORBIDDEN", [...path, key].join("."));
    }
    visitPersistedValue(child, [...path, key]);
  }
}

export function requireNonEmpty(value: string, code: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function assertSafeRecordId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value.includes("..")) {
    throw new PhaseBError("UNSAFE_RECORD_ID");
  }
}

import { createHash } from "node:crypto";
import {
  PhaseBError,
  type AuthenticatedPrincipalContext,
  type AuthorizationMode,
  type GitControlMachineOperation,
  type MachineOperationDefinition,
  type PolicyDecision,
  type PrincipalAuthenticationExpectation,
  type PrincipalAuthenticator,
  type PrincipalClaimsPresentation,
  type TaskPrincipal,
} from "./machineOperationContracts.js";

export const PHASE_B_POLICY_VERSION = "agent08-git-control-v1.3-phase-b";

export function createDefaultOperationDefinitions(): MachineOperationDefinition[] {
  return [
    definition("prepare_isolated_worktree", 1, "machine_policy", "C", "mutation", true),
    definition("inspect_worktree_lease", 1, "machine_policy", "C", "authenticated_read_only", false),
    definition("renew_worktree_lease", 1, "machine_policy", "C", "mutation", true),
    definition("remove_owned_worktree", 1, "machine_policy", "D", "mutation", true),
    definition("prune_owned_worktree_metadata", 1, "machine_policy", "D", "mutation", true),
    definition("promote_isolated_branch", 2, "user_confirmed", "F", "future_tier_2", true),
  ];
}

function definition(
  operation: GitControlMachineOperation,
  operationTier: 1 | 2,
  authorizationMode: "machine_policy" | "user_confirmed",
  enabledPhase: "C" | "D" | "F",
  executionKind: "authenticated_read_only" | "mutation" | "future_tier_2",
  requiresExecutionCapability: boolean,
): MachineOperationDefinition {
  return {
    operation,
    operationTier,
    authorizationMode,
    enabledPhase,
    runtimeAvailability: "disabled",
    executionKind,
    requiresExecutionCapability,
  };
}

export class OperationRegistry {
  readonly #definitions = new Map<GitControlMachineOperation, MachineOperationDefinition>();

  constructor(definitions: MachineOperationDefinition[]) {
    for (const item of definitions) {
      if (this.#definitions.has(item.operation)) throw new PhaseBError("OPERATION_REGISTRY_CONFLICT");
      this.#definitions.set(item.operation, Object.freeze({ ...item }));
    }
  }

  get(operation: GitControlMachineOperation): MachineOperationDefinition {
    const item = this.#definitions.get(operation);
    if (!item) throw new PhaseBError("OPERATION_NOT_ALLOWED");
    return item;
  }

  list(): MachineOperationDefinition[] {
    return [...this.#definitions.values()].map((item) => ({ ...item }));
  }
}

export class DisabledPrincipalAuthenticator implements PrincipalAuthenticator {
  async authenticate(
    _presentation: PrincipalClaimsPresentation,
    _expected: PrincipalAuthenticationExpectation,
  ): Promise<AuthenticatedPrincipalContext> {
    throw new PhaseBError("PRINCIPAL_AUTHENTICATOR_UNAVAILABLE");
  }
}

export interface TestCredentialRecord {
  credential: string;
  principal: TaskPrincipal;
  status: "active" | "revoked";
  expiresAt: string;
}

export class DeterministicTestPrincipalAuthenticator implements PrincipalAuthenticator {
  readonly #credentials = new Map<string, TestCredentialRecord>();
  readonly #now: () => Date;

  constructor(options: { credentials: TestCredentialRecord[]; now: () => Date }) {
    this.#now = options.now;
    for (const record of options.credentials) this.#credentials.set(record.credential, record);
  }

  async authenticate(
    presentation: PrincipalClaimsPresentation,
    expected: PrincipalAuthenticationExpectation,
  ): Promise<AuthenticatedPrincipalContext> {
    if (!presentation.credential) throw new PhaseBError("CREDENTIAL_REQUIRED");
    const record = this.#credentials.get(presentation.credential);
    if (!record) throw new PhaseBError("PRINCIPAL_NOT_TRUSTED");
    if (record.status === "revoked") throw new PhaseBError("CREDENTIAL_REVOKED");
    const now = this.#now();
    if (Date.parse(record.expiresAt) <= now.getTime()) throw new PhaseBError("CREDENTIAL_EXPIRED");
    assertPrincipalClaims(record.principal, presentation.claims);
    if (record.principal.taskId !== expected.taskId) throw new PhaseBError("TASK_ID_MISMATCH");
    if (record.principal.sessionId !== expected.sessionId) throw new PhaseBError("SESSION_ID_MISMATCH");
    return {
      principal: { ...record.principal },
      authenticatedAt: now.toISOString(),
      credentialFingerprint: `sha256:${createHash("sha256").update(presentation.credential).digest("hex")}`,
      authenticationMethod: "deterministic_test_double",
    };
  }
}

function assertPrincipalClaims(expected: TaskPrincipal, claims: TaskPrincipal): void {
  if (claims.principalId !== expected.principalId || claims.credentialId !== expected.credentialId) {
    throw new PhaseBError("PRINCIPAL_MISMATCH");
  }
  if (claims.taskId !== expected.taskId) throw new PhaseBError("TASK_ID_MISMATCH");
  if (claims.sessionId !== expected.sessionId) throw new PhaseBError("SESSION_ID_MISMATCH");
}

export interface PolicyDecisionInput {
  operationId: string;
  operation: GitControlMachineOperation;
  expectedAuthorizationMode: AuthorizationMode;
  authenticatedPrincipal: AuthenticatedPrincipalContext;
  repoId: string;
  repositoryIdentityDigest: string;
  taskId: string;
  leaseId: string | null;
  parameterDigest: string;
  preflightDigest: string;
}

export class AuthorizationPolicy {
  readonly #registry: OperationRegistry;
  readonly #now: () => Date;
  readonly #idGenerator: () => string;
  readonly #decisionTtlMs: number;

  constructor(options: {
    registry: OperationRegistry;
    now: () => Date;
    idGenerator: () => string;
    decisionTtlMs?: number;
  }) {
    this.#registry = options.registry;
    this.#now = options.now;
    this.#idGenerator = options.idGenerator;
    this.#decisionTtlMs = options.decisionTtlMs ?? 30_000;
  }

  decide(input: PolicyDecisionInput): PolicyDecision {
    const operation = this.#registry.get(input.operation);
    const reasons: string[] = [];
    if (input.expectedAuthorizationMode !== operation.authorizationMode) {
      reasons.push("AUTHORIZATION_MODE_NOT_ALLOWED");
    }
    if (operation.runtimeAvailability !== "phase_b_test_simulation") reasons.push("OPERATION_NOT_ENABLED");
    if (!input.repoId.trim()) reasons.push("REPO_NOT_ALLOWED");
    if (!input.repositoryIdentityDigest.trim()) reasons.push("REPO_IDENTITY_MISMATCH");
    if (input.authenticatedPrincipal.principal.taskId !== input.taskId) reasons.push("TASK_ID_MISMATCH");
    if (!input.parameterDigest.trim()) reasons.push("PARAMETER_DIGEST_REQUIRED");
    if (!input.preflightDigest.trim()) reasons.push("PREFLIGHT_DIGEST_REQUIRED");
    const createdAt = this.#now();
    return {
      schemaVersion: 1,
      policyDecisionId: this.#idGenerator(),
      policyVersion: PHASE_B_POLICY_VERSION,
      operationId: input.operationId,
      operation: input.operation,
      operationTier: operation.operationTier,
      authorizationMode: operation.authorizationMode,
      principal: { ...input.authenticatedPrincipal.principal },
      repoId: input.repoId,
      repositoryIdentityDigest: input.repositoryIdentityDigest,
      taskId: input.taskId,
      leaseId: input.leaseId,
      parameterDigest: input.parameterDigest,
      preflightDigest: input.preflightDigest,
      decision: reasons.length === 0 ? "allow" : "deny",
      reasons,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.#decisionTtlMs).toISOString(),
    };
  }

  assertDecisionCurrent(decision: PolicyDecision): void {
    let operation: MachineOperationDefinition;
    try {
      operation = this.#registry.get(decision.operation);
    } catch {
      throw new PhaseBError("POLICY_DECISION_STALE");
    }
    if (
      operation.operationTier !== decision.operationTier ||
      operation.authorizationMode !== decision.authorizationMode ||
      operation.runtimeAvailability !== "phase_b_test_simulation"
    ) {
      throw new PhaseBError("POLICY_DECISION_STALE");
    }
  }
}

import { randomUUID } from "node:crypto";
import {
  PhaseBError,
  type AuthenticatedPrincipalContext,
  type AuthorizationMode,
  type GitControlMachineOperation,
  type PolicyDecision,
  type PrincipalAuthenticator,
  type TaskPrincipal,
} from "./machineOperationContracts.js";
import type { AuthorizationPolicy } from "./authorizationPolicy.js";
import type { ImmutablePreflightRecord, ImmutablePreflightStore } from "./immutablePreflightStore.js";
import {
  capabilityIdHash,
  type ExecutionCapability,
  type IssuedExecutionCapability,
  type ExecutionCapabilityStore,
} from "./executionCapabilityStore.js";
import type { PolicyDecisionStore } from "./policyDecisionStore.js";
import type {
  MachineAuditAppendInput,
  MachineOperationAuditStore,
} from "./machineOperationAuditStore.js";

export interface MachineOperationAuthorizationInput {
  credential: string | undefined;
  claims: TaskPrincipal;
  expectedTaskId: string;
  expectedSessionId: string;
  operationId: string;
  operation: GitControlMachineOperation;
  expectedAuthorizationMode: AuthorizationMode;
  repoId: string;
  repositoryIdentityDigest: string;
  taskId: string;
  leaseId: string | null;
  parameterDigest: string;
  relevantState: Record<string, unknown>;
}

export interface MachineOperationAuthorizationResult {
  authenticatedPrincipal: AuthenticatedPrincipalContext;
  preflight: ImmutablePreflightRecord;
  policyDecision: PolicyDecision;
  executionCapability: ExecutionCapability | null;
  rawCapability: string | null;
}

export interface ConsumeMachineCapabilityInput {
  credential: string | undefined;
  claims: TaskPrincipal;
  expectedTaskId: string;
  expectedSessionId: string;
  policyDecisionId: string;
  operationId: string;
  repoId: string;
  taskId: string;
  rawCapability: string;
}

export interface MachineOperationAuthorizationServiceOptions {
  authenticator: PrincipalAuthenticator;
  policy: AuthorizationPolicy;
  preflightStore: ImmutablePreflightStore;
  policyDecisionStore: PolicyDecisionStore;
  capabilityStore: ExecutionCapabilityStore;
  auditStore: Pick<MachineOperationAuditStore, "append">;
  now?: () => Date;
  auditIdGenerator?: () => string;
}

export class MachineOperationAuthorizationService {
  readonly #authenticator: PrincipalAuthenticator;
  readonly #policy: AuthorizationPolicy;
  readonly #preflightStore: ImmutablePreflightStore;
  readonly #policyDecisionStore: PolicyDecisionStore;
  readonly #capabilityStore: ExecutionCapabilityStore;
  readonly #auditStore: Pick<MachineOperationAuditStore, "append">;
  readonly #now: () => Date;
  readonly #auditIdGenerator: () => string;

  constructor(options: MachineOperationAuthorizationServiceOptions) {
    this.#authenticator = options.authenticator;
    this.#policy = options.policy;
    this.#preflightStore = options.preflightStore;
    this.#policyDecisionStore = options.policyDecisionStore;
    this.#capabilityStore = options.capabilityStore;
    this.#auditStore = options.auditStore;
    this.#now = options.now ?? (() => new Date());
    this.#auditIdGenerator = options.auditIdGenerator ?? (() => randomUUID());
  }

  async authenticate(input: {
    credential: string | undefined;
    claims: TaskPrincipal;
    expectedTaskId: string;
    expectedSessionId: string;
  }): Promise<AuthenticatedPrincipalContext> {
    return this.#authenticator.authenticate(
      { credential: input.credential, claims: input.claims },
      { taskId: input.expectedTaskId, sessionId: input.expectedSessionId },
    );
  }

  async authorize(
    input: MachineOperationAuthorizationInput,
  ): Promise<MachineOperationAuthorizationResult> {
    const authenticatedPrincipal = await this.#authenticator.authenticate(
      { credential: input.credential, claims: input.claims },
      { taskId: input.expectedTaskId, sessionId: input.expectedSessionId },
    );

    await this.#appendAudit({
      operationId: input.operationId,
      phase: "requested",
      operation: input.operation,
      principalId: authenticatedPrincipal.principal.principalId,
      taskId: authenticatedPrincipal.principal.taskId,
      sessionId: authenticatedPrincipal.principal.sessionId,
      repoId: input.repoId,
      repositoryIdentityDigest: input.repositoryIdentityDigest,
      leaseId: input.leaseId,
      parameterDigest: input.parameterDigest,
    });

    const preflight = await this.#preflightStore.create({
      operationId: input.operationId,
      repoId: input.repoId,
      repositoryIdentityDigest: input.repositoryIdentityDigest,
      principal: authenticatedPrincipal.principal,
      operation: input.operation,
      parameterDigest: input.parameterDigest,
      relevantState: input.relevantState,
      createdAt: this.#now().toISOString(),
    });

    const policyDecision = this.#policy.decide({
      operationId: input.operationId,
      operation: input.operation,
      expectedAuthorizationMode: input.expectedAuthorizationMode,
      authenticatedPrincipal,
      repoId: input.repoId,
      repositoryIdentityDigest: input.repositoryIdentityDigest,
      taskId: input.taskId,
      leaseId: input.leaseId,
      parameterDigest: input.parameterDigest,
      preflightDigest: preflight.immutableDigest,
    });

    // The existing audit store preserves its established phase ordering:
    // policy_decided precedes the durable preflight phase marker.
    await this.#appendAudit({
      operationId: input.operationId,
      phase: "policy_decided",
      operation: policyDecision.operation,
      operationTier: policyDecision.operationTier,
      authorizationMode: policyDecision.authorizationMode,
      principalId: policyDecision.principal.principalId,
      taskId: policyDecision.taskId,
      policyVersion: policyDecision.policyVersion,
      policyDecisionId: policyDecision.policyDecisionId,
      repoId: policyDecision.repoId,
      repositoryIdentityDigest: policyDecision.repositoryIdentityDigest,
      leaseId: policyDecision.leaseId,
      parameterDigest: policyDecision.parameterDigest,
      preflightDigest: policyDecision.preflightDigest,
      resultCode: policyDecision.decision,
    });
    await this.#preflightStore.appendPhaseRecord({
      operationId: input.operationId,
      phase: "policy_decided",
      recordedAt: this.#now().toISOString(),
      immutablePreflightDigest: preflight.immutableDigest,
    });
    await this.#appendAudit({
      operationId: input.operationId,
      phase: "preflight_recorded",
      operation: policyDecision.operation,
      operationTier: policyDecision.operationTier,
      authorizationMode: policyDecision.authorizationMode,
      principalId: policyDecision.principal.principalId,
      taskId: policyDecision.taskId,
      policyDecisionId: policyDecision.policyDecisionId,
      repoId: policyDecision.repoId,
      repositoryIdentityDigest: policyDecision.repositoryIdentityDigest,
      leaseId: policyDecision.leaseId,
      parameterDigest: policyDecision.parameterDigest,
      preflightDigest: policyDecision.preflightDigest,
    });
    await this.#policyDecisionStore.create(policyDecision);

    if (policyDecision.decision !== "allow") {
      return {
        authenticatedPrincipal,
        preflight,
        policyDecision,
        executionCapability: null,
        rawCapability: null,
      };
    }

    let issued: IssuedExecutionCapability | null = null;
    try {
      issued = await this.#capabilityStore.issue(policyDecision);
      await this.#appendAudit({
        operationId: input.operationId,
        phase: "capability_issued",
        operation: policyDecision.operation,
        operationTier: policyDecision.operationTier,
        authorizationMode: policyDecision.authorizationMode,
        principalId: policyDecision.principal.principalId,
        taskId: policyDecision.taskId,
        policyVersion: policyDecision.policyVersion,
        policyDecisionId: policyDecision.policyDecisionId,
        capabilityIdHash: capabilityIdHash(issued.capability.capabilityId),
        repoId: policyDecision.repoId,
        repositoryIdentityDigest: policyDecision.repositoryIdentityDigest,
        leaseId: policyDecision.leaseId,
        parameterDigest: policyDecision.parameterDigest,
        preflightDigest: policyDecision.preflightDigest,
      });
    } catch (error) {
      if (issued) {
        await this.#capabilityStore.revoke(issued.capability.capabilityId);
      }
      throw error;
    }
    return {
      authenticatedPrincipal,
      preflight,
      policyDecision,
      executionCapability: issued.capability,
      rawCapability: issued.rawCapability,
    };
  }

  async consume(input: ConsumeMachineCapabilityInput): Promise<ExecutionCapability> {
    const authenticatedPrincipal = await this.#authenticator.authenticate(
      { credential: input.credential, claims: input.claims },
      { taskId: input.expectedTaskId, sessionId: input.expectedSessionId },
    );
    const policyDecision = await this.#policyDecisionStore.read(input.policyDecisionId);
    const decisionExpiry = Date.parse(policyDecision.expiresAt);
    if (
      policyDecision.decision !== "allow" ||
      !Number.isFinite(decisionExpiry) ||
      decisionExpiry <= this.#now().getTime()
    ) {
      throw new PhaseBError(
        policyDecision.decision === "allow" ? "POLICY_DECISION_EXPIRED" : "POLICY_DENIED",
      );
    }
    this.#policy.assertDecisionCurrent(policyDecision);
    if (
      policyDecision.operationId !== input.operationId ||
      policyDecision.repoId !== input.repoId ||
      policyDecision.taskId !== input.taskId ||
      policyDecision.principal.principalId !== authenticatedPrincipal.principal.principalId ||
      policyDecision.principal.kind !== authenticatedPrincipal.principal.kind ||
      policyDecision.principal.credentialId !== authenticatedPrincipal.principal.credentialId ||
      policyDecision.principal.taskId !== policyDecision.taskId ||
      policyDecision.principal.taskId !== authenticatedPrincipal.principal.taskId ||
      policyDecision.principal.sessionId !== authenticatedPrincipal.principal.sessionId
    ) {
      throw new PhaseBError("POLICY_DECISION_MISMATCH");
    }
    const preflight = await this.#preflightStore.read(policyDecision.operationId);
    if (
      preflight.immutableDigest !== policyDecision.preflightDigest ||
      preflight.operationId !== policyDecision.operationId ||
      preflight.parameterDigest !== policyDecision.parameterDigest ||
      preflight.repoId !== policyDecision.repoId ||
      preflight.repositoryIdentityDigest !== policyDecision.repositoryIdentityDigest ||
      preflight.operation !== policyDecision.operation ||
      preflight.principal.principalId !== policyDecision.principal.principalId ||
      preflight.principal.kind !== policyDecision.principal.kind ||
      preflight.principal.credentialId !== policyDecision.principal.credentialId ||
      preflight.principal.taskId !== policyDecision.taskId ||
      preflight.principal.sessionId !== policyDecision.principal.sessionId
    ) {
      throw new PhaseBError("PREFLIGHT_BINDING_MISMATCH");
    }
    const consumed = await this.#capabilityStore.consume({
      rawCapability: input.rawCapability,
      expected: {
        policyDecisionId: policyDecision.policyDecisionId,
        operationId: policyDecision.operationId,
        operation: policyDecision.operation,
        principalId: authenticatedPrincipal.principal.principalId,
        repoId: policyDecision.repoId,
        repositoryIdentityDigest: policyDecision.repositoryIdentityDigest,
        taskId: policyDecision.taskId,
        leaseId: policyDecision.leaseId,
        parameterDigest: policyDecision.parameterDigest,
        preflightDigest: policyDecision.preflightDigest,
      },
    });
    await this.#appendAudit({
      operationId: policyDecision.operationId,
      phase: "capability_consumed",
      operation: policyDecision.operation,
      operationTier: policyDecision.operationTier,
      authorizationMode: policyDecision.authorizationMode,
      principalId: authenticatedPrincipal.principal.principalId,
      taskId: policyDecision.taskId,
      policyVersion: policyDecision.policyVersion,
      policyDecisionId: policyDecision.policyDecisionId,
      capabilityIdHash: capabilityIdHash(consumed.capabilityId),
      repoId: policyDecision.repoId,
      repositoryIdentityDigest: policyDecision.repositoryIdentityDigest,
      leaseId: policyDecision.leaseId,
      parameterDigest: policyDecision.parameterDigest,
      preflightDigest: preflight.immutableDigest,
    });
    return consumed;
  }

  async #appendAudit(input: Omit<MachineAuditAppendInput, "auditId" | "timestamp">): Promise<void> {
    try {
      await this.#auditStore.append({
        ...input,
        auditId: this.#auditIdGenerator(),
        timestamp: this.#now().toISOString(),
      });
    } catch (error) {
      throw new PhaseBError(
        "AUDIT_WRITE_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

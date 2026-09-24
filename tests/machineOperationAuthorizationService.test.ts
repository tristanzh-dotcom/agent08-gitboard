import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  AuthorizationPolicy,
  DeterministicTestPrincipalAuthenticator,
  OperationRegistry,
  createDefaultOperationDefinitions,
} from "../src/gitboard/authorizationPolicy.js";
import { ExecutionCapabilityStore } from "../src/gitboard/executionCapabilityStore.js";
import { ImmutablePreflightStore } from "../src/gitboard/immutablePreflightStore.js";
import { MachineOperationAuditStore } from "../src/gitboard/machineOperationAuditStore.js";
import { MachineOperationAuthorizationService } from "../src/gitboard/machineOperationAuthorizationService.js";
import { PolicyDecisionStore } from "../src/gitboard/policyDecisionStore.js";
import type { TaskPrincipal } from "../src/gitboard/machineOperationContracts.js";

const tempDirs: string[] = [];
const principal: TaskPrincipal = {
  kind: "codex_task",
  principalId: "principal-1",
  taskId: "task-1",
  sessionId: "session-1",
  credentialId: "credential-1",
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function createSimulationRegistry(): OperationRegistry {
  return new OperationRegistry(
    createDefaultOperationDefinitions().map((definition) =>
      definition.operation === "prepare_isolated_worktree"
        ? { ...definition, runtimeAvailability: "phase_b_test_simulation" as const }
        : definition,
    ),
  );
}

async function service(options: {
  simulation?: boolean;
  failingAudit?: boolean;
  failingAuditPhase?: "requested" | "capability_issued";
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "agent08-phase-b-coordinator-"));
  tempDirs.push(root);
  const now = () => new Date("2026-07-30T00:00:00.000Z");
  const authenticator = new DeterministicTestPrincipalAuthenticator({
    now,
    credentials: [
      {
        credential: "good-test-credential",
        principal,
        status: "active",
        expiresAt: "2026-07-30T01:00:00.000Z",
      },
    ],
  });
  const registry = options.simulation ? createSimulationRegistry() : new OperationRegistry(createDefaultOperationDefinitions());
  const policy = new AuthorizationPolicy({
    registry,
    now,
    idGenerator: () => "decision-1",
  });
  const durableAudit = new MachineOperationAuditStore(root);
  const audit = options.failingAudit || options.failingAuditPhase
    ? ({
        append: async (input: Parameters<MachineOperationAuditStore["append"]>[0]) => {
          if (options.failingAudit || input.phase === options.failingAuditPhase) {
            throw new Error("audit unavailable");
          }
          return durableAudit.append(input);
        },
      } as never)
    : durableAudit;
  return {
    root,
    decisionStore: new PolicyDecisionStore(root),
    service: new MachineOperationAuthorizationService({
      authenticator,
      policy,
      preflightStore: new ImmutablePreflightStore(root),
      policyDecisionStore: new PolicyDecisionStore(root),
      capabilityStore: new ExecutionCapabilityStore(root, {
        now,
        idGenerator: () => "capability-1",
        tokenGenerator: () => "deterministic-secret-material",
      }),
      auditStore: audit,
      now,
    }),
  };
}

const baseInput = {
  credential: "good-test-credential",
  claims: principal,
  expectedTaskId: "task-1",
  expectedSessionId: "session-1",
  operationId: "operation-1",
  operation: "prepare_isolated_worktree" as const,
  expectedAuthorizationMode: "machine_policy" as const,
  repoId: "agent08-gitboard",
  repositoryIdentityDigest: "repo-identity-digest",
  taskId: "task-1",
  leaseId: "lease-1",
  parameterDigest: "parameter-digest",
  relevantState: { headOid: "a".repeat(40), clean: true },
};

describe("MachineOperationAuthorizationService", () => {
  test("runs authenticated test principal through preflight, policy, capability, audit, and consume", async () => {
    const { root, service: coordinator } = await service({ simulation: true });
    const authorization = await coordinator.authorize(baseInput);

    expect(authorization.policyDecision.decision).toBe("allow");
    expect(authorization.executionCapability).toMatchObject({
      capabilityId: "capability-1",
      policyDecisionId: "decision-1",
    });
    expect(authorization.rawCapability).toBe("capability-1.deterministic-secret-material");

    const consumed = await coordinator.consume({
      credential: "good-test-credential",
      claims: principal,
      expectedTaskId: "task-1",
      expectedSessionId: "session-1",
      policyDecisionId: authorization.policyDecision.policyDecisionId,
      operationId: "operation-1",
      repoId: "agent08-gitboard",
      taskId: "task-1",
      rawCapability: authorization.rawCapability!,
    });
    expect(consumed.consumedAt).toBe("2026-07-30T00:00:00.000Z");
    await expect(new MachineOperationAuditStore(root).status("operation-1")).resolves.toMatchObject({
      latestPhase: "capability_consumed",
      status: "consumed",
    });
  });

  test("denies production-disabled operation without producing capability", async () => {
    const { root, service: coordinator } = await service();
    const authorization = await coordinator.authorize(baseInput);

    expect(authorization.policyDecision).toMatchObject({
      decision: "deny",
      reasons: ["OPERATION_NOT_ENABLED"],
    });
    expect(authorization.rawCapability).toBeNull();
    expect(authorization.executionCapability).toBeNull();
    await expect(new ExecutionCapabilityStore(root).read("capability-1")).rejects.toMatchObject({
      code: "CAPABILITY_NOT_FOUND",
    });
  });

  test("does not accept a forged caller decision and reloads the authoritative decision", async () => {
    const { service: coordinator } = await service({ simulation: true });
    const authorization = await coordinator.authorize(baseInput);

    const forgedInput = {
      credential: "good-test-credential",
      claims: principal,
      expectedTaskId: "task-1",
      expectedSessionId: "session-1",
      policyDecisionId: authorization.policyDecision.policyDecisionId,
      operationId: "operation-1",
      repoId: "agent08-gitboard",
      taskId: "task-1",
      rawCapability: authorization.rawCapability!,
      policyDecision: {
        ...authorization.policyDecision,
        operation: "renew_worktree_lease",
        repoId: "forged-repo",
      },
    } as unknown as Parameters<typeof coordinator.consume>[0];
    await expect(coordinator.consume(forgedInput)).resolves.toMatchObject({ capabilityId: "capability-1" });
  });

  test("rejects missing, denied, expired, and mismatched authoritative records", async () => {
    const { service: coordinator } = await service({ simulation: true });
    await expect(
      coordinator.consume({
        credential: "good-test-credential",
        claims: principal,
        expectedTaskId: "task-1",
        expectedSessionId: "session-1",
        policyDecisionId: "missing-decision",
        operationId: "operation-1",
        repoId: "agent08-gitboard",
        taskId: "task-1",
        rawCapability: "capability-1.unknown-secret",
      }),
    ).rejects.toMatchObject({ code: "POLICY_DECISION_NOT_FOUND" });

    const authorization = await coordinator.authorize(baseInput);
    const mismatch = async (overrides: Record<string, unknown>) =>
      coordinator.consume({
        credential: "good-test-credential",
        claims: principal,
        expectedTaskId: "task-1",
        expectedSessionId: "session-1",
        policyDecisionId: authorization.policyDecision.policyDecisionId,
        operationId: "operation-1",
        repoId: "agent08-gitboard",
        taskId: "task-1",
        rawCapability: authorization.rawCapability!,
        ...overrides,
      });

    await expect(mismatch({ repoId: "wrong-repo" })).rejects.toMatchObject({ code: "POLICY_DECISION_MISMATCH" });
    await expect(mismatch({ operationId: "wrong-operation" })).rejects.toMatchObject({ code: "POLICY_DECISION_MISMATCH" });
    await expect(mismatch({ taskId: "wrong-task" })).rejects.toMatchObject({ code: "POLICY_DECISION_MISMATCH" });
    await expect(mismatch({ expectedTaskId: "wrong-task" })).rejects.toMatchObject({ code: "TASK_ID_MISMATCH" });
    await expect(mismatch({ expectedSessionId: "wrong-session" })).rejects.toMatchObject({ code: "SESSION_ID_MISMATCH" });
  });

  test("blocks authorization when the requested audit record cannot be written", async () => {
    const { service: coordinator } = await service({ simulation: true, failingAudit: true });

    await expect(coordinator.authorize(baseInput)).rejects.toMatchObject({
      code: "AUDIT_WRITE_FAILED",
    });
  });

  test("revokes a capability when capability-issued audit cannot be written", async () => {
    const failing = await service({ simulation: true, failingAuditPhase: "capability_issued" });
    await expect(failing.service.authorize({
      ...baseInput,
      operationId: "operation-2",
    })).rejects.toMatchObject({ code: "AUDIT_WRITE_FAILED" });
    await expect(failing.service.consume({
      credential: "good-test-credential",
      claims: principal,
      expectedTaskId: "task-1",
      expectedSessionId: "session-1",
      policyDecisionId: "decision-1",
      operationId: "operation-2",
      repoId: "agent08-gitboard",
      taskId: "task-1",
      rawCapability: "capability-1.deterministic-secret-material",
    })).rejects.toMatchObject({ code: "CAPABILITY_REVOKED" });
  });
});

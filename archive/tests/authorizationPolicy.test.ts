import { describe, expect, test } from "vitest";
import {
  AuthorizationPolicy,
  DeterministicTestPrincipalAuthenticator,
  DisabledPrincipalAuthenticator,
  OperationRegistry,
  createDefaultOperationDefinitions,
} from "../src/gitboard/authorizationPolicy.js";
import {
  PhaseBError,
  digestCanonicalJson,
  type AuthenticatedPrincipalContext,
  type TaskPrincipal,
} from "../src/gitboard/machineOperationContracts.js";

const principal: TaskPrincipal = {
  kind: "codex_task",
  principalId: "principal-1",
  taskId: "task-1",
  sessionId: "session-1",
  credentialId: "credential-1",
};

const context: AuthenticatedPrincipalContext = {
  principal,
  authenticatedAt: "2026-07-30T00:00:00.000Z",
  credentialFingerprint: "sha256:test-only-fingerprint",
  authenticationMethod: "deterministic_test_double",
};

function simulatedRegistry(): OperationRegistry {
  return new OperationRegistry(
    createDefaultOperationDefinitions().map((definition) =>
      definition.operation === "prepare_isolated_worktree"
        ? { ...definition, runtimeAvailability: "phase_b_test_simulation" as const }
        : definition,
    ),
  );
}

describe("server-owned operation registry", () => {
  test("defines every approved operation with production Tier 1 disabled", () => {
    const definitions = createDefaultOperationDefinitions();

    expect(definitions.map((definition) => definition.operation)).toEqual([
      "prepare_isolated_worktree",
      "inspect_worktree_lease",
      "renew_worktree_lease",
      "remove_owned_worktree",
      "prune_owned_worktree_metadata",
      "promote_isolated_branch",
    ]);
    expect(definitions.slice(0, 5).every((definition) => definition.operationTier === 1)).toBe(true);
    expect(definitions.slice(0, 5).every((definition) => definition.runtimeAvailability === "disabled")).toBe(true);
    expect(definitions.find((definition) => definition.operation === "inspect_worktree_lease")).toMatchObject({
      authorizationMode: "machine_policy",
      enabledPhase: "C",
      executionKind: "authenticated_read_only",
      runtimeAvailability: "disabled",
    });
    expect(definitions.find((definition) => definition.operation === "prune_owned_worktree_metadata")).toMatchObject({
      enabledPhase: "D",
      runtimeAvailability: "disabled",
    });
    expect(definitions.find((definition) => definition.operation === "promote_isolated_branch")).toMatchObject({
      operationTier: 2,
      authorizationMode: "user_confirmed",
      enabledPhase: "F",
      runtimeAvailability: "disabled",
    });
  });

  test("rejects duplicate definitions and never accepts caller tier or mode", () => {
    const definitions = createDefaultOperationDefinitions();
    expect(() => new OperationRegistry([...definitions, definitions[0]])).toThrowError(
      expect.objectContaining({ code: "OPERATION_REGISTRY_CONFLICT" }),
    );

    const policy = new AuthorizationPolicy({
      registry: simulatedRegistry(),
      now: () => new Date("2026-07-30T00:00:00.000Z"),
      idGenerator: () => "decision-1",
    });
    const decision = policy.decide({
      operationId: "operation-1",
      operation: "prepare_isolated_worktree",
      expectedAuthorizationMode: "read_only",
      authenticatedPrincipal: context,
      repoId: "agent08-gitboard",
      repositoryIdentityDigest: "repo-identity-digest",
      taskId: "task-1",
      leaseId: null,
      parameterDigest: "parameter-digest",
      preflightDigest: "preflight-digest",
    });

    expect(decision).toMatchObject({
      operationTier: 1,
      authorizationMode: "machine_policy",
      decision: "deny",
      reasons: ["AUTHORIZATION_MODE_NOT_ALLOWED"],
    });
  });
});

describe("principal authentication contracts", () => {
  test("production authenticator is explicitly unavailable", async () => {
    const authenticator = new DisabledPrincipalAuthenticator();

    await expect(
      authenticator.authenticate(
        { credential: "not-a-real-credential", claims: principal },
        { taskId: "task-1", sessionId: "session-1" },
      ),
    ).rejects.toMatchObject({ code: "PRINCIPAL_AUTHENTICATOR_UNAVAILABLE" });
  });

  test("deterministic test double distinguishes trust and every principal mismatch", async () => {
    const authenticator = new DeterministicTestPrincipalAuthenticator({
      now: () => new Date("2026-07-30T00:00:00.000Z"),
      credentials: [
        {
          credential: "good-test-credential",
          principal,
          status: "active",
          expiresAt: "2026-07-30T01:00:00.000Z",
        },
        {
          credential: "expired-test-credential",
          principal: { ...principal, credentialId: "credential-expired" },
          status: "active",
          expiresAt: "2026-07-29T23:59:59.000Z",
        },
        {
          credential: "revoked-test-credential",
          principal: { ...principal, credentialId: "credential-revoked" },
          status: "revoked",
          expiresAt: "2026-07-30T01:00:00.000Z",
        },
      ],
    });

    await expect(
      authenticator.authenticate(
        { credential: "good-test-credential", claims: principal },
        { taskId: "task-1", sessionId: "session-1" },
      ),
    ).resolves.toMatchObject({ principal, authenticationMethod: "deterministic_test_double" });

    const failures: Array<{
      credential: string | undefined;
      claims: TaskPrincipal;
      expected: { taskId: string; sessionId: string };
      code: string;
    }> = [
      {
        credential: undefined,
        claims: principal,
        expected: { taskId: "task-1", sessionId: "session-1" },
        code: "CREDENTIAL_REQUIRED",
      },
      {
        credential: "invalid-test-credential",
        claims: principal,
        expected: { taskId: "task-1", sessionId: "session-1" },
        code: "PRINCIPAL_NOT_TRUSTED",
      },
      {
        credential: "expired-test-credential",
        claims: { ...principal, credentialId: "credential-expired" },
        expected: { taskId: "task-1", sessionId: "session-1" },
        code: "CREDENTIAL_EXPIRED",
      },
      {
        credential: "revoked-test-credential",
        claims: { ...principal, credentialId: "credential-revoked" },
        expected: { taskId: "task-1", sessionId: "session-1" },
        code: "CREDENTIAL_REVOKED",
      },
      {
        credential: "good-test-credential",
        claims: { ...principal, principalId: "wrong-principal" },
        expected: { taskId: "task-1", sessionId: "session-1" },
        code: "PRINCIPAL_MISMATCH",
      },
      {
        credential: "good-test-credential",
        claims: principal,
        expected: { taskId: "other-task", sessionId: "session-1" },
        code: "TASK_ID_MISMATCH",
      },
      {
        credential: "good-test-credential",
        claims: principal,
        expected: { taskId: "task-1", sessionId: "other-session" },
        code: "SESSION_ID_MISMATCH",
      },
    ];

    for (const failure of failures) {
      await expect(
        authenticator.authenticate(
          { credential: failure.credential, claims: failure.claims },
          failure.expected,
        ),
      ).rejects.toMatchObject({ code: failure.code });
    }
  });
});

describe("PolicyDecision", () => {
  test("binds authenticated principal, repo identity, parameters, and immutable preflight", () => {
    const policy = new AuthorizationPolicy({
      registry: simulatedRegistry(),
      now: () => new Date("2026-07-30T00:00:00.000Z"),
      idGenerator: () => "decision-allow",
      decisionTtlMs: 30_000,
    });

    const decision = policy.decide({
      operationId: "operation-allow",
      operation: "prepare_isolated_worktree",
      expectedAuthorizationMode: "machine_policy",
      authenticatedPrincipal: context,
      repoId: "agent08-gitboard",
      repositoryIdentityDigest: "repo-identity-digest",
      taskId: "task-1",
      leaseId: "lease-1",
      parameterDigest: "parameter-digest",
      preflightDigest: "preflight-digest",
    });

    expect(decision).toEqual({
      schemaVersion: 1,
      policyDecisionId: "decision-allow",
      policyVersion: "agent08-git-control-v1.3-phase-b",
      operationId: "operation-allow",
      operation: "prepare_isolated_worktree",
      operationTier: 1,
      authorizationMode: "machine_policy",
      principal,
      repoId: "agent08-gitboard",
      repositoryIdentityDigest: "repo-identity-digest",
      taskId: "task-1",
      leaseId: "lease-1",
      parameterDigest: "parameter-digest",
      preflightDigest: "preflight-digest",
      decision: "allow",
      reasons: [],
      createdAt: "2026-07-30T00:00:00.000Z",
      expiresAt: "2026-07-30T00:00:30.000Z",
    });
  });

  test("denies disabled operations and missing or ambiguous identity evidence", () => {
    const productionPolicy = new AuthorizationPolicy({
      registry: new OperationRegistry(createDefaultOperationDefinitions()),
      now: () => new Date("2026-07-30T00:00:00.000Z"),
      idGenerator: () => "decision-deny",
    });
    expect(
      productionPolicy.decide({
        operationId: "operation-disabled",
        operation: "prepare_isolated_worktree",
        expectedAuthorizationMode: "machine_policy",
        authenticatedPrincipal: context,
        repoId: "agent08-gitboard",
        repositoryIdentityDigest: "repo-identity-digest",
        taskId: "task-1",
        leaseId: null,
        parameterDigest: "parameter-digest",
        preflightDigest: "preflight-digest",
      }),
    ).toMatchObject({ decision: "deny", reasons: ["OPERATION_NOT_ENABLED"] });

    const simulatedPolicy = new AuthorizationPolicy({
      registry: simulatedRegistry(),
      now: () => new Date("2026-07-30T00:00:00.000Z"),
      idGenerator: () => "decision-ambiguous",
    });
    expect(
      simulatedPolicy.decide({
        operationId: "operation-ambiguous",
        operation: "prepare_isolated_worktree",
        expectedAuthorizationMode: "machine_policy",
        authenticatedPrincipal: context,
        repoId: " ",
        repositoryIdentityDigest: "",
        taskId: "task-1",
        leaseId: null,
        parameterDigest: "",
        preflightDigest: "",
      }),
    ).toMatchObject({
      decision: "deny",
      reasons: [
        "REPO_NOT_ALLOWED",
        "REPO_IDENTITY_MISMATCH",
        "PARAMETER_DIGEST_REQUIRED",
        "PREFLIGHT_DIGEST_REQUIRED",
      ],
    });
  });

  test("canonical digest is stable across object key order", () => {
    expect(digestCanonicalJson({ b: 2, a: { y: true, x: "value" } })).toBe(
      digestCanonicalJson({ a: { x: "value", y: true }, b: 2 }),
    );
    expect(() => digestCanonicalJson({ unsafe: undefined })).toThrow(PhaseBError);
  });
});

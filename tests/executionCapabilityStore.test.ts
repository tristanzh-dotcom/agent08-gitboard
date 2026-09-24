import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ExecutionCapabilityStore } from "../src/gitboard/executionCapabilityStore.js";
import type { PolicyDecision } from "../src/gitboard/machineOperationContracts.js";

const tempDirs: string[] = [];
let nowMs = Date.parse("2026-07-30T00:00:00.000Z");

afterEach(async () => {
  nowMs = Date.parse("2026-07-30T00:00:00.000Z");
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function decision(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    schemaVersion: 1,
    policyDecisionId: "decision-1",
    policyVersion: "agent08-git-control-v1.3-phase-b",
    operationId: "operation-1",
    operation: "prepare_isolated_worktree",
    operationTier: 1,
    authorizationMode: "machine_policy",
    principal: {
      kind: "codex_task",
      principalId: "principal-1",
      taskId: "task-1",
      sessionId: "session-1",
      credentialId: "credential-1",
    },
    repoId: "agent08-gitboard",
    repositoryIdentityDigest: "repo-identity-digest",
    taskId: "task-1",
    leaseId: "lease-1",
    parameterDigest: "parameter-digest",
    preflightDigest: "preflight-digest",
    decision: "allow",
    reasons: [],
    createdAt: "2026-07-30T00:00:00.000Z",
    expiresAt: "2026-07-30T00:01:00.000Z",
    ...overrides,
  };
}

async function createStore(options: { ttlMs?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), "agent08-phase-b-capability-"));
  tempDirs.push(root);
  return {
    root,
    store: new ExecutionCapabilityStore(root, {
      now: () => new Date(nowMs),
      idGenerator: () => "capability-1",
      tokenGenerator: () => "deterministic-secret-material",
      ttlMs: options.ttlMs ?? 30_000,
    }),
  };
}

function expected(overrides: Record<string, unknown> = {}) {
  return {
    policyDecisionId: "decision-1",
    operationId: "operation-1",
    operation: "prepare_isolated_worktree" as const,
    principalId: "principal-1",
    repoId: "agent08-gitboard",
    repositoryIdentityDigest: "repo-identity-digest",
    taskId: "task-1",
    leaseId: "lease-1",
    parameterDigest: "parameter-digest",
    preflightDigest: "preflight-digest",
    ...overrides,
  };
}

describe("ExecutionCapabilityStore", () => {
  test("issues opaque capability and persists only its irreversible verifier", async () => {
    const { root, store } = await createStore();
    const issued = await store.issue(decision());
    const persisted = await readFile(
      join(root, "phase-b", "capabilities", "capability-1", "issued.json"),
      "utf8",
    );

    expect(issued.rawCapability).toBe("capability-1.deterministic-secret-material");
    expect(persisted).not.toContain(issued.rawCapability);
    expect(persisted).not.toContain("deterministic-secret-material");
    expect(persisted).toContain("verifierHash");
    expect(await new ExecutionCapabilityStore(root, { now: () => new Date(nowMs) }).read("capability-1"))
      .toMatchObject({ capabilityId: "capability-1", consumedAt: null });
  });

  test("consumes once before operation and rejects replay", async () => {
    const { root, store } = await createStore();
    const issued = await store.issue(decision());
    const consumed = await store.consume({ rawCapability: issued.rawCapability, expected: expected() });

    expect(consumed.consumedAt).toBe("2026-07-30T00:00:00.000Z");
    await expect(
      new ExecutionCapabilityStore(root, { now: () => new Date(nowMs) }).consume({
        rawCapability: issued.rawCapability,
        expected: expected(),
      }),
    ).rejects.toMatchObject({ code: "CAPABILITY_USED" });
  });

  test("rejects missing, expired, denied, and every binding mismatch", async () => {
    const { store } = await createStore({ ttlMs: 1_000 });
    await expect(store.issue(decision({ decision: "deny", reasons: ["POLICY_DENIED"] }))).rejects.toMatchObject({
      code: "POLICY_DENIED",
    });

    const issued = await store.issue(decision());
    await expect(store.consume({ rawCapability: "", expected: expected() })).rejects.toMatchObject({
      code: "CAPABILITY_REQUIRED",
    });
    const mismatches = [
      { policyDecisionId: "other-decision" },
      { operationId: "other-operation" },
      { operation: "renew_worktree_lease" },
      { principalId: "other-principal" },
      { repoId: "other-repo" },
      { repositoryIdentityDigest: "other-identity" },
      { taskId: "other-task" },
      { leaseId: "other-lease" },
      { parameterDigest: "other-parameters" },
      { preflightDigest: "other-preflight" },
    ];
    for (const mismatch of mismatches) {
      await expect(
        store.consume({ rawCapability: issued.rawCapability, expected: expected(mismatch) }),
      ).rejects.toMatchObject({ code: "CAPABILITY_MISMATCH" });
    }
    await expect(
      store.consume({ rawCapability: "capability-1.wrong-secret", expected: expected() }),
    ).rejects.toMatchObject({ code: "CAPABILITY_MISMATCH" });

    nowMs += 1_001;
    await expect(
      store.consume({ rawCapability: issued.rawCapability, expected: expected() }),
    ).rejects.toMatchObject({ code: "CAPABILITY_EXPIRED" });
  });

  test("default generator uses cryptographically strong opaque material", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-phase-b-capability-random-"));
    tempDirs.push(root);
    const issued = await new ExecutionCapabilityStore(root, {
      now: () => new Date(nowMs),
    }).issue(decision());
    const [, secret = ""] = issued.rawCapability.split(".");

    expect(secret.length).toBeGreaterThanOrEqual(40);
    expect(secret).not.toMatch(/^[0-9a-f-]{36}$/i);
  });
});

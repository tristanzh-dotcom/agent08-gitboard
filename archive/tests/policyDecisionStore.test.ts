import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { PolicyDecisionStore } from "../src/gitboard/policyDecisionStore.js";
import type { PolicyDecision } from "../src/gitboard/machineOperationContracts.js";

const tempDirs: string[] = [];

afterEach(async () => {
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

describe("PolicyDecisionStore", () => {
  test("persists complete immutable decisions and rejects overwrite", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-phase-b-policy-"));
    tempDirs.push(root);
    const store = new PolicyDecisionStore(root);
    const created = decision();

    await store.create(created);
    await expect(new PolicyDecisionStore(root).read("decision-1")).resolves.toEqual(created);
    await expect(store.create(created)).rejects.toMatchObject({ code: "POLICY_DECISION_ALREADY_EXISTS" });

    const persisted = await readFile(
      join(root, "phase-b", "policy-decisions", "decision-1.json"),
      "utf8",
    );
    expect(persisted).not.toContain("rawCapability");
    expect(persisted).not.toContain("credential-value");
  });

  test("returns a typed missing-record error", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-phase-b-policy-missing-"));
    tempDirs.push(root);
    await expect(new PolicyDecisionStore(root).read("missing-decision")).rejects.toMatchObject({
      code: "POLICY_DECISION_NOT_FOUND",
    });
  });
});

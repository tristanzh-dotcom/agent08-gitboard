import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { MachineOperationAuditStore } from "../src/gitboard/machineOperationAuditStore.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function store(): Promise<{ root: string; store: MachineOperationAuditStore }> {
  const root = await mkdtemp(join(tmpdir(), "agent08-phase-b-audit-"));
  tempDirs.push(root);
  return { root, store: new MachineOperationAuditStore(root) };
}

describe("MachineOperationAuditStore", () => {
  test("appends phases and recovers operation status after restart", async () => {
    const { root, store: first } = await store();
    await first.append({
      auditId: "audit-1",
      operationId: "operation-1",
      phase: "requested",
      timestamp: "2026-07-30T00:00:00.000Z",
      operation: "prepare_isolated_worktree",
      operationTier: 1,
      authorizationMode: "machine_policy",
      principalId: "principal-1",
      taskId: "task-1",
      sessionId: "session-1",
      repoId: "agent08-gitboard",
    });
    await first.append({
      auditId: "audit-2",
      operationId: "operation-1",
      phase: "policy_decided",
      timestamp: "2026-07-30T00:00:01.000Z",
      policyDecisionId: "decision-1",
      resultCode: "allow",
    });

    const restarted = new MachineOperationAuditStore(root);
    await expect(restarted.readOperation("operation-1")).resolves.toHaveLength(2);
    await expect(restarted.status("operation-1")).resolves.toEqual({
      operationId: "operation-1",
      latestPhase: "policy_decided",
      status: "authorized",
    });
  });

  test("rejects duplicate and out-of-order phases", async () => {
    const { store } = await MachineOperationAuditStoreTestFixture();
    await store.append({
      auditId: "audit-1",
      operationId: "operation-1",
      phase: "requested",
      timestamp: "2026-07-30T00:00:00.000Z",
    });
    await store.append({
      auditId: "audit-2",
      operationId: "operation-1",
      phase: "preflight_recorded",
      timestamp: "2026-07-30T00:00:01.000Z",
    });

    await expect(
      store.append({
        auditId: "audit-duplicate",
        operationId: "operation-1",
        phase: "preflight_recorded",
        timestamp: "2026-07-30T00:00:02.000Z",
      }),
    ).rejects.toMatchObject({ code: "AUDIT_PHASE_ALREADY_EXISTS" });
    await expect(
      store.append({
        auditId: "audit-old",
        operationId: "operation-1",
        phase: "policy_decided",
        timestamp: "2026-07-30T00:00:03.000Z",
      }),
    ).rejects.toMatchObject({ code: "AUDIT_PHASE_ORDER_INVALID" });
  });

  test("stores capability ID hash but rejects raw capability, credential, and stderr", async () => {
    const { root, store } = await MachineOperationAuditStoreTestFixture();
    await store.append({
      auditId: "audit-safe",
      operationId: "operation-safe",
      phase: "capability_issued",
      timestamp: "2026-07-30T00:00:00.000Z",
      capabilityIdHash: "sha256:capability-id-hash",
    });
    const text = await readFile(
      join(root, "phase-b", "audit", "operation-safe", "04-capability_issued.json"),
      "utf8",
    );
    expect(text).toContain("sha256:capability-id-hash");

    for (const unsafe of [
      { rawCapability: "raw-capability" },
      { credential: "raw-credential" },
      { unrestrictedStderr: "private stderr" },
    ]) {
      await expect(
        store.append({
          auditId: `audit-${Object.keys(unsafe)[0]}`,
          operationId: `operation-${Object.keys(unsafe)[0]}`,
          phase: "requested",
          timestamp: "2026-07-30T00:00:00.000Z",
          ...unsafe,
        } as never),
      ).rejects.toMatchObject({ code: "SENSITIVE_MATERIAL_FORBIDDEN" });
    }
  });
});

async function MachineOperationAuditStoreTestFixture(): Promise<{
  root: string;
  store: MachineOperationAuditStore;
}> {
  return store();
}

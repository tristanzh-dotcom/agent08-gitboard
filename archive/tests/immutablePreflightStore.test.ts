import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ImmutablePreflightStore } from "../src/gitboard/immutablePreflightStore.js";
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

async function createStore(): Promise<{ root: string; store: ImmutablePreflightStore }> {
  const root = await mkdtemp(join(tmpdir(), "agent08-phase-b-preflight-"));
  tempDirs.push(root);
  return { root, store: new ImmutablePreflightStore(root) };
}

function input(relevantState: Record<string, unknown> = { headOid: "abc123", clean: true }) {
  return {
    operationId: "operation-1",
    repoId: "agent08-gitboard",
    repositoryIdentityDigest: "repo-identity-digest",
    principal,
    operation: "prepare_isolated_worktree" as const,
    parameterDigest: "parameter-digest",
    relevantState,
    createdAt: "2026-07-30T00:00:00.000Z",
  };
}

describe("ImmutablePreflightStore", () => {
  test("creates a stable digest and remains readable after restart", async () => {
    const { root, store: first } = await createStore();
    const { store: second } = await createStore();
    const created = await first.create(input({ z: 1, nested: { b: true, a: "value" } }));
    const sameRecord = await second.create(input({ nested: { a: "value", b: true }, z: 1 }));

    expect(created.immutableDigest).toBe(sameRecord.immutableDigest);
    await expect(new ImmutablePreflightStore(root).read("operation-1")).resolves.toEqual(created);
  });

  test("rejects overwrite and appends later phase records without changing preflight", async () => {
    const { root, store } = await createStore();
    const created = await store.create(input());
    const recordPath = join(root, "phase-b", "preflight", "operation-1", "record.json");
    const originalText = await readFile(recordPath, "utf8");

    await expect(store.create(input())).rejects.toMatchObject({ code: "PREFLIGHT_ALREADY_EXISTS" });
    await store.appendPhaseRecord({
      operationId: "operation-1",
      phase: "policy_decided",
      recordedAt: "2026-07-30T00:00:01.000Z",
      immutablePreflightDigest: created.immutableDigest,
    });

    expect(await readFile(recordPath, "utf8")).toBe(originalText);
    await expect(
      store.appendPhaseRecord({
        operationId: "operation-1",
        phase: "policy_decided",
        recordedAt: "2026-07-30T00:00:02.000Z",
        immutablePreflightDigest: created.immutableDigest,
      }),
    ).rejects.toMatchObject({ code: "PREFLIGHT_PHASE_ALREADY_EXISTS" });
  });

  test("rejects sensitive material and unsafe operation IDs", async () => {
    const { store } = await createStore();
    await expect(
      store.create(input({ rawCapability: "must-not-persist" })),
    ).rejects.toMatchObject({ code: "SENSITIVE_MATERIAL_FORBIDDEN" });
    await expect(store.create({ ...input(), operationId: "../escape" })).rejects.toMatchObject({
      code: "UNSAFE_RECORD_ID",
    });
  });
});

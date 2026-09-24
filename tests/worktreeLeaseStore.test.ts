import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { WorktreeLeaseStore } from "../src/gitboard/worktreeLeaseStore.js";

const tempDirs: string[] = [];
let nowMs = Date.parse("2026-07-30T00:00:00.000Z");

afterEach(async () => {
  nowMs = Date.parse("2026-07-30T00:00:00.000Z");
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const identity = {
  repoId: "agent08-gitboard",
  canonicalRepositoryPath: "/Users/tristanzh/agent/agent08-gitboard",
  canonicalTopLevelPath: "/Users/tristanzh/agent/agent08-gitboard",
  canonicalCommonGitDir: "/Users/tristanzh/agent/agent08-gitboard/.git",
  commonGitDirDevice: 1,
  commonGitDirInode: 2,
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: "idempotency-1",
    requestDigest: "request-digest-1",
    repoId: "agent08-gitboard",
    repositoryIdentity: identity,
    principalId: "principal-1",
    taskId: "task-1",
    sessionId: "session-1",
    canonicalWorktreePath: "/Users/tristanzh/.codex/agent08/worktrees/agent08-gitboard/task-1/lease-1",
    creationOperationId: "operation-1",
    baseCommitOid: "a".repeat(40),
    branchMode: "detached" as const,
    branchName: null,
    requestedLeaseSeconds: 3_600,
    lastAuditId: "audit-1",
    ...overrides,
  };
}

async function createStore() {
  const root = await mkdtemp(join(tmpdir(), "agent08-phase-b-lease-"));
  tempDirs.push(root);
  let generated = 0;
  return {
    root,
    store: new WorktreeLeaseStore(root, {
      now: () => new Date(nowMs),
      idGenerator: () => `lease-${++generated}`,
    }),
  };
}

describe("WorktreeLeaseStore", () => {
  test("reserves with policy defaults, allows shorter TTL, and recovers after restart", async () => {
    const { root, store } = await createStore();
    const reserved = await store.reserve(request({ requestedLeaseSeconds: 3_600 }));

    expect(reserved).toMatchObject({
      leaseId: "lease-1",
      lifecycle: "reserved",
      leaseVersion: 0,
      createdAt: "2026-07-30T00:00:00.000Z",
      expiresAt: "2026-07-30T01:00:00.000Z",
      expiryGraceAt: "2026-07-31T01:00:00.000Z",
    });
    expect(await new WorktreeLeaseStore(root, { now: () => new Date(nowMs) }).read("lease-1")).toEqual(reserved);
  });

  test("is idempotent for the same request and conflicts for changed parameters", async () => {
    const { store } = await createStore();
    const first = await store.reserve(request());
    await expect(store.reserve(request())).resolves.toEqual(first);
    await expect(store.reserve(request({ requestDigest: "changed-request" }))).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });

  test("uses version CAS, bounded renewal, and never deletes on expiry", async () => {
    const { store } = await createStore();
    await store.reserve(request({ requestedLeaseSeconds: 86_400 }));
    await store.transition("lease-1", 0, "creating", "audit-creating");
    const active = await store.transition("lease-1", 1, "active", "audit-active");

    await expect(store.transition("lease-1", 0, "removing", "audit-stale")).rejects.toMatchObject({
      code: "LEASE_VERSION_CONFLICT",
    });
    const renewed = await store.renew("lease-1", active.leaseVersion, 3_600, "audit-renew");
    expect(renewed.leaseVersion).toBe(active.leaseVersion + 1);
    expect(renewed.expiresAt).toBe("2026-07-30T01:00:00.000Z");

    await expect(
      store.renew("lease-1", renewed.leaseVersion, 7 * 24 * 60 * 60 + 1, "audit-too-long"),
    ).rejects.toMatchObject({ code: "LEASE_RENEWAL_LIMIT_EXCEEDED" });

    nowMs = Date.parse("2026-07-30T01:00:01.000Z");
    await expect(store.isExpired("lease-1")).resolves.toBe(true);
    await expect(store.read("lease-1")).resolves.toMatchObject({ lifecycle: "active" });
  });

  test("records quarantine and removed tombstone as durable lifecycle states", async () => {
    const { store } = await createStore();
    await store.reserve(request());
    await store.transition("lease-1", 0, "creating", "audit-creating");
    const active = await store.transition("lease-1", 1, "active", "audit-active");
    const quarantined = await store.quarantine("lease-1", active.leaseVersion, "audit-quarantine");
    expect(quarantined.lifecycle).toBe("quarantined");

    const second = await store.reserve(request({
      idempotencyKey: "idempotency-2",
      requestDigest: "request-digest-2",
    }));
    await store.transition(second.leaseId, 0, "creating", "audit-creating-2");
    const activeSecond = await store.transition(second.leaseId, 1, "active", "audit-active-2");
    const removing = await store.transition(second.leaseId, activeSecond.leaseVersion, "removing", "audit-removing");
    const removed = await store.tombstone(second.leaseId, removing.leaseVersion, "audit-removed");
    expect(removed.lifecycle).toBe("removed");
    await expect(store.read(second.leaseId)).resolves.toMatchObject({ lifecycle: "removed" });
  });
});

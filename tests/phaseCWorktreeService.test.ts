import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
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
import { createPhaseCWorktreeService, type PrepareIsolatedWorktreeRequest } from "../src/gitboard/phaseCWorktreeService.js";
import type { TaskPrincipal } from "../src/gitboard/machineOperationContracts.js";

const exec = promisify(execFile);
const dirs: string[] = [];
const principal: TaskPrincipal = { kind: "codex_task", principalId: "principal-1", taskId: "task-1", sessionId: "session-1", credentialId: "credential-1" };

afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agent08-phase-c-")); dirs.push(root);
  const repo = join(root, "repo"); const managedRoot = join(root, "managed");
  await exec("git", ["init", "-q", repo]);
  await exec("git", ["-C", repo, "config", "user.email", "test@example.invalid"]);
  await exec("git", ["-C", repo, "config", "user.name", "Phase C Test"]);
  await writeFile(join(repo, "README.md"), "fixture\n");
  await exec("git", ["-C", repo, "add", "README.md"]); await exec("git", ["-C", repo, "commit", "-qm", "fixture"]);
  const { stdout } = await exec("git", ["-C", repo, "rev-parse", "HEAD"]);
  const manifest = { version: 1 as const, root, generatedAt: new Date(0).toISOString(), targets: [{ id: "fixture-repo", agent: null, label: "Fixture", path: repo, remote: "", visibility: "local" as const, required: true }] };
  return { root, repo, managedRoot, manifest, head: stdout.trim() };
}

type WorktreeAdd = (repo: string, target: string, oid: string) => Promise<void>;

async function service(
  f: Awaited<ReturnType<typeof fixture>>,
  ids?: () => string,
  options: { worktreeAdd?: WorktreeAdd; auditFailurePhase?: string | (() => string | undefined) } = {},
) {
  const now = () => new Date("2026-07-30T00:00:00.000Z");
  const authenticator = new DeterministicTestPrincipalAuthenticator({ now, credentials: [{ credential: "good-test-credential", principal, status: "active", expiresAt: "2026-07-30T01:00:00.000Z" }] });
  const definitions = createDefaultOperationDefinitions().map((definition) =>
    ["prepare_isolated_worktree", "inspect_worktree_lease", "renew_worktree_lease"].includes(definition.operation)
      ? { ...definition, runtimeAvailability: "phase_b_test_simulation" as const } : definition,
  );
  let decisionNumber = 0;
  const authRoot = join(f.root, "auth");
  const authorization = new MachineOperationAuthorizationService({
    authenticator,
    policy: new AuthorizationPolicy({ registry: new OperationRegistry(definitions), now, idGenerator: () => `decision-${++decisionNumber}` }),
    preflightStore: new ImmutablePreflightStore(authRoot),
    policyDecisionStore: new PolicyDecisionStore(authRoot),
    capabilityStore: new ExecutionCapabilityStore(authRoot, { now, idGenerator: (() => { let n = 0; return () => `capability-${++n}`; })(), tokenGenerator: () => "deterministic-secret-material" }),
    auditStore: new MachineOperationAuditStore(authRoot),
    now,
  });
  const durableAudit = new MachineOperationAuditStore(join(f.root, "phase-c-audit"));
  const auditStore = {
    append: async (input: Parameters<MachineOperationAuditStore["append"]>[0]) => {
      const failurePhase = typeof options.auditFailurePhase === "function"
        ? options.auditFailurePhase()
        : options.auditFailurePhase;
      if (input.phase === failurePhase) throw new Error("audit unavailable");
      return durableAudit.append(input);
    },
  };
  return createPhaseCWorktreeService({
    manifest: f.manifest,
    managedRoot: f.managedRoot,
    stateRoot: join(f.root, "leases"),
    authenticator,
    authorization,
    auditStore,
    now,
    idGenerator: ids,
    worktreeAdd: options.worktreeAdd,
  } as never);
}

function request(f: Awaited<ReturnType<typeof fixture>>, overrides: Partial<PrepareIsolatedWorktreeRequest> = {}): PrepareIsolatedWorktreeRequest {
  return { schemaVersion: 1, operationId: "op-1", idempotencyKey: "idem-1", credential: "good-test-credential", claims: principal, repoId: "fixture-repo", taskId: principal.taskId, base: { kind: "commit_oid", oid: f.head }, branchMode: "detached", requestedLeaseSeconds: 3600, ...overrides };
}

describe("Phase C authenticated isolated worktree lifecycle", () => {
  test("creates detached worktree, inspects it, renews, and writes durable audit", async () => {
    const f = await fixture(); const svc = await service(f);
    const created = await svc.prepare(request(f));
    expect(created.lease.lifecycle).toBe("active");
    const inspected = await svc.inspect({ schemaVersion: 1, operationId: "op-2", idempotencyKey: "idem-2", credential: "good-test-credential", claims: principal, repoId: "fixture-repo", taskId: principal.taskId, leaseId: created.lease.leaseId });
    expect(inspected).toMatchObject({ ownershipVerified: true, registered: true, headOid: f.head, clean: true, removable: false });
    const renewed = await svc.renew({ schemaVersion: 1, operationId: "op-3", idempotencyKey: "idem-3", credential: "good-test-credential", claims: principal, repoId: "fixture-repo", taskId: principal.taskId, leaseId: created.lease.leaseId, expectedLeaseVersion: created.lease.leaseVersion, requestedLeaseSeconds: 7200 });
    expect(renewed.lease.leaseVersion).toBe(created.lease.leaseVersion + 2);
    const audit = await readFile(join(f.root, "phase-c-audit", "phase-b", "audit", "op-1", "08-postflight_recorded.json"), "utf8");
    expect(JSON.parse(audit).auditId).toBe(created.lease.lastAuditId);
    for (const phase of ["07-command_finished", "08-postflight_recorded", "09-result_recorded"]) {
      await expect(readFile(join(f.root, "phase-c-audit", "phase-b", "audit", "op-1", `${phase}.json`), "utf8")).resolves.toBeTruthy();
    }
  });

  test("does not alter a dirty primary worktree", async () => {
    const f = await fixture(); await writeFile(join(f.repo, "dirty.txt"), "keep\n"); const svc = await service(f);
    await svc.prepare(request(f, { base: { kind: "repo_head" } }));
    await expect(exec("git", ["-C", f.repo, "status", "--porcelain"])).resolves.toMatchObject({ stdout: expect.stringContaining("?? dirty.txt") });
  });

  test("counts ignored porcelain entries without granting removability", async () => {
    const f = await fixture();
    const svc = await service(f);
    const created = await svc.prepare(request(f));
    await writeFile(join(f.repo, ".git", "info", "exclude"), "ignored.txt\n");
    await writeFile(join(created.lease.canonicalWorktreePath, "ignored.txt"), "ignored\n");
    const inspected = await svc.inspect({
      schemaVersion: 1,
      operationId: "op-ignored",
      idempotencyKey: "idem-ignored",
      credential: "good-test-credential",
      claims: principal,
      repoId: "fixture-repo",
      taskId: principal.taskId,
      leaseId: created.lease.leaseId,
    });
    expect(inspected.ignoredOutputCount).toBe(1);
    expect(inspected.removable).toBe(false);
  });

  test("rejects managed branches, caller paths, bad commits, and missing configuration", async () => {
    const f = await fixture(); const svc = await service(f);
    await expect(svc.prepare(request(f, { branchMode: "managed_branch" }))).rejects.toMatchObject({ code: "BRANCH_MODE_UNSUPPORTED" });
    await expect(svc.prepare({ ...request(f), targetPath: "/tmp/escape" } as never)).rejects.toMatchObject({ code: "UNSUPPORTED_REQUEST_FIELD" });
    await expect(svc.prepare(request(f, { base: { kind: "commit_oid", oid: "b".repeat(40) } }))).rejects.toMatchObject({ code: "BASE_REVISION_INVALID" });
    expect(() => createPhaseCWorktreeService({})).toThrowError(expect.objectContaining({ code: "PHASE_C_CONFIGURATION_REQUIRED" }));
  });

  test("authenticates caller claims and rejects ownership mismatch", async () => {
    const f = await fixture(); const svc = await service(f); const created = await svc.prepare(request(f));
    await expect(svc.inspect({ schemaVersion: 1, operationId: "op-bad", idempotencyKey: "idem-bad", credential: "good-test-credential", claims: { ...principal, taskId: "other" }, repoId: "fixture-repo", taskId: "other", leaseId: created.lease.leaseId })).rejects.toMatchObject({ code: "TASK_ID_MISMATCH" });
    await expect(svc.inspect({ schemaVersion: 1, operationId: "op-bad2", idempotencyKey: "idem-bad2", credential: "wrong", claims: principal, repoId: "fixture-repo", taskId: principal.taskId, leaseId: created.lease.leaseId })).rejects.toMatchObject({ code: "PRINCIPAL_NOT_TRUSTED" });
  });

  test("idempotency ignores operationId and reconciles an exact existing registration", async () => {
    const f = await fixture(); const ids = (() => { let n = 0; return () => `lease-${++n}`; })(); const svc = await service(f, ids);
    const first = await svc.prepare(request(f)); const second = await svc.prepare(request(f, { operationId: "different-operation" }));
    expect(second.lease.leaseId).toBe(first.lease.leaseId);
    await expect(readFile(join(f.root, "phase-c-audit", "phase-b", "audit", "different-operation", "06-command_started.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(f.root, "phase-c-audit", "phase-b", "audit", "different-operation", "07-command_finished.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("reserve and creating transition precede command_started and injected Git execution", async () => {
    const f = await fixture();
    let observedCreating = false;
    let observedCommandAudit = false;
    const add: WorktreeAdd = async (repo, target, oid) => {
      const leaseText = await readFile(join(f.root, "leases", "phase-b", "leases", "lease-1", "versions", "000001.json"), "utf8");
      observedCreating = JSON.parse(leaseText).lifecycle === "creating";
      observedCommandAudit = await readFile(join(f.root, "phase-c-audit", "phase-b", "audit", "op-1", "06-command_started.json")).then(() => true).catch(() => false);
      await exec("git", ["-C", repo, "worktree", "add", "--detach", target, oid]);
    };
    const svc = await service(f, () => "lease-1", { worktreeAdd: add });
    await svc.prepare(request(f));
    expect(observedCreating).toBe(true);
    expect(observedCommandAudit).toBe(true);
  });

  test("idempotency conflict does not produce command_started", async () => {
    const f = await fixture();
    const svc = await service(f, () => "lease-1");
    await svc.prepare(request(f));
    await expect(svc.prepare(request(f, { operationId: "op-conflict", requestedLeaseSeconds: 7200 }))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(readFile(join(f.root, "phase-c-audit", "phase-b", "audit", "op-conflict", "06-command_started.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("primary postcondition mismatch quarantines the lease", async () => {
    const f = await fixture();
    const add: WorktreeAdd = async (repo, target, oid) => {
      await exec("git", ["-C", repo, "worktree", "add", "--detach", target, oid]);
      await writeFile(join(repo, "postcondition-drift.txt"), "drift\n");
    };
    const svc = await service(f, () => "lease-1", { worktreeAdd: add });
    await expect(svc.prepare(request(f))).rejects.toMatchObject({ code: "POSTCONDITION_FAILED" });
    const lease = await new (await import("../src/gitboard/worktreeLeaseStore.js")).WorktreeLeaseStore(join(f.root, "leases")).read("lease-1");
    expect(lease.lifecycle).toBe("quarantined");
  });

  test("postflight ambiguity quarantines the lease", async () => {
    const f = await fixture();
    const add: WorktreeAdd = async (_repo, target) => { await mkdir(target, { recursive: true }); };
    const svc = await service(f, () => "lease-1", { worktreeAdd: add });
    await expect(svc.prepare(request(f))).rejects.toMatchObject({ code: "POSTCONDITION_FAILED" });
    const lease = await new (await import("../src/gitboard/worktreeLeaseStore.js")).WorktreeLeaseStore(join(f.root, "leases")).read("lease-1");
    expect(lease.lifecycle).toBe("quarantined");
  });

  test("failed Git command with absent target converges to failed lease", async () => {
    const f = await fixture();
    const add: WorktreeAdd = async () => { throw new Error("simulated command failure"); };
    const svc = await service(f, () => "lease-1", { worktreeAdd: add });
    await expect(svc.prepare(request(f))).rejects.toMatchObject({ code: "GIT_WORKTREE_ADD_FAILED" });
    const lease = await new (await import("../src/gitboard/worktreeLeaseStore.js")).WorktreeLeaseStore(join(f.root, "leases")).read("lease-1");
    expect(lease.lifecycle).toBe("failed");
  });

  test("renew does not write a renewed audit when lease CAS rejects", async () => {
    const f = await fixture();
    const svc = await service(f, () => "lease-1");
    const created = await svc.prepare(request(f));
    await expect(svc.renew({
      schemaVersion: 1, operationId: "renew-conflict", idempotencyKey: "renew-conflict",
      credential: "good-test-credential", claims: principal, repoId: "fixture-repo", taskId: principal.taskId,
      leaseId: created.lease.leaseId, expectedLeaseVersion: created.lease.leaseVersion - 2, requestedLeaseSeconds: 7200,
    })).rejects.toMatchObject({ code: "LEASE_VERSION_CONFLICT" });
    await expect(readFile(join(f.root, "phase-c-audit", "phase-b", "audit", "renew-conflict", "09-result_recorded.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("renew audit failure quarantines the newly renewed lease", async () => {
    let failurePhase: string | undefined;
    const f = await fixture();
    const svc = await service(f, () => "lease-1", { auditFailurePhase: () => failurePhase });
    const created = await svc.prepare(request(f));
    failurePhase = "result_recorded";
    await expect(svc.renew({
      schemaVersion: 1, operationId: "renew-audit-failure", idempotencyKey: "renew-audit-failure",
      credential: "good-test-credential", claims: principal, repoId: "fixture-repo", taskId: principal.taskId,
      leaseId: created.lease.leaseId, expectedLeaseVersion: created.lease.leaseVersion, requestedLeaseSeconds: 7200,
    })).rejects.toMatchObject({ code: "AUDIT_WRITE_FAILED" });
    const lease = await new (await import("../src/gitboard/worktreeLeaseStore.js")).WorktreeLeaseStore(join(f.root, "leases")).read("lease-1");
    expect(lease.lifecycle).toBe("quarantined");
    expect(lease.leaseVersion).toBe(created.lease.leaseVersion + 2);
  });

  test("active result audit failure quarantines the new active version", async () => {
    let failurePhase: string | undefined;
    const f = await fixture();
    let nextLease = 0;
    const svc = await service(f, () => `lease-${++nextLease}`, { auditFailurePhase: () => failurePhase });
    const first = await svc.prepare(request(f));
    expect(first.lease.lifecycle).toBe("active");
    failurePhase = "result_recorded";
    await expect(svc.prepare(request(f, { operationId: "op-2", idempotencyKey: "idem-2" }))).rejects.toMatchObject({ code: "AUDIT_WRITE_FAILED" });
    const lease = await new (await import("../src/gitboard/worktreeLeaseStore.js")).WorktreeLeaseStore(join(f.root, "leases")).read("lease-2");
    expect(lease.lifecycle).toBe("quarantined");
  });

  test("post-command audit failure quarantines instead of leaving creating", async () => {
    const f = await fixture();
    const add: WorktreeAdd = async () => { throw new Error("simulated command failure"); };
    const svc = await service(f, () => "lease-1", { worktreeAdd: add, auditFailurePhase: "command_finished" });
    await expect(svc.prepare(request(f))).rejects.toMatchObject({ code: "AUDIT_WRITE_FAILED" });
    const lease = await new (await import("../src/gitboard/worktreeLeaseStore.js")).WorktreeLeaseStore(join(f.root, "leases")).read("lease-1");
    expect(lease.lifecycle).toBe("quarantined");
  });

  test("renew proves detached filesystem ownership and rejects metadata drift without lease mutation", async () => {
    const cases = [
      {
        name: "wrong gitdir",
        mutate: async (worktree: string, admin: string) => { await writeFile(join(worktree, ".git"), "gitdir: /tmp/not-owned\n"); },
      },
      {
        name: "wrong commondir",
        mutate: async (_worktree: string, admin: string) => { await writeFile(join(admin, "commondir"), "/tmp/not-common\n"); },
      },
      {
        name: "wrong back-reference",
        mutate: async (_worktree: string, admin: string) => { await writeFile(join(admin, "gitdir"), "/tmp/not-worktree/.git\n"); },
      },
      {
        name: "symbolic HEAD",
        mutate: async (_worktree: string, admin: string) => { await writeFile(join(admin, "HEAD"), "ref: refs/heads/main\n"); },
      },
      {
        name: "wrong detached OID",
        mutate: async (_worktree: string, admin: string) => { await writeFile(join(admin, "HEAD"), "0".repeat(40) + "\n"); },
      },
    ];
    for (const testCase of cases) {
      const f = await fixture();
      const svc = await service(f, () => "lease-1");
      const created = await svc.prepare(request(f));
      const worktree = created.lease.canonicalWorktreePath;
      const gitFile = await readFile(join(worktree, ".git"), "utf8");
      const gitdir = gitFile.trim().slice("gitdir:".length).trim();
      const admin = await realpath(gitdir);
      await testCase.mutate(worktree, admin);
      await expect(svc.renew({
        schemaVersion: 1, operationId: `renew-${testCase.name}`, idempotencyKey: `renew-${testCase.name}`,
        credential: "good-test-credential", claims: principal, repoId: "fixture-repo", taskId: principal.taskId,
        leaseId: created.lease.leaseId, expectedLeaseVersion: created.lease.leaseVersion, requestedLeaseSeconds: 7200,
      })).rejects.toMatchObject({ code: expect.stringMatching(/WORKTREE|REPOSITORY/) });
      const after = await new (await import("../src/gitboard/worktreeLeaseStore.js")).WorktreeLeaseStore(join(f.root, "leases")).read("lease-1");
      expect(after.leaseVersion).toBe(created.lease.leaseVersion);
    }
  });

  test("quarantines a partial target/registry ambiguity without creating", async () => {
    const f = await fixture();
    const target = join(f.managedRoot, "fixture-repo", principal.taskId, "lease-1");
    await mkdir(target, { recursive: true });
    const svc = await service(f, () => "lease-1");
    await expect(svc.prepare(request(f))).rejects.toMatchObject({ code: "AMBIGUOUS_CREATE_RESULT" });
  });

  test("keeps the Git command boundary fixed and excludes cleanup operations", async () => {
    const source = await readFile(new URL("../src/gitboard/phaseCWorktreeService.ts", import.meta.url), "utf8");
    expect(source).toContain('["worktree", "add", "--detach", target, oid]');
    expect(source).toContain("shell: false"); expect(source).not.toMatch(/worktree", "(?:remove|prune)/);
  });
});

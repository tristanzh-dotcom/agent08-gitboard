import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  PhaseBError,
  assertSafeRecordId,
  digestCanonicalJson,
  type AuthenticatedPrincipalContext,
  type PrincipalAuthenticator,
  type RepositoryIdentity,
  type TaskPrincipal,
} from "./machineOperationContracts.js";
import type { MachineOperationAuthorizationService } from "./machineOperationAuthorizationService.js";
import type { MachineOperationAuditStore, MachineAuditRecord } from "./machineOperationAuditStore.js";
import type { RepoManifest, RepoManifestEntry } from "./types.js";
import { WorktreeLeaseStore, type WorktreeLease } from "./worktreeLeaseStore.js";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 8_192;
const OP_PREPARE = "prepare_isolated_worktree" as const;
const OP_INSPECT = "inspect_worktree_lease" as const;
const OP_RENEW = "renew_worktree_lease" as const;

export interface PhaseCRequestBase {
  schemaVersion: 1;
  operationId: string;
  idempotencyKey: string;
  credential: string;
  claims: TaskPrincipal;
  repoId: string;
  taskId: string;
}

export interface PrepareIsolatedWorktreeRequest extends PhaseCRequestBase {
  base: { kind: "repo_head" } | { kind: "commit_oid"; oid: string };
  branchMode: "detached" | "managed_branch";
  requestedLeaseSeconds: number;
}
export interface InspectWorktreeLeaseRequest extends PhaseCRequestBase { leaseId: string }
export interface RenewWorktreeLeaseRequest extends PhaseCRequestBase {
  leaseId: string;
  expectedLeaseVersion: number;
  requestedLeaseSeconds: number;
}

export interface WorktreeLeaseInspection {
  lease: WorktreeLease;
  ownershipVerified: boolean;
  registered: boolean;
  canonicalPath: string;
  commonGitDirIdentityDigest: string;
  headOid: string | null;
  branchMode: "detached" | "managed_branch";
  clean: boolean;
  stagedCount: number;
  trackedChangeCount: number;
  untrackedCount: number;
  ignoredOutputCount: number;
  inProgressStates: string[];
  removable: false;
}

export type RegistrationReconciliation =
  | { status: "absent" }
  | { status: "matched"; inspection: RegistrationInspection }
  | { status: "ambiguous"; reason: string };

interface RegistrationInspection {
  canonicalPath: string;
  headOid: string;
  commonGitDirIdentityDigest: string;
}

export interface PhaseCServiceOptions {
  manifest: RepoManifest;
  managedRoot: string;
  stateRoot: string;
  authenticator: PrincipalAuthenticator;
  authorization: MachineOperationAuthorizationService;
  auditStore: Pick<MachineOperationAuditStore, "append">;
  now?: () => Date;
  idGenerator?: () => string;
  worktreeAdd?: (repo: string, target: string, oid: string) => Promise<void>;
}

export interface PhaseCWorktreeService {
  prepare(request: PrepareIsolatedWorktreeRequest): Promise<{ lease: WorktreeLease; postflightDigest: string }>;
  inspect(request: InspectWorktreeLeaseRequest): Promise<WorktreeLeaseInspection>;
  renew(request: RenewWorktreeLeaseRequest): Promise<{ lease: WorktreeLease; oldExpiresAt: string; newExpiresAt: string }>;
}

export function createPhaseCWorktreeService(options: Partial<PhaseCServiceOptions> = {}): PhaseCWorktreeService {
  requireConfiguration(options);
  const { manifest, managedRoot, stateRoot, authorization, auditStore } = options as PhaseCServiceOptions;
  const now = options.now ?? (() => new Date());
  const ids = options.idGenerator ?? (() => randomUUID());
  const worktreeAdd = options.worktreeAdd ?? runFixedWorktreeAdd;
  const leases = new WorktreeLeaseStore(stateRoot, { now, idGenerator: ids });

  return {
    prepare: async (request) => {
      assertRequestShape(request, ["schemaVersion", "operationId", "idempotencyKey", "credential", "claims", "repoId", "taskId", "base", "branchMode", "requestedLeaseSeconds"]);
      const authenticated = await authorization.authenticate({
        credential: request.credential,
        claims: request.claims,
        expectedTaskId: request.taskId,
        expectedSessionId: request.claims.sessionId,
      });
      if (request.branchMode !== "detached") throw new PhaseBError("BRANCH_MODE_UNSUPPORTED");
      const target = findTarget(manifest, request.repoId);
      const identity = await resolveIdentity(target);
      const canonicalRoot = await validateManagedRoot(managedRoot, manifest);
      const baseCommitOid = request.base.kind === "repo_head"
        ? await verifyCommit(identity.canonicalRepositoryPath, "HEAD^{commit}")
        : await verifyCommit(identity.canonicalRepositoryPath, `${validateOid(request.base.oid)}^{commit}`);
      const parameterDigest = digestCanonicalJson({
        operation: OP_PREPARE, repoId: request.repoId, taskId: request.taskId,
        principal: principalIdentity(authenticated), baseCommitOid, branchMode: request.branchMode,
        requestedLeaseSeconds: request.requestedLeaseSeconds,
      });
      const authorizationResult = await authorization.authorize({
        credential: request.credential, claims: request.claims,
        expectedTaskId: request.taskId, expectedSessionId: authenticated.principal.sessionId,
        operationId: request.operationId, operation: OP_PREPARE,
        expectedAuthorizationMode: "machine_policy", repoId: request.repoId,
        repositoryIdentityDigest: identityDigest(identity), taskId: request.taskId, leaseId: null,
        parameterDigest, relevantState: { identity, baseCommitOid },
      });
      if (!authorizationResult.rawCapability || authorizationResult.policyDecision.decision !== "allow") {
        throw new PhaseBError("POLICY_DENIED");
      }
      await authorization.consume({
        credential: request.credential, claims: request.claims,
        expectedTaskId: request.taskId, expectedSessionId: authenticated.principal.sessionId,
        policyDecisionId: authorizationResult.policyDecision.policyDecisionId,
        operationId: request.operationId, repoId: request.repoId, taskId: request.taskId,
        rawCapability: authorizationResult.rawCapability,
      });
      const identityAfterAuth = await resolveIdentity(target);
      assertSameIdentity(identity, identityAfterAuth);
      const primaryBefore = await primaryDigest(identityAfterAuth.canonicalRepositoryPath);
      const leaseId = ids();
      assertSafeRecordId(leaseId);
      const derivedTargetPath = deriveTarget(canonicalRoot, request.repoId, request.taskId, leaseId);
      const requestDigest = digestCanonicalJson({
        operation: OP_PREPARE, repoId: request.repoId, taskId: request.taskId,
        principal: principalIdentity(authenticated), baseCommitOid, branchMode: request.branchMode,
        requestedLeaseSeconds: request.requestedLeaseSeconds,
      });
      const requestedAuditId = await appendAudit(auditStore, request.operationId, OP_PREPARE, "requested", identityAfterAuth, reservedLeaseFields(request, authenticated, null));
      const reserved = await leases.reserve({
        leaseId, operationName: OP_PREPARE, idempotencyKey: request.idempotencyKey, requestDigest,
        repoId: request.repoId, repositoryIdentity: identityAfterAuth,
        principalId: authenticated.principal.principalId, taskId: request.taskId,
        sessionId: authenticated.principal.sessionId, canonicalWorktreePath: derivedTargetPath,
        creationOperationId: request.operationId, baseCommitOid, branchMode: "detached",
        branchName: null, requestedLeaseSeconds: request.requestedLeaseSeconds,
        lastAuditId: requestedAuditId,
      });
      const targetPath = reserved.canonicalWorktreePath;
      const reconciliation = await reconcile(targetPath, identityAfterAuth, baseCommitOid);
      if (reconciliation.status === "ambiguous") {
        const resultAuditId = await appendAudit(auditStore, request.operationId, OP_PREPARE, "result_recorded", identityAfterAuth, { resultCode: "AMBIGUOUS_CREATE_RESULT" });
        await leases.quarantine(reserved.leaseId, reserved.leaseVersion, resultAuditId);
        throw new PhaseBError("AMBIGUOUS_CREATE_RESULT");
      }
      if (reconciliation.status === "matched") {
        const postflightDigest = digestCanonicalJson(reconciliation.inspection);
        const postflightId = await appendAudit(auditStore, request.operationId, OP_PREPARE, "postflight_recorded", identityAfterAuth, { postflightDigest });
        const active = reserved.lifecycle === "active"
          ? reserved
          : await leases.transition(reserved.leaseId, reserved.leaseVersion, "active", postflightId);
        try {
          await appendAudit(auditStore, request.operationId, OP_PREPARE, "result_recorded", identityAfterAuth, { resultCode: "active", postflightDigest });
        } catch (error) {
          await leases.quarantine(active.leaseId, active.leaseVersion, postflightId);
          throw error;
        }
        return { lease: active, postflightDigest };
      }
      await mkdir(join(targetPath, ".."), { recursive: true, mode: 0o700 });
      let creating = await leases.transition(reserved.leaseId, reserved.leaseVersion, "creating", reserved.lastAuditId);
      let commandStartedAuditId: string;
      try {
        commandStartedAuditId = await appendAudit(auditStore, request.operationId, OP_PREPARE, "command_started", identityAfterAuth, reservedLeaseFields(request, authenticated, creating.leaseId));
        creating = await leases.recordAudit(creating.leaseId, creating.leaseVersion, commandStartedAuditId);
      } catch (error) {
        await leases.quarantine(creating.leaseId, creating.leaseVersion, creating.lastAuditId);
        throw error;
      }
      let commandError: unknown = null;
      try { await worktreeAdd(identityAfterAuth.canonicalRepositoryPath, targetPath, baseCommitOid); } catch (error) { commandError = error; }
      let afterCommand: RegistrationReconciliation;
      try {
        afterCommand = await reconcile(targetPath, identityAfterAuth, baseCommitOid);
      } catch (error) {
        await leases.quarantine(creating.leaseId, creating.leaseVersion, creating.lastAuditId);
        throw error;
      }
      try {
        await appendAudit(
          auditStore,
          request.operationId,
          OP_PREPARE,
          "command_finished",
          identityAfterAuth,
          { resultCode: commandError ? "failed" : "succeeded" },
        );
      } catch (error) {
        await leases.quarantine(creating.leaseId, creating.leaseVersion, creating.lastAuditId);
        throw error;
      }
      if (commandError) {
        if (afterCommand.status === "matched") {
          const postflightDigest = digestCanonicalJson(afterCommand.inspection);
          let postflightId: string;
          try {
            postflightId = await appendAudit(auditStore, request.operationId, OP_PREPARE, "postflight_recorded", identityAfterAuth, { postflightDigest });
          } catch (error) {
            await leases.quarantine(creating.leaseId, creating.leaseVersion, creating.lastAuditId);
            throw error;
          }
          let active: WorktreeLease;
          try {
            active = await leases.transition(creating.leaseId, creating.leaseVersion, "active", postflightId);
          } catch (error) {
            await leases.quarantine(creating.leaseId, creating.leaseVersion, creating.lastAuditId);
            throw error;
          }
          try {
            await appendAudit(auditStore, request.operationId, OP_PREPARE, "result_recorded", identityAfterAuth, { resultCode: "reconciled", postflightDigest, leaseVersion: active.leaseVersion });
          } catch (error) {
            await leases.quarantine(active.leaseId, active.leaseVersion, postflightId);
            throw error;
          }
          return { lease: active, postflightDigest };
        }
        try {
          if (afterCommand.status === "absent") {
            const resultAuditId = await appendAudit(auditStore, request.operationId, OP_PREPARE, "result_recorded", identityAfterAuth, { resultCode: "failed" });
            const failed = await leases.transition(creating.leaseId, creating.leaseVersion, "failed", resultAuditId);
            throw new PhaseBError("GIT_WORKTREE_ADD_FAILED", failed.lifecycle);
          }
          const resultAuditId = await appendAudit(auditStore, request.operationId, OP_PREPARE, "result_recorded", identityAfterAuth, { resultCode: "ambiguous" });
          await leases.quarantine(creating.leaseId, creating.leaseVersion, resultAuditId);
          throw new PhaseBError("AMBIGUOUS_CREATE_RESULT");
        } catch (error) {
          if (error instanceof PhaseBError && ["GIT_WORKTREE_ADD_FAILED", "AMBIGUOUS_CREATE_RESULT"].includes(error.code)) throw error;
          await leases.quarantine(creating.leaseId, creating.leaseVersion, creating.lastAuditId);
          throw error;
        }
      }
      if (afterCommand.status !== "matched") {
        try {
          const resultAuditId = await appendAudit(auditStore, request.operationId, OP_PREPARE, "result_recorded", identityAfterAuth, { resultCode: "POSTCONDITION_FAILED" });
          await leases.quarantine(creating.leaseId, creating.leaseVersion, resultAuditId);
        } catch (error) {
          await leases.quarantine(creating.leaseId, creating.leaseVersion, creating.lastAuditId);
          throw error;
        }
        throw new PhaseBError("POSTCONDITION_FAILED", afterCommand.status === "ambiguous" ? afterCommand.reason : "absent");
      }
      let primaryAfter: string;
      try {
        primaryAfter = await primaryDigest(identityAfterAuth.canonicalRepositoryPath);
      } catch (error) {
        await leases.quarantine(creating.leaseId, creating.leaseVersion, creating.lastAuditId);
        throw error;
      }
      if (primaryBefore !== primaryAfter) {
        try {
          const resultAuditId = await appendAudit(auditStore, request.operationId, OP_PREPARE, "result_recorded", identityAfterAuth, { resultCode: "POSTCONDITION_FAILED" });
          await leases.quarantine(creating.leaseId, creating.leaseVersion, resultAuditId);
        } catch (error) {
          await leases.quarantine(creating.leaseId, creating.leaseVersion, creating.lastAuditId);
          throw error;
        }
        throw new PhaseBError("POSTCONDITION_FAILED");
      }
      const postflightDigest = digestCanonicalJson(afterCommand.inspection);
      let postflightId: string;
      try {
        postflightId = await appendAudit(auditStore, request.operationId, OP_PREPARE, "postflight_recorded", identityAfterAuth, { postflightDigest });
      } catch (error) {
        await leases.quarantine(creating.leaseId, creating.leaseVersion, creating.lastAuditId);
        throw error;
      }
      let active: WorktreeLease;
      try {
        active = await leases.transition(creating.leaseId, creating.leaseVersion, "active", postflightId);
      } catch (error) {
        await leases.quarantine(creating.leaseId, creating.leaseVersion, creating.lastAuditId);
        throw error;
      }
      try {
        await appendAudit(auditStore, request.operationId, OP_PREPARE, "result_recorded", identityAfterAuth, { resultCode: "active", postflightDigest });
      } catch (error) {
        await leases.quarantine(active.leaseId, active.leaseVersion, postflightId);
        throw error;
      }
      return { lease: active, postflightDigest };
    },
    inspect: async (request) => {
      assertRequestShape(request, ["schemaVersion", "operationId", "idempotencyKey", "credential", "claims", "repoId", "taskId", "leaseId"]);
      const authenticated = await authorization.authenticate({ credential: request.credential, claims: request.claims, expectedTaskId: request.taskId, expectedSessionId: request.claims.sessionId });
      const lease = await leases.read(request.leaseId);
      assertLeaseOwnership(lease, request, authenticated);
      const target = findTarget(manifest, request.repoId);
      const identity = await resolveIdentity(target);
      assertSameIdentity(lease.repositoryIdentity, identity);
      const result = await inspectWorktree(lease, identity);
      await appendAudit(auditStore, request.operationId, OP_INSPECT, "result_recorded", identity, { resultCode: "inspected" });
      return result;
    },
    renew: async (request) => {
      assertRequestShape(request, ["schemaVersion", "operationId", "idempotencyKey", "credential", "claims", "repoId", "taskId", "leaseId", "expectedLeaseVersion", "requestedLeaseSeconds"]);
      const authenticated = await authorization.authenticate({ credential: request.credential, claims: request.claims, expectedTaskId: request.taskId, expectedSessionId: request.claims.sessionId });
      const lease = await leases.read(request.leaseId);
      const target = findTarget(manifest, request.repoId);
      const identity = await resolveIdentityFilesystem(target);
      assertLeaseOwnership(lease, request, authenticated);
      assertSameIdentity(lease.repositoryIdentity, identity);
      await verifyWorktreeFilesystem(lease, identity);
      const parameterDigest = digestCanonicalJson({ operation: OP_RENEW, repoId: request.repoId, taskId: request.taskId, principal: principalIdentity(authenticated), leaseId: request.leaseId, expectedLeaseVersion: request.expectedLeaseVersion, requestedLeaseSeconds: request.requestedLeaseSeconds });
      const authz = await authorization.authorize({ credential: request.credential, claims: request.claims, expectedTaskId: request.taskId, expectedSessionId: authenticated.principal.sessionId, operationId: request.operationId, operation: OP_RENEW, expectedAuthorizationMode: "machine_policy", repoId: request.repoId, repositoryIdentityDigest: identityDigest(identity), taskId: request.taskId, leaseId: request.leaseId, parameterDigest, relevantState: { identity, leaseVersion: lease.leaseVersion } });
      if (!authz.rawCapability || authz.policyDecision.decision !== "allow") throw new PhaseBError("POLICY_DENIED");
      await authorization.consume({ credential: request.credential, claims: request.claims, expectedTaskId: request.taskId, expectedSessionId: authenticated.principal.sessionId, policyDecisionId: authz.policyDecision.policyDecisionId, operationId: request.operationId, repoId: request.repoId, taskId: request.taskId, rawCapability: authz.rawCapability });
      const before = lease.expiresAt;
      const renewed = await leases.renew(request.leaseId, request.expectedLeaseVersion, request.requestedLeaseSeconds, lease.lastAuditId);
      let resultAuditId: string | undefined;
      try {
        resultAuditId = await appendAudit(auditStore, request.operationId, OP_RENEW, "result_recorded", identity, { resultCode: "renewed" });
        const audited = await leases.recordAudit(renewed.leaseId, renewed.leaseVersion, resultAuditId);
        return { lease: audited, oldExpiresAt: before, newExpiresAt: audited.expiresAt };
      } catch (error) {
        await leases.quarantine(renewed.leaseId, renewed.leaseVersion, resultAuditId ?? renewed.lastAuditId);
        throw error;
      }
    },
  };
}

function requireConfiguration(options: Partial<PhaseCServiceOptions>): void {
  for (const key of ["manifest", "managedRoot", "stateRoot", "authenticator", "authorization", "auditStore"] as const) {
    if (!options[key]) throw new PhaseBError("PHASE_C_CONFIGURATION_REQUIRED");
  }
}
function findTarget(manifest: RepoManifest, repoId: string): RepoManifestEntry {
  const target = manifest.targets.find((item) => item.id === repoId);
  if (!target) throw new PhaseBError("REPO_NOT_ALLOWED");
  return target;
}
function principalIdentity(context: AuthenticatedPrincipalContext): object {
  return { kind: context.principal.kind, principalId: context.principal.principalId, taskId: context.principal.taskId, sessionId: context.principal.sessionId, credentialId: context.principal.credentialId };
}
function reservedLeaseFields(request: PhaseCRequestBase, authenticated: AuthenticatedPrincipalContext, leaseId: string | null): Record<string, unknown> {
  return { principalId: authenticated.principal.principalId, taskId: request.taskId, leaseId };
}
function assertRequestShape(request: object, allowed: string[]): void {
  const forbidden = new Set(["command", "args", "argv", "subcommand", "cwd", "environment", "gitDir", "gitWorkTree", "config", "remote", "force", "targetPath", "rawRef"]);
  for (const key of Object.keys(request)) if (forbidden.has(key) || !allowed.includes(key)) throw new PhaseBError("UNSUPPORTED_REQUEST_FIELD");
}
async function resolveIdentity(target: RepoManifestEntry): Promise<RepositoryIdentity> {
  const configured = resolve(target.path);
  try { if ((await lstat(configured)).isSymbolicLink()) throw new PhaseBError("SYMLINK_ESCAPE"); } catch (e) { if (e instanceof PhaseBError) throw e; }
  const repository = await realpath(target.path).catch(() => { throw new PhaseBError("REPOSITORY_NOT_FOUND"); });
  const { stdout } = await runGit(repository, ["rev-parse", "--show-toplevel", "--git-common-dir", "HEAD"]);
  const lines = stdout.trim().split(/\r?\n/);
  if (lines.length < 2) throw new PhaseBError("REPOSITORY_IDENTITY_AMBIGUOUS");
  const top = await realpath(isAbsolute(lines[0]) ? lines[0] : resolve(repository, lines[0]));
  const common = await realpath(isAbsolute(lines[1]) ? lines[1] : resolve(repository, lines[1]));
  if (top !== repository) throw new PhaseBError("PARENT_REPOSITORY_MISMATCH");
  const s = await stat(common);
  return { repoId: target.id, canonicalRepositoryPath: repository, canonicalTopLevelPath: top, canonicalCommonGitDir: common, commonGitDirDevice: s.dev, commonGitDirInode: s.ino };
}
async function resolveIdentityFilesystem(target: RepoManifestEntry): Promise<RepositoryIdentity> {
  const repository = await realpath(target.path).catch(() => { throw new PhaseBError("REPOSITORY_NOT_FOUND"); });
  const top = repository;
  const common = await realpath(join(repository, ".git")).catch(() => { throw new PhaseBError("REPOSITORY_IDENTITY_MISMATCH"); });
  const commonStat = await stat(common);
  return { repoId: target.id, canonicalRepositoryPath: repository, canonicalTopLevelPath: top, canonicalCommonGitDir: common, commonGitDirDevice: commonStat.dev, commonGitDirInode: commonStat.ino };
}
function assertSameIdentity(a: RepositoryIdentity, b: RepositoryIdentity): void {
  if (a.repoId !== b.repoId || a.canonicalRepositoryPath !== b.canonicalRepositoryPath || a.canonicalTopLevelPath !== b.canonicalTopLevelPath || a.canonicalCommonGitDir !== b.canonicalCommonGitDir || a.commonGitDirDevice !== b.commonGitDirDevice || a.commonGitDirInode !== b.commonGitDirInode) throw new PhaseBError("REPOSITORY_IDENTITY_MISMATCH");
}
function isSameOrInside(parent: string, candidate: string): boolean {
  const r = relative(parent, candidate);
  return r === "" || (!r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r));
}
async function canonicalWithoutCreate(path: string): Promise<{ canonical: string; existing: string }> {
  const absolute = resolve(path);
  let cursor = absolute;
  const missing: string[] = [];
  while (true) {
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) throw new PhaseBError("SYMLINK_ESCAPE");
      const canonical = await realpath(cursor);
      return { canonical: join(canonical, ...missing.reverse()), existing: cursor };
    } catch (error) {
      if (error instanceof PhaseBError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new PhaseBError("MANAGED_ROOT_INVALID");
      const parent = resolve(cursor, "..");
      if (parent === cursor) throw new PhaseBError("MANAGED_ROOT_INVALID");
      missing.push(cursor.slice(parent.length + 1));
      cursor = parent;
    }
  }
}
async function validateManagedRoot(root: string, manifest: RepoManifest): Promise<string> {
  if (!isAbsolute(root)) throw new PhaseBError("MANAGED_ROOT_INVALID");
  const rootInfo = await canonicalWithoutCreate(root);
  for (const repo of manifest.targets) {
    const repoPath = await realpath(repo.path).catch(() => { throw new PhaseBError("REPOSITORY_NOT_FOUND"); });
    if (isSameOrInside(rootInfo.canonical, repoPath) || isSameOrInside(repoPath, rootInfo.canonical)) throw new PhaseBError("MANAGED_ROOT_CONTAINMENT");
  }
  return rootInfo.canonical;
}
function deriveTarget(root: string, repoId: string, taskId: string, leaseId: string): string {
  assertSafeRecordId(repoId); assertSafeRecordId(taskId); assertSafeRecordId(leaseId);
  const target = resolve(root, repoId, taskId, leaseId);
  if (!isSameOrInside(root, target) || target === root) throw new PhaseBError("TARGET_PATH_INVALID");
  return target;
}
function validateOid(oid: string): string {
  if (!/^[0-9a-f]{40}$/i.test(oid)) throw new PhaseBError("BASE_REVISION_INVALID");
  return oid.toLowerCase();
}
async function verifyCommit(repo: string, expression: string): Promise<string> {
  try {
    const output = (await runGit(repo, ["rev-parse", "--verify", expression])).stdout.trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(output)) throw new Error();
    return output;
  } catch { throw new PhaseBError("BASE_REVISION_INVALID"); }
}
async function runFixedWorktreeAdd(repo: string, target: string, oid: string): Promise<void> {
  try { await execFileAsync("git", ["worktree", "add", "--detach", target, oid], { cwd: repo, shell: false, timeout: 15_000, maxBuffer: MAX_OUTPUT, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/tmp" } }); }
  catch (e) { throw new PhaseBError("GIT_WORKTREE_ADD_FAILED", e instanceof Error ? e.message.slice(0, 512) : "git worktree add failed"); }
}
async function runGit(repo: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { cwd: repo, shell: false, timeout: 10_000, maxBuffer: MAX_OUTPUT, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/tmp" } });
}
async function reconcile(target: string, identity: RepositoryIdentity, oid: string): Promise<RegistrationReconciliation> {
  let targetExists = false;
  try { await lstat(target); targetExists = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") return { status: "ambiguous", reason: "target-stat-failed" }; }
  let registry: string;
  try { registry = (await runGit(identity.canonicalRepositoryPath, ["worktree", "list", "--porcelain"])).stdout; } catch { return { status: "ambiguous", reason: "registry-check-failed" }; }
  const exact = targetExists ? await realpath(target).catch(() => null) : null;
  const registered = registry.split(/\r?\n/).some((line) => line === `worktree ${exact ?? target}`);
  if (!targetExists && !registered) return { status: "absent" };
  if (!targetExists || !registered || !exact) return { status: "ambiguous", reason: "partial-registration" };
  try {
    const headOid = (await runGit(exact, ["rev-parse", "--verify", "HEAD"])).stdout.trim().toLowerCase();
    if (headOid !== oid) return { status: "ambiguous", reason: "head-mismatch" };
    let branch = ""; try { branch = (await runGit(exact, ["symbolic-ref", "-q", "HEAD"])).stdout.trim(); } catch {}
    if (branch) return { status: "ambiguous", reason: "attached-branch" };
    const targetIdentity = await resolveWorktreeIdentity(exact, identity);
    assertSameIdentity(identity, targetIdentity);
    return { status: "matched", inspection: { canonicalPath: exact, headOid, commonGitDirIdentityDigest: identityDigest(targetIdentity) } };
  } catch { return { status: "ambiguous", reason: "inspection-failed" }; }
}
async function resolveWorktreeIdentity(worktreePath: string, expected: RepositoryIdentity): Promise<RepositoryIdentity> {
  const { stdout } = await runGit(worktreePath, ["rev-parse", "--show-toplevel", "--git-common-dir", "HEAD"]);
  const lines = stdout.trim().split(/\r?\n/);
  if (lines.length < 2) throw new PhaseBError("REPOSITORY_IDENTITY_MISMATCH");
  const top = await realpath(isAbsolute(lines[0]) ? lines[0] : resolve(worktreePath, lines[0]));
  const common = await realpath(isAbsolute(lines[1]) ? lines[1] : resolve(worktreePath, lines[1]));
  const commonStat = await stat(common);
  if (top !== worktreePath || common !== expected.canonicalCommonGitDir || commonStat.dev !== expected.commonGitDirDevice || commonStat.ino !== expected.commonGitDirInode) throw new PhaseBError("REPOSITORY_IDENTITY_MISMATCH");
  return { ...expected };
}
async function inspectWorktree(lease: WorktreeLease, identity: RepositoryIdentity): Promise<WorktreeLeaseInspection> {
  const reconciliation = await reconcile(lease.canonicalWorktreePath, identity, lease.baseCommitOid);
  if (reconciliation.status !== "matched") throw new PhaseBError("WORKTREE_NOT_REGISTERED");
  const status = await runGit(lease.canonicalWorktreePath, ["status", "--porcelain=v2", "--ignored", "-z"]);
  const entries = status.stdout.split("\0").filter(Boolean);
  let staged = 0, tracked = 0, untracked = 0, ignored = 0;
  for (const entry of entries) {
    if (entry.startsWith("!")) ignored++;
    else if (entry.startsWith("?")) untracked++;
    else if (entry.startsWith("1 ") || entry.startsWith("2 ")) { tracked++; if (entry[2] !== "." && entry[2] !== " ") staged++; }
  }
  const inProgressStates: string[] = [];
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]) { try { await stat(join(identity.canonicalCommonGitDir, marker)); inProgressStates.push(marker); } catch {} }
  return { lease, ownershipVerified: true, registered: true, canonicalPath: reconciliation.inspection.canonicalPath, commonGitDirIdentityDigest: reconciliation.inspection.commonGitDirIdentityDigest, headOid: reconciliation.inspection.headOid, branchMode: lease.branchMode, clean: tracked === 0 && untracked === 0, stagedCount: staged, trackedChangeCount: tracked, untrackedCount: untracked, ignoredOutputCount: ignored, inProgressStates, removable: false };
}
async function verifyWorktreeFilesystem(lease: WorktreeLease, identity: RepositoryIdentity): Promise<void> {
  const worktreeInfo = await lstat(lease.canonicalWorktreePath).catch(() => {
    throw new PhaseBError("WORKTREE_NOT_REGISTERED");
  });
  if (!worktreeInfo.isDirectory()) throw new PhaseBError("WORKTREE_NOT_REGISTERED");
  const canonicalWorktree = await realpath(lease.canonicalWorktreePath).catch(() => {
    throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");
  });
  if (canonicalWorktree !== lease.canonicalWorktreePath) {
    throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");
  }

  const gitFilePath = join(lease.canonicalWorktreePath, ".git");
  const gitFileInfo = await lstat(gitFilePath).catch(() => {
    throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");
  });
  if (!gitFileInfo.isFile()) throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");
  const gitFile = await readFile(gitFilePath, "utf8").catch(() => {
    throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");
  });
  const gitdirReference = parseMetadataLine(gitFile, "gitdir");
  const administrativeDirectory = await realpath(resolve(lease.canonicalWorktreePath, gitdirReference)).catch(() => {
    throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");
  });
  const administrativeInfo = await lstat(administrativeDirectory).catch(() => {
    throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");
  });
  if (!administrativeInfo.isDirectory()) throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");

  const common = await realpath(identity.canonicalCommonGitDir).catch(() => {
    throw new PhaseBError("REPOSITORY_IDENTITY_MISMATCH");
  });
  if (common !== identity.canonicalCommonGitDir) throw new PhaseBError("REPOSITORY_IDENTITY_MISMATCH");
  const administrativeScope = join(identity.canonicalCommonGitDir, "worktrees");
  if (!isSameOrInside(administrativeScope, administrativeDirectory)) {
    throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");
  }

  const commondirPath = join(administrativeDirectory, "commondir");
  const commondirInfo = await lstat(commondirPath).catch(() => {
    throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");
  });
  const gitdirPath = join(administrativeDirectory, "gitdir");
  const gitdirInfo = await lstat(gitdirPath).catch(() => {
    throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");
  });
  const headPath = join(administrativeDirectory, "HEAD");
  const headInfo = await lstat(headPath).catch(() => {
    throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");
  });
  if (!commondirInfo.isFile() || !gitdirInfo.isFile() || !headInfo.isFile()) {
    throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");
  }

  const commonReference = parseSingleMetadataPath(await readFile(commondirPath, "utf8"));
  const resolvedCommon = await realpath(resolve(administrativeDirectory, commonReference)).catch(() => {
    throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");
  });
  if (resolvedCommon !== identity.canonicalCommonGitDir) {
    throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");
  }

  const backReference = parseSingleMetadataPath(await readFile(gitdirPath, "utf8"));
  const resolvedBackReference = await realpath(resolve(administrativeDirectory, backReference)).catch(() => {
    throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");
  });
  const canonicalGitFile = await realpath(gitFilePath).catch(() => {
    throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");
  });
  if (resolvedBackReference !== canonicalGitFile) {
    throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");
  }

  const head = (await readFile(headPath, "utf8")).trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(head) || head !== lease.baseCommitOid.toLowerCase()) {
    throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");
  }
}

function parseMetadataLine(value: string, key: string): string {
  const trimmed = value.trim();
  const match = new RegExp(`^${key}:\\s*(.+)$`).exec(trimmed);
  if (!match || !match[1]?.trim()) throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");
  return match[1].trim();
}

function parseSingleMetadataPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\n") || trimmed.includes("\r")) {
    throw new PhaseBError("WORKTREE_IDENTITY_MISMATCH");
  }
  return trimmed;
}
function identityDigest(identity: RepositoryIdentity): string { return digestCanonicalJson(identity); }
function assertLeaseOwnership(lease: WorktreeLease, request: PhaseCRequestBase & { leaseId: string }, authenticated: AuthenticatedPrincipalContext): void {
  if (lease.repoId !== request.repoId || lease.taskId !== request.taskId || lease.principalId !== authenticated.principal.principalId || lease.sessionId !== authenticated.principal.sessionId) throw new PhaseBError("LEASE_OWNERSHIP_MISMATCH");
}
async function primaryDigest(repo: string): Promise<string> {
  const status = await runGit(repo, ["status", "--porcelain=v2", "--branch", "-z"]);
  const head = await runGit(repo, ["rev-parse", "--verify", "HEAD"]);
  return digestCanonicalJson({ status: status.stdout, head: head.stdout });
}
async function appendAudit(store: Pick<MachineOperationAuditStore, "append">, operationId: string, operation: typeof OP_PREPARE | typeof OP_INSPECT | typeof OP_RENEW, phase: "requested" | "command_started" | "command_finished" | "postflight_recorded" | "result_recorded", identity: RepositoryIdentity, fields: Record<string, unknown>): Promise<string> {
  try {
    const record = await store.append({ auditId: randomUUID(), operationId, phase, operation, repoId: identity.repoId, repositoryIdentityDigest: identityDigest(identity), ...fields } as Parameters<MachineOperationAuditStore["append"]>[0]);
    return (record as MachineAuditRecord).auditId;
  } catch (error) {
    throw new PhaseBError("AUDIT_WRITE_FAILED", error instanceof Error ? error.message : String(error));
  }
}

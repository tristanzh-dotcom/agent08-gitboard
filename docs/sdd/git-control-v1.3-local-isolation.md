# Agent08 Git Control v1.3 Local Isolation SDD

Status: Superseded by v1.4; Historical Phase A Contract Only
Date: 2026-07-30
Owner: Agent08 / agent08-gitboard
Approved scope: governance and contract design only
Superseded by: `docs/sdd/git-control-v1.4-finalization.md`
Related drafts:

- `docs/sdd/git-control-v1.1.md`
- `docs/sdd/git-control-v1.2-upstream.md`
- `docs/sdd/git-control-v1.2.1-commit-safety.md`

## 1. Decision and authority boundary

This SDD defines the approved Phase A contract for risk-classified Git
operations and machine-authorized local isolation.

Approval of this document authorizes:

- governance and contract documentation;
- typed interface and state-machine design;
- security, audit, test, rollout, and rollback requirements.

It does not authorize:

- executable Agent08 changes;
- real worktree creation, removal, or prune;
- service, Web, or Codex runtime integration;
- dependency installation;
- branch creation, checkout, commit, merge, push, or any other Git mutation.

Phase B and every later phase require separate TZ authorization after this
written contract is reviewed.

## 2. Problem statement

The current governance routes every automated Git mutation through Agent08, but
the current Agent08 execution model treats a one-time confirmation token as the
common gate for every mutation. It has no authenticated machine principal,
policy decision, execution capability, task ownership, or worktree lease.

This prevents a Codex task from using a narrowly controlled local-isolation
worktree without asking TZ to confirm every reversible isolation operation. It
also risks confusing:

- user intent confirmation;
- execution authorization;
- anti-replay capability;
- path possession;
- task ownership.

v1.3 separates those concepts and adds only the smallest contract needed for
safe local isolation.

## 3. Risk tiers

### Tier 0 — Read only

Authorization mode:

```text
read_only
```

Examples:

- status;
- diff;
- log;
- show;
- rev-parse;
- branch inspection;
- worktree inspection.

Tier 0 may run directly when applicable governance permits it.

### Tier 1 — Machine-authorized local isolation

Authorization mode:

```text
machine_policy
```

Approved operation names:

```text
prepare_isolated_worktree
inspect_worktree_lease
renew_worktree_lease
remove_owned_worktree
prune_owned_worktree_metadata
```

`prune_owned_worktree_metadata` is contract-defined but remains execution
disabled until exact owned scope can be proven.

Tier 1 never grants general Git authority.

Tier 1 is contract-approved but runtime-disabled. No Tier 1 operation is
available until its applicable implementation phase, executable verification,
and explicit TZ activation approval are complete.

### Tier 2 — Controlled durable local mutation

Authorization mode:

```text
user_confirmed
```

Examples:

- stage;
- commit;
- cherry-pick;
- merge;
- rebase;
- reset;
- stash;
- promotion from an isolated worktree.

Tier 2 requires a separate UserConfirmation.

### Tier 3 — External or destructive

Authorization mode:

```text
explicit_destructive_approval
```

Examples:

- push and force push;
- remote creation or modification;
- protected-branch update;
- branch deletion;
- destructive reset;
- history rewrite;
- remote PR or other external visibility.

Tier 3 requires explicit TZ approval for the exact external or destructive
impact.

## 4. Authorization model

Authorization, execution capability, and user confirmation are separate
records.

### 4.1 PolicyDecision

```ts
interface PolicyDecision {
  policyDecisionId: string;
  policyVersion: string;
  operationId: string;
  operation: GitControlOperation;
  operationTier: 0 | 1 | 2 | 3;
  authorizationMode:
    | "read_only"
    | "machine_policy"
    | "user_confirmed"
    | "explicit_destructive_approval";
  principal: TaskPrincipal;
  repoId: string;
  repositoryIdentityDigest: string;
  taskId: string;
  leaseId: string | null;
  parameterDigest: string;
  preflightDigest: string;
  decision: "allow" | "deny";
  reasons: string[];
  createdAt: string;
  expiresAt: string;
}
```

The server-owned operation registry determines tier and authorization mode.
The caller cannot select or downgrade them.

### 4.2 ExecutionCapability

Every mutation requires:

```ts
interface ExecutionCapability {
  capabilityId: string;
  policyDecisionId: string;
  operationId: string;
  operation: GitControlOperation;
  principalId: string;
  repoId: string;
  repositoryIdentityDigest: string;
  taskId: string;
  leaseId: string | null;
  parameterDigest: string;
  preflightDigest: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}
```

The capability is:

- short-lived;
- single-use;
- operation-bound;
- principal-bound;
- repository-bound;
- task/lease-bound;
- parameter-bound;
- preflight-bound;
- consumed before command execution;
- never stored or logged in raw form.

Consumption does not skip a current-state rescan.

### 4.3 UserConfirmation

Tier 2 and Tier 3 additionally require:

```ts
interface UserConfirmation {
  userConfirmationId: string;
  operationId: string;
  policyDecisionId: string;
  confirmedBy: "TZ";
  confirmationSurface: "agent08_git_control";
  confirmedParameterDigest: string;
  confirmedImpact: string[];
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}
```

Tier 1 does not create a synthetic UserConfirmation.

### 4.4 TaskPrincipal

```ts
interface TaskPrincipal {
  kind: "codex_task";
  principalId: string;
  taskId: string;
  sessionId: string;
  credentialId: string;
}
```

Principal claims are accepted only from an authenticated local machine route.
HTTP body fields alone do not authenticate the caller.

The exact Codex runtime credential, authenticated transport, and task/session
identity binding remain activation decisions. Phase B may define interfaces,
data structures, and test doubles, but no real machine mutation route may be
enabled until both decisions are approved and accepted.

## 5. Repository identity

Repository authorization is not based only on repo ID or a normalized path.

```ts
interface RepositoryIdentity {
  repoId: string;
  canonicalRepositoryPath: string;
  canonicalTopLevelPath: string;
  canonicalCommonGitDir: string;
  commonGitDirDevice: number;
  commonGitDirInode: number;
}
```

Required checks:

- repo ID is in the Agent08 manifest and explicitly opts into Tier 1;
- configured path resolves to the expected canonical path;
- no relevant path component is a symbolic-link escape;
- Git top level matches the allowlisted repository;
- common Git directory identity is stable before and after operation;
- the repository is not inferred only because Git found a parent repository;
- any ambiguity or identity drift fails closed.

## 6. Managed worktree root

The approved managed root for the v1.3 contract is:

```text
/Users/tristanzh/.codex/agent08/worktrees
```

Phase A does not create this directory. Its physical identity, ownership,
permissions, parent-component, and symbolic-link checks remain Phase C runtime
preconditions.

Rules:

- the root is outside every managed business repository;
- the root and each existing parent component have verified canonical identity,
  ownership, and permissions;
- symbolic-link traversal is forbidden;
- clients cannot submit an arbitrary target path;
- target path is derived as:

```text
<managed-root>/<repo-id>/<task-id>/<lease-id>
```

- the derived target must not exist before creation;
- a path inside the managed root does not by itself prove ownership;
- an existing user directory is never adopted or overwritten.

## 7. Worktree ownership and lease

```ts
interface WorktreeLease {
  leaseId: string;
  repoId: string;
  repositoryIdentity: RepositoryIdentity;
  principalId: string;
  taskId: string;
  sessionId: string;
  canonicalWorktreePath: string;
  creationOperationId: string;
  baseCommitOid: string;
  branchMode: "detached" | "managed_branch";
  branchName: string | null;
  createdAt: string;
  expiresAt: string;
  leaseVersion: number;
  lifecycle:
    | "reserved"
    | "creating"
    | "active"
    | "removing"
    | "removed"
    | "failed"
    | "quarantined";
  lastAuditId: string;
}
```

Ownership requires every bound field to match. It is never inferred solely from:

- path prefix;
- directory existence;
- a `.git` file;
- task-supplied metadata;
- current process working directory.

Lease changes use atomic version checks and durable tombstones.

### Lease policy defaults

Server policy defines:

```text
default lease TTL = 24 hours
maximum cumulative active lifetime without new TZ approval = 7 days
expiry grace period before cleanup eligibility = 24 hours
```

The caller may request a shorter duration but cannot exceed the policy maximum.
Renewal is constrained by the current lease version, verified ownership, and
the maximum cumulative active lifetime measured from `createdAt`. Expiry does
not authorize force cleanup. A dirty, ambiguous, or non-owned worktree is never
automatically deleted because its lease expired, including after the expiry
grace period. These values are server policy and are never passed through as raw
Git arguments.

## 8. Common request and result envelopes

Every Tier 1 mutation uses two explicit service phases:

```text
authorize/preflight
  -> PolicyDecision
  -> ExecutionCapability
execute
  -> capability consumption
  -> current-state rescan
  -> fixed operation
  -> postflight
  -> result
```

`inspect_worktree_lease` is read-only and uses one authenticated request without
an execution capability. Lease renewal, creation, removal, and any future
metadata mutation use both phases.

```ts
interface MachineOperationRequest {
  schemaVersion: 1;
  operationId: string;
  idempotencyKey: string;
  expectedAuthorizationMode: "machine_policy";
  principal: TaskPrincipal;
  repoId: string;
  taskId: string;
}

interface MachineOperationAuthorization {
  operationId: string;
  policyDecisionId: string;
  authorizationMode: "machine_policy";
  repoId: string;
  taskId: string;
  leaseId: string | null;
  parameterDigest: string;
  preflightDigest: string;
  executionCapability: string;
  capabilityExpiresAt: string;
  auditId: string;
}

interface ExecuteMachineOperationRequest {
  schemaVersion: 1;
  operationId: string;
  idempotencyKey: string;
  policyDecisionId: string;
  executionCapability: string;
  principal: TaskPrincipal;
  repoId: string;
  taskId: string;
}

interface MachineOperationResult {
  operationId: string;
  policyDecisionId: string;
  authorizationMode: "machine_policy";
  repoId: string;
  taskId: string;
  leaseId: string | null;
  status: "prepared" | "active" | "blocked" | "removed" | "failed";
  preflightDigest: string;
  postflightDigest: string | null;
  auditId: string;
  error?: TypedGitControlError;
}
```

The authorize request supplies the operation-specific parameters. The execute
request does not repeat or override them; Agent08 loads the authorized
operation record and verifies its parameter and preflight digests before
consuming the capability. Raw capability values are returned only to the
authenticated caller and are never persisted in audit output.

Machine requests must reject these fields at schema validation:

```text
command
args
argv
subcommand
cwd
environment
gitDir
gitWorkTree
config
remote
force
targetPath
rawRef
```

## 9. `prepare_isolated_worktree`

### Request

```ts
interface PrepareIsolatedWorktreeRequest extends MachineOperationRequest {
  base:
    | { kind: "repo_head" }
    | { kind: "commit_oid"; oid: string };
  branchMode: "detached" | "managed_branch";
  branchPurposeSlug?: string;
  requestedLeaseSeconds: number;
}
```

The detached-only executable MVP, if later authorized, accepts only detached
worktrees:

```text
branchMode = detached
```

`managed_branch` remains a future schema value and must be rejected by all
Phase C MVP request validation with `BRANCH_MODE_UNSUPPORTED`; it must never be
silently converted to `detached`.

A `commit_oid` is a full validated hexadecimal object ID. `repo_head` is
resolved server-side to a full commit OID during preflight.

### Preconditions

- authenticated principal and request task ID match;
- operation registry maps this operation to Tier 1;
- repository is allowlisted and Tier 1 enabled;
- repository identity is unambiguous and stable;
- base resolves locally to a commit;
- managed root is valid;
- derived target does not exist;
- no active lease or idempotency conflict exists;
- audit reservation succeeds;
- no remote access is required.

The user main worktree does not need to be clean.

### Fixed command boundary

The proxy constructs only the approved detached-worktree template from:

- verified repository working directory;
- server-derived canonical target path;
- verified full commit OID.

It accepts no raw command, argv, environment, branch, remote, config, `-C`, or
force input.

### Postconditions

- exact canonical target is registered by Git;
- target common Git directory identity matches the repository identity;
- target HEAD equals the resolved base commit OID;
- target is detached;
- lease lifecycle is `active`;
- the user main worktree pre/post digest is unchanged;
- audit includes the postflight digest.

## 10. `inspect_worktree_lease`

### Request

```ts
interface InspectWorktreeLeaseRequest extends MachineOperationRequest {
  leaseId: string;
}
```

### Result additions

```ts
interface WorktreeLeaseInspection {
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
  removable: boolean;
}
```

Inspection is read-only but still authenticates principal and task ownership.

## 11. `renew_worktree_lease`

### Request

```ts
interface RenewWorktreeLeaseRequest extends MachineOperationRequest {
  leaseId: string;
  expectedLeaseVersion: number;
  requestedLeaseSeconds: number;
}
```

### Preconditions and postconditions

- lease is active and belongs to the same principal/task/repo;
- current path and repository identity still match;
- expected version matches;
- requested expiry is inside the policy maximum;
- no Git command runs;
- success atomically increments version and records old/new expiry.

## 12. `remove_owned_worktree`

### Request

```ts
interface RemoveOwnedWorktreeRequest extends MachineOperationRequest {
  leaseId: string;
  expectedLeaseVersion: number;
}
```

### Preconditions

- lease exists and belongs to the current principal/task;
- repository identity, common Git directory, canonical path, creation operation,
  base revision, and mode match the ownership record;
- worktree remains registered at the exact path;
- it is not a pre-existing user worktree;
- tracked changes are empty;
- staged changes are empty;
- untracked files are empty;
- ignored outputs that would be deleted are empty;
- no merge, rebase, cherry-pick, revert, bisect, sequencer, or lock is active;
- no force option is used;
- no branch deletion is an implicit side effect.

### Postconditions

- exact target path and worktree registration are absent;
- every non-target worktree identity and state digest is unchanged;
- lease lifecycle is `removed` with a durable tombstone;
- any ambiguity returns a blocked result.

Dirty owned worktrees are handed to TZ for a Tier 2 or manual decision.

## 13. `prune_owned_worktree_metadata`

### Contract status

Contract defined; execution disabled in the initial MVP.

`git worktree prune` is repository-wide and does not accept an exact lease or
path target. Agent08 must not use one stale lease as authority to prune unrelated
metadata.

Metadata prune runtime remains disabled unless a future implementation can
prove exact owned scope. Cleanup completion never authorizes expanding that
scope or using unrestricted `git worktree prune`.

Before execution can be enabled, implementation and tests must prove:

- exact mapping from lease to the stale administrative record;
- common Git directory exclusive operation lock;
- no non-owned prunable record;
- no race between dry-run, execution, and postflight;
- recoverable quarantine or equivalent rollback;
- unchanged non-target worktree registry and identity.

If exact scope cannot be proven:

```text
SCOPED_METADATA_PRUNE_UNSUPPORTED
```

## 14. `promote_isolated_branch`

`promote_isolated_branch` is a future Tier 2 typed operation.

It is outside the MVP and requires:

- separate UserConfirmation;
- protected-branch validation;
- server-controlled branch-name policy;
- no upstream, remote, commit, merge, push, or branch deletion side effect;
- separate Phase F approval and acceptance.

Tier 1 lease ownership never implies promotion authority.

Protected-branch registry authority is deferred to Phase F and must be resolved
before any `promote_isolated_branch` implementation or managed-branch
capability. It is not a prerequisite for Phase B primitives, Phase C detached
lifecycle activation, or Phase D detached cleanup.

## 15. Idempotency and crash recovery

Idempotency key scope:

```text
principal + task + repo + operation + idempotencyKey
```

Rules:

- the same key and request digest returns the prior operation result;
- the same key with different parameters returns `IDEMPOTENCY_CONFLICT`;
- after an ambiguous command result or crash, Agent08 rescans before retrying;
- it never blindly repeats worktree creation or removal;
- operation audit records lifecycle phases independently;
- capability reuse is rejected even when the client retries;
- a replacement capability may be issued only from a new PolicyDecision based
  on reconciled current state.

## 16. Immutable audit

Audit phases:

```text
requested
policy_decided
preflight_recorded
capability_issued
capability_consumed
command_started
command_finished
postflight_recorded
result_recorded
```

Each record includes:

- audit ID and operation ID;
- timestamp and phase;
- operation tier and authorization mode;
- principal/task/session;
- policy version and decision ID;
- capability ID hash, never raw capability;
- UserConfirmation ID when required;
- repository and common Git directory identity;
- lease ID/version/lifecycle;
- canonical target path;
- base OID and branch mode/name;
- parameter, preflight, and postflight digests;
- command template ID, not caller argv;
- result or typed error code.

Audit failure before command execution blocks the operation. A failure after
command start creates an ambiguous operation state that must be reconciled by
read-only rescan.

## 17. Command, path, ref, and environment controls

- Use one fixed proxy method per operation.
- Do not expose a raw runner through HTTP, service, policy, or capability types.
- Use a verified repository working directory; do not accept `-C`.
- Strip caller-supplied `GIT_*`, `GIT_DIR`, `GIT_WORK_TREE`, config, hook, and
  credential environment overrides.
- Tier 1 command templates never access remote.
- Target paths are absolute, server-derived, canonical, and outside business
  repositories.
- Reject path traversal, symbolic-link components, existing target directories,
  NUL, control characters, and ambiguous Unicode/path normalization.
- Base revisions are resolved to full commit OIDs.
- Managed branch names, when later enabled, are server-derived and reject
  leading `-`, `..`, unsafe ref syntax, collisions, and protected branches.

## 18. Dirty user-worktree non-interference

The invariant is:

```text
UserWorktreeDigest(before) == UserWorktreeDigest(after)
```

The digest covers:

- canonical user worktree path;
- repository/common Git directory identity;
- HEAD OID and current branch;
- index state;
- porcelain tracked/staged/untracked state;
- in-progress state;
- user worktree registration identity.

Tier 1:

- may read this state;
- does not require it to be clean;
- does not include uncommitted content in the isolated worktree;
- does not stash, checkout, switch, reset, clean, move, overwrite, or remove
  files in the user worktree.

Any observed user-worktree drift produces `POSTCONDITION_FAILED`.

## 19. Typed errors

Common authorization and identity errors:

```text
AUTHORIZATION_MODE_NOT_ALLOWED
PRINCIPAL_NOT_TRUSTED
TASK_ID_MISMATCH
REPO_NOT_ALLOWED
REPO_IDENTITY_MISMATCH
POLICY_DENIED
CAPABILITY_REQUIRED
CAPABILITY_EXPIRED
CAPABILITY_USED
CAPABILITY_MISMATCH
STATE_DRIFT
AUDIT_WRITE_FAILED
IDEMPOTENCY_CONFLICT
```

Creation errors:

```text
BASE_REVISION_INVALID
BRANCH_MODE_UNSUPPORTED
MANAGED_ROOT_INVALID
TARGET_PATH_EXISTS
TARGET_PATH_ESCAPE
SYMLINK_ESCAPE
LEASE_CONFLICT
REMOTE_ACCESS_FORBIDDEN
WORKTREE_CREATE_FAILED
POSTCONDITION_FAILED
```

Lease and cleanup errors:

```text
LEASE_NOT_FOUND
LEASE_NOT_OWNED
LEASE_EXPIRED
LEASE_VERSION_CONFLICT
LEASE_RENEWAL_LIMIT_EXCEEDED
WORKTREE_NOT_REGISTERED
WORKTREE_IS_USER_OWNED
WORKTREE_IDENTITY_MISMATCH
OWNED_WORKTREE_DIRTY
OWNED_WORKTREE_HAS_UNTRACKED
OWNED_WORKTREE_HAS_IGNORED_OUTPUT
GIT_OPERATION_IN_PROGRESS
WORKTREE_REMOVE_FAILED
SCOPED_METADATA_PRUNE_UNSUPPORTED
```

Errors return productized title, summary, suggested action, operation ID, and
audit ID. Raw private content, credentials, capabilities, and unrestricted
stderr are excluded.

## 20. Notification deduplication

Authorization and notification state remain separate.

Agent08 returns stable restriction metadata:

```ts
interface GitRestriction {
  notificationKey: string;
  restrictionCategory:
    | "direct_git_mutation_forbidden"
    | "tier_upgrade_required"
    | "machine_route_unavailable"
    | "dirty_owned_worktree_cleanup_blocked"
    | "external_approval_required";
  operationTier: 0 | 1 | 2 | 3;
  alternativePath: string;
  externalImpact: boolean;
  blockedCompletion: boolean;
}
```

Codex task runtime owns task/session-scoped deduplication:

- the same task, restriction, and alternative path is notified once;
- later attempts automatically use the allowed path;
- notification repeats only when completion is blocked, TZ must make a new risk
  decision, tier increases, external impact changes, or the alternative path
  changes or fails;
- notification records never authorize Git operations.

The notification registry may be cleaned up or archived when the task ends. The
exact Codex runtime storage implementation is outside the Agent08 repository
and must be resolved during Phase E integration; it is not a Phase B blocker.

## 21. Threat controls

The implementation contract must defend against:

- unauthenticated local callers;
- caller-selected authorization downgrade;
- capability replay or cross-repo reuse;
- repository path replacement and symbolic-link escape;
- parent-repository discovery;
- ref, branch, option, path, and environment injection;
- confused-deputy use of managed worktree paths;
- implicit remote access;
- mutation of a dirty user worktree;
- removal of a non-owned or dirty worktree;
- repository-wide metadata prune;
- TOCTOU identity/path changes;
- crash between command and audit result;
- concurrent operations on the same common Git directory.

Any identity, ownership, state, scope, or result ambiguity fails closed.

## 22. Test contract for later phases

### Phase B primitive tests

- operation registry prevents tier downgrade;
- authenticated principal and task claims are bound;
- PolicyDecision binds repo identity, parameters, and preflight;
- ExecutionCapability rejects missing, expired, used, mismatched, replayed, or
  cross-principal requests;
- UserConfirmation is required only for Tier 2 and Tier 3;
- lease reserve/renew/version/idempotency/tombstone behavior is atomic;
- no real worktree mutation occurs.

### Phase C lifecycle activation tests

- `prepare_isolated_worktree` creates a detached worktree with the fixed
  template;
- immediate `inspect_worktree_lease` after create succeeds;
- inspect confirms exact repository, common Git directory, canonical path,
  task, and lease ownership;
- inspect confirms detached HEAD and the expected base OID;
- inspect reports cleanliness, expiry, and removable state;
- `renew_worktree_lease` succeeds within policy;
- renewal rejects a lease-version mismatch;
- renewal rejects cumulative expiry beyond 7 days;
- a create retry after an ambiguous result rescans instead of creating a
  duplicate worktree;
- raw command, argv, target path, remote, force, config, `-C`, and environment
  override fields are rejected;
- symbolic-link, path traversal, existing target, parent-repo, and identity
  mismatch fail closed;
- the dirty user main-worktree pre/post digest is unchanged;
- no removal or metadata-prune operation is reachable;
- rollback preserves durable lease and audit records and hands every existing
  owned worktree to TZ;
- disposable-repository integration tests create no persistent business-repo
  state.

### Phase D cleanup tests

- `remove_owned_worktree` succeeds only for a clean owned worktree and without
  force;
- tracked, staged, untracked, ignored output, lock, and in-progress states block;
- other task, other repo, other path, expired/ambiguous ownership, and user
  worktrees block;
- force is never used;
- branch deletion is never implicit;
- `prune_owned_worktree_metadata` remains blocked when any non-owned prunable
  record exists;
- exact-scope metadata recovery returns
  `SCOPED_METADATA_PRUNE_UNSUPPORTED` when exact owned scope cannot be proven;
- non-target worktree registry and state remain unchanged.

### Phase E integration tests

- Codex uses only the authenticated typed API;
- broker unavailable behavior fails closed and does not fall back to raw Git;
- restriction notification is task-deduplicated;
- tier or external-impact change triggers a new notice.

### Phase F promotion tests

- separate UserConfirmation is mandatory;
- protected or existing branch names block;
- promotion does not stage, commit, merge, push, set upstream, or delete a
  branch.

## 23. Phased delivery

### Phase A — Governance and contract approval

Scope:

- workspace tier model;
- sovereignty authorization model;
- Agent08 local invariants;
- this SDD;
- no runtime implementation.

Exit:

- documents are internally consistent;
- no placeholder remains;
- current draft SDD status is preserved;
- no executable files change.

Rollback:

- revert only the Phase A document edits through the approved Agent08 Git
  Control path;
- runtime remains unchanged.

### Phase B — Read-only and policy primitives

Scope:

- operation metadata;
- principal credential, authenticated transport, and task/session identity
  interfaces and test doubles;
- PolicyDecision;
- ExecutionCapability and UserConfirmation separation;
- lease and audit stores;
- test doubles only.

Exit:

- targeted primitive tests and TypeScript typecheck pass;
- no real authenticated machine route is enabled;
- no real worktree mutation is reachable.

Rollback:

- disable feature registration;
- preserve readable audit and lease data;
- no Git worktree cleanup is necessary.

#### Phase B implementation evidence (2026-07-30)

With separate TZ authorization, Phase B primitives were implemented in isolated
modules under `src/gitboard/`:

- server-owned operation metadata, authenticated-principal interfaces, the
  disabled production authenticator, and deny-by-default `PolicyDecision`;
- immutable preflight records and append-only machine-operation audit records;
- immutable durable `PolicyDecision` storage; single-use, short-lived
  `ExecutionCapability` storage with verifier-only persistence, separate
  `UserConfirmation` storage, and durable lease state;
- a dependency-injected, simulation-only authorization coordinator covering
  authenticate -> preflight -> policy -> durable decision -> capability ->
  re-authenticate -> authoritative preflight/decision binding -> consume ->
  audit. A capability is revoked before returning an audit failure after issue.

The production operation registry remains `runtimeAvailability: "disabled"` for
all six definitions. The test-only simulation registry is supplied explicitly
to tests and is not registered with `gitControlServerMain.ts`. No machine HTTP
path, managed isolation root, Git runner, child-process import, or worktree
mutation was added. The two activation decision classes in section 24 remain
unresolved and therefore block any later runtime activation.

### Phase C — Detached worktree lifecycle activation

Scope:

- `prepare_isolated_worktree`;
- `inspect_worktree_lease`;
- `renew_worktree_lease`;
- detached mode only;
- fixed local-only worktree creation proxy;
- repository identity verification;
- managed-root verification;
- durable lease activation;
- lease inspection;
- bounded lease renewal;
- postflight verification;
- crash and idempotency reconciliation;
- disposable repository integration tests.

`inspect_worktree_lease` is an authenticated read-only operation.
`renew_worktree_lease` executes no Git command but is a Tier 1 lifecycle
operation. After successful creation, the task must be able to inspect lease
ownership, registration, HEAD, cleanliness, expiry, and removable state, and
renew the lease within the 7-day cumulative maximum. Phase C includes no
worktree removal or metadata prune.

Exit:

- principal authentication and authoritative task/session binding activation
  decisions are approved and accepted before real worktree mutation;
- the create -> inspect -> renew lifecycle passes;
- dirty-user-worktree non-interference is proven;
- postflight and crash reconciliation pass;
- no remote, force, branch, upstream, raw-argument, or caller-controlled path
  exists;
- no clean-owned removal route is claimed as available.

Rollback:

- disable new worktree creation immediately;
- retain authenticated `inspect_worktree_lease`;
- stop lease renewal except where explicitly required to preserve an existing
  worktree for TZ review;
- preserve all durable lease and audit records;
- do not automatically remove, prune, force-clean, or abandon an existing
  worktree;
- hand every existing owned worktree to TZ for a manual or later Phase D cleanup
  decision;
- TZ's real terminal Git operations remain governed by the existing manual
  operation boundary and must not be described as Codex automation.

### Phase D — Owned cleanup and metadata recovery

Scope:

- `remove_owned_worktree`;
- `prune_owned_worktree_metadata`.

`remove_owned_worktree` accepts only a clean, owned, registered detached
worktree. Dirty state, untracked files, ignored output, in-progress operations,
identity ambiguity, and non-owned worktrees all block removal. It never uses
force or deletes a branch. `prune_owned_worktree_metadata` remains disabled
unless exact owned scope can be proven; otherwise it returns
`SCOPED_METADATA_PRUNE_UNSUPPORTED`.

Exit:

- all dirty, ambiguous, non-owned, and in-progress cases fail closed;
- no force or branch deletion;
- unrelated worktrees remain unchanged.

Rollback:

- disable removal and prune;
- keep inspect available;
- retain lease, audit, and tombstone records;
- hand blocked cleanup to TZ.

### Phase E — Codex integration and notification deduplication

Scope:

- authenticated Codex task integration;
- task/session-scoped notification registry and notice deduplication;
- broker-unavailable behavior.

Exit:

- Codex uses no raw mutation fallback;
- duplicate notices are suppressed without affecting authorization;
- tier/external/blocking changes re-notify.

Rollback:

- disable integration;
- return to Tier 0 plus user-controlled Agent08 operations.

### Phase F — Optional branch promotion

Scope:

- `promote_isolated_branch` as Tier 2;
- protected-branch registry authority;
- no automatic commit, merge, upstream, or push.

Exit:

- separate TZ approval;
- protected-branch and confirmation acceptance pass.

Rollback:

- disable the route;
- preserve existing branch/worktree state for user decision.

## 24. Remaining activation decisions

Only these two activation decision classes remain:

1. Principal credential and authenticated local transport: credential issuance,
   transport authentication, credential rotation, local-process impersonation
   protection, restart/recovery behavior, and the machine-endpoint exposure
   boundary. Phase A does not invent an implementation. Phase B may define the
   interface, data structures, and test doubles, but the real authenticated
   machine route remains disabled until the mechanism is approved and accepted.
   This decision must be resolved before Phase C performs real worktree
   mutation.
2. Codex task/session identity source: the authoritative sources for task ID and
   session ID, binding of the principal to the current Codex task, and whether
   restart recovers or rejects an old principal. Phase B may express the
   interface and a test double, but no real machine route may be enabled without
   an authoritative task/session identity source.

## 25. Non-goals

- No raw `git worktree` execution by Codex.
- No automatic stage, commit, stash, reset, checkout, switch, cherry-pick,
  merge, rebase, or conflict resolution.
- No automatic task branch in the MVP.
- No branch promotion in Tier 1.
- No upstream, fetch, pull, push, remote, PR, or visibility mutation.
- No force, clean, overwrite, or user dirty-worktree cleanup.
- No unrestricted `git worktree prune`.
- No use of managed path possession as general Git authority.
- No executable implementation under Phase A approval.

## 26. Final MVP boundary

The approved MVP boundary for a later separately authorized executable
milestone is:

```text
allowlisted repository
+ authenticated Codex task principal
+ machine PolicyDecision
+ one-time ExecutionCapability
+ detached worktree only
+ Agent08-managed canonical root
+ durable task/lease ownership
+ fixed local-only command template
+ no remote, force, branch, upstream, or user-worktree mutation
+ pre/post identity and state verification
+ immutable audit
+ prepare
+ inspect
+ renew
+ clean-owned remove
```

Phase C separately activates prepare, inspect, and renew. Phase D separately
activates clean-owned removal. Metadata prune remains behind its independent
exact-scope activation gate. Phase A activates none of these operations.
Automatic task branches, metadata prune without exact scope, promotion, commit,
merge, and push remain outside that MVP.

### Phase C lean acceptance evidence (2026-07-30)

The final acceptance correction keeps the production boundary disabled while
fixing three lifecycle proofs: reserve and `creating` now precede
`command_started`; matched/idempotent reconciliation emits no false command
audit; and every post-command failure converges to `active`, `failed`, or
`quarantined` rather than remaining `creating`. Renew now proves canonical
filesystem ownership through the worktree `.git` file, common Git
administrative scope, `commondir`, `gitdir` back-reference, detached HEAD, and
lease base OID without running a Git command. `removable` remains `false`, and
remove/prune, production route, and production managed-root activation remain
unimplemented. Renew now commits its lease CAS before writing the `renewed`
audit; result-audit failure quarantines the new lease version rather than
leaving an untracked active renewal.

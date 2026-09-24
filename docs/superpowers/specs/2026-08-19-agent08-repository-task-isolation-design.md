# Agent08 Repository and Task Isolation Design

Status: Approved for Agent08 implementation; Web implementation remains separately owned
Date: 2026-08-19
Owner: Agent08 / `agent08-gitboard`
Web counterpart: Codex task `01a01a15-a6ea-7751-a5a4-ea21b1366034`
Approved direction: TZ

## 1. Decision

Agent08 will extend the approved Git Control v1.4/v1.4.1 contract with the
smallest state model needed to keep development work independent while making
commit and push boundaries explicit.

The model separates four facts:

```text
service/repository observation
repository Git truth
task-scoped finalization selection
pushability of existing commits
```

Repository dirt remains visible but does not govern ordinary development,
other repositories, or push of existing commits. A business repository and
`web-platform` always produce independent proposal, plan, confirmation, and
receipt records. They may carry the same caller-supplied `taskIntentId`, but
Agent08 does not create a cross-repository transaction or task database.

This is an additive v1.4.2 design. It does not create a parallel v2 route
family, a worktree manager, a patch engine, semantic file classification, or a
global task coordinator.

## 2. Authority and repository boundary

Agent08 owns:

- the allowlisted repository registry and canonical physical paths;
- read-only Git observation;
- the public Git Control scan representation;
- proposal validation and immutable finalization plans;
- local confirmation, fixed commit/push execution, and receipts.

Web owns:

- the `/agent08` publication shell and presentation;
- identity-gated same-origin proxying to Agent08;
- transient browser selection state for a manual draft;
- user-visible recovery text and layout.

Business Agent repositories own their product behavior and content. Web and
Agent08 must not infer which task owns a diff by inspecting filenames, hunks,
or file contents.

Agent08 implementation in this task must not edit `/Users/tristanzh/agent/web`
or any business repository. The Web task consumes this contract and owns its
own design and implementation approval.

## 3. Goals

1. Development can continue in a dirty repository without a global release or
   health gate blocking unrelated work.
2. `web-platform` remains an independent Git repository and GitBoard card.
3. A business task that changes both its business repository and Web uses two
   independent finalization operations.
4. Repository truth, task selection, and pushability cannot be mistaken for
   one another.
5. A failed repository scan cannot make another repository unknown or make the
   failed repository appear clean.
6. Ignored runtime files and filesystem-only large files do not become Git
   dirty state or commit candidates.
7. Browser responses contain no canonical absolute repository paths, raw Git
   stderr, credentials, confirmation tokens, or private file content.

## 4. Non-goals

The design does not add:

- automatic commit or push;
- automatic file ownership or mixed-hunk detection;
- patch-level or hunk-level selection;
- cross-repository atomicity, rollback, or sequencing;
- task persistence beyond optional metadata on finalization records;
- branch, stash, rebase, reset, checkout, pull, or worktree operations;
- runtime lifecycle control or Web publication readiness;
- a compatibility adapter that reconstructs legacy dashboard/checklist shapes;
- a Git health score as mutation authority.

## 5. Minimal repository registry

The internal manifest remains the canonical repository identity registry. Its
version becomes `2`. Each target adds only the metadata required to group and
label repositories:

```ts
type RepoKind = "business" | "platform" | "governance";
type RepoLifecycle = "active" | "retired" | "unpublished";

interface RepoManifestEntry {
  id: string;
  ownerId: string;
  label: string;
  kind: RepoKind;
  lifecycle: RepoLifecycle;
  path: string;
  remote: string;
  visibility: "public" | "private" | "local";
  required: boolean;
}
```

The production default manifest writes version `2` and declares every field.
Existing in-memory version `1` fixtures and historical consumers may be read
through one bounded compatibility normalizer that derives missing display-only
metadata; this compatibility does not alter repository identity, paths,
remotes, or finalization policy and is not exposed as a second public API.

`path` and `remote` remain server-side identity data. `kind`, `ownerId`, and
`lifecycle` are display/grouping metadata and do not weaken finalization
checks. `lifecycle` describes the GitBoard card's declared lifecycle; it does
not start, stop, publish, or retire a Web runtime and does not independently
disable Git finalization.

The target classification is:

| Repository | Kind | Owner | Lifecycle |
| --- | --- | --- | --- |
| `agent-tooling` | governance | `agent-tooling` | active |
| `agent02-pvi` | business | `agent02` | active |
| `agent03-prs` | business | `agent03` | active |
| `agent04-lpm` | business | `agent04` | active |
| `agent05-pptx` | business | `agent05` | retired |
| `agent06-pka` | business | `agent06` | active |
| `agent07-sentinel` | business | `agent07` | retired |
| `agent08-gitboard` | governance | `agent08` | active |
| `agent10-asset-library` | business | `agent10` | active |
| `agent11-fishtank-monitor` | business | `agent11` | unpublished |
| `agent12-fishtank-3dtwin` | business | `agent12` | active |
| `agent13-esp-reminder` | business | `agent13` | active |
| `home-platform` | platform | `home-platform` | active |
| `agent14-ppt2html` | business | `agent14` | active |
| `web-platform` | platform | `agent00` | active |

Publication route and runtime service identifiers remain Web-owned metadata and
are intentionally not duplicated into the Agent08 manifest.

## 6. Canonical public scan contract

`GET /api/git-control/scan` becomes the only canonical repository scan
contract. A successful response contains one repository list and does not also
return `dashboard.targets`, `cards`, a global health score, or a global
ready/blocked result.

```ts
type ObservationState = "verified" | "unverified";
type RepoTruthState = "clean" | "dirty" | "unknown";
type PushabilityState = "pushable" | "not_pushable" | "unknown";
type ActionState = "enabled" | "disabled";
type ChangeStatus =
  | "modified"
  | "untracked"
  | "deleted"
  | "renamed"
  | "unmerged";

interface GitControlScanResponse {
  schemaVersion: 2;
  observation: {
    state: ObservationState;
    observedAt: string | null;
    reasonCode: string | null;
  };
  repositories: PublicRepositorySnapshot[];
}

interface PublicRepositorySnapshot {
  repoId: string;
  label: string;
  kind: RepoKind;
  ownerId: string;
  lifecycle: RepoLifecycle;
  availability:
    | "git_repository"
    | "uninitialized_directory"
    | "missing"
    | "unknown";
  observation: {
    state: ObservationState;
    observedAt: string;
    reasonCode: string | null;
  };
  repoTruth: {
    state: RepoTruthState;
    changeCount: number;
    conflictCount: number;
    changes: Array<{ path: string; status: ChangeStatus }>;
  };
  branch: {
    state: "attached" | "detached" | "unborn" | "unknown";
    name: string | null;
  };
  pushability: {
    state: PushabilityState;
    commitCount: number;
    ahead: number;
    behind: number;
    reasonCode: string | null;
  };
  actions: {
    commit: { state: ActionState; reasonCode: string | null };
    push: { state: ActionState; reasonCode: string | null };
  };
}
```

All paths in `changes` are repository-relative Git paths. The public payload
does not contain the canonical repository path, manifest remote URL, raw
command output, stash messages, or large-file filesystem enumeration.

`GET /api/git-control/repos/:repoId` reuses the same
`PublicRepositorySnapshot` projection and may add only `stashCount` as
display-only data:

```ts
interface GitControlRepoDetailResponse {
  schemaVersion: 2;
  repository: PublicRepositorySnapshot;
  stashCount: number;
}
```

It does not return canonical paths, remote URLs, stash selectors/messages, or
another independently derived action model.

`actions.commit=enabled` means a user may begin or submit an exact proposal; it
does not promise that selected paths will pass final secret, blocked-path, or
drift checks. `actions.push` derives from `pushability` and never from working
tree dirt.

`taskSelection` is deliberately absent from the global scan. A repository may
have more than one task intent, and task selection only has meaning for a
specific finalization `operationId`.

## 7. Observation and failure rules

### 7.1 Service-level failure

An identity failure, unavailable Agent08 service, malformed public schema, or
unhandled scan failure produces an unverified service result with no repository
snapshots:

```json
{
  "schemaVersion": 2,
  "observation": {
    "state": "unverified",
    "observedAt": null,
    "reasonCode": "AGENT08_SCAN_FAILED"
  },
  "repositories": []
}
```

The HTTP status may be non-2xx. Consumers must clear previous snapshots and
must not reuse old clean, dirty, pushability, or action state.

### 7.2 Per-repository failure

Repository scanning is isolated per target. A failed target remains in the
response with:

```text
observation.state = unverified
availability = unknown when it cannot be determined
repoTruth.state = unknown
pushability.state = unknown
commit/push actions = disabled
```

Other targets retain their verified results. A deterministically missing path
or existing non-Git directory is a verified availability result, not a clean
repository. An index lock, permission error, unreadable working directory, or
unexpected Git failure is `unverified`, not `missing`.

A failed remote probe does not erase verified local Git truth. It produces
`pushability.state=unknown` with `reasonCode=REMOTE_CHECK_FAILED`.

### 7.3 Git truth only

The canonical scan derives changed paths from Git status. Recursive filesystem
large-file scanning is removed from the canonical scan and cannot affect
`repoTruth`, actions, or finalization readiness. Ignored `.logs`, `.runtime`,
cache, dependency, and generated files are absent unless Git itself reports
them as changed.

Selected-path blocked-output and secret checks remain mandatory at commit
prepare time under v1.4.

## 8. Proposal and task-intent contract

`taskIntentId` is opaque caller-supplied correlation metadata. Agent08 validates
and records it but does not create, query, resolve, or manage tasks.

The bounded format is:

```text
1 to 128 characters
first character: A-Z, a-z, or 0-9
remaining characters: A-Z, a-z, 0-9, dot, underscore, colon, slash, or hyphen
```

Commit proposals add:

```ts
type PathSelectionDeclaration = "exact_paths" | "mixed_or_indeterminate";

interface CommitProposal {
  selectedPaths: string[];
  commitMessage: string;
  expectedHead?: string;
  rationale?: string;
  source?: "codex" | "manual";
  taskIntentId?: string;
  selectionDeclaration?: PathSelectionDeclaration;
}
```

Push proposals add only `taskIntentId`; push has no path selection declaration.

Validation rules:

1. An omitted `source` normalizes to `manual` for backward compatibility.
2. `source=codex` requires `taskIntentId`.
3. A Codex commit requires `selectionDeclaration`.
4. A manual proposal may omit `taskIntentId`. The UI and receipt then display
   `未关联任务` and make no task-ownership claim.
5. A manual commit that includes `taskIntentId` also requires
   `selectionDeclaration`; otherwise it cannot claim task isolation.
6. `selectionDeclaration=mixed_or_indeterminate` returns
   `MIXED_PATH_REQUIRES_OWNER_SPLIT` before an executable plan or confirmation
   exists.
7. `selectionDeclaration=exact_paths` records the owning workflow's judgement;
   it is not semantic proof produced by Agent08.
8. Agent08 never inspects content to infer task ownership and never changes the
   selected path set.

The new stable validation codes are:

```text
FINALIZATION_TASK_INTENT_INVALID
FINALIZATION_TASK_INTENT_REQUIRED
FINALIZATION_SELECTION_DECLARATION_REQUIRED
MIXED_PATH_REQUIRES_OWNER_SPLIT
```

Existing v1.4 drift, confirmation, path, secret, and execution codes remain in
force.

## 9. Finalization records and public status

New plans, attempts, and receipts add nullable `taskIntentId`. Commit plans also
record nullable `selectionDeclaration`. These are additive fields on the
existing stores; no data migration or new database is introduced. Older stored
records normalize missing fields to `null` when projected publicly.

The canonical browser-safe projection is:

```ts
type PublicFinalizationState =
  | "ready"
  | "confirmed"
  | "consumed"
  | "rejected"
  | "failed"
  | "succeeded";

interface PublicFinalizationAttempt {
  operation: "commit" | "push";
  repoId: string;
  proposalSource: "codex" | "manual";
  taskIntentId: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface PublicBasePlan {
  operation: "commit" | "push";
  repoId: string;
  branch: string;
  expectedHead: string;
  proposalSource: "codex" | "manual";
  taskIntentId: string | null;
  createdAt: string;
  expiresAt: string;
}

interface PublicCommitPlan extends PublicBasePlan {
  operation: "commit";
  selectedPaths: string[];
  selectionDeclaration: "exact_paths" | null;
  commitMessage: string;
  rationale: string | null;
}

interface PublicPushPlan extends PublicBasePlan {
  operation: "push";
}

type PublicFinalizationPlan = PublicCommitPlan | PublicPushPlan;

interface PublicFinalizationReceipt {
  operation: "commit" | "push";
  repoId: string;
  taskIntentId: string | null;
  state: "succeeded" | "failed";
  resultCode: string;
  beforeOid: string | null;
  afterOid: string | null;
  branch: string;
  completedAt: string;
}

interface PublicFinalizationStatus {
  schemaVersion: 2;
  operationId: string;
  state: PublicFinalizationState;
  outcome:
    | "ready_for_confirmation"
    | "proposal_stale"
    | "proposal_rejected"
    | "confirmation_expired"
    | "execution_failed"
    | "committed"
    | "pushed";
  resultCode: string;
  attempt: PublicFinalizationAttempt;
  plan: PublicFinalizationPlan | null;
  receipt: PublicFinalizationReceipt | null;
}

interface PublicFinalizationConfirmation {
  schemaVersion: 2;
  operationId: string;
  state: "confirmed";
  confirmationToken: string;
  expiresAt: string;
}
```

Nullability is deterministic:

- `plan=null` only when preparation was rejected before an immutable plan was
  created or no plan record exists;
- `receipt=null` until an execution attempt reaches a persisted terminal
  success/failure receipt;
- rejected preparation normally has `plan=null` and `receipt=null`;
- ready, confirmed, consumed, stale, or confirmation-expired status retains a
  non-null plan while it exists and has no receipt before execution;
- committed, pushed, or execution-failed status after Git execution has a
  terminal receipt;
- older records without task intent or selection declaration project those
  fields as `null`, never as an inferred value.

Route response shapes are fixed:

- commit/push `POST .../prepare` returns `PublicFinalizationStatus` with
  `state=ready`, a non-null plan, and `receipt=null`;
- `GET /api/git-control/finalizations/:operationId` returns the same
  `PublicFinalizationStatus` projection;
- `POST .../execute` returns the same `PublicFinalizationStatus` projection
  after execution rather than a separate receipt-only shape;
- `POST .../confirm` returns `PublicFinalizationConfirmation` because its
  single-use token must not appear in status or receipt responses.

These projections exclude canonical paths, remote URLs, plan digests,
selected-state digests, persisted confirmation records/token digests, raw
output, and private content. The only raw confirmation token is the short-lived
single-use value returned by the explicit confirm operation.

The same `taskIntentId` may appear on operations for a business repository and
`web-platform`, but every operation keeps an independent:

```text
operationId
plan digest
confirmation
execution
receipt
```

Agent08 does not order the operations or roll one back when the other fails.

## 10. Push semantics

Pushability describes committed Git history only.

- A dirty or staged working tree does not disable push.
- Unmerged working-tree paths do not change whether an already committed OID
  can be pushed; existing branch, remote, and OID checks remain authoritative.
- No commits to publish yields `not_pushable` with
  `reasonCode=NO_COMMITS_TO_PUSH`.
- An unavailable remote check yields `unknown`, never `not_pushable` or
  `clean`.
- Push execution remains the exact non-force single-ref v1.4 operation.

## 11. Legacy Web route contract

The Web-owned routes below retire with `410 Gone`:

```text
GET /api/agent08/scan
GET /api/agent08/checklist
```

Their bounded response identifies:

```text
replacement=/api/git-control/scan
```

They do not transform the new response into a legacy dashboard or checklist.
`GET /api/git-control/scan` is the only scan truth.

Web removes its direct import of Agent08 `dashboardService` and uses an
identity-gated method/path allowlist for Git Control proxy routes. These are Web
implementation requirements and are not implemented in the Agent08 repository.

## 12. Data flow

```text
read-only scan
  Agent08 manifest
    -> per-target Git observation
    -> public repository projection
    -> Web identity-gated proxy
    -> UI renders backend states without re-deriving them

Codex commit proposal
  repoId + exact paths + taskIntentId + exact_paths declaration
    -> Agent08 validation
    -> immutable per-repo plan
    -> local confirmation
    -> exact per-repo commit
    -> per-repo receipt carrying taskIntentId

Codex mixed proposal
  mixed_or_indeterminate declaration
    -> MIXED_PATH_REQUIRES_OWNER_SPLIT
    -> no plan and no confirmation

push proposal
  repoId + expected HEAD + taskIntentId
    -> independent immutable push plan
    -> confirmation
    -> exact push of approved OID
```

## 13. Minimal implementation surface

Agent08 implementation should be limited to the existing modules that own the
contract:

- manifest and shared Git snapshot types;
- repository scanner and public scan projection;
- Git Control service and HTTP projection;
- finalization proposal validation and record projection;
- focused tests for those modules.

The legacy health score, release checklist, and dashboard service may remain as
unused historical source during this change, but the canonical Git Control scan
must not call them. Removing all historical files is outside this design.

No new persistence service, registry file, background worker, event bus,
database, route family, or generic policy framework is justified.

## 14. Acceptance criteria

1. The public scan has `schemaVersion=2`, one `repositories` list, and no
   `dashboard`, `cards`, global health, or global ready/blocked field.
2. No public scan, repo detail, or finalization status contains an absolute
   repository path, manifest remote URL, or stash message.
3. `web-platform` is `kind=platform`; business, platform, and governance
   repositories are distinguishable without Web maintaining a second mapping.
4. A single repository scan failure produces one unverified repository while
   other repositories remain verified.
5. A service-level scan failure produces no reusable repository snapshots.
6. Ignored runtime/log files and filesystem-only large files do not affect Git
   truth or commit/push action state.
7. Dirty working-tree state does not disable a valid push action or push plan.
8. Global scan contains no task selection state.
9. A Codex proposal without a valid `taskIntentId` is rejected before plan
   creation.
10. A task-associated commit without a selection declaration is rejected.
11. `mixed_or_indeterminate` returns
    `MIXED_PATH_REQUIRES_OWNER_SPLIT` and creates no executable plan.
12. `taskIntentId` survives proposal, plan, status, execution attempt, and
    receipt projection.
13. Two repositories sharing a `taskIntentId` still have different operation
    IDs, confirmations, and receipts.
14. Manual proposals without `taskIntentId` remain possible and make no
    task-isolation claim.
15. Existing exact-path, drift, confirmation, secret, no-force, and postflight
    v1.4 tests continue to pass.

## 15. Minimal verification

Implementation verification is limited to affected Agent08 tests and
typechecking:

```text
npm test -- <affected manifest/scanner/service/http/finalization test files>
npm run typecheck
git diff --check
```

No Web test, full multi-repository suite, runtime restart, commit, or push is
part of this Agent08 implementation task. The Web owner verifies its proxy and
UI separately against this public contract.

# Agent08 Git Control v1.2 Upstream SDD

Status: Draft
Date: 2026-06-19
Owner: Agent08 / agent08-gitboard
Related baseline: `docs/sdd/git-control-v1.1.md`

## 1. Purpose

Agent08 v1.1 can commit, push, pull, stash, and rebase only when a repo already has a valid upstream. The current blind spot is `upstream: null`: a clean repo with no upstream may be rendered as if it were synced, for example `main ✓`, even though Agent08 cannot prove push or pull state.

Agent08 v1.2 fixes that state-machine gap. It adds explicit upstream detection and two safety-gated operations:

- `set_upstream`: local-only tracking configuration when `origin/<branch>` already exists.
- `push_with_upstream`: remote push plus local tracking setup when the local branch needs to be published or pushed with `-u`.

The user-facing page remains:

```text
http://127.0.0.1:3000/agent08
```

The functional owner remains:

```text
/Users/tristanzh/agent/agent08-gitboard
```

The shared Web platform remains only the publishing shell/proxy/iframe host. It must not own Git mutation logic.

## 2. Version Boundary

v1.2 is an incremental Git Control upgrade. It does not replace v1.1 and does not weaken any v1.1 hard boundary.

### v1.2 adds

- upstream-null state modeling;
- remote branch existence probing through read-only Git;
- typed `set_upstream`;
- typed `push_with_upstream`;
- explicit UI states and confirmation panels for both operations.

### v1.2 does not add

- arbitrary branch checkout;
- branch creation UI;
- branch deletion UI;
- remote add or remote URL editing;
- tag creation or tag push;
- force push;
- arbitrary `git push -u <remote> <branch>` input;
- web-platform-side Git command construction.

Remote is fixed to `origin` in v1.2. Branch names must come from the scanner snapshot and must never be accepted as free-form user input.

## 3. Inherited v1.1 Hard Boundaries

The v1.1 seven hard boundaries remain mandatory:

1. Read-only and mutation GitProxy layers are split.
2. Repo allowlist and command allowlist are mandatory.
3. Current status is rechecked immediately before mutation.
4. Operation snapshots are stored before mutation.
5. Failure model is productized and operation-specific.
6. Self-monitoring has explicit mutation semantics.
7. Web-platform only publishes/proxies and does not perform Git mutation.

v1.2 implementation and tests must prove these still hold for `set_upstream` and `push_with_upstream`.

## 4. Repo Set

The monitored and mutation-eligible repo allowlist is unchanged:

```text
agent-tooling
agent02-pvi
agent03-prs
agent04-lpm
agent05-pptx
agent06-pka
agent07-sentinel
agent08-gitboard
web-platform
```

Unknown repo ids, path traversal, symlinks escaping the manifest path, and paths outside the manifest root remain hard failures.

## 5. Data Model Additions

`RepoSnapshot` must distinguish "clean and tracked" from "clean but upstream missing".

Minimum additions:

```ts
type UpstreamState =
  | "tracked"
  | "orphaned_upstream"
  | "missing_upstream_remote_exists"
  | "missing_upstream_remote_missing"
  | "detached"
  | "unknown";

interface RepoSnapshot {
  branch: string | null;
  upstream: string | null;
  remoteTrackingBranch: string | null;
  remoteHasBranch: boolean;
  upstreamState: UpstreamState;
  ahead: number;
  behind: number;
  commitsToPushCount: number;
  commitsToPushSubjects: string[];
}
```

Rules:

- `remoteTrackingBranch` is `origin/<branch>` when `branch` is present; otherwise `null`.
- `remoteHasBranch` is true only when `origin/<branch>` is proven to exist.
- `upstream: null` must never be rendered as synced.
- `ahead` and `behind` are authoritative only when an upstream exists or when the scanner explicitly computes a candidate comparison against `origin/<branch>`.
- `commitsToPushSubjects` is capped at five subjects.
- `commitsToPushSubjects` must not contain raw patch content or file contents.

## 6. Read-Only Scanner Additions

`ReadonlyGitProxy` / `RepoScanner` must add:

```ts
remoteHasBranch(repoPath: string, branch: string): Promise<boolean>;
```

Data source:

```bash
git ls-remote --heads origin <branch>
```

Execution rules:

- timeout: 5 seconds;
- empty output returns `false`;
- timeout, network failure, authentication failure, or command failure returns `false`;
- this method is read-only and cannot live in `MutationGitProxy`;
- `branch` must be the current scanned branch, not a UI-provided string;
- remote is fixed to `origin`.

Candidate commits for `push_with_upstream` must be derived by read-only Git:

- if `origin/<branch>` exists, compare `origin/<branch>..HEAD`;
- if `origin/<branch>` does not exist, use `git log --oneline --format="%s" -5 <branch>`;
- when `origin/<branch>` does not exist, `commitsToPushCount` is the output line count and `commitsToPushSubjects` is the subject array, capped at five entries;
- if detached HEAD, return no candidate operation.

## 7. Upstream State Machine

### Tracked

Condition:

- repo exists;
- `branch` is not null;
- `upstream` is not null.

UI:

- existing v1.1 push/pull/rebase rules apply;
- clean, ahead 0, behind 0 may display synced.

### Orphaned upstream

Condition:

- repo exists;
- `branch` is not null;
- `upstream` is not null;
- `remoteHasBranch` is false.

UI:

- display `upstream unreachable`;
- do not display `✓`;
- do not show push, pull, or rebase buttons;
- show `set upstream` only if a later rescan proves a replacement `origin/<branch>` exists;
- otherwise show a blocked state with a productized reason that the configured upstream no longer exists on `origin`.

### Missing upstream, remote branch exists

Condition:

- repo exists;
- `branch` is not null;
- `upstream` is null;
- `remoteHasBranch` is true.

UI:

- display `no upstream`;
- do not display `✓`;
- if clean and no local candidate commits need push, show `set upstream`;
- if clean and candidate commits exist with no candidate behind/diverged state, show `push -u`;
- if dirty, show commit workflow first and keep upstream action unavailable.

### Missing upstream, remote branch missing

Condition:

- repo exists;
- `branch` is not null;
- `upstream` is null;
- `remoteHasBranch` is false.

UI:

- display `no upstream`;
- do not display `✓`;
- if clean and local branch has commits, show `push -u`;
- if clean and `commitsToPushCount === 0`, show no mutation buttons and display `no commits to publish`;
- if dirty, show commit workflow first;
- `set upstream` is unavailable because there is no remote tracking branch to bind to.

### Detached or unknown

Condition:

- detached HEAD; or
- scanner cannot determine branch/upstream safely.

UI:

- display blocked/unknown;
- no upstream mutation buttons.

## 8. Mutation Commands

v1.2 extends the command allowlist with:

```text
set_upstream
push_with_upstream
```

Typed proxy methods:

```ts
setUpstream(input: {
  repoId: string;
  repoPath: string;
  branch: string;
  remote: "origin";
}): Promise<MutationResult>;

pushWithUpstream(input: {
  repoId: string;
  repoPath: string;
  branch: string;
  remote: "origin";
}): Promise<MutationResult>;
```

Internal commands:

```bash
git branch --set-upstream-to origin/<branch> <branch>
git push -u origin <branch>
```

Forbidden:

- arbitrary remote names;
- arbitrary branch names from request bodies;
- extra push args;
- `--force`;
- `--force-with-lease`;
- `--tags`;
- `--all`;
- shell fragments;
- raw Git argv accepted from UI or web-platform.

## 9. Preconditions

| Condition | `set_upstream` | `push_with_upstream` |
|---|---:|---:|
| repo exists | yes | yes |
| not detached HEAD | yes | yes |
| remote `origin` exists | yes | yes |
| `origin/<branch>` exists remotely | yes | no |
| not dirty | yes | yes |
| commits to push / ahead > 0 | no | yes |
| no upstream currently set | yes | yes |
| behind === 0 | no | yes |

Interpretation:

- For `set_upstream`, remote branch existence is mandatory because the operation binds local tracking to an existing remote branch.
- For `push_with_upstream`, remote branch existence is not mandatory because publishing a new branch is valid after explicit confirmation.
- For `push_with_upstream`, "ahead > 0" means candidate commits to push were detected by the scanner. When no upstream exists, this must not reuse misleading v1.1 `ahead: 0`; it must be computed as `commitsToPushCount`.
- If `origin/<branch>` exists and the remote branch contains commits not in local history, `push_with_upstream` is blocked as behind/diverged.

## 10. Confirmation Panels

Every v1.2 mutation still uses the v1.1 token flow:

- `operationId`;
- `preflightSnapshotId`;
- `confirmationToken`;
- `expiresAtMs`;
- execute request must echo the token payload.

### `set_upstream` confirmation panel

Minimum fields:

- repo id;
- branch;
- remote: `origin`;
- remote tracking branch: `origin/<branch>`;
- current upstream: `none`;
- statement: no commits will be pushed;
- warning: local Git config will be updated.

### `push_with_upstream` confirmation panel

Minimum fields:

- repo id;
- branch;
- remote: `origin`;
- ahead / candidate commits: `N commits`;
- commits to push: first five commit subjects;
- warning: `This operation pushes to origin AND sets upstream tracking.`

If more than five commits will be pushed, the panel must state how many additional commits are omitted from the preview.

## 11. API Contract

The HTTP layer remains a typed bridge. It must not build raw Git commands.

New endpoints:

```text
POST /api/git-control/repos/:repoId/set-upstream/prepare
POST /api/git-control/repos/:repoId/set-upstream
POST /api/git-control/repos/:repoId/push-upstream/prepare
POST /api/git-control/repos/:repoId/push-upstream
```

Prepare responses include the confirmation panel fields in section 10.

Execute requests include:

```ts
interface ExecuteUpstreamMutationRequest {
  operationId: string;
  preflightSnapshotId: string;
  confirmationToken: string;
}
```

Execute requests must not include branch, remote, or argv. Those values come from the preflight snapshot and current rescan.

## 12. Mutation Snapshot Additions

`MutationPreflightSnapshot.operation` extends to:

```ts
type MutationOperation =
  | "commit"
  | "push"
  | "pull_ff_only"
  | "stash"
  | "rebase"
  | "stash_rebase"
  | "set_upstream"
  | "push_with_upstream";
```

v1.2 snapshot fields:

```ts
interface UpstreamMutationSnapshotFields {
  branch: string | null;
  upstream: string | null;
  remote: "origin";
  remoteTrackingBranch: string | null;
  remoteHasBranch: boolean;
  commitsToPushCount: number;
  commitsToPushSubjects: string[];
  selfMutation: boolean;
}
```

Rules:

- snapshots are written before mutation;
- snapshot write failure blocks mutation;
- `selfMutation` warning remains mandatory for `agent08-gitboard`;
- snapshots must not store credentials or raw file contents.

## 13. Productized Error Codes

v1.2 adds these operation-specific codes:

```ts
type UpstreamMutationErrorCode =
  | "UPSTREAM_ALREADY_SET"
  | "REMOTE_ORIGIN_MISSING"
  | "REMOTE_BRANCH_REQUIRED_FOR_SET_UPSTREAM"
  | "REMOTE_BRANCH_MISSING_OR_UNAVAILABLE"
  | "NO_COMMITS_TO_PUSH_WITH_UPSTREAM"
  | "DIRTY_BLOCKS_SET_UPSTREAM"
  | "DIRTY_BLOCKS_PUSH_WITH_UPSTREAM"
  | "DETACHED_HEAD_BLOCKS_UPSTREAM"
  | "BEHIND_BLOCKS_PUSH_WITH_UPSTREAM"
  | "DIVERGED_BLOCKS_PUSH_WITH_UPSTREAM"
  | "UNSAFE_BRANCH_NAME"
  | "UNSUPPORTED_REMOTE";
```

Minimum productized message rules:

- `title`: one short user-facing sentence;
- `summary`: explains why Agent08 blocked the operation;
- `suggestedAction`: tells TZ which visible action to take next;
- raw stderr is not the primary UI message;
- raw diagnostics, if available, must be redacted.

## 14. UI Requirements

The UI must reflect upstream state without requiring users to understand Git internals.

Required behavior:

- `main ✓` is valid only when upstream exists and ahead/behind are both zero.
- `upstream: null` renders as `main · no upstream` or equivalent.
- clean repos with no upstream are not marked as synced.
- `set upstream` appears only when remote tracking branch exists and no push is needed.
- `push -u` appears only when clean, upstream missing, and candidate commits exist.
- dirty repos continue to prioritize commit workflow before upstream operations.
- confirmation panels show only operation-relevant facts.
- self-mutation warning remains visible when the selected repo is `agent08-gitboard`.

No footer or header text should expose proxy internals. User-facing text should describe account/link status and the selected repo state.

## 15. TDD Red-Light Contract

Implementation must proceed by red-green-refactor. Each item below starts as a failing test.

### Scanner tests

- `remoteHasBranch` returns true when `git ls-remote --heads origin main` returns a matching line.
- `remoteHasBranch` returns false on empty output.
- `remoteHasBranch` returns false on timeout or Git failure.
- `upstream` present and `remoteHasBranch: false` produces `upstreamState: "orphaned_upstream"`.
- `upstream: null` produces `upstreamState: "missing_upstream_remote_exists"` when the remote branch exists.
- `upstream: null` produces `upstreamState: "missing_upstream_remote_missing"` when the remote branch is missing.
- `upstream: null` never produces a synced display state.
- `commitsToPushSubjects` is capped to five subjects.
- remote branch missing uses `git log --oneline --format="%s" -5 <branch>` as the candidate commit source.
- remote branch missing with zero candidate commits produces no mutation buttons and a `no commits to publish` display reason.

### SafetyGate tests

- `set_upstream` is blocked when dirty files exist.
- `set_upstream` is blocked when upstream already exists.
- `set_upstream` is blocked when `origin/<branch>` is missing.
- `push_with_upstream` is blocked when dirty files exist.
- `push_with_upstream` is blocked when no candidate commits exist.
- `push_with_upstream` is blocked when candidate remote state is behind or diverged.
- detached HEAD blocks both upstream mutations.
- unsafe branch names are rejected even when they appear in malformed snapshots.

### MutationGitProxy tests

- `setUpstream` constructs only `git branch --set-upstream-to origin/main main`.
- `pushWithUpstream` constructs only `git push -u origin main`.
- raw argv cannot be passed through public proxy methods.
- forbidden args such as `--force`, `--tags`, and `--all` are rejected.

### Service/API tests

- prepare for `set_upstream` returns operation id, token, expiry, branch, remote, and remote tracking branch.
- prepare for `push_with_upstream` returns operation id, token, expiry, ahead count, first five commit subjects, and explicit warning text.
- execute rechecks current snapshot before mutation.
- execute ignores branch/remote fields if a client sends them in the body.
- `MutationSafetyError` propagates as HTTP 409 with the productized code.
- unknown internal errors remain HTTP 500 with no raw stderr dump.

### UI/web tests

- a repo with `upstream: null` does not render `✓`.
- a clean repo with remote branch present renders `set upstream`.
- a clean repo with candidate commits renders `push -u`.
- `push -u` confirmation shows branch, remote, ahead count, first five commit subjects, and the push-plus-upstream warning.
- web-platform tests prove no Git mutation implementation is duplicated in `web/server.mjs`.

### Integration smoke

- scan a real repo with upstream present and confirm v1.1 push/pull rules still work.
- scan a real repo with upstream missing and confirm it renders no-upstream state.
- prepare and cancel `set_upstream`; no mutation occurs.
- prepare and cancel `push_with_upstream`; no mutation occurs.
- self-monitoring warning appears for `agent08-gitboard` upstream mutations.

## 16. Acceptance Criteria

v1.2 is complete only when:

- all v1.1 tests still pass;
- all v1.2 red tests fail first and then pass;
- no implementation code accepts raw Git command arrays from UI or web-platform;
- no clean upstream-null repo is shown as synced;
- `set_upstream` and `push_with_upstream` are available only under the state-machine rules above;
- `/agent08` can explain why a repo needs upstream setup without exposing raw stderr;
- web-platform remains a proxy/publishing layer.

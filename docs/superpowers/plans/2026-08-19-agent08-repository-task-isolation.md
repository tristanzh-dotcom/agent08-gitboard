# Agent08 Repository and Task Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agent08 the single browser-safe Git state and finalization authority while isolating repository truth, task intent, and pushability.

**Architecture:** Extend the existing v1.4.1 implementation in place. The default manifest declares repository display metadata; `RepoScanner` keeps internal Git evidence and isolates target failures; `GitControlService` produces one public scan/detail projection; existing finalization stores gain additive task metadata; HTTP prepare/status/execute share one public status DTO.

**Tech Stack:** TypeScript 5.7, Node.js, Vitest 2.1, existing Agent08 JSON file stores and typed Git wrappers.

## Global Constraints

- Preserve v1.4 exact-path, immutable-plan, separate-confirmation, drift, secret, non-force push, and postflight checks.
- Do not edit `/Users/tristanzh/agent/web` or any business Agent repository.
- Do not add a database, task registry, event bus, v2 route family, cross-repository coordinator, patch engine, or semantic classifier.
- Do not execute Git commit, push, stage, branch, stash, reset, or checkout operations.
- Preserve unrelated existing working-tree changes; patch only the listed Agent08 files.
- `taskIntentId` is caller-supplied opaque metadata, not task authority.
- Manual proposals without `taskIntentId` remain valid and make no task-isolation claim.
- Minimal verification means affected Vitest files, TypeScript typecheck, and `git diff --check` only.

---

### Task 1: Add repository metadata and the canonical public scan projection

**Files:**
- Modify: `src/gitboard/types.ts`
- Modify: `src/gitboard/manifest.ts`
- Modify: `src/gitboard/gitControlService.ts`
- Test: `tests/repoScanner.test.ts`
- Test: `tests/gitControlService.test.ts`

**Interfaces:**
- Consumes: existing `RepoSnapshot`, `RepoManifest`, `RepoScanner`, and `GitProxy`.
- Produces: `RepoKind`, `RepoLifecycle`, `GitControlScanResponse`, `PublicRepositorySnapshot`, and `GitControlRepoDetailResponse`.

- [ ] **Step 1: Write failing manifest and scan-contract tests**

Add expectations equivalent to:

```ts
const manifest = createDefaultManifest("/Users/tristanzh/agent");
expect(manifest.version).toBe(2);
expect(manifest.targets.find(({ id }) => id === "web-platform")).toMatchObject({
  ownerId: "agent00",
  kind: "platform",
  lifecycle: "active",
});

const scan = await service.scan();
expect(scan).toMatchObject({
  schemaVersion: 2,
  observation: { state: "verified", reasonCode: null },
  repositories: [{
    repoId: "agent08-gitboard",
    kind: "governance",
    repoTruth: { state: "dirty", changeCount: 1 },
    pushability: { state: "pushable", commitCount: 1 },
    actions: {
      commit: { state: "enabled" },
      push: { state: "enabled" },
    },
  }],
});
expect(scan).not.toHaveProperty("dashboard");
expect(scan).not.toHaveProperty("cards");
expect(JSON.stringify(scan)).not.toContain("/Users/tristanzh/agent");
expect(JSON.stringify(scan)).not.toContain("github.com");

const detail = await service.repoDetail("agent08-gitboard");
expect(detail).toEqual({
  schemaVersion: 2,
  repository: scan.repositories[0],
  stashCount: 1,
});
expect(JSON.stringify(detail)).not.toContain("stash@{0}");
expect(JSON.stringify(detail)).not.toContain("local work");
```

- [ ] **Step 2: Run the focused tests and confirm contract failures**

Run:

```bash
npm test -- tests/repoScanner.test.ts tests/gitControlService.test.ts
```

Expected: FAIL because manifest version 2 metadata and canonical public DTOs do not exist.

- [ ] **Step 3: Add minimal public and compatibility types**

Implement in `src/gitboard/types.ts`:

```ts
export type RepoKind = "business" | "platform" | "governance";
export type RepoLifecycle = "active" | "retired" | "unpublished";
export type ObservationState = "verified" | "unverified";
export type RepoTruthState = "clean" | "dirty" | "unknown";
export type PushabilityState = "pushable" | "not_pushable" | "unknown";
export type ChangeStatus = "modified" | "untracked" | "deleted" | "renamed" | "unmerged";

export interface RepoManifestEntry {
  id: string;
  agent: string | null;
  ownerId?: string;
  kind?: RepoKind;
  lifecycle?: RepoLifecycle;
  label: string;
  path: string;
  remote: string;
  visibility: "public" | "private" | "local";
  required: boolean;
}

export interface RepoManifest {
  version: 1 | 2;
  root: string;
  generatedAt: string;
  targets: RepoManifestEntry[];
}

export interface GitControlScanResponse {
  schemaVersion: 2;
  observation: {
    state: ObservationState;
    observedAt: string | null;
    reasonCode: string | null;
  };
  repositories: PublicRepositorySnapshot[];
}

export interface PublicRepositorySnapshot {
  repoId: string;
  label: string;
  kind: RepoKind;
  ownerId: string;
  lifecycle: RepoLifecycle;
  availability: "git_repository" | "uninitialized_directory" | "missing" | "unknown";
  observation: { state: ObservationState; observedAt: string; reasonCode: string | null };
  repoTruth: {
    state: RepoTruthState;
    changeCount: number;
    conflictCount: number;
    changes: Array<{ path: string; status: ChangeStatus }>;
  };
  branch: { state: "attached" | "detached" | "unborn" | "unknown"; name: string | null };
  pushability: {
    state: PushabilityState;
    commitCount: number;
    ahead: number;
    behind: number;
    reasonCode: string | null;
  };
  actions: {
    commit: { state: "enabled" | "disabled"; reasonCode: string | null };
    push: { state: "enabled" | "disabled"; reasonCode: string | null };
  };
}

export interface GitControlRepoDetailResponse {
  schemaVersion: 2;
  repository: PublicRepositorySnapshot;
  stashCount: number;
}
```

Keep version 1 fixture compatibility through optional display metadata. The production default manifest must explicitly write version 2 and all metadata.

- [ ] **Step 4: Update the production manifest classification**

Replace `version: 1` with `version: 2` and add the exact `ownerId`, `kind`, and `lifecycle` values from the approved design table. Do not add publication routes or runtime service IDs.

- [ ] **Step 5: Build the safe service projection**

Replace `dashboard + cards` in `GitControlService.scan()` with one projection. Normalize legacy fixture metadata only in the projection:

```ts
function manifestDisplay(target: RepoManifestEntry): {
  ownerId: string;
  kind: RepoKind;
  lifecycle: RepoLifecycle;
} {
  return {
    ownerId: target.ownerId ?? target.agent?.toLowerCase() ?? target.id,
    kind: target.kind ?? "business",
    lifecycle: target.lifecycle ?? "active",
  };
}
```

Flatten dirty buckets to relative change entries, calculate `repoTruth`, derive branch state, and derive pushability independently of dirty state. `push` is enabled only when pushability is `pushable`; `commit` is enabled only for a verified attached Git repository with changed paths and no unmerged paths.

Change `repoDetail()` to return the same public repository projection plus only `stashCount`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- tests/repoScanner.test.ts tests/gitControlService.test.ts
```

Expected: PASS.

---

### Task 2: Isolate repository scan failures and remove filesystem gating

**Files:**
- Modify: `src/gitboard/types.ts`
- Modify: `src/gitboard/repoScanner.ts`
- Test: `tests/repoScanner.test.ts`
- Test: `tests/gitControlService.test.ts`

**Interfaces:**
- Consumes: `RepoSnapshot` and existing read-only `GitProxy` methods.
- Produces: per-target `observationState` and `observationReasonCode` used by the Task 1 public projection.

- [ ] **Step 1: Write failing isolation tests**

Add tests proving:

```ts
expect(git.listLargeFiles).not.toHaveBeenCalled();
expect(results[0]).toMatchObject({ observationState: "unverified" });
expect(results[1]).toMatchObject({ observationState: "verified", id: "healthy-repo" });
expect(indexLockSnapshot).toMatchObject({
  observationState: "unverified",
  exists: true,
});
```

Use one target whose `statusPorcelain` throws `fatal: Unable to create .git/index.lock` and one target that returns a valid porcelain response. Also cover an existing non-Git directory as verified and initializable.

- [ ] **Step 2: Run the tests and confirm failure**

Run:

```bash
npm test -- tests/repoScanner.test.ts tests/gitControlService.test.ts
```

Expected: FAIL because one unexpected target error currently rejects the scan and the scanner calls `listLargeFiles`.

- [ ] **Step 3: Add internal observation fields**

Extend `RepoSnapshot`:

```ts
observationState: "verified" | "unverified";
observationReasonCode: string | null;
```

Successful, missing-path, and verified non-Git snapshots use `verified`. Index-lock, permission, unreadable-directory, and unexpected Git failures use `unverified` and preserve unknown Git truth.

- [ ] **Step 4: Remove large-file enumeration from the canonical scanner**

Change the scan Promise to read only status, last commit, diff stat, and stash list. Preserve `dirty.largeFiles: []` internally for historical dashboard type compatibility; do not call `GitProxy.listLargeFiles`.

- [ ] **Step 5: Make every target return a result**

Limit missing-repository classification to deterministic missing-path and non-Git cases. Replace the final `throw` with an unverified snapshot:

```ts
return unverifiedRepoSnapshot(target, "REPO_SCAN_FAILED");
```

An index-lock message must not match missing-repository logic. A remote probe failure continues to preserve local observation and maps only pushability to unknown.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- tests/repoScanner.test.ts tests/gitControlService.test.ts
```

Expected: PASS with partial failure isolation and no large-file call.

---

### Task 3: Add task intent and path-selection declaration to finalization

**Files:**
- Modify: `src/gitboard/finalizationContracts.ts`
- Modify: `src/gitboard/finalizationPlanStore.ts`
- Modify: `src/gitboard/finalizationService.ts`
- Test: `tests/finalizationService.test.ts`

**Interfaces:**
- Consumes: existing `CommitProposal`, `PushProposal`, plan/attempt/receipt stores, and v1.4 checks.
- Produces: `PathSelectionDeclaration`, nullable task metadata on records, and four new stable rejection codes.

- [ ] **Step 1: Write failing proposal-validation tests**

Add tests for:

```ts
await expect(service.prepareCommit(repoId, {
  selectedPaths,
  commitMessage: "feat: exact",
  source: "codex",
  selectionDeclaration: "exact_paths",
})).rejects.toMatchObject({ code: "FINALIZATION_TASK_INTENT_REQUIRED" });

await expect(service.prepareCommit(repoId, {
  selectedPaths,
  commitMessage: "feat: mixed",
  source: "codex",
  taskIntentId: "agent14/web-publish",
  selectionDeclaration: "mixed_or_indeterminate",
})).rejects.toMatchObject({ code: "MIXED_PATH_REQUIRES_OWNER_SPLIT" });

expect(await store.status("operation-1")).toMatchObject({
  plan: null,
  attempt: {
    taskIntentId: "agent14/web-publish",
    resultCode: "MIXED_PATH_REQUIRES_OWNER_SPLIT",
  },
});
```

Also prove:

- Codex commit with task intent but no declaration is rejected;
- manual commit without task intent remains valid and stores null metadata;
- manual commit with task intent requires a declaration;
- Codex push requires task intent but no path declaration;
- task intent survives successful commit and failed execution receipts.

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
npm test -- tests/finalizationService.test.ts
```

Expected: FAIL because proposals and records do not carry or validate the new metadata.

- [ ] **Step 3: Extend finalization contracts additively**

Add:

```ts
export type PathSelectionDeclaration = "exact_paths" | "mixed_or_indeterminate";

taskIntentId?: string; // proposals
selectionDeclaration?: PathSelectionDeclaration; // commit proposal

taskIntentId?: string | null; // attempts/plans/receipts for old-record compatibility
selectionDeclaration?: "exact_paths" | null; // commit plans
```

Do not change existing store file formats or introduce migration files.

- [ ] **Step 4: Validate metadata before Git inspection**

Implement bounded helpers:

```ts
const TASK_INTENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/;

function normalizeTaskIntentId(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!TASK_INTENT_ID.test(value)) {
    throw new FinalizationError("FINALIZATION_TASK_INTENT_INVALID");
  }
  return value;
}
```

Validation order:

1. normalize source (`undefined` becomes `manual`);
2. normalize task intent;
3. require task intent for Codex;
4. for commit, require declaration for Codex or any task-associated manual proposal;
5. reject `mixed_or_indeterminate` before `git.inspectCommit`;
6. create the attempt with normalized metadata;
7. continue existing v1.4 inspection and plan creation.

- [ ] **Step 5: Propagate metadata through all terminal paths**

Copy nullable task intent into commit/push plans, attempts, success receipts, and execution-failure receipts. Copy `exact_paths` into commit plans. Missing old values normalize to null when read publicly.

Update `persistedAttempt()` in `finalizationPlanStore.ts` to retain
`taskIntentId: attempt.taskIntentId ?? null`; the existing completion record
continues to merge over the persisted attempt and needs no schema change.

- [ ] **Step 6: Run focused finalization tests**

Run:

```bash
npm test -- tests/finalizationService.test.ts
```

Expected: PASS, including all existing v1.4 drift and push tests.

---

### Task 4: Freeze HTTP request parsing and public finalization DTOs

**Files:**
- Modify: `src/gitboard/finalizationContracts.ts`
- Modify: `src/gitboard/gitControlHttpServer.ts`
- Modify: `src/gitboard/gitControlService.ts`
- Test: `tests/gitControlHttpServer.test.ts`
- Test: `tests/gitControlService.test.ts`

**Interfaces:**
- Consumes: Task 1 scan/detail DTOs and Task 3 finalization records.
- Produces: exact `PublicFinalizationStatus` and `PublicFinalizationConfirmation` projections.

- [ ] **Step 1: Write failing HTTP shape tests**

Update scan/detail expectations to the Task 1 DTOs. Add exact expectations for:

```ts
interface PublicFinalizationStatus {
  schemaVersion: 2;
  operationId: string;
  state: "ready" | "confirmed" | "consumed" | "rejected" | "failed" | "succeeded";
  outcome: FinalizationOutcome;
  resultCode: string;
  attempt: {
    operation: "commit" | "push";
    repoId: string;
    proposalSource: "codex" | "manual";
    taskIntentId: string | null;
    createdAt: string;
    completedAt: string | null;
  };
  plan: PublicFinalizationPlan | null;
  receipt: PublicFinalizationReceipt | null;
}
```

Prove prepare and execute return this same shape, confirm returns:

```ts
{
  schemaVersion: 2,
  operationId: "op-1",
  state: "confirmed",
  confirmationToken: "token",
  expiresAt: "..."
}
```

Prove no response contains canonical path, remote URL, stash message, raw output, token digest, plan digest, or selected-state digest.

- [ ] **Step 2: Run HTTP/service tests and confirm failure**

Run:

```bash
npm test -- tests/gitControlService.test.ts tests/gitControlHttpServer.test.ts
```

Expected: FAIL because prepare/execute currently return internal plan/receipt shapes and status lacks schema version, attempt metadata, and task fields.

- [ ] **Step 3: Parse the new proposal fields exactly**

Extend request parsing so commit accepts `taskIntentId` and
`selectionDeclaration`, and push accepts `taskIntentId`. Reject non-string or
unknown declaration values with bounded finalization errors. Do not infer or
rewrite task IDs.

- [ ] **Step 4: Implement one public status projection**

Implement typed projection helpers from the approved spec. Normalize absent
old-record fields to null. Commit plans expose only relative selected paths,
selection declaration, message, rationale, branch/HEAD/source/task/expiry.
Push plans omit remote URL/ref/OID. Receipts omit `outputSummary`.

- [ ] **Step 5: Make prepare/status/execute return one status shape**

After successful prepare, fetch `finalizationStatus(plan.operationId)` and
return its public projection. After execute, fetch status by receipt operation
ID and return the same projection. GET status uses the same helper. Confirm adds
only schema version and the literal `confirmed` state to its existing token
response.

- [ ] **Step 6: Productize service-level failures**

For scan failures return the schema-2 unverified envelope with
`repositories=[]` and a bounded reason code. Existing finalization errors keep
their operation ID and outcome mapping; add `proposal_rejected` mapping for the
new validation codes without exposing raw exception details.

- [ ] **Step 7: Run focused HTTP/service tests**

Run:

```bash
npm test -- tests/gitControlService.test.ts tests/gitControlHttpServer.test.ts
```

Expected: PASS.

---

### Task 5: Minimal regression and cross-task handoff

**Files:**
- Verify only: all files changed by Tasks 1-4
- Coordinate: Web task `01a01a15-a6ea-7751-a5a4-ea21b1366034`

**Interfaces:**
- Consumes: complete Agent08 public contract.
- Produces: verified backend test report and exact DTO handoff for Web integration.

- [ ] **Step 1: Run the complete affected Agent08 test set**

Run:

```bash
npm test -- tests/repoScanner.test.ts tests/gitControlService.test.ts tests/finalizationService.test.ts tests/gitControlHttpServer.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Check patch formatting**

Run:

```bash
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 4: Send the verified contract to the Web owner**

Send:

```text
changed Agent08 files
exact scan/detail/finalization DTOs
new validation/error codes
focused test counts and typecheck result
whether a fresh local 3108 build/runtime is available for integration
```

- [ ] **Step 5: Run bounded local integration only if both implementations are ready**

Use a temporary or explicitly controlled Agent08 process and the Web task's
documented local test route. Verify:

```text
scan schemaVersion=2
web-platform kind=platform
no absolute path in browser payload
manual draft starts 0/N selected
dirty repository can still show push enabled when commits are pushable
unverified clears repository state
Codex operation restore shows taskIntentId and exact selected paths
```

Do not restart persistent services or execute commit/push during integration.

- [ ] **Step 6: Report without Git mutation**

List changed files, tests, skipped integration with reason if either side is not
ready, and remaining user-test caveats. Do not stage, commit, or push.

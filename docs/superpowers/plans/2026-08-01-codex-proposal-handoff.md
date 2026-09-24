# Codex Proposal Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agent08 reliably present and execute exact Codex or explicit manual commit/push proposals, without deriving commit intent from all dirty files or requiring users to diagnose raw finalization failures.

**Architecture:** Existing `prepare` routes remain the local proposal ingress. Agent08 records proposal source and a secret-free terminal attempt record before any finalization plan exists, while preserving v1.4's immutable plan, confirmation, recheck, and fixed Git execution. Shared Web renders an existing proposal by operation ID and offers a deliberate empty-selection manual fallback; it never classifies files or silently repairs stale proposals.

**Tech Stack:** TypeScript, Node.js HTTP, Vitest, Node built-in test runner, existing Agent08 file-backed finalization store, shared Web `server.mjs` proxy.

## Global Constraints

- Preserve v1.4 canonical-path, allowlist, exact-HEAD, selected-content digest, secret scan, single-use confirmation, fixed `commit --only`, fixed non-force push, and postcondition checks.
- Agent08 must not infer what project files should be committed, mutate an invalid proposal, clean/stash/rebase, or add any GitHub credential route.
- A changed proposal always requires a fresh Codex/manual proposal and a new user confirmation; no automatic commit or push retry is permitted.
- Browser responses and persisted records remain secret-free: no tokens, raw file contents, credentials, command output, or absolute paths.
- Keep Agent08 changes in `/Users/tristanzh/agent/agent08-gitboard` and Web changes in `/Users/tristanzh/agent/web`; test each repository from its own cwd.
- Any final Git commit or push must use the Agent08 prepare/confirm flow; do not run direct Git mutation commands.

---

### Task 1: Typed proposal source and queryable preparation attempts

**Files:**

- Modify: `src/gitboard/finalizationContracts.ts`
- Modify: `src/gitboard/finalizationPlanStore.ts`
- Modify: `src/gitboard/finalizationService.ts`
- Modify: `tests/finalizationPlanStore.test.ts`
- Modify: `tests/finalizationService.test.ts`

**Interfaces:**

- Consumes: existing `CommitProposal`, `PushPlan`, `FinalizationPlanStore`, and `FinalizationError`.
- Produces: `ProposalSource`, `PushProposal`, `FinalizationAttempt`, and `FinalizationStatus` with a safe `outcome`; `prepareCommit` and `preparePush` record both ready and rejected preparation attempts.

- [ ] **Step 1: Write failing store tests for a plan-less rejected preparation and a ready proposal.**

  Add fixtures that assert an attempt is immutable, has no raw detail, and can be read even when no plan exists:

  ```ts
  await store.createAttempt({
    schemaVersion: 1,
    operationId: "attempt-1",
    operation: "commit",
    repoId: "agent08-gitboard",
    proposalSource: "codex",
    status: "rejected",
    outcome: "proposal_rejected",
    resultCode: "FINALIZATION_SECRET_DETECTED",
    createdAt: "2026-08-01T00:00:00.000Z",
    completedAt: "2026-08-01T00:00:00.000Z",
  });
  await expect(store.status("attempt-1")).resolves.toMatchObject({
    status: "rejected",
    plan: null,
    attempt: { outcome: "proposal_rejected", resultCode: "FINALIZATION_SECRET_DETECTED" },
  });
  ```

- [ ] **Step 2: Run the focused store test and verify it fails because attempts and plan-less status do not exist.**

  Run: `npm test -- tests/finalizationPlanStore.test.ts`

  Expected: FAIL with missing `createAttempt` or an incompatible `FinalizationStatus` shape.

- [ ] **Step 3: Add the minimal contract and store support.**

  In `finalizationContracts.ts`, add bounded public fields and keep all existing plan fields unchanged:

  ```ts
  export type ProposalSource = "codex" | "manual";
  export type FinalizationOutcome =
    | "ready_for_confirmation"
    | "proposal_stale"
    | "proposal_rejected"
    | "confirmation_expired"
    | "execution_failed"
    | "committed"
    | "pushed";

  export interface PushProposal {
    expectedHead?: string;
    source?: ProposalSource;
  }

  export interface FinalizationAttempt {
    schemaVersion: 1;
    operationId: string;
    operation: FinalizationOperation;
    repoId: string;
    proposalSource: ProposalSource;
    status: "ready" | "rejected" | "failed" | "succeeded";
    outcome: FinalizationOutcome;
    resultCode: string;
    createdAt: string;
    completedAt: string | null;
  }
  ```

  Add `proposalSource: ProposalSource` to `CommitProposal`, `CommitPlan`, and `PushPlan`; make the externally supplied proposal source optional at the HTTP boundary but resolve it deterministically in the service. Extend `FinalizationStatus` to contain `attempt: FinalizationAttempt` and `plan: FinalizationPlan | null`.

  In `FinalizationPlanStore`, add `storage/finalization/attempts/<operationId>.json`, `createAttempt`, `completeAttempt`, and a `status` path that first resolves an attempt and then optionally reads a plan/receipt. Do not add raw error details to the attempt file.

- [ ] **Step 4: Run the focused store test and verify it passes.**

  Run: `npm test -- tests/finalizationPlanStore.test.ts`

  Expected: PASS.

- [ ] **Step 5: Write failing service tests for source propagation and rejected prepare audit.**

  Extend the finalization fixture with deterministic operation IDs and assert both cases:

  ```ts
  const prepared = await fixture.service.prepareCommit("agent08-gitboard", {
    selectedPaths: commitInspection.selectedPaths,
    commitMessage: "feat(agent08): proposal handoff",
    source: "codex",
  });
  expect(prepared.proposalSource).toBe("codex");

  await expect(fixture.service.prepareCommit("agent08-gitboard", {
    selectedPaths: ["missing.ts"],
    commitMessage: "test",
    source: "manual",
  })).rejects.toMatchObject({ code: "FINALIZATION_PATH_UNCHANGED" });
  await expect(fixture.store.status("operation-2")).resolves.toMatchObject({
    status: "rejected",
    attempt: { proposalSource: "manual", outcome: "proposal_rejected" },
  });
  ```

- [ ] **Step 6: Run the focused service test and verify it fails.**

  Run: `npm test -- tests/finalizationService.test.ts`

  Expected: FAIL because plans have no proposal source and prepare errors do not have attempts.

- [ ] **Step 7: Implement preparation attempts and safe outcome mapping in the service.**

  Generate the operation ID before final Git inspection, create a `ready` attempt only after the proposal's structural fields are valid, and complete it as `ready_for_confirmation` after storing the plan. On `FinalizationError`, complete the attempt with `proposal_rejected`; on unexpected errors, complete it with `execution_failed` and rethrow the existing bounded error. Attach only the generated `operationId` to `FinalizationError`, never its raw detail.

  Extend push preparation to accept `PushProposal`. When a Codex push proposal supplies `expectedHead`, require it to be a full OID equal to the inspected HEAD; a manual proposal may omit it. Persist `proposalSource` on the push plan.

- [ ] **Step 8: Run focused Agent08 contract tests and typecheck.**

  Run: `npm test -- tests/finalizationPlanStore.test.ts tests/finalizationService.test.ts && npm run typecheck`

  Expected: PASS.

- [ ] **Step 9: Finalize this task only through Agent08 after review.**

  Prepare an exact Agent08 commit proposal containing only the Task 1 files, inspect its immutable plan in Gitboard, and use the local user confirmation surface. Do not use direct `git add` or `git commit`.

### Task 2: Proposal-aware HTTP contract and bounded error/status presentation

**Files:**

- Modify: `src/gitboard/gitControlService.ts`
- Modify: `src/gitboard/gitControlHttpServer.ts`
- Modify: `tests/gitControlService.test.ts`
- Modify: `tests/gitControlHttpServer.test.ts`

**Interfaces:**

- Consumes: Task 1's `ProposalSource`, `PushProposal`, status attempt, and error operation ID.
- Produces: source-aware prepare routes and safe response bodies containing `operationId`, `outcome`, `resultCode`, and bounded state class.

- [ ] **Step 1: Write failing HTTP tests for Codex/manual proposals and a stale error.**

  Add a commit request with source and a push request with expected HEAD:

  ```ts
  body: {
    selectedPaths: ["src/app.ts"],
    commitMessage: "feat: final proposal",
    expectedHead: "a".repeat(40),
    source: "codex",
  }
  ```

  Stub a finalization error with `operationId: "op-stale"`, then require this secret-free response:

  ```ts
  expect(response.body).toEqual({
    error: {
      code: "FINALIZATION_SELECTED_STATE_DRIFT",
      operationId: "op-stale",
      outcome: "proposal_stale",
      title: "Proposal needs refresh",
      summary: "The approved selected content changed before finalization.",
      suggestedAction: "Ask Codex to prepare a new proposal, then review and confirm it.",
    },
  });
  ```

- [ ] **Step 2: Run the focused HTTP tests and verify they fail.**

  Run: `npm test -- tests/gitControlHttpServer.test.ts tests/gitControlService.test.ts`

  Expected: FAIL because source/push proposal fields and bounded outcome output are absent.

- [ ] **Step 3: Implement input parsing and finite error mapping.**

  Add `source` to `toCommitProposal` and a `toPushProposal` parser. Permit only `codex` and `manual`; default omitted source to `codex` for backwards-compatible Codex callers. Make `GitControlService.preparePush(repoId, proposal)` forward the parsed proposal.

  Replace the universal finalization response with an allowlisted mapper:

  ```ts
  function publicFinalizationOutcome(code: string): FinalizationOutcome {
    if (["FINALIZATION_SELECTED_STATE_DRIFT", "FINALIZATION_HEAD_DRIFT", "FINALIZATION_BRANCH_DRIFT", "FINALIZATION_REMOTE_DRIFT"].includes(code)) return "proposal_stale";
    if (["FINALIZATION_PLAN_EXPIRED", "FINALIZATION_CONFIRMATION_EXPIRED"].includes(code)) return "confirmation_expired";
    return "execution_failed";
  }
  ```

  Keep `code` for machine clients, but render only fixed copy selected by outcome. Include `operationId` only when the error carries one. Never serialize `error.message` or `detail`.

- [ ] **Step 4: Run focused HTTP/service tests and typecheck.**

  Run: `npm test -- tests/gitControlHttpServer.test.ts tests/gitControlService.test.ts && npm run typecheck`

  Expected: PASS.

- [ ] **Step 5: Finalize this task through the Agent08 confirmation flow.**

  Submit only the Task 2 source and test files as an exact proposal, review the plan, and confirm it in Gitboard.

### Task 3: Gitboard renders Codex proposals and has an explicit manual fallback

**Files:**

- Modify: `/Users/tristanzh/agent/web/app/agent08.js`
- Modify: `/Users/tristanzh/agent/web/tests/agent08-service.test.mjs`

**Interfaces:**

- Consumes: `GET /api/git-control/finalizations/:operationId` and source-aware prepare responses from Task 2 through the existing Web proxy.
- Produces: a proposal status panel, URL-addressable operation restoration, and manual commit construction with no implicit path selection.

- [ ] **Step 1: Write failing Web source-level tests for the required boundaries.**

  Assert that the client restores an operation by ID, sends manual source explicitly, and has no implicit checked selection:

  ```js
  assert.match(source, /new URLSearchParams\(window\.location\.search\)\.get\("operationId"\)/);
  assert.match(source, /source:\s*"manual"/);
  assert.match(source, /selectedFiles instanceof Set \? selectedFiles : new Set\(\)/);
  assert.doesNotMatch(source, /const checked = !selected \|\| selected\.has\(file\.path\)/);
  assert.match(source, /\/api\/git-control\/finalizations\/\$\{encodeURIComponent\(operationId\)\}/);
  ```

- [ ] **Step 2: Run the focused Web test and verify it fails.**

  Run: `node --test tests/agent08-service.test.mjs`

  Expected: FAIL because the UI defaults every file to checked and does not restore proposal status.

- [ ] **Step 3: Implement proposal restoration and manual selection discipline.**

  On boot, read optional `operationId` from the current URL. Fetch its status through the existing same-origin Git Control proxy and initialize `pendingMutation` from `status.plan`; never recreate `selectedPaths` from current scan data. Render source, selected paths, commit message, short HEAD, expiry, and the bounded outcome.

  For user-initiated manual commit, initialize the selected set as empty. Keep checkbox changes as explicit input, post `source: "manual"`, and show the existing empty-selection validation until paths are deliberately chosen. Post `{ source: "manual" }` for a manual push.

  Replace generic finalization copy with UI copy keyed only by server `outcome`:

  ```js
  const outcomeCopy = {
    proposal_stale: "提案已失效；请由 Codex 生成新的提交或推送提案。",
    confirmation_expired: "确认已过期；请重新确认未变化的提案。",
    execution_failed: "Git 执行未完成；请查看此提案的安全状态后重试。",
  };
  ```

  Do not render raw error messages, selected file contents, token data, absolute paths, or a client-side automatic retry.

- [ ] **Step 4: Run the focused Web test and syntax check.**

  Run: `node --test tests/agent08-service.test.mjs && node --check app/agent08.js`

  Expected: PASS.

- [ ] **Step 5: Finalize Web changes through Agent08 only after scoped review.**

  In the `web-platform` card, submit exactly `app/agent08.js` and `tests/agent08-service.test.mjs` (plus any approved, directly related contract test) as a proposal. Do not absorb concurrent Agent13 or runtime-log changes.

### Task 4: End-to-end contract coverage and documented Codex handoff

**Files:**

- Modify: `docs/sdd/git-control-v1.4-finalization.md`
- Modify: `docs/sdd/git-control-v1.4.1-codex-proposal-handoff.md`
- Modify: `tests/finalizationService.test.ts`
- Modify: `tests/gitControlHttpServer.test.ts`
- Modify: `/Users/tristanzh/agent/web/tests/agent08-service.test.mjs`

**Interfaces:**

- Consumes: Tasks 1-3.
- Produces: locked acceptance evidence for proposal source, stale-plan refusal, clean push semantics, and user-visible recoverability.

- [ ] **Step 1: Add failing cross-layer acceptance cases.**

  Add one case per invariant:

  ```ts
  // Agent08: selected state changed after confirmation.
  expect(status.attempt.outcome).toBe("proposal_stale");
  expect(status.receipt?.resultCode).toBe("FINALIZATION_SELECTED_STATE_DRIFT");

  // Agent08: dirty files do not change an exact push plan.
  expect(prepared.expectedHead).toBe(head);
  expect(prepared).not.toHaveProperty("dirty");
  ```

  In the Web test, assert proposal status copy exists and that neither `.ralc-logs` nor another file pattern is classified by the UI; exclusion is a Codex/manual proposal decision, not a Gitboard heuristic.

- [ ] **Step 2: Run the affected tests and verify at least the new assertions fail before implementation is complete.**

  Run from Agent08: `npm test -- tests/finalizationService.test.ts tests/gitControlHttpServer.test.ts`

  Run from Web: `node --test tests/agent08-service.test.mjs`

  Expected: failure until all Task 1-3 code is present.

- [ ] **Step 3: Complete the focused documentation and make acceptance names exact.**

  In `git-control-v1.4-finalization.md`, add a short normative reference to v1.4.1 stating that `/commit/prepare` and `/push/prepare` are proposal ingress only, and that the UI must not derive a default commit set from the dirty scan. Keep v1.4 as the base contract; do not duplicate or alter its safety invariants.

  In the v1.4.1 document, replace `implementation not yet started` with its completed status only after all checks below pass. Do not mark the design complete before executable evidence exists.

- [ ] **Step 4: Run complete affected verification.**

  Run from Agent08:

  ```bash
  npm test -- tests/finalizationPlanStore.test.ts tests/finalizationService.test.ts tests/gitControlService.test.ts tests/gitControlHttpServer.test.ts
  npm run typecheck
  ```

  Run from Web:

  ```bash
  node --test tests/agent08-service.test.mjs
  node --check server.mjs
  node --check app/agent08.js
  ```

  Expected: all commands exit 0. Do not run unrelated full suites unless a changed contract test explicitly requires them.

- [ ] **Step 5: Perform a manual local acceptance without mutating Git.**

  In `/agent08`, open a known Codex-originated operation ID and confirm the page displays its exact immutable plan. Verify a stale fixture/status renders `提案已失效` and no token, raw error detail, or absolute path. Verify manual mode opens with no file checkbox selected. This step must not click final confirmation or issue a Git mutation.

- [ ] **Step 6: Finalize documentation and implementation in separately scoped Agent08 proposals.**

  Prepare an Agent08 proposal for the exact Agent08 files, then a separate `web-platform` proposal for exact Web files. Review selected paths, test evidence, and plan digest before each local user confirmation. Push only the verified resulting commit, using a separately confirmed push plan.

# Agent08 Git Control v1.4 Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace development-time worktree governance with a thin, deterministic final commit and push control plane driven by Codex proposals.

**Architecture:** Codex proposes selected paths, messages, and push intent. Agent08 persists an immutable plan, separately records local-operator confirmation, re-verifies Git state, invokes one fixed typed Git command sequence, and persists a receipt. Existing dashboard reads remain, while mutation HTTP exposure is reduced to commit and push.

**Tech Stack:** TypeScript 5.7, Node.js filesystem/crypto/child_process, Git CLI, Vitest.

## Global Constraints

- Development files, dirty state, local worktrees, and orchestration remain outside Agent08 control.
- Agent08 exposes only final `commit` and `push` mutations.
- Model proposals are inputs, never deterministic evidence.
- No raw command, argv, cwd, remote, refspec, force, or environment field is accepted.
- Existing unrelated dirty files are preserved.
- This task does not perform a repository commit or push.

---

### Task 1: Contract and immutable plan store

**Files:**
- Create: `src/gitboard/finalizationContracts.ts`
- Create: `src/gitboard/finalizationPlanStore.ts`
- Test: `tests/finalizationPlanStore.test.ts`

**Interfaces:**
- Produces: `CommitProposal`, `CommitPlan`, `PushPlan`, `FinalizationReceipt`, `FinalizationError`, and `FinalizationPlanStore`.

- [x] **Step 1: Write failing store tests**

Test exclusive immutable plan creation, separate confirmation, token expiry,
single-use consumption, and secret-free receipts.

- [x] **Step 2: Verify RED**

Run: `npm test -- --run tests/finalizationPlanStore.test.ts`
Expected: FAIL because the store modules do not exist.

- [x] **Step 3: Implement minimal persistent records**

Use SHA-256 token hashes and exclusive JSON files under
`storage/finalization/{plans,confirmations,consumptions,receipts}`.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- --run tests/finalizationPlanStore.test.ts`
Expected: all store tests pass.

### Task 2: Deterministic Git adapter

**Files:**
- Create: `src/gitboard/finalizationGit.ts`
- Test: `tests/finalizationGit.test.ts`

**Interfaces:**
- Produces: `FinalizationGit`, `RealFinalizationGit`, `inspectCommit`,
  `commitSelected`, `inspectPush`, and `pushExact`.

- [x] **Step 1: Write failing adapter tests**

Test safe path validation, selected-state digest stability, blocked secrets,
`git commit --only`, exact non-force push refspec, and rejection of unsafe
branches/remotes.

- [x] **Step 2: Verify RED**

Run: `npm test -- --run tests/finalizationGit.test.ts`
Expected: FAIL because the adapter does not exist.

- [x] **Step 3: Implement typed Git operations**

Build all Git argv internally. Read selected state using `status`, `diff`, and
filesystem hashes. Execute commit with `add -A` plus `commit --only`; execute
push with one full-OID refspec.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- --run tests/finalizationGit.test.ts`
Expected: all adapter tests pass.

### Task 3: Finalization service and HTTP contract

**Files:**
- Create: `src/gitboard/finalizationService.ts`
- Modify: `src/gitboard/gitControlService.ts`
- Modify: `src/gitboard/gitControlHttpServer.ts`
- Test: `tests/finalizationService.test.ts`
- Modify: `tests/gitControlHttpServer.test.ts`
- Modify: `tests/gitControlService.test.ts`

**Interfaces:**
- Produces: `prepareCommit`, `preparePush`, `confirmFinalization`,
  `executeFinalization`, and `finalizationStatus`.

- [x] **Step 1: Write failing service and route tests**

Cover proposal binding, no confirmation at prepare, drift blocking,
dirty-worktree push allowance, exact receipt persistence, and 404 for legacy
mutation routes.

- [x] **Step 2: Verify RED**

Run: `npm test -- --run tests/finalizationService.test.ts tests/gitControlHttpServer.test.ts`
Expected: FAIL on missing finalization methods and routes.

- [x] **Step 3: Implement service orchestration**

Resolve the manifest entry server-side, prepare immutable plans, confirm
separately, consume before command, re-inspect state, verify postconditions, and
record typed success or failure receipts.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- --run tests/finalizationService.test.ts tests/gitControlHttpServer.test.ts tests/gitControlService.test.ts`
Expected: all finalization service and route tests pass.

### Task 4: Direct consumer and product boundary

**Files:**
- Modify: `src/gitboard/gitControlCardModel.ts`
- Modify: `tests/gitControlCardModel.test.ts`
- Modify: `/Users/tristanzh/agent/web/app/agent08.js`
- Modify: `/Users/tristanzh/agent/web/tests/agent08-service.test.mjs`
- Modify: `AGENTS.md`
- Modify: `/Users/tristanzh/agent/AGENTS.md`
- Modify: `/Users/tristanzh/agent/agent-tooling/docs/git-operations-sovereignty.md`

**Interfaces:**
- Consumes: finalization HTTP routes from Task 3.
- Produces: UI proposal submission, explicit confirmation call, execution call,
  and governance aligned to commit/push-only Agent08 scope.

- [x] **Step 1: Write failing card and direct-consumer tests**

Expect only commit/push actions and the prepare-confirm-execute request flow.

- [x] **Step 2: Verify RED**

Run: `npm test -- --run tests/gitControlCardModel.test.ts`
and from `/Users/tristanzh/agent/web` run the targeted Agent08 service test file.
Expected: FAIL on legacy actions and request flow.

- [x] **Step 3: Update product boundary**

Remove legacy mutation action exposure, send the Codex/UI proposal during
prepare, and call confirm before execute. Update authority prose so development
state is outside Agent08 while commit/push remain controlled.

- [x] **Step 4: Verify GREEN**

Run the same targeted Agent08 and Web tests.
Expected: all affected direct-consumer tests pass.

### Task 5: Final verification

**Files:**
- Review all changed files above.

- [x] **Step 1: Run Level 4 verification**

Run the Agent08 full suite because the finalization change affects the core Git
permission and data-integrity boundary, plus the direct Web consumer tests.

- [x] **Step 2: Run static gates**

Run `npm run typecheck`, `npm run build`, `git diff --check`, and deterministic
source searches proving production service/HTTP code has no Phase C dependency.

- [x] **Step 3: Review the approved SDD**

Check every acceptance item in `docs/sdd/git-control-v1.4-finalization.md`
against executed tests and source evidence; report any skipped check.

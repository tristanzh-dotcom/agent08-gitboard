# Agent14 双仓库 Git Control 最终化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Agent08 内补齐 Agent14 发布所需的 Git Control 合同，使
`agent14-ppt2html` 与 `web-platform` 按 `repository + task/intent` 形成两个
相互独立的 proposal、confirmation 和 receipt；对无法证明为单一意图的
mixed path fail closed；将仓库真实状态、任务选中状态、可推送提交状态和
观测是否可信明确分离。

**Architecture:** Agent08 是唯一的 Git Control 合同、方案持久化、确认和
执行实现位置。Agent14 业务仓库与 Web 仓库只作为被扫描、被提案、被验证的
目标仓库，不在其中加入 Git Control 逻辑。一个 finalization operation 只
绑定一个 allowlisted `repoId`，即使两个仓库属于同一个发布意图，也不建立
跨仓库原子事务；它们必须各自 prepare、确认、execute 并产生 receipt。

**Tech Stack:** 现有 TypeScript、Node.js HTTP、Vitest、文件型
finalization stores，以及 Agent08 v1.4 的 immutable plan、single-use
confirmation、preflight recheck 和固定 Git 执行路径。

## Global Constraints

- 本方案只允许在 `/Users/tristanzh/agent/agent08-gitboard` 落地；不得修改
  `/Users/tristanzh/agent/agent14-ppt2html` 或 `/Users/tristanzh/agent/web`。
- 当前执行只准备方案和必要的 Agent08 设计合同，不执行 commit、push、
  branch、stash、reset、rebase、remote 配置或其他 Git 写操作。
- 保留 v1.4 的 canonical path、allowlist、branch/HEAD、selected-content
  digest、secret scan、single-use confirmation、执行前 re-scan、commit
  postcondition 和 non-force push 约束。
- `repoId + taskIntentId` 是 proposal 的语义边界，但不是跨仓库事务 ID。
  一个 proposal 不得包含两个 `repoId`；相同的 `taskIntentId` 可以关联两个
  receipt，但不能共享 confirmation token 或 execute 调用。
- 提交集合只能来自 owning Codex/Agent 提供的精确 `selectedPaths`。Agent08
  不得把所有 dirty paths 自动变成 proposal，不得按文件名、文本、Agent 名称
  或模型推断进行语义分类。
- 当前 Agent08 只有 path-level exact selection。一个文件中若混有 Agent13
  与 Agent14 hunks，不能把整文件当成任一任务的安全提交集合。该 proposal
  必须在 prepare 前停止；由 owning Codex/Agent 完成可验证的拆分后，以新的
  HEAD、精确路径集合和新的 proposal 重新开始。Agent08 只验证路径、内容
  digest 和 Git 身份，不把 owning Agent 的语义声明渲染为自身已经证明。
- Agent08 服务不可达或扫描失败时，Web/卡片只能呈现 `unverified`，不得复用
  stale snapshot，也不得宣称 clean、dirty、task-clean、pushable 或
  current。
- Agent14 Web 的“三栏、独立后端、8114、same-origin proxy”等功能发布
  授权不等于 Git Control 实现授权；Git Control 相关行为仍需遵守本方案和
  material product change 设计批准闸门。
- 保留目标仓库现有的并发 dirty/untracked 变化；Git Control 只处理本次
  immutable proposal 明确选中的内容。

## Current Baseline and Evidence

截至 2026-08-19，本地可见状态如下；这些是方案输入，不是可用于执行的
live receipt：

- Agent14 业务仓库当前包含 `.gitignore`、设计文档、README、package、
  `src/*`、`test/*` 和 `tools/extract_document.py` 的业务变更；其本地
  `npm test` 为 9/9 通过。
- Web 当前同时包含 Agent13-only、Agent14-only 和 mixed/shared 变更。
  Agent14 focused tests 为 3/3 通过，`node --check server.mjs` 与
  `git diff --check` 通过。
- 可确定的 Web 归属：Agent14-only 为
  `app/agent14.css`、`app/agent14.js`、
  `config/agents/agent14.contract.json`、
  `docs/agents/agent14-publishing-config.md`、
  `tests/agent14-proxy.test.mjs`、
  `tests/agent14-runtime-registration.test.mjs`、
  `tests/agent14-service.test.mjs`；Agent13-only 为
  `app/agent13.css`、`app/agent13.js`、
  `tests/agent13-content-layout.test.mjs`、
  `tests/agent13-tab5-browse-browser.test.mjs`。
- `server.mjs`、`config/platform-agent-runtime.json`、
  `config/platform-backend-processes.json` 及
  `tests/agent-boundary-contract.test.mjs`、
  `tests/new-agent-publishing-contract.test.mjs`、
  `tests/platform-home-service.test.mjs`、
  `tests/platform-region-contract-browser.test.mjs` 是 mixed/shared，不能
  由 GitBoard 自动归入 Agent14。
- `127.0.0.1:3108` 当前无监听，`/api/git-control/scan` 不可达。因此本方案
  不把任何旧卡片、旧快照或本地推断当作当前 Git truth。
- Agent08 manifest 已有 `agent14-ppt2html` 和 `web-platform` 两个
  allowlisted target；实现阶段仍需用读取 manifest 的测试锁定 canonical
  identity，不得通过 Web 或目标仓库旁路注册。

## Task 1: Freeze the Agent14 dual-repository finalization contract

**Files:**

- Add: `docs/sdd/git-control-agent14-dual-repo-finalization.md`
- Read: `docs/sdd/git-control-v1.4-finalization.md`
- Read: `docs/sdd/git-control-v1.4.1-codex-proposal-handoff.md`

- [ ] **Step 1: Record the two repository identities and operation boundary.**

  The contract must name only these two targets for this workflow:

  | repoId | canonical target | operation rule |
  | --- | --- | --- |
  | `agent14-ppt2html` | `/Users/tristanzh/agent/agent14-ppt2html` | independent commit/push proposal |
  | `web-platform` | `/Users/tristanzh/agent/web` | independent commit/push proposal |

  The canonical path and remote remain resolved from the Agent08 manifest. A
  proposal may reference only one row. A shared `taskIntentId` is correlation
  metadata only; there is no “publish both” execute endpoint and no all-or-none
  receipt.

- [ ] **Step 2: Define how the selected file set is formed.**

  The owning Codex/Agent supplies `selectedPaths` for one repository and an
  opaque `taskIntentId`. Agent08 normalizes and validates those paths against
  the selected-content digest and current HEAD. It does not inspect filenames
  to decide ownership and does not add dirty paths that were not proposed.

  For this publication, the intended proposals are separate in substance:

  - Agent14 business proposal: only the Agent14 business changes that the owner
    explicitly selects in `agent14-ppt2html`.
  - Web proposal: only Agent14-only Web paths that the owner explicitly selects;
    mixed/shared Web files are not eligible until the owning work is split and a
    fresh proposal is produced.

- [ ] **Step 3: Define independent confirmation and receipts.**

  Each repository gets its own operation ID, immutable plan, confirmation
  token, preflight recheck, commit/push result, and receipt. A confirmation for
  `agent14-ppt2html` must fail closed if presented to a `web-platform`
  operation, even when both operations share a task intent. Receipts must carry
  `repoId`, `taskIntentId` when supplied, operation ID, exact selected-path
  digest, resulting OID/ref, and bounded outcome only.

- [ ] **Step 4: Define the mixed-path gate without a semantic classifier.**

  The contract must distinguish these cases:

  1. `exact_paths`: the owner has produced a repository state in which the
     selected path set is safe to propose at path granularity; Agent08 may
     continue with its existing path/digest checks.
  2. `mixed_or_indeterminate`: a selected file contains changes from more than
     one task or its ownership cannot be established; Agent08 must reject
     preparation with a bounded `MIXED_PATH_REQUIRES_OWNER_SPLIT` outcome and
     persist no executable plan or confirmation.

  The second value is a fail-closed guard, not a claim that GitBoard has
  semantically classified the file. The owner must split the work into
  disjoint exact paths or otherwise produce an independently verifiable
  repository state, then submit a new proposal. No stale proposal may be
  widened or retried automatically.

- [ ] **Step 5: Keep the material-change gate explicit.**

  Before implementation changes the public Agent08 contract or card state,
  review this design against the v1.4 contract and record TZ approval for the
  observable state/wording change. This plan itself does not authorize Web UI
  edits, Agent14 behavior changes, or Git execution.

## Task 2: Add an Agent08-only verified/unverified state model

**Files:**

- Modify: `src/gitboard/types.ts`
- Modify: `src/gitboard/repoScanner.ts`
- Modify: `src/gitboard/dashboardService.ts`
- Modify: `src/gitboard/gitControlCardModel.ts`
- Modify: `src/gitboard/gitControlHttpServer.ts`
- Test: `tests/repoScanner.test.ts`
- Test: `tests/dashboardService.test.ts`
- Test: `tests/gitControlCardModel.test.ts`
- Test: `tests/gitControlHttpServer.test.ts`

- [ ] **Step 1: Introduce separate typed state dimensions.**

  Add an additive, secret-free model equivalent to:

  ```ts
  type ObservationState = "verified" | "unverified";
  type RepoTruthState = "clean" | "dirty" | "unknown";
  type TaskSelectionState = "none" | "selected" | "stale" | "unknown";
  type PushabilityState = "pushable" | "not_pushable" | "unknown";

  interface GitControlState {
    observationState: ObservationState;
    repoTruth: RepoTruthState;
    taskSelection: TaskSelectionState;
    pushability: PushabilityState;
  }
  ```

  Preserve existing internal fields where compatibility requires them, but do
  not derive one `dirtyLine` from task selection or pushability. `unknown` is
  valid only when `observationState` is `unverified` or an operation has become
  stale.

- [ ] **Step 2: Make scan success and service failure distinguishable.**

  A successful Agent08 scan returns `observationState: "verified"` and the
  actual repository truth. A failed/unavailable scan returns a bounded
  `state: "unverified"` response with no target snapshots, no old counts, no
  current branch claim, and no pushability claim. It must not cache a successful
  scan as if it were current.

- [ ] **Step 3: Render the three user-facing states independently.**

  When verified, the card may say, for example, “仓库有 8 项未提交变化；本
  任务已选择 3 个文件；可推送 1 个提交”. When the repository is clean, it
  must say “仓库干净”，而不是 dirty. When no task paths are selected, it must
  say “本任务未选择文件”，而不是把仓库 dirty count 当成任务变更。When
  unverified, it must say “Agent08 状态未验证”，并隐藏或禁用依赖当前扫描的
  clean/dirty/pushable 操作。

- [ ] **Step 4: Add regression tests for stale and unavailable states.**

  Cover: successful clean scan, successful dirty scan with no task selection,
  selected task whose content digest changes, pushable commits with unrelated
  dirty files, unavailable HTTP service, and absence of stale target data in the
  unavailable response. Assert that `unknown` never renders as clean or dirty.

- [ ] **Step 5: Run the focused Agent08 tests before changing any other surface.**

  Run:

  ```sh
  npm test -- tests/repoScanner.test.ts tests/dashboardService.test.ts \
    tests/gitControlCardModel.test.ts tests/gitControlHttpServer.test.ts
  npm run typecheck
  ```

  Expected: all focused tests pass and TypeScript exits 0. A failure is a
  contract blocker and must not be worked around by weakening the unavailable
  state.

## Task 3: Enforce repository-plus-intent proposal isolation

**Files:**

- Modify only if required by the approved contract: `src/gitboard/finalizationContracts.ts`
- Modify only if required by the approved contract: `src/gitboard/finalizationService.ts`
- Test: `tests/finalizationService.test.ts`
- Test: `tests/finalizationPlanStore.test.ts`
- Test: `tests/gitControlHttpServer.test.ts`

- [ ] **Step 1: Add bounded intent metadata without creating a batch transaction.**

  Carry a validated opaque `taskIntentId` through commit/push proposal,
  immutable plan, public status, and receipt. Keep `repoId` authoritative from
  the route/service call and reject a proposal that attempts to name a second
  repository. Do not add a multi-repository plan store key or an execute-both
  route.

- [ ] **Step 2: Test the two Agent14 operations with the same intent.**

  Prepare one operation for `agent14-ppt2html` and one for `web-platform` using
  the same intent ID. Assert distinct operation IDs, plans, confirmations,
  selected-content digests, and receipts. Execute each only with its own
  confirmation. Assert that a token or plan from one repo cannot execute the
  other repo.

- [ ] **Step 3: Test exact selection and unrelated dirty preservation.**

  Supply a proposal containing an explicit subset of changed paths and assert
  that no other dirty or untracked path enters the immutable plan or commit
  postcondition. Keep this test at path granularity; do not add semantic
  classification to make the assertion pass.

- [ ] **Step 4: Test stale proposal behavior.**

  Change selected content, HEAD, branch, or remote identity after prepare and
  before execute. Assert `proposal_stale`, no automatic refresh, no widened
  selection, no retry, and no receipt claiming a commit/push.

- [ ] **Step 5: Run the finalization isolation tests and typecheck.**

  Run:

  ```sh
  npm test -- tests/finalizationService.test.ts \
    tests/finalizationPlanStore.test.ts tests/gitControlHttpServer.test.ts
  npm run typecheck
  ```

  Expected: PASS with each repository independently auditable.

## Task 4: Make mixed/shared Web paths fail closed

**Files:**

- Modify only if required by the approved contract: `src/gitboard/finalizationContracts.ts`
- Modify only if required by the approved contract: `src/gitboard/finalizationService.ts`
- Test: `tests/finalizationService.test.ts`
- Test: `tests/gitControlHttpServer.test.ts`
- Add only if the existing test layout cannot express the cases:
  `tests/finalizationMixedPath.test.ts`

- [ ] **Step 1: Add a bounded mixed/indeterminate rejection path.**

  If the owning proposal identifies a selected file as
  `mixed_or_indeterminate`, return `MIXED_PATH_REQUIRES_OWNER_SPLIT`. Do not
  create a plan, confirmation token, commit, push, or success receipt. Do not
  expose raw diff content or absolute paths in the browser error.

- [ ] **Step 2: Add tests using the actual shared Web examples.**

  Exercise `server.mjs` and at least one shared config/test path as mixed and
  assert fail closed. Exercise Agent14-only paths as eligible only when the
  owner supplies an exact-path proposal. The test must prove that GitBoard does
  not silently absorb Agent13 hunks and does not infer ownership from the
  filename.

- [ ] **Step 3: Verify the owner-split restart rule.**

  After a simulated owner split, use a fresh proposal with a fresh selected
  digest and assert that the old rejected proposal cannot be upgraded or
  reused. If the file remains mixed or the evidence is absent, reject again.

- [ ] **Step 4: Keep semantic verification outside the GitBoard claim.**

  The API/status wording must say that the proposal was accepted for exact path
  processing, not that Agent08 proved business ownership of every hunk. Do not
  add a model-generated classifier, automatic hunk attribution, or a fallback
  that selects the whole file.

## Task 5: Lock the two allowlisted targets and live-evidence behavior

**Files:**

- Read: `src/gitboard/manifest.ts`
- Test: `tests/dashboardService.test.ts`
- Test: `tests/repoScanner.test.ts`
- Modify only if the allowlist regression is real: `src/gitboard/manifest.ts`

- [ ] **Step 1: Assert both target IDs resolve through the Agent08 manifest.**

  Verify `agent14-ppt2html` resolves to the Agent14 business repository and
  `web-platform` resolves to `/Users/tristanzh/agent/web`, with their configured
  allowlisted remotes. Do not duplicate this identity in Web or Agent14.

- [ ] **Step 2: Assert scan output is repository-scoped.**

  A successful scan has one snapshot per target and never merges dirty counts
  or selected paths across the two repositories. A failed scan has no usable
  target snapshot and is explicitly `unverified`.

- [ ] **Step 3: Add the 3108 unavailable regression.**

  With the Agent08 HTTP server unavailable, assert bounded `503`/service-error
  behavior and `unverified` state. Do not start a long-lived service as part of
  this preparation, and do not use a prior response to fill the fields.

## Task 6: Verification and release gates for a later implementation run

- [ ] **Step 1: Run Agent08 focused tests and typecheck from its own cwd.**

  Run the affected Vitest files, then `npm run typecheck` and `git diff --check`.
  Read the complete output and report any skipped tests with their reason.

- [ ] **Step 2: Verify target repositories independently, read-only.**

  From each target repository, capture its own status and focused business/Web
  tests only after Agent08 has a verified scan. Do not use a Web snapshot as a
  substitute for Agent08 Git truth.

- [ ] **Step 3: Require live Agent08 evidence before any finalization claim.**

  Once `127.0.0.1:3108` is intentionally restored by its owner, a fresh scan
  must report both target IDs, canonical identity, branch/HEAD, selected state,
  and pushability. If it is still unavailable, the only valid report is
  `unverified`; no clean/dirty or pushable conclusion is allowed.

- [ ] **Step 4: Keep actual Git finalization outside this preparation run.**

  A later, separately authorized run may use Agent08's prepare → local
  confirmation → execute flow for each repository. This plan does not stage,
  commit, push, alter remotes, or create a cross-repo publication receipt.

## Acceptance Criteria

- The Agent08 contract states that `agent14-ppt2html` and `web-platform` are two
  independent finalization units, even when correlated by one task intent.
- No proposal can turn all repository dirty paths into the task's selected
  set, and no confirmation/receipt can cross repository boundaries.
- A known or declared mixed/shared path fails closed until the owning
  Codex/Agent produces a fresh, verifiable split and new proposal.
- Repo truth, task selection, pushability, and observation confidence are
  separate fields and separate user-facing messages.
- Agent08 unavailable means `unverified` with no stale clean/dirty/pushable
  claims.
- No Git Control code, contract, or plan is added to Agent14 or Web, and this
  preparation run performs no commit or push.

## Scope Exclusions

- No implementation of Agent14 business conversion, HTML/PPT rendering,
  Web UI/backend lifecycle, Obsidian persistence, or proxy behavior.
- No changes to Agent13 or Agent14 files in the shared Web worktree.
- No semantic ownership classifier, hunk auto-selection, whole-file fallback,
  cross-repository transaction, force push, remote reconfiguration, or direct
  shell/Git execution surface.
- No claim that current Agent08 live state is clean, dirty, task-clean, or
  pushable while port 3108 is not listening.

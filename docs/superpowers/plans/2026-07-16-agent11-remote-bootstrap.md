# Agent11 Remote Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely publish Agent11's existing local commit history to a newly created private GitHub repository through Agent08 Git Control.

**Architecture:** GitHub repository creation happens once through the authenticated `gh` client. Agent08 gains a small `configure_origin` mutation that derives the only permissible URL from the Agent11 manifest target; all local Git remote and push writes remain behind existing preflight and confirmation gates.

**Tech Stack:** TypeScript, Vitest, Agent08 Git Control HTTP service, GitHub CLI.

## Global Constraints

- Canonical ID and GitHub name: `agent11-fishtank-monitor`.
- Create a private empty GitHub repository under `tristanzh-dotcom`.
- Do not create another commit or include the five later working-tree modifications.
- Never invoke raw local Git write commands; route remote configuration and push through Agent08.
- `configure_origin` accepts only the manifest-defined remote URL and only when `origin` is absent.
- `bootstrap_push` alone may push while dirty, and only for a new remote branch with no local upstream; it never stages or commits files.

---

### Task 1: Add the scoped origin-configuration contract

**Files:**
- Modify: `src/gitboard/manifest.ts`
- Modify: `src/gitboard/mutationGitProxy.ts`
- Modify: `src/gitboard/mutationSafetyGate.ts`
- Modify: `src/gitboard/gitControlService.ts`
- Modify: `src/gitboard/gitControlHttpServer.ts`
- Test: `tests/mutationGitProxy.test.ts`
- Test: `tests/mutationSafetyGate.test.ts`
- Test: `tests/gitControlService.test.ts`
- Test: `tests/gitControlHttpServer.test.ts`

**Interfaces:**
- Produces `configure_origin` as an allowlisted Agent08 mutation and HTTP route `/api/git-control/repos/:id/configure-origin`.
- `MutationGitProxy.configureOrigin({ repoPath, remoteUrl })` invokes only `git remote add origin <manifest remote>`.
- `MutationSafetyGate.assertAllowed` permits origin configuration only for a Git repository with an HTTPS manifest remote; `MutationGitProxy` rejects an existing `origin` before adding it.

- [ ] **Step 1: Write failing tests**

Add assertions that `configure_origin` is recognized, invokes `remote add origin https://github.com/tristanzh-dotcom/agent11-fishtank-monitor.git`, rejects pre-existing origins and empty/non-HTTPS manifest remotes, and routes through HTTP. Add assertions that `bootstrap_push` is the only dirty-tree push exception and accepts only a new remote branch without upstream.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `npm test -- tests/mutationGitProxy.test.ts tests/mutationSafetyGate.test.ts tests/gitControlService.test.ts tests/gitControlHttpServer.test.ts`

Expected: failures because `configure_origin` is not yet an accepted operation or route.

- [ ] **Step 3: Implement the minimal mutation path**

Add the mutation operation, derive the remote from the target manifest rather than request data, add safe-state validation, service dispatch, and HTTP route mapping. Productize unsafe attempts with a dedicated safety error.

- [ ] **Step 4: Run focused tests to verify green**

Run the Step 2 command. Expected: all selected tests pass.

### Task 2: Validate the shared Web action surface

**Files:**
- Modify: `/Users/tristanzh/agent/web/app/agent08.js`
- Test: `/Users/tristanzh/agent/web/tests/agent08-service.test.mjs`

**Interfaces:**
- `routeOperation("configure_origin")` resolves to `configure-origin`.
- UI labels the action `Configure origin` and continues using existing safety confirmation UI.

- [ ] **Step 1: Write failing static contract tests**

Assert the Agent08 front end recognizes the new operation and route.

- [ ] **Step 2: Run the Web test to verify failure**

Run: `node --test /Users/tristanzh/agent/web/tests/agent08-service.test.mjs`

Expected: failure due to absent operation mapping.

- [ ] **Step 3: Implement the route and copy**

Add only operation-to-route mapping and user-facing label; reuse the existing preflight confirmation behavior.

- [ ] **Step 4: Run the Web test to verify green**

Run the Step 2 command. Expected: all tests pass.

### Task 3: Create and publish Agent11 remote state

**Files:**
- Modify: `docs/superpowers/specs/2026-07-16-agent11-remote-bootstrap-design.md`

**Interfaces:**
- Creates `https://github.com/tristanzh-dotcom/agent11-fishtank-monitor.git` as private and empty.
- Agent08 prepare/mutate `configure-origin` adds the manifest-derived origin.
- Agent08 prepare/mutate `bootstrap-push` publishes existing `main` without staging the dirty worktree.

- [ ] **Step 1: Create the private empty GitHub repository**

Run: `gh repo create tristanzh-dotcom/agent11-fishtank-monitor --private --disable-issues --disable-wiki --confirm`

Expected: GitHub returns its repository URL; no local Git mutation is performed by this command.

- [ ] **Step 2: Configure origin through Agent08**

POST to Agent08's `configure-origin/prepare`, then POST its one-time confirmation token to `configure-origin` without accepting a client-provided URL.

Expected: local `origin` equals the manifest URL.

- [ ] **Step 3: Push existing main through Agent08**

POST `bootstrap-push/prepare`, then POST its one-time token to `bootstrap-push`.

Expected: `main` is upstream-tracked as `origin/main`; no second commit is created.

- [ ] **Step 4: Run acceptance checks**

Verify GitHub visibility is private, Agent08 scan reports `origin/main`, `git log -1` remains `f46fd6b`, and the five known modified files remain dirty.

### Task 4: Full verification

**Files:**
- Verify: `src/gitboard/**`, `tests/**`, `/Users/tristanzh/agent/web/app/agent08.js`, `/Users/tristanzh/agent/web/tests/agent08-service.test.mjs`

- [ ] **Step 1: Run Agent08 complete verification**

Run: `npm test && npm run typecheck && npm run build && git diff --check`

Expected: all tests, type checking, build, and whitespace check pass.

- [ ] **Step 2: Run shared Web verification**

Run: `node --test /Users/tristanzh/agent/web/tests/agent08-service.test.mjs && node --check /Users/tristanzh/agent/web/server.mjs`

Expected: Web contract tests and syntax validation pass.

- [ ] **Step 3: Record completion evidence**

Report the GitHub URL, controlled operation outcomes, preserved dirty files, and verification results. Do not stage, commit, or push Agent08/Web source changes unless separately directed.

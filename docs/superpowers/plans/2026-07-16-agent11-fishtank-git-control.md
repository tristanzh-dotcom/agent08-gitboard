# Agent11 Fishtank Monitor Git Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register Agent11's actual project directory in Agent08 and let its Agent08 card safely initialize a local Git repository before using ordinary Git Control.

**Architecture:** `RepoScanner` adds an explicit `initializable` snapshot state for an existing non-Git directory. Agent08's typed mutation stack adds `init_repository`, which only runs the fixed local `git init --initial-branch=main` command after the existing preflight-token safety gate. The shared Web `/agent08` renderer consumes the dynamic card response and needs no Agent11-specific route.

**Tech Stack:** TypeScript ESM, Node.js `fs/promises`, Vitest, shared Web Node test runner, existing Agent08 Git Control HTTP API.

## Global Constraints

- Canonical repository ID: `agent11-fishtank-monitor`; display identity: `Agent11`; project path: `/Users/tristanzh/agent/agent11-fishtank-monitor`.
- Do not use the stale shorthand `agent11-fish-monitor`.
- Initialization is local only: no GitHub repository creation, remote configuration, push, or initial commit.
- Only Agent08's typed mutation proxy may execute `git init`; Web remains rendering/proxy only.
- All mutation requests require a fresh preflight snapshot and matching one-time confirmation token.
- Preserve existing unrelated dirty changes in `agent08-gitboard` and `/Users/tristanzh/agent/web`.
- Never run `git add`, `git commit`, or any direct Git write from the shell. Any later commit must be performed through the Agent08 Git Control surface with a deliberately selected file list.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/gitboard/types.ts` | Represents the initializable state in a repository snapshot. |
| `src/gitboard/manifest.ts` | Registers Agent11 using its actual directory and local-only visibility. |
| `src/gitboard/repoScanner.ts` | Separates an existing non-Git directory from a missing directory. |
| `src/gitboard/mutationGitProxy.ts` | Owns fixed `git init` argument construction. |
| `src/gitboard/mutationSafetyGate.ts` | Applies allowlist, token, and initializable-state checks for `init_repository`. |
| `src/gitboard/gitControlService.ts` | Preflights and executes the typed init operation. |
| `src/gitboard/gitControlHttpServer.ts` | Maps the stable `/init` API route to `init_repository` and returns productized errors. |
| `src/gitboard/gitControlCardModel.ts` | Shows an enabled `init_repository` action only for the initializable state. |
| `../web/app/agent08.js` | Gives the new operation a stable route and human-readable confirmation label. |
| `docs/sdd/git-control-v1.2.1-commit-safety.md` | Records the new local-only initialization contract. |

## Task 1: Register Agent11 and model an initializable directory

**Files:**
- Modify: `src/gitboard/types.ts`
- Modify: `src/gitboard/manifest.ts`
- Modify: `src/gitboard/repoScanner.ts`
- Modify: `tests/repoScanner.test.ts`
- Modify: `tests/dirtyScanner.test.ts`
- Modify: `tests/dashboardService.test.ts`

**Interfaces:**
- Produces `RepoSnapshot.initializable: boolean`.
- Produces the manifest entry `{ id: "agent11-fishtank-monitor", agent: "Agent11", label: "Fishtank Monitor", path: "${base}/agent11-fishtank-monitor", remote: "", visibility: "local", required: true }`.
- Later tasks consume `snapshot.initializable === true` as the only pre-init state.

- [ ] **Step 1: Write failing manifest and scanner tests**

Add an Agent11 expectation to the manifest/dashboard tests and add a scanner test whose Git proxy throws `fatal: not a git repository` while the injected directory probe returns `true`:

```ts
expect(createDefaultManifest("/Users/tristanzh/agent").targets).toContainEqual(
  expect.objectContaining({
    id: "agent11-fishtank-monitor",
    agent: "Agent11",
    path: "/Users/tristanzh/agent/agent11-fishtank-monitor",
    visibility: "local",
    remote: "",
  }),
);

expect(snapshot).toMatchObject({
  exists: false,
  initializable: true,
  branch: null,
  upstream: null,
});
```

Update the existing scan-summary assertions from 10 to 11 and assert the Agent11 target is present.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm test -- tests/repoScanner.test.ts tests/dirtyScanner.test.ts tests/dashboardService.test.ts
```

Expected: failures naming the missing Agent11 target and missing `initializable` snapshot field; existing unrelated tests remain unmodified.

- [ ] **Step 3: Add the minimal snapshot and scanner implementation**

Insert this field immediately after `exists: boolean;` in `RepoSnapshot`:

```ts
initializable: boolean;
```

Change the missing-snapshot function signature and add the returned field immediately after `exists: false,`:

```ts
function missingRepoSnapshot(target: RepoManifestEntry, initializable = false): RepoSnapshot {
}

initializable,
```

Inject a directory probe into `RepoScanner` with `exists: async (path) => stat(path).then(() => true, () => false)`. In the `not a git repository` catch path, call that probe and return `missingRepoSnapshot(target, directoryExists)`. Keep `ENOENT`, stale-index-lock, and other existing missing behavior at `initializable: false`.

Append this manifest target immediately after Agent10:

```ts
{
  id: "agent11-fishtank-monitor",
  agent: "Agent11",
  label: "Fishtank Monitor",
  path: `${base}/agent11-fishtank-monitor`,
  remote: "",
  visibility: "local",
  required: true,
},
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
npm test -- tests/repoScanner.test.ts tests/dirtyScanner.test.ts tests/dashboardService.test.ts
```

Expected: all three files pass, with the default scan returning 11 targets and no regression to missing-directory handling.

## Task 2: Add the local-only `init_repository` safety contract

**Files:**
- Modify: `src/gitboard/mutationGitProxy.ts`
- Modify: `src/gitboard/mutationSafetyGate.ts`
- Modify: `src/gitboard/gitControlService.ts`
- Modify: `src/gitboard/gitControlHttpServer.ts`
- Modify: `tests/mutationGitProxy.test.ts`
- Modify: `tests/mutationSafetyGate.test.ts`
- Modify: `tests/gitControlService.test.ts`
- Modify: `tests/gitControlHttpServer.test.ts`

**Interfaces:**
- Consumes `RepoSnapshot.initializable` from Task 1.
- Produces `MutationGitOperation = ... | "init_repository"`.
- Produces `MutationGitProxy.initRepository({ repoPath: string }): Promise<string>`.
- Exposes `POST /api/git-control/repos/:repoId/init/prepare` and `POST /api/git-control/repos/:repoId/init`.

- [ ] **Step 1: Write failing proxy, safety, service, and HTTP tests**

Add one test per boundary:

```ts
await proxy.initRepository({ repoPath: "/tmp/agent11" });
expect(calls).toEqual([["init", "--initial-branch=main"]]);

expect(() => safetyGate.assertCanMutate({
  repoId: "agent11-fishtank-monitor",
  repoPath: "/Users/tristanzh/agent/agent11-fishtank-monitor",
  operation: "init_repository",
  preflightSnapshotId: "snap-1",
  confirmationToken,
  currentSnapshot: snapshot({ exists: false, initializable: true, branch: null }),
})).not.toThrow();

await expect(service.mutate("agent11-fishtank-monitor", "init_repository", prepared)).resolves.toMatchObject({
  ok: true,
  operation: "init_repository",
});

expect(await dispatchGitControlHttpRequest(service, {
  method: "POST",
  path: "/api/git-control/repos/agent11-fishtank-monitor/init/prepare",
  body: {},
})).toMatchObject({ status: 200, body: { operation: "init_repository" } });
```

Add negative assertions that `initializable: false` and `exists: true` both throw `REPOSITORY_INIT_NOT_ALLOWED`, and that a stale/mismatched confirmation token invokes no Git command.

- [ ] **Step 2: Run the mutation-contract tests and verify RED**

Run:

```bash
npm test -- tests/mutationGitProxy.test.ts tests/mutationSafetyGate.test.ts tests/gitControlService.test.ts tests/gitControlHttpServer.test.ts
```

Expected: failures because `init_repository`, the proxy method, and the `/init` route do not yet exist.

- [ ] **Step 3: Implement the fixed initialization path**

Append the literal member to `MutationGitOperation`, add the same literal to `ALLOWED_MUTATION_OPERATIONS`, then add the typed proxy method:

```ts
| "init_repository";

async initRepository(input: RepoPathMutationInput): Promise<string> {
  return this.#runner.runGit(input.repoPath, ["init", "--initial-branch=main"]);
}
```

In `MutationSafetyGate.assertCanMutate`, keep repo/token checks first. For `init_repository`, require `!currentSnapshot.exists && currentSnapshot.initializable`, return immediately on success, and throw `new MutationSafetyError("REPOSITORY_INIT_NOT_ALLOWED")` otherwise. Do not apply the branch, upstream, dirty-worktree, merge, or rebase gates to this pre-Git state.

In `GitControlService`, accept the operation in `assertMutationOperation`, save the preflight snapshot, and dispatch `init_repository` to `mutationProxy.initRepository({ repoPath: snapshot.path })`. Mark its preflight `worktreeState` as `initializable` and provide this warning in `prepareMutationDetails`:

```ts
warning: "This initializes a local Git repository only. It does not create a remote, push, or commit files.",
```

Map HTTP route segment `init` to `init_repository`. Add `REPOSITORY_INIT_NOT_ALLOWED` handling with title `Repository initialization unavailable`, summary `The selected directory is not eligible for local Git initialization.`, and suggested action `Rescan the directory and use initialization only before it becomes a Git repository.`

- [ ] **Step 4: Run the mutation-contract tests and verify GREEN**

Run:

```bash
npm test -- tests/mutationGitProxy.test.ts tests/mutationSafetyGate.test.ts tests/gitControlService.test.ts tests/gitControlHttpServer.test.ts
```

Expected: all focused tests pass; command capture proves the only initialization command is `git init --initial-branch=main` and no remote, push, or commit command is emitted.

## Task 3: Surface the initialization action in Git Control and Web

**Files:**
- Modify: `src/gitboard/gitControlCardModel.ts`
- Modify: `tests/gitControlCardModel.test.ts`
- Modify: `/Users/tristanzh/agent/web/app/agent08.js`
- Modify: `/Users/tristanzh/agent/web/tests/agent08-service.test.mjs`

**Interfaces:**
- Consumes `GitControlActionId = ... | "init_repository"` and `snapshot.initializable`.
- Consumes the HTTP route segment `init` from Task 2.
- Produces the dynamic Agent11 action button and its existing confirmation flow on `/agent08`.

- [ ] **Step 1: Write failing card and shared-Web tests**

Add a card-model test:

```ts
expect(buildGitControlCardModel(snapshot({
  exists: false,
  initializable: true,
  branch: null,
}))).toMatchObject({
  blockedReason: null,
  actions: [{ id: "init_repository", enabled: true }],
});
```

Add a shared Web fixture with `agent11-fishtank-monitor` as the selected card and assert its rendered `/agent08` response contains both `data-agent08-detail-repo="agent11-fishtank-monitor"` and `data-agent08-action="init_repository"`. Add source checks for `routeOperation("init_repository") === "init"` and the label `Initialize repository`.

- [ ] **Step 2: Run the UI tests and verify RED**

Run:

```bash
npm test -- tests/gitControlCardModel.test.ts
node --test /Users/tristanzh/agent/web/tests/agent08-service.test.mjs
```

Expected: failures because an initializable snapshot currently has a detached-HEAD blocker and no `init_repository` route/label.

- [ ] **Step 3: Implement the minimal card and client behavior**

Extend the action union and add this branch before detached-head blocking:

```ts
if (snapshot.initializable) {
  return {
    actions: [{ id: "init_repository", enabled: true }],
    blockedReason: null,
    dirtyLine: "not initialized",
    selfMutationWarning: null,
    stashLine: null,
    statusLine: "local directory · Git not initialized",
  };
}
```

In `web/app/agent08.js`, map `init_repository` to `init` and label it without changing the existing generic prepare/confirm workflow:

```js
if (operation === "init_repository") return "init";

if (operation === "init_repository") return "Initialize repository";
```

Do not add Agent11-specific CSS, routes, or platform-home entries; the existing card loop and post-mutation refresh must remain the only rendering path.

- [ ] **Step 4: Run the UI tests and verify GREEN**

Run:

```bash
npm test -- tests/gitControlCardModel.test.ts
node --test /Users/tristanzh/agent/web/tests/agent08-service.test.mjs
```

Expected: Agent11's dynamic card renders the initialization action and the existing confirmation controls remain present for all operations.

## Task 4: Record the contract and run end-to-end acceptance

**Files:**
- Modify: `docs/sdd/git-control-v1.2.1-commit-safety.md`
- Modify: `docs/superpowers/specs/2026-07-16-agent11-fishtank-git-control-design.md` only if implementation reveals an approved wording correction
- Modify: generated `dist/gitboard/*` through `npm run build`

**Interfaces:**
- Consumes the behavior delivered by Tasks 1–3.
- Produces the compiled Agent08 service and documented local-only initialization boundary.

- [ ] **Step 1: Add the approved SDD addendum**

Add a short `init_repository` section that states all of the following: it is limited to a manifest-listed existing non-Git directory; it uses a fresh preflight and one-time confirmation token; its fixed command is `git init --initial-branch=main`; it never creates remotes, pushes, or commits; a rescan must complete before normal card actions are offered.

- [ ] **Step 2: Run the complete automated verification suite**

Run:

```bash
npm test
npm run typecheck
npm run build
node --check /Users/tristanzh/agent/web/server.mjs
node --test /Users/tristanzh/agent/web/tests/agent08-service.test.mjs
```

Expected: all Agent08 tests pass, type checking exits 0, build updates tracked `dist/gitboard/*` artifacts, and the shared Web syntax/service test passes.

- [ ] **Step 3: Execute real local initialization through Agent08**

Start the rebuilt Agent08 service using its documented `serve:git-control` command, fetch the Agent11 card from `GET /api/git-control/scan`, and verify it reports `initializable: true`. Invoke the `/init/prepare` endpoint, submit the returned one-time token to `/init`, then fetch a fresh scan.

Expected before mutation: Agent11 is `initializable: true` with exactly one `init_repository` action. Expected after mutation: `/Users/tristanzh/agent/agent11-fishtank-monitor/.git` exists, the fresh snapshot has `exists: true`, `initializable: false`, `branch: "main"`, and the card offers ordinary `commit` behavior for the existing untracked project files. Verify no `origin` remote exists and no commit was created.

- [ ] **Step 4: Inspect the final change boundary**

Run:

```bash
git diff --check
git status --short
git -C /Users/tristanzh/agent/agent11-fishtank-monitor status --short
git -C /Users/tristanzh/agent/agent11-fishtank-monitor remote -v
git -C /Users/tristanzh/agent/agent11-fishtank-monitor log -1 --oneline
```

Expected: no whitespace errors; only planned files plus pre-existing unrelated dirty files are changed; Agent11 has a local Git worktree with no remote and no initial commit.

## Plan self-review

- Spec coverage: Task 1 registers the actual directory and preserves missing-directory behavior; Task 2 confines initialization to Agent08's typed, confirmed mutation path; Task 3 proves the dynamic Web card; Task 4 records and proves the local-only acceptance boundary.
- Placeholder scan: this document contains no deferred implementation markers or unspecified handlers.
- Type consistency: all layers use the same operation identifier, `init_repository`; only the HTTP route uses the deliberately separate `init` path segment.

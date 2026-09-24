# Agent11 Extension Web/Git Control Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the local `agent11-fishtank-extension` repository in the existing Agent08 Git Control service so it is visible through the Web `/agent08` console.

**Architecture:** Agent08 remains the sole Git Control owner. The Web platform already proxies the dynamic Agent08 scan and does not need a new firmware route, backend port, or API. The extension is registered as a local repository with no claimed remote; commit remains available through the existing finalization boundary while push stays disabled until a real remote is explicitly configured.

**Tech Stack:** TypeScript, Vitest, compiled Agent08 service, Web platform HTTP proxy.

**Spec:** `docs/sdd/git-control-v1.4-finalization.md`, with the existing Web publication boundary in `/Users/tristanzh/agent/web/docs/agents/agent12-publishing-config.md` used only as the analogous dynamic-publication reference.

## Global Constraints

- Preserve all pre-existing dirty changes in Agent08 and Web.
- Do not invent or configure a GitHub remote for `agent11-fishtank-extension`.
- Do not add a new Agent11 firmware Web backend, port, API, or product page.
- Keep `include/secrets.hpp`, build output, and other local-only files outside Git Control commit selection through the extension repository's existing `.gitignore`.
- Agent08 finalization remains limited to typed `commit` and `push`; push is unavailable while the target has no verified remote.

---

### Task 1: Add the Git Control registration contract

**Files:**
- Create: `tests/manifest.test.ts`
- Modify: `src/gitboard/manifest.ts`

**Interfaces:**
- Consumes: `createDefaultManifest(root: string)`.
- Produces: one `agent11-fishtank-extension` manifest target with Agent11 ownership, local visibility, active Git Control lifecycle, the canonical workspace path, and an empty remote declaration.

- [ ] **Step 1: Write the failing manifest contract test**

```ts
import { describe, expect, test } from "vitest";
import { createDefaultManifest } from "../src/gitboard/manifest.js";

describe("Agent11 extension Git Control registration", () => {
  test("registers the local extension repository without claiming a remote", () => {
    const manifest = createDefaultManifest("/Users/tristanzh/agent");
    const target = manifest.targets.find((entry) => entry.id === "agent11-fishtank-extension");

    expect(target).toEqual({
      id: "agent11-fishtank-extension",
      agent: "Agent11",
      ownerId: "agent11",
      kind: "business",
      lifecycle: "active",
      label: "Fishtank Extension",
      path: "/Users/tristanzh/agent/agent11-fishtank-extension",
      remote: "",
      visibility: "local",
      required: true,
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails for the missing target**

Run: `npx vitest run tests/manifest.test.ts`

Expected: FAIL because `createDefaultManifest()` does not yet contain `agent11-fishtank-extension`.

- [ ] **Step 3: Add the minimal target after the existing Agent11 monitor target**

Add this exact manifest entry in `src/gitboard/manifest.ts`:

```ts
{
  id: "agent11-fishtank-extension",
  agent: "Agent11",
  ownerId: "agent11",
  kind: "business",
  lifecycle: "active",
  label: "Fishtank Extension",
  path: `${base}/agent11-fishtank-extension`,
  remote: "",
  visibility: "local",
  required: true
},
```

- [ ] **Step 4: Run the focused contract test**

Run: `npx vitest run tests/manifest.test.ts`

Expected: PASS with one test and no failures.

### Task 2: Rebuild the Agent08 service artifact

**Files:**
- Modify: `dist/gitboard/manifest.js` and compiler-generated adjacent Agent08 artifacts as required by the existing build.

**Interfaces:**
- Consumes: the updated `createDefaultManifest()`.
- Produces: the runtime Agent08 service artifact used by Web's existing `/agent08` proxy.

- [ ] **Step 1: Run the Agent08 typecheck and build**

Run: `npm run typecheck`

Expected: exit 0.

Run: `npm run build`

Expected: exit 0 and the generated Agent08 manifest artifact contains `agent11-fishtank-extension`.

### Task 3: Verify Web publication and repository visibility

**Files:**
- No Web source/config files are expected to change; the existing `config/agents/agent08.contract.json` and `/agent08` proxy remain the publication boundary.

**Interfaces:**
- Consumes: the rebuilt Agent08 service and Web's existing Agent08 proxy.
- Produces: a live Git Control scan containing the new local repository and a reachable Web `/agent08` page.

- [ ] **Step 1: Restart only the Agent08 service through the existing local Web lifecycle control if the live service is stale**

Use the existing bounded Agent08 lifecycle path; do not restart the shared Web process unless the Web service itself is unhealthy.

- [ ] **Step 2: Verify the Agent08 backend scan**

Run: `curl --fail --silent http://127.0.0.1:3108/api/git-control/scan`

Expected: `repositories` contains `repoId=agent11-fishtank-extension`, `availability=git_repository`, and a non-pushable local/no-remote state.

- [ ] **Step 3: Verify the Web proxy**

Run: `curl --fail --silent http://127.0.0.1:3000/api/git-control/scan`

Expected: the proxied response contains the same Agent11 extension repository entry.

Run: `curl --fail --silent http://127.0.0.1:3000/agent08`

Expected: the existing Git Control page is served with the Agent08 shell markers.

- [ ] **Step 4: Review final diffs and report unrelated dirty state**

Run: `git diff --check` in Agent08 and `git status --short --branch` in both Agent08 and Web. Do not commit or push these cross-project publication changes without a separate finalization request.

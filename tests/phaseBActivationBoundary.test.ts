import { readFile } from "node:fs/promises";
import { dispatchGitControlHttpRequest } from "../src/gitboard/gitControlHttpServer.js";
import { createDefaultOperationDefinitions } from "../src/gitboard/authorizationPolicy.js";
import { describe, expect, test } from "vitest";

const phaseBSourceFiles = [
  "src/gitboard/machineOperationContracts.ts",
  "src/gitboard/phaseBFileStore.ts",
  "src/gitboard/authorizationPolicy.ts",
  "src/gitboard/policyDecisionStore.ts",
  "src/gitboard/immutablePreflightStore.ts",
  "src/gitboard/machineOperationAuditStore.ts",
  "src/gitboard/executionCapabilityStore.ts",
  "src/gitboard/userConfirmationStore.ts",
  "src/gitboard/worktreeLeaseStore.ts",
  "src/gitboard/machineOperationAuthorizationService.ts",
];

describe("Phase B production activation boundary", () => {
  test("keeps all production operations disabled and does not expose machine HTTP paths", async () => {
    expect(createDefaultOperationDefinitions().every((definition) => definition.runtimeAvailability === "disabled")).toBe(true);
    const response = await dispatchGitControlHttpRequest(
      {
        async scan() { return {}; },
        async repoDetail() { return {}; },
        async prepareCommit() { return {}; },
        async preparePush() { return {}; },
        async confirmFinalization() { return {}; },
        async executeFinalization() { return {}; },
        async finalizationStatus() { return {}; },
      },
      {
        method: "POST",
        path: "/api/git-control/machine/operations/prepare_isolated_worktree",
        body: { principal: { principalId: "untrusted" } },
      },
    );

    expect(response.status).toBe(404);
  });

  test("new Phase B modules cannot reach Git runners, worktree commands, or raw child processes", async () => {
    const source = await Promise.all(phaseBSourceFiles.map((file) => readFile(file, "utf8")));
    const joined = source.join("\n");
    expect(joined).not.toContain("node:child_process");
    expect(joined).not.toContain("MutationGitProxy");
    expect(joined).not.toMatch(/git\s+worktree\s+(add|remove|prune)/);
    expect(joined).not.toContain("managed root");
  });

  test("server main remains disconnected from Phase B coordinator and managed root", async () => {
    const source = await readFile("src/gitboard/gitControlServerMain.ts", "utf8");
    expect(source).not.toContain("machineOperationAuthorizationService");
    expect(source).not.toContain("prepare_isolated_worktree");
    expect(source).not.toContain(".codex/agent08/worktrees");
  });

  test("production server does not construct the Phase C service", async () => {
    const source = await readFile("src/gitboard/gitControlServerMain.ts", "utf8");
    expect(source).not.toContain("phaseCWorktreeService");
    expect(source).not.toContain("createPhaseCWorktreeService");
  });
});

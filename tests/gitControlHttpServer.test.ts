import { describe, expect, test } from "vitest";
import { FinalizationError } from "../src/gitboard/finalizationContracts.js";
import {
  dispatchGitControlHttpRequest,
  publicFinalizationOutcome,
  type GitControlHttpService,
} from "../src/gitboard/gitControlHttpServer.js";

describe("git control HTTP server", () => {
  test("classifies validation and post-confirmation path drift as proposal outcomes", () => {
    expect(publicFinalizationOutcome("FINALIZATION_PATH_BLOCKED")).toBe("proposal_rejected");
    expect(publicFinalizationOutcome("FINALIZATION_PATH_NOT_FILE")).toBe("proposal_rejected");
    expect(publicFinalizationOutcome("FINALIZATION_SELECTED_PATHS_DRIFT")).toBe("proposal_stale");
  });

  test("exposes the canonical scan, safe repo detail, and exact finalization status DTOs", async () => {
    const service = serviceFixture();
    service.scan = async () => ({
      schemaVersion: 2,
      observation: { state: "verified", observedAt: "2026-08-19T00:00:00.000Z" },
      repositories: [],
    });
    service.repoDetail = async (repoId) => ({
      schemaVersion: 2,
      repository: { repoId, label: "Agent08 GitBoard" },
      stashCount: 0,
    });
    service.finalizationStatus = async (operationId) => finalizationStatusFixture(operationId);

    await expectJson(service, "GET", "/api/git-control/scan", 200, {
      schemaVersion: 2,
      observation: { state: "verified", observedAt: "2026-08-19T00:00:00.000Z" },
      repositories: [],
    });
    await expectJson(service, "GET", "/api/git-control/repos/agent08-gitboard", 200, {
      schemaVersion: 2,
      repository: { repoId: "agent08-gitboard", label: "Agent08 GitBoard" },
      stashCount: 0,
    });
    await expectJson(service, "GET", "/api/git-control/finalizations/op-1", 200, {
      schemaVersion: 2,
      operationId: "op-1",
      state: "ready",
      outcome: "ready_for_confirmation",
      resultCode: "FINALIZATION_PREPARED",
      attempt: {
        operation: "commit",
        repoId: "agent02-pvi",
        proposalSource: "codex",
        taskIntentId: "task-agent02-1",
        createdAt: "2026-08-01T00:00:00.000Z",
        completedAt: null,
      },
      plan: null,
      receipt: null,
    });
    await expectJson(service, "GET", "/api/git-control/identity", 200, {
      ok: true,
      agentId: "agent08",
      service: "git-control",
    });
  });

  test("uses the receipt as terminal status without exposing private plan or receipt fields", async () => {
    const service = serviceFixture();
    service.finalizationStatus = async () => ({
      operationId: "op-private-status",
      status: "succeeded",
      attempt: {
        schemaVersion: 1,
        operationId: "op-private-status",
        operation: "push",
        repoId: "agent02-pvi",
        proposalSource: "codex",
        taskIntentId: "task-agent02-publish",
        status: "succeeded",
        outcome: "ready_for_confirmation",
        resultCode: "FINALIZATION_PLAN_PREPARED",
        createdAt: "2026-08-01T00:00:00.000Z",
        completedAt: "2026-08-01T00:01:00.000Z",
      },
      plan: {
        schemaVersion: 1,
        operationId: "op-private-status",
        operation: "push",
        repoId: "agent02-pvi",
        canonicalRepoPath: "/sentinel/absolute/private-repository-path",
        branch: "main",
        expectedHead: "a".repeat(40),
        proposalSource: "codex",
        taskIntentId: "task-agent02-publish",
        remote: "origin",
        remoteUrl: "https://user:credential@github.example.invalid/private.git",
        remoteRef: "refs/heads/main",
        expectedRemoteOid: "b".repeat(40),
        confirmationToken: "confirmation-token-not-for-browser",
        rawSelectedFileContents: "private file contents not for browser output",
        createdAt: "2026-08-01T00:00:00.000Z",
        expiresAt: "2026-08-01T00:05:00.000Z",
      },
      receipt: {
        schemaVersion: 1,
        operationId: "op-private-status",
        operation: "push",
        repoId: "agent02-pvi",
        taskIntentId: "task-agent02-publish",
        status: "succeeded",
        resultCode: "PUSHED",
        beforeOid: "b".repeat(40),
        afterOid: "a".repeat(40),
        branch: "main",
        completedAt: "2026-08-01T00:01:00.000Z",
        outputSummary: "raw git output: credential=not-for-browser",
      },
    } as unknown as import("../src/gitboard/finalizationContracts.js").FinalizationStatus);

    const response = await dispatchGitControlHttpRequest(service, {
      method: "GET",
      path: "/api/git-control/finalizations/op-private-status",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      schemaVersion: 2,
      operationId: "op-private-status",
      state: "succeeded",
      outcome: "pushed",
      resultCode: "PUSHED",
      attempt: {
        operation: "push",
        repoId: "agent02-pvi",
        proposalSource: "codex",
        taskIntentId: "task-agent02-publish",
        createdAt: "2026-08-01T00:00:00.000Z",
        completedAt: "2026-08-01T00:01:00.000Z",
      },
      plan: {
        operation: "push",
        repoId: "agent02-pvi",
        branch: "main",
        expectedHead: "a".repeat(40),
        proposalSource: "codex",
        taskIntentId: "task-agent02-publish",
        createdAt: "2026-08-01T00:00:00.000Z",
        expiresAt: "2026-08-01T00:05:00.000Z",
      },
      receipt: {
        operation: "push",
        repoId: "agent02-pvi",
        taskIntentId: "task-agent02-publish",
        state: "succeeded",
        resultCode: "PUSHED",
        beforeOid: "b".repeat(40),
        afterOid: "a".repeat(40),
        branch: "main",
        completedAt: "2026-08-01T00:01:00.000Z",
      },
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("/sentinel/absolute/private-repository-path");
    expect(serialized).not.toContain("user:credential@github.example.invalid");
    expect(serialized).not.toContain("confirmation-token-not-for-browser");
    expect(serialized).not.toContain("private file contents not for browser output");
    expect(serialized).not.toContain("raw git output: credential=not-for-browser");
  });

  test("routes prepare, separate confirmation, and execution without exposing confirmation at prepare", async () => {
    const seen: unknown[] = [];
    const service = serviceFixture();
    service.prepareCommit = async (repoId, proposal) => {
      seen.push({ action: "prepareCommit", repoId, proposal });
      return { operationId: "op-commit", operation: "commit", repoId };
    };
    service.preparePush = async (repoId, proposal) => {
      seen.push({ action: "preparePush", repoId, proposal });
      return { operationId: "op-push", operation: "push", repoId };
    };
    service.confirmFinalization = async (operationId) => {
      seen.push({ action: "confirm", operationId });
      return { operationId, confirmationToken: "token-1", expiresAt: "2026-07-30T10:01:00.000Z" };
    };
    service.executeFinalization = async (operationId, confirmationToken) => {
      seen.push({ action: "execute", operationId, confirmationToken });
      return { operationId, status: "succeeded" };
    };
    service.finalizationStatus = async (operationId) => {
      if (operationId === "op-push") {
        return finalizationStatusFixture(operationId, "push");
      }
      if (seen.some((item) => (item as { action?: string }).action === "execute")) {
        return finalizationStatusFixture(operationId, "commit", "succeeded");
      }
      return finalizationStatusFixture(operationId, "commit");
    };

    await expectJson(
      service,
      "POST",
      "/api/git-control/repos/agent02-pvi/commit/prepare",
      200,
      publicStatusFixture("op-commit", "commit"),
      {
        selectedPaths: ["src/app.ts"],
        commitMessage: "feat: final proposal",
        expectedHead: "a".repeat(40),
        rationale: "Codex reviewed the diff",
        source: "codex",
        taskIntentId: "task-agent02-release",
        selectionDeclaration: "exact_paths",
      },
    );
    await expectJson(
      service,
      "POST",
      "/api/git-control/repos/agent02-pvi/push/prepare",
      200,
      publicStatusFixture("op-push", "push"),
      { expectedHead: "a".repeat(40), source: "manual" },
    );
    await expectJson(
      service,
      "POST",
      "/api/git-control/finalizations/op-commit/confirm",
      200,
      {
        schemaVersion: 2,
        operationId: "op-commit",
        state: "confirmed",
        confirmationToken: "token-1",
        expiresAt: "2026-07-30T10:01:00.000Z",
      },
    );
    await expectJson(
      service,
      "POST",
      "/api/git-control/finalizations/op-commit/execute",
      200,
      publicStatusFixture("op-commit", "commit", "succeeded"),
      { confirmationToken: "token-1" },
    );

    expect(seen).toEqual([
      {
        action: "prepareCommit",
        repoId: "agent02-pvi",
        proposal: {
          selectedPaths: ["src/app.ts"],
          commitMessage: "feat: final proposal",
          expectedHead: "a".repeat(40),
          rationale: "Codex reviewed the diff",
          source: "codex",
          taskIntentId: "task-agent02-release",
          selectionDeclaration: "exact_paths",
        },
      },
      {
        action: "preparePush",
        repoId: "agent02-pvi",
        proposal: { expectedHead: "a".repeat(40), source: "manual" },
      },
      { action: "confirm", operationId: "op-commit" },
      { action: "execute", operationId: "op-commit", confirmationToken: "token-1" },
    ]);
  });

  test("does not expose legacy development mutation routes", async () => {
    const service = serviceFixture();
    for (const path of [
      "/api/git-control/repos/agent02-pvi/commit",
      "/api/git-control/repos/agent02-pvi/stash-rebase",
      "/api/git-control/repos/agent02-pvi/set-upstream/prepare",
      "/api/git-control/repos/agent02-pvi/bootstrap-push",
      "/api/git-control/repos/agent02-pvi/init/prepare",
    ]) {
      await expectJson(service, "POST", path, 404, { error: { code: "NOT_FOUND" } }, {});
    }
  });

  test("routes the existing backend repair boundary independently", async () => {
    const calls: string[] = [];
    const service = serviceFixture();
    service.backendStart = async (agentId) => {
      calls.push(`start:${agentId}`);
      return { agentId, status: "started", pid: 4204, port: 8004 };
    };
    service.backendRestart = async (agentId) => {
      calls.push(`restart:${agentId}`);
      return { agentId, status: "restarted", pid: 4206, port: 8086 };
    };

    await expectJson(service, "POST", "/api/git-control/backend/agent04/start", 200, {
      ok: true,
      agentId: "agent04",
      action: "start",
      process: { agentId: "agent04", status: "started", pid: 4204, port: 8004 },
    });
    await expectJson(service, "POST", "/api/git-control/backend/agent06/restart", 200, {
      ok: true,
      agentId: "agent06",
      action: "restart",
      process: { agentId: "agent06", status: "restarted", pid: 4206, port: 8086 },
    });
    expect(calls).toEqual(["start:agent04", "restart:agent06"]);
  });

  test("productizes finalization errors without leaking raw content", async () => {
    const service = serviceFixture();
    service.prepareCommit = async () => {
      throw new FinalizationError(
        "FINALIZATION_SECRET_DETECTED",
        "private.txt: token=https://secret@example.invalid",
      );
    };

    const response = await dispatchGitControlHttpRequest(service, {
      method: "POST",
      path: "/api/git-control/repos/agent02-pvi/commit/prepare",
      body: { selectedPaths: ["private.txt"], commitMessage: "test" },
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: {
        code: "FINALIZATION_SECRET_DETECTED",
        outcome: "proposal_rejected",
        title: "Proposal rejected",
        summary: "The proposal does not satisfy the finalization contract.",
        suggestedAction: "Correct the proposal, then prepare it again.",
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("secret@example");
  });

  test("returns the bounded stale-proposal outcome with its operation ID", async () => {
    const service = serviceFixture();
    service.prepareCommit = async () => {
      throw new FinalizationError(
        "FINALIZATION_SELECTED_STATE_DRIFT",
        "private.txt: token=https://secret@example.invalid",
        "op-stale",
      );
    };

    const response = await dispatchGitControlHttpRequest(service, {
      method: "POST",
      path: "/api/git-control/repos/agent02-pvi/commit/prepare",
      body: {
        selectedPaths: ["src/app.ts"],
        commitMessage: "feat: final proposal",
        expectedHead: "a".repeat(40),
        source: "codex",
      },
    });

    expect(response.status).toBe(409);
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
    expect(JSON.stringify(response.body)).not.toContain("secret@example");
  });

  test("rejects an unrecognized proposal source", async () => {
    const response = await dispatchGitControlHttpRequest(serviceFixture(), {
      method: "POST",
      path: "/api/git-control/repos/agent02-pvi/push/prepare",
      body: { source: "operator" },
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: {
        code: "FINALIZATION_PROPOSAL_SOURCE_INVALID",
        outcome: "proposal_rejected",
        title: "Proposal rejected",
        summary: "The proposal does not satisfy the finalization contract.",
        suggestedAction: "Correct the proposal, then prepare it again.",
      },
    });
  });

  test("fails closed with an unverified canonical scan envelope", async () => {
    const service = serviceFixture();
    service.scan = async () => {
      throw new Error("fatal: https://token@example.invalid/private.git");
    };
    const response = await dispatchGitControlHttpRequest(service, {
      method: "GET",
      path: "/api/git-control/scan",
    });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      schemaVersion: 2,
      observation: {
        state: "unverified",
        observedAt: null,
        reasonCode: "AGENT08_SCAN_FAILED",
      },
      repositories: [],
    });
    expect(JSON.stringify(response.body)).not.toContain("token@example");
  });
});

function serviceFixture(): GitControlHttpService {
  return {
    async scan() {
      return {};
    },
    async repoDetail() {
      return {};
    },
    async prepareCommit() {
      return {};
    },
    async preparePush() {
      return {};
    },
    async confirmFinalization() {
      return {};
    },
    async executeFinalization() {
      return {};
    },
    async finalizationStatus() {
      return finalizationStatusFixture("op-default");
    },
  };
}

function finalizationStatusFixture(
  operationId: string,
  operation: "commit" | "push" = "commit",
  status: "ready" | "succeeded" = "ready",
): import("../src/gitboard/finalizationContracts.js").FinalizationStatus {
  return {
    operationId,
    status,
    attempt: {
      schemaVersion: 1,
      operationId,
      operation,
      repoId: "agent02-pvi",
      proposalSource: "codex",
      taskIntentId: "task-agent02-1",
      status,
      outcome: status === "succeeded" ? (operation === "commit" ? "committed" : "pushed") : "ready_for_confirmation",
      resultCode: status === "succeeded" ? (operation === "commit" ? "COMMITTED" : "PUSHED") : "FINALIZATION_PREPARED",
      createdAt: "2026-08-01T00:00:00.000Z",
      completedAt: status === "succeeded" ? "2026-08-01T00:01:00.000Z" : null,
    },
    plan: null,
    receipt: null,
  };
}

function publicStatusFixture(
  operationId: string,
  operation: "commit" | "push",
  status: "ready" | "succeeded" = "ready",
): unknown {
  return {
    schemaVersion: 2,
    operationId,
    state: status,
    outcome: status === "succeeded" ? (operation === "commit" ? "committed" : "pushed") : "ready_for_confirmation",
    resultCode: status === "succeeded" ? (operation === "commit" ? "COMMITTED" : "PUSHED") : "FINALIZATION_PREPARED",
    attempt: {
      operation,
      repoId: "agent02-pvi",
      proposalSource: "codex",
      taskIntentId: "task-agent02-1",
      createdAt: "2026-08-01T00:00:00.000Z",
      completedAt: status === "succeeded" ? "2026-08-01T00:01:00.000Z" : null,
    },
    plan: null,
    receipt: null,
  };
}

async function expectJson(
  service: GitControlHttpService,
  method: string,
  path: string,
  status: number,
  expected: unknown,
  body?: Record<string, unknown>,
): Promise<void> {
  const response = await dispatchGitControlHttpRequest(service, { method, path, body });
  expect(response.status).toBe(status);
  expect(response.headers["content-type"]).toMatch(/^application\/json\b/);
  expect(response.body).toEqual(expected);
}

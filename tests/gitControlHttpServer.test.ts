import {
  dispatchGitControlHttpRequest,
  type GitControlHttpService,
} from "../src/gitboard/gitControlHttpServer.js";
import { MutationSafetyError } from "../src/gitboard/mutationSafetyGate.js";
import { describe, expect, test } from "vitest";

describe("git control HTTP server", () => {
  test("exposes read APIs as JSON without web-platform business logic", async () => {
    const service: GitControlHttpService = {
      async scan() {
        return { cards: [{ id: "agent08-gitboard", statusLine: "main ✓" }] };
      },
      async repoDetail(repoId) {
        return {
          snapshot: { id: repoId },
          stashList: [{ index: 0, selector: "stash@{0}", message: "WIP", branch: "main", createdAt: null }],
        };
      },
      async mutationStatus(operationId) {
        return { operationId, status: "queued" };
      },
      async prepareMutation(repoId, operation) {
        return { repoId, operation, confirmationToken: "token-1" };
      },
      async mutate(repoId, operation, body) {
        return { ok: true, repoId, operation, beforeSnapshotId: body.preflightSnapshotId };
      },
    };
    await expectJson(service, "GET", "/api/git-control/scan", 200, {
      cards: [{ id: "agent08-gitboard", statusLine: "main ✓" }],
    });
    await expectJson(service, "GET", "/api/git-control/repos/agent08-gitboard", 200, {
      snapshot: { id: "agent08-gitboard" },
      stashList: [{ index: 0, selector: "stash@{0}", message: "WIP", branch: "main", createdAt: null }],
    });
    await expectJson(service, "GET", "/api/git-control/mutations/op-1", 200, {
      operationId: "op-1",
      status: "queued",
    });
  });

  test("routes mutation prepare and execute requests through the injected service", async () => {
    const seen: Array<{ repoId: string; operation: string; body?: unknown }> = [];
    const service: GitControlHttpService = {
      async scan() {
        return {};
      },
      async repoDetail() {
        return {};
      },
      async mutationStatus() {
        return {};
      },
      async prepareMutation(repoId, operation) {
        seen.push({ repoId, operation });
        return { repoId, operation, operationId: "op-prepare", confirmationToken: "token-1" };
      },
      async mutate(repoId, operation, body) {
        seen.push({ repoId, operation, body });
        return { ok: true, repoId, operation };
      },
    };
    await expectJson(
      service,
      "POST",
      "/api/git-control/repos/agent02-pvi/commit/prepare",
      200,
      { repoId: "agent02-pvi", operation: "commit", operationId: "op-prepare", confirmationToken: "token-1" },
    );
    await expectJson(
      service,
      "POST",
      "/api/git-control/repos/agent02-pvi/stash-rebase",
      200,
      { ok: true, repoId: "agent02-pvi", operation: "stash_rebase" },
      { preflightSnapshotId: "snap-1", confirmationToken: "token-1" },
    );

    expect(seen).toEqual([
      { repoId: "agent02-pvi", operation: "commit" },
      {
        repoId: "agent02-pvi",
        operation: "stash_rebase",
        body: { preflightSnapshotId: "snap-1", confirmationToken: "token-1" },
      },
    ]);
  });

  test("returns productized errors instead of raw exception text", async () => {
    const service: GitControlHttpService = {
      async scan() {
        throw new Error("fatal: https://token@example.invalid/private.git");
      },
      async repoDetail() {
        return {};
      },
      async mutationStatus() {
        return {};
      },
      async prepareMutation() {
        return {};
      },
      async mutate() {
        return {};
      },
    };
    const response = await dispatchGitControlHttpRequest(service, {
      method: "GET",
      path: "/api/git-control/scan",
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
      code: "AGENT08_SERVICE_ERROR",
      title: "Agent08 service unavailable",
      summary: "The Git Control service could not complete the request.",
      suggestedAction: "Check the local agent08-gitboard service logs and retry.",
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("token@example");
  });

  test("propagates mutation safety errors with operation-specific productized codes", async () => {
    const service: GitControlHttpService = {
      async scan() {
        return {};
      },
      async repoDetail() {
        return {};
      },
      async mutationStatus() {
        return {};
      },
      async prepareMutation() {
        return {};
      },
      async mutate() {
        throw new MutationSafetyError("DIRTY_BLOCKS_PUSH");
      },
    };

    const response = await dispatchGitControlHttpRequest(service, {
      method: "POST",
      path: "/api/git-control/repos/agent02-pvi/push",
      body: { preflightSnapshotId: "snap-1", confirmationToken: "token-1" },
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: {
        code: "DIRTY_BLOCKS_PUSH",
        title: "Push blocked by local changes",
        summary: "The repository has local working tree changes, so push was not started.",
        suggestedAction: "Commit or stash the local changes, rescan the repo, then retry push.",
      },
    });
  });
});

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

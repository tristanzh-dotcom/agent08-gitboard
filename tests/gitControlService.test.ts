import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { createGitControlService } from "../src/gitboard/gitControlService.js";
import type { GitProxy } from "../src/gitboard/gitProxy.js";
import { MutationGitProxy } from "../src/gitboard/mutationGitProxy.js";
import type { RepoManifest } from "../src/gitboard/types.js";

const manifest: RepoManifest = {
  version: 1,
  root: "/Users/tristanzh/agent",
  generatedAt: "2026-06-19T00:00:00.000Z",
  targets: [
    {
      id: "agent08-gitboard",
      agent: "Agent08",
      label: "Git Console",
      path: "/Users/tristanzh/agent/agent08-gitboard",
      remote: "https://github.com/tristanzh-dotcom/agent08-gitboard.git",
      visibility: "public",
      required: true,
    },
  ],
};

const dirtyGit: GitProxy = {
  async statusPorcelain() {
    return [
      "# branch.oid abcdef1234567890",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +1 -0",
      "1 .M N... 100644 100644 100644 abcdef1234567890 abcdef1234567890 src/gitboard/gitControlService.ts",
    ].join("\n");
  },
  async lastCommit() {
    return "abcdef1|feat(gitboard): expose dashboard service|2026-06-18T15:00:00.000Z";
  },
  async diffStat() {
    return " src/gitboard/gitControlService.ts | 2 ++\n 1 file changed, 2 insertions(+)";
  },
  async stashList() {
    return "stash@{0}: WIP on main: abcdef1 feat(gitboard): expose dashboard service";
  },
  async listLargeFiles() {
    return [];
  },
  async remoteHasBranch() {
    return true;
  },
  async commitsToPushSubjects() {
    return ["feat(gitboard): expose dashboard service"];
  },
};

const noUpstreamGit: GitProxy = {
  async statusPorcelain() {
    return [
      "# branch.oid abcdef1234567890",
      "# branch.head main",
    ].join("\n");
  },
  async lastCommit() {
    return "abcdef1|feat(agent02): local commit|2026-06-19T15:00:00.000Z";
  },
  async diffStat() {
    return "";
  },
  async stashList() {
    return "";
  },
  async listLargeFiles() {
    return [];
  },
  async remoteHasBranch() {
    return false;
  },
  async commitsToPushSubjects() {
    return ["feat(agent02): local commit"];
  },
};

const unmergedGit: GitProxy = {
  ...dirtyGit,
  async statusPorcelain() {
    return [
      "# branch.oid abcdef1234567890",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +0 -0",
      "1 M. N... 100644 100644 100644 abcdef1234567890 abcdef1234567890 workflows/foreign-jv-china-watch/src/agent02-adapter.mjs",
      "u UU N... 100644 100644 100644 100644 base ours theirs workflows/foreign-jv-china-watch/data/latest_card_payload.json",
    ].join("\n");
  },
};

describe("GitControlService", () => {
  test("returns dashboard scan data plus card-ready action models", async () => {
    const service = createGitControlService({
      git: dirtyGit,
      manifest,
      now: () => new Date("2026-06-19T10:00:00.000Z"),
    });

    const scan = await service.scan();

    expect(scan.dashboard.targets).toHaveLength(1);
    expect(scan.cards).toEqual([
      {
        id: "agent08-gitboard",
        label: "Git Console",
        statusLine: "main ↑1",
        dirtyLine: "1 dirty",
        stashLine: "stash: 1",
        blockedReason: null,
        selfMutationWarning: "Running service code will not change until restart after a self mutation.",
        actions: [
          { id: "commit", enabled: true },
          { id: "push", enabled: false },
        ],
      },
    ]);
  });

  test("returns repo detail with parsed read-only stash metadata", async () => {
    const service = createGitControlService({ git: dirtyGit, manifest });

    const detail = await service.repoDetail("agent08-gitboard");

    expect(detail.snapshot.id).toBe("agent08-gitboard");
    expect(detail.stashList).toEqual([
      {
        index: 0,
        selector: "stash@{0}",
        message: "abcdef1 feat(gitboard): expose dashboard service",
        branch: "main",
        createdAt: null,
      },
    ]);
  });

  test("prepares mutations by storing a preflight snapshot and returning a bound token", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-git-control-"));
    const service = createGitControlService({
      root,
      git: dirtyGit,
      manifest,
      now: () => new Date("2026-06-19T10:00:00.000Z"),
      nowMs: () => 1_800,
    });

    const prepared = await service.prepareMutation("agent08-gitboard", "commit");

    expect(prepared).toMatchObject({
      repoId: "agent08-gitboard",
      operation: "commit",
      preflightSnapshotId: prepared.operationId,
      expiresAtMs: 61_800,
    });
    expect(prepared.confirmationToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const saved = JSON.parse(
      await readFile(join(root, "storage", "mutations", `${prepared.operationId}.json`), "utf8"),
    ) as Record<string, unknown>;
    expect(saved).toMatchObject({
      operationId: prepared.operationId,
      repoId: "agent08-gitboard",
      operation: "commit",
      branch: "main",
      ahead: 1,
      behind: 0,
      selfMutation: true,
    });
  });

  test("blocks commit prepare when the repo has unmerged conflict files", async () => {
    const service = createGitControlService({
      git: unmergedGit,
      manifest,
      nowMs: () => 2_000,
    });

    await expect(service.prepareMutation("agent08-gitboard", "commit")).rejects.toMatchObject({
      code: "UNMERGED_BLOCKS_COMMIT",
    });
  });

  test("passes selected commit files through to the mutation proxy", async () => {
    const calls: Array<{ repoPath: string; args: string[] }> = [];
    const service = createGitControlService({
      git: dirtyGit,
      manifest,
      mutationProxy: new MutationGitProxy({
        async runGit(repoPath, args) {
          calls.push({ repoPath, args });
          return "ok";
        },
      }),
      nowMs: () => 2_000,
    });
    const prepared = await service.prepareMutation("agent08-gitboard", "commit");

    await service.mutate("agent08-gitboard", "commit", {
      operationId: prepared.operationId,
      preflightSnapshotId: prepared.preflightSnapshotId,
      confirmationToken: prepared.confirmationToken,
      message: "test(agent08): selected files",
      files: ["src/gitboard/gitControlService.ts"],
    });

    expect(calls[0]).toEqual({
      repoPath: "/Users/tristanzh/agent/agent08-gitboard",
      args: ["add", "--", "src/gitboard/gitControlService.ts"],
    });
    expect(calls[0]?.args).not.toContain(".");
  });

  test("force-adds tracked dist runtime contract files through commit mutation", async () => {
    const calls: string[][] = [];
    const service = createGitControlService({
      git: dirtyGit,
      manifest,
      mutationProxy: new MutationGitProxy({
        async isTrackedFile(_repoPath, file) {
          return file === "dist/gitboard/dashboardService.js";
        },
        async runGit(_repoPath, args) {
          calls.push(args);
          return "ok";
        },
      }),
      nowMs: () => 2_100,
    });
    const prepared = await service.prepareMutation("agent08-gitboard", "commit");

    await service.mutate("agent08-gitboard", "commit", {
      operationId: prepared.operationId,
      preflightSnapshotId: prepared.preflightSnapshotId,
      confirmationToken: prepared.confirmationToken,
      message: "test(agent08): tracked dist",
      files: ["src/gitboard/mutationGitProxy.ts", "dist/gitboard/dashboardService.js"],
    });

    expect(calls).toEqual([
      ["add", "--", "src/gitboard/mutationGitProxy.ts"],
      ["add", "-f", "--", "dist/gitboard/dashboardService.js"],
      ["commit", "-m", "test(agent08): tracked dist"],
    ]);
  });

  test("returns productized safety error for untracked dist commit files", async () => {
    const calls: string[][] = [];
    const service = createGitControlService({
      git: dirtyGit,
      manifest,
      mutationProxy: new MutationGitProxy({
        async isTrackedFile() {
          return false;
        },
        async runGit(_repoPath, args) {
          calls.push(args);
          return "ok";
        },
      }),
      nowMs: () => 2_200,
    });
    const prepared = await service.prepareMutation("agent08-gitboard", "commit");

    await expect(
      service.mutate("agent08-gitboard", "commit", {
        operationId: prepared.operationId,
        preflightSnapshotId: prepared.preflightSnapshotId,
        confirmationToken: prepared.confirmationToken,
        message: "test(agent08): untracked dist",
        files: ["dist/tmp/generated.js"],
      }),
    ).rejects.toMatchObject({ code: "COMMIT_PATH_BLOCKED" });

    expect(calls).toEqual([]);
  });

  test("returns a compact one-line output summary after commit success", async () => {
    const service = createGitControlService({
      git: dirtyGit,
      manifest,
      mutationProxy: new MutationGitProxy({
        async runGit(_repoPath, args) {
          if (args[0] === "commit") {
            return [
              "[main abc1234] chore(agent07-sentinel): commit selected repo changes",
              "2032 files changed, 1265664 insertions(+)",
              "create mode 120000 node_modules/.bin/vite",
            ].join("\n");
          }
          return "";
        },
      }),
      nowMs: () => 2_500,
    });
    const prepared = await service.prepareMutation("agent08-gitboard", "commit");

    const result = await service.mutate("agent08-gitboard", "commit", {
      operationId: prepared.operationId,
      preflightSnapshotId: prepared.preflightSnapshotId,
      confirmationToken: prepared.confirmationToken,
      message: "test(agent08): selected files",
      files: ["src/gitboard/gitControlService.ts"],
    });

    expect(result.output).toContain("2032 files changed");
    expect(result.outputSummary).toBe("[main abc1234] chore(agent07-sentinel): commit selected repo changes");
    expect(result.outputSummary).not.toContain("\n");
    expect(result.outputSummary.length).toBeLessThanOrEqual(160);
  });

  test("prepares set-upstream with branch, origin remote, and tracking branch details", async () => {
    const service = createGitControlService({
      git: {
        ...noUpstreamGit,
        async remoteHasBranch() {
          return true;
        },
        async commitsToPushSubjects() {
          return [];
        },
      },
      manifest,
      nowMs: () => 3_000,
    });

    const prepared = await service.prepareMutation("agent08-gitboard", "set_upstream");

    expect(prepared).toMatchObject({
      repoId: "agent08-gitboard",
      operation: "set_upstream",
      branch: "main",
      remote: "origin",
      remoteTrackingBranch: "origin/main",
      currentUpstream: null,
      warning: "This operation updates local Git tracking config and does not push commits.",
    });
  });

  test("executes set-upstream using snapshot branch instead of request body branch", async () => {
    const calls: string[][] = [];
    const service = createGitControlService({
      git: {
        ...noUpstreamGit,
        async remoteHasBranch() {
          return true;
        },
        async commitsToPushSubjects() {
          return [];
        },
      },
      manifest,
      mutationProxy: new MutationGitProxy({
        async runGit(_repoPath, args) {
          calls.push(args);
          return "ok";
        },
      }),
      nowMs: () => 4_000,
    });
    const prepared = await service.prepareMutation("agent08-gitboard", "set_upstream");

    await service.mutate("agent08-gitboard", "set_upstream", {
      operationId: prepared.operationId,
      preflightSnapshotId: prepared.preflightSnapshotId,
      confirmationToken: prepared.confirmationToken,
      branch: "main --force" } as any);

    expect(calls).toEqual([["branch", "--set-upstream-to", "origin/main", "main"]]);
  });

  test("prepares push-with-upstream with commit preview and explicit warning", async () => {
    const service = createGitControlService({
      git: noUpstreamGit,
      manifest,
      nowMs: () => 5_000,
    });

    const prepared = await service.prepareMutation("agent08-gitboard", "push_with_upstream");

    expect(prepared).toMatchObject({
      repoId: "agent08-gitboard",
      operation: "push_with_upstream",
      branch: "main",
      remote: "origin",
      ahead: 1,
      commitsToPushSubjects: ["feat(agent02): local commit"],
      warning: "This operation pushes to origin AND sets upstream tracking.",
    });
  });

  test("executes push-with-upstream using typed proxy and snapshot branch", async () => {
    const calls: string[][] = [];
    const service = createGitControlService({
      git: noUpstreamGit,
      manifest,
      mutationProxy: new MutationGitProxy({
        async runGit(_repoPath, args) {
          calls.push(args);
          return "ok";
        },
      }),
      nowMs: () => 6_000,
    });
    const prepared = await service.prepareMutation("agent08-gitboard", "push_with_upstream");

    await service.mutate("agent08-gitboard", "push_with_upstream", {
      operationId: prepared.operationId,
      preflightSnapshotId: prepared.preflightSnapshotId,
      confirmationToken: prepared.confirmationToken,
      remote: "evil" } as any);

    expect(calls).toEqual([["push", "-u", "origin", "main"]]);
  });
});

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
});

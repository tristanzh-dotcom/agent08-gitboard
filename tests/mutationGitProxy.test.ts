import { describe, expect, test } from "vitest";
import { assertReadOnlyGitArgs } from "../src/gitboard/realGitProxy.js";

describe("Agent08 v1.1 GitProxy boundaries", () => {
  test("readonly proxy keeps mutating commands outside the v1 scan boundary", () => {
    expect(() => assertReadOnlyGitArgs(["status", "--porcelain=v2", "--branch"])).not.toThrow();
    expect(() => assertReadOnlyGitArgs(["commit", "-m", "nope"])).toThrow(/not read-only/);
    expect(() => assertReadOnlyGitArgs(["push", "origin", "main"])).toThrow(/not read-only/);
    expect(() => assertReadOnlyGitArgs(["pull", "--ff-only"])).toThrow(/not read-only/);
    expect(() => assertReadOnlyGitArgs(["stash", "push"])).toThrow(/not read-only/);
  });

  test("mutation proxy exposes no public raw or args-array execution escape hatch", async () => {
    const { MutationGitProxy, assertAllowedMutationOperation } = await import("../src/gitboard/mutationGitProxy.js");
    const proxy = new MutationGitProxy({ runGit: async () => "" });

    expect("runUnsafe" in proxy).toBe(false);
    expect("runRaw" in proxy).toBe(false);
    expect(() => assertAllowedMutationOperation("force_push")).toThrow(/command not allowed/i);
  });

  test("mutation proxy builds commit commands internally from typed inputs", async () => {
    const { MutationGitProxy } = await import("../src/gitboard/mutationGitProxy.js");
    const calls: Array<{ repoPath: string; args: string[] }> = [];
    const proxy = new MutationGitProxy({
      async runGit(repoPath, args) {
        calls.push({ repoPath, args });
        return "";
      },
    });

    await proxy.commit({
      repoPath: "/tmp/repo",
      message: "feat(gitboard): wire control API",
      files: ["src/gitboard/gitControlService.ts"],
    });

    expect(calls).toEqual([
      { repoPath: "/tmp/repo", args: ["add", "--", "src/gitboard/gitControlService.ts"] },
      { repoPath: "/tmp/repo", args: ["commit", "-m", "feat(gitboard): wire control API"] },
    ]);
  });

  test("mutation proxy blocks dependency and runtime paths before git add", async () => {
    const { MutationGitProxy } = await import("../src/gitboard/mutationGitProxy.js");
    const calls: string[][] = [];
    const proxy = new MutationGitProxy({
      async runGit(_repoPath, args) {
        calls.push(args);
        return "";
      },
    });

    await expect(
      proxy.commit({
        repoPath: "/tmp/repo",
        message: "chore(agent07): selected files",
        files: ["node_modules/.bin/vite"],
      }),
    ).rejects.toThrow(/COMMIT_PATH_BLOCKED/);
    await expect(
      proxy.commit({
        repoPath: "/tmp/repo",
        message: "chore(agent07): selected files",
        files: ["storage/runtime_shadow/runtime_1/sources/source_stage_snapshot.json"],
      }),
    ).rejects.toThrow(/COMMIT_PATH_BLOCKED/);
    await expect(
      proxy.commit({
        repoPath: "/tmp/repo",
        message: "chore(agent07): selected files",
        files: ["storage/mutations/op-1.json"],
      }),
    ).rejects.toThrow(/COMMIT_PATH_BLOCKED/);

    expect(calls).toEqual([]);
  });

  test("mutation proxy force-adds tracked dist files while regular files use normal add", async () => {
    const { MutationGitProxy } = await import("../src/gitboard/mutationGitProxy.js");
    const calls: string[][] = [];
    const proxy = new MutationGitProxy({
      async isTrackedFile(_repoPath, file) {
        calls.push(["tracked", file]);
        return file === "dist/gitboard/dashboardService.js";
      },
      async runGit(_repoPath, args) {
        calls.push(args);
        return "";
      },
    });

    await proxy.commit({
      repoPath: "/tmp/repo",
      message: "chore(agent08): rebuild runtime contract",
      files: ["src/gitboard/mutationGitProxy.ts", "dist/gitboard/dashboardService.js"],
    });

    expect(calls).toEqual([
      ["tracked", "dist/gitboard/dashboardService.js"],
      ["add", "--", "src/gitboard/mutationGitProxy.ts"],
      ["add", "-f", "--", "dist/gitboard/dashboardService.js"],
      ["commit", "-m", "chore(agent08): rebuild runtime contract"],
    ]);
  });

  test("mutation proxy blocks untracked dist files before git add", async () => {
    const { MutationGitProxy } = await import("../src/gitboard/mutationGitProxy.js");
    const calls: string[][] = [];
    const proxy = new MutationGitProxy({
      async isTrackedFile(_repoPath, file) {
        calls.push(["tracked", file]);
        return false;
      },
      async runGit(_repoPath, args) {
        calls.push(args);
        return "";
      },
    });

    await expect(
      proxy.commit({
        repoPath: "/tmp/repo",
        message: "chore(agent08): selected files",
        files: ["dist/tmp/generated.js"],
      }),
    ).rejects.toThrow(/COMMIT_PATH_BLOCKED/);

    expect(calls).toEqual([["tracked", "dist/tmp/generated.js"]]);
  });

  test("mutation proxy exposes only safe typed sync workflows and never stash pop", async () => {
    const { MutationGitProxy } = await import("../src/gitboard/mutationGitProxy.js");
    const calls: string[][] = [];
    const proxy = new MutationGitProxy({
      async runGit(_repoPath, args) {
        calls.push(args);
        return "";
      },
    });

    await proxy.push({ repoPath: "/tmp/repo" });
    await proxy.pullFastForward({ repoPath: "/tmp/repo" });
    await proxy.stashRebase({
      repoPath: "/tmp/repo",
      operationId: "op-1",
      upstream: "origin/main",
    });

    expect(calls).toEqual([
      ["push"],
      ["pull", "--ff-only"],
      ["stash", "push", "-u", "-m", "agent08: pre-rebase op-1"],
      ["rebase", "origin/main"],
    ]);
    expect(calls.flat()).not.toContain("pop");
    expect(calls.flat()).not.toContain("apply");
  });

  test("mutation proxy builds set-upstream from typed branch and origin remote only", async () => {
    const { MutationGitProxy } = await import("../src/gitboard/mutationGitProxy.js");
    const calls: string[][] = [];
    const proxy = new MutationGitProxy({
      async runGit(_repoPath, args) {
        calls.push(args);
        return "";
      },
    });

    await proxy.setUpstream({ repoPath: "/tmp/repo", branch: "main", remote: "origin" });

    expect(calls).toEqual([["branch", "--set-upstream-to", "origin/main", "main"]]);
  });

  test("mutation proxy builds push-with-upstream from typed branch and origin remote only", async () => {
    const { MutationGitProxy } = await import("../src/gitboard/mutationGitProxy.js");
    const calls: string[][] = [];
    const proxy = new MutationGitProxy({
      async runGit(_repoPath, args) {
        calls.push(args);
        return "";
      },
    });

    await proxy.pushWithUpstream({ repoPath: "/tmp/repo", branch: "main", remote: "origin" });

    expect(calls).toEqual([["push", "-u", "origin", "main"]]);
  });

  test("mutation proxy rejects unsafe upstream branch names", async () => {
    const { MutationGitProxy } = await import("../src/gitboard/mutationGitProxy.js");
    const proxy = new MutationGitProxy({ runGit: async () => "" });

    await expect(proxy.setUpstream({ repoPath: "/tmp/repo", branch: "../main", remote: "origin" })).rejects.toThrow(
      /unsafe branch/,
    );
    await expect(
      proxy.pushWithUpstream({ repoPath: "/tmp/repo", branch: "main --force", remote: "origin" }),
    ).rejects.toThrow(/unsafe branch/);
  });
});

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
});

import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { FinalizationError } from "../src/gitboard/finalizationContracts.js";
import {
  FinalizationGit,
  RealFinalizationGitRunner,
  type FinalizationGitRunner,
} from "../src/gitboard/finalizationGit.js";

const execFileAsync = promisify(execFile);

describe("FinalizationGit", () => {
  test("inspects exact changed paths and creates a stable selected-state digest", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-inspect-"));
    await writeFile(join(root, "safe.ts"), "export const value = 2;\n", "utf8");
    const canonicalRoot = await realpath(root);
    const runner = scriptedRunner(canonicalRoot, {
      "rev-parse --show-toplevel": canonicalRoot,
      "symbolic-ref --quiet --short HEAD": "main",
      "rev-parse --verify HEAD": "a".repeat(40),
      "diff --name-only --diff-filter=U -z": "",
      "status --porcelain=v1 -z --untracked-files=all -- safe.ts": " M safe.ts\0",
      "diff --raw -z --no-ext-diff HEAD -- safe.ts": ":100644 100644 aaaaaaa bbbbbbb M\0safe.ts\0",
    });
    const git = new FinalizationGit(runner);

    const first = await git.inspectCommit(root, ["safe.ts"]);
    const second = await git.inspectCommit(root, ["safe.ts"]);

    expect(first).toMatchObject({
      canonicalRepoPath: canonicalRoot,
      branch: "main",
      head: "a".repeat(40),
      selectedPaths: ["safe.ts"],
      changedPaths: ["safe.ts"],
    });
    expect(first.selectedStateDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(second.selectedStateDigest).toBe(first.selectedStateDigest);
  });

  test("inspects a large binary change without exceeding the Git output buffer", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-large-binary-"));
    await git(root, ["init", "--initial-branch=main"]);
    await git(root, ["config", "user.name", "Agent08 Test"]);
    await git(root, ["config", "user.email", "agent08-test@example.invalid"]);
    await writeFile(join(root, "large.bin"), randomBytes(12 * 1024 * 1024));
    await git(root, ["add", "--", "large.bin"]);
    await git(root, ["commit", "-m", "test: add large binary"]);

    await writeFile(join(root, "large.bin"), randomBytes(12 * 1024 * 1024));

    const inspection = await new FinalizationGit(new RealFinalizationGitRunner()).inspectCommit(root, ["large.bin"]);

    expect(inspection.selectedPaths).toEqual(["large.bin"]);
    expect(inspection.changedPaths).toEqual(["large.bin"]);
  });

  test("rejects unsafe, unchanged, blocked-output, and secret-bearing commit paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-block-"));
    const privateKeyHeader = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
    await writeFile(join(root, "secret.txt"), `${privateKeyHeader}\nnot-a-real-key\n`, "utf8");
    const canonicalRoot = await realpath(root);
    const runner = scriptedRunner(canonicalRoot, {
      "rev-parse --show-toplevel": canonicalRoot,
      "symbolic-ref --quiet --short HEAD": "main",
      "rev-parse --verify HEAD": "a".repeat(40),
      "diff --name-only --diff-filter=U -z": "",
      "status --porcelain=v1 -z --untracked-files=all -- safe.ts": "",
      "status --porcelain=v1 -z --untracked-files=all -- secret.txt": "?? secret.txt\0",
      "diff --raw -z --no-ext-diff HEAD -- secret.txt": "",
    });
    const git = new FinalizationGit(runner);

    await expect(git.inspectCommit(root, ["../escape"])).rejects.toMatchObject({
      code: "FINALIZATION_PATH_INVALID",
    });
    await expect(git.inspectCommit(root, ["node_modules/pkg/index.js"])).rejects.toMatchObject({
      code: "FINALIZATION_PATH_BLOCKED",
    });
    await expect(git.inspectCommit(root, ["safe.ts"])).rejects.toMatchObject({
      code: "FINALIZATION_PATH_UNCHANGED",
    });
    await expect(git.inspectCommit(root, ["secret.txt"])).rejects.toMatchObject({
      code: "FINALIZATION_SECRET_DETECTED",
    });
  });

  test("expands an untracked directory selection into its actual files", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-directory-"));
    const directory = join(root, "test", "new-feature");
    await writeFile(join(root, "placeholder"), "", "utf8");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "case.test.ts"), "export {};\n", "utf8");
    await writeFile(join(directory, "iteration.log"), "ignored runtime output\n", "utf8");
    const canonicalRoot = await realpath(root);
    const runner = scriptedRunner(canonicalRoot, {
      "rev-parse --show-toplevel": canonicalRoot,
      "symbolic-ref --quiet --short HEAD": "main",
      "rev-parse --verify HEAD": "a".repeat(40),
      "diff --name-only --diff-filter=U -z": "",
      "status --porcelain=v1 -z --untracked-files=all -- test/new-feature/case.test.ts test/new-feature/iteration.log": "?? test/new-feature/case.test.ts\0",
      "diff --raw -z --no-ext-diff HEAD -- test/new-feature/case.test.ts": "",
    });

    const inspection = await new FinalizationGit(runner).inspectCommit(root, ["test/new-feature/"]);

    expect(inspection.selectedPaths).toEqual(["test/new-feature/case.test.ts"]);
    expect(inspection.changedPaths).toEqual(["test/new-feature/case.test.ts"]);
  });

  test("commits only selected paths while preserving unrelated staged changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-real-"));
    await git(root, ["init", "--initial-branch=main"]);
    await git(root, ["config", "user.name", "Agent08 Test"]);
    await git(root, ["config", "user.email", "agent08-test@example.invalid"]);
    await writeFile(join(root, "selected.txt"), "base\n", "utf8");
    await writeFile(join(root, "unrelated.txt"), "base\n", "utf8");
    await git(root, ["add", "--", "selected.txt", "unrelated.txt"]);
    await git(root, ["commit", "-m", "test: base"]);
    const before = (await git(root, ["rev-parse", "--verify", "HEAD"])).trim();
    await writeFile(join(root, "selected.txt"), "selected change\n", "utf8");
    await writeFile(join(root, "unrelated.txt"), "unrelated staged change\n", "utf8");
    await git(root, ["add", "--", "unrelated.txt"]);

    const finalizationGit = new FinalizationGit(new RealFinalizationGitRunner());
    const inspection = await finalizationGit.inspectCommit(root, ["selected.txt"]);
    const result = await finalizationGit.commitSelected(root, {
      branch: inspection.branch,
      expectedHead: before,
      selectedPaths: inspection.selectedPaths,
      selectedStateDigest: inspection.selectedStateDigest,
      commitMessage: "feat: selected only",
    });

    expect(result.parentOid).toBe(before);
    expect(result.committedPaths).toEqual(["selected.txt"]);
    expect((await git(root, ["diff", "--cached", "--name-only"])).trim()).toBe("unrelated.txt");
    expect((await git(root, ["show", "--format=", "--name-only", "HEAD"])).trim()).toBe("selected.txt");
  });

  test("commits a selected deletion that is already staged", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-staged-deletion-"));
    await git(root, ["init", "--initial-branch=main"]);
    await git(root, ["config", "user.name", "Agent08 Test"]);
    await git(root, ["config", "user.email", "agent08-test@example.invalid"]);
    await writeFile(join(root, "selected.txt"), "base\n", "utf8");
    await writeFile(join(root, "selected-deleted.txt"), "base\n", "utf8");
    await git(root, ["add", "--", "selected.txt", "selected-deleted.txt"]);
    await git(root, ["commit", "-m", "test: base"]);
    const before = (await git(root, ["rev-parse", "--verify", "HEAD"])).trim();

    await writeFile(join(root, "selected.txt"), "selected change\n", "utf8");
    await rm(join(root, "selected-deleted.txt"));
    await writeFile(join(root, "unrelated-added.txt"), "unrelated staged addition\n", "utf8");
    await git(root, ["add", "--", "selected.txt", "selected-deleted.txt", "unrelated-added.txt"]);

    const finalizationGit = new FinalizationGit(new RealFinalizationGitRunner());
    const inspection = await finalizationGit.inspectCommit(root, ["selected.txt", "selected-deleted.txt"]);
    const result = await finalizationGit.commitSelected(root, {
      branch: inspection.branch,
      expectedHead: before,
      selectedPaths: inspection.selectedPaths,
      selectedStateDigest: inspection.selectedStateDigest,
      commitMessage: "fix: commit a staged deletion",
    });

    expect(result.parentOid).toBe(before);
    expect(result.committedPaths).toEqual(["selected-deleted.txt", "selected.txt"]);
    expect((await git(root, ["diff", "--cached", "--name-status"])).trim()).toBe("A\tunrelated-added.txt");
  });

  test("commits ignored tracked files and an untracked selection", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-ignored-tracked-"));
    await git(root, ["init", "--initial-branch=main"]);
    await git(root, ["config", "user.name", "Agent08 Test"]);
    await git(root, ["config", "user.email", "agent08-test@example.invalid"]);
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "dist", "manifest.js"), "base\n", "utf8");
    await writeFile(join(root, "selected-deleted.txt"), "base\n", "utf8");
    await writeFile(join(root, "unrelated.txt"), "base\n", "utf8");
    await git(root, ["add", "--", "dist/manifest.js", "selected-deleted.txt", "unrelated.txt"]);
    await writeFile(join(root, ".gitignore"), "dist/\n", "utf8");
    await git(root, ["add", "--", ".gitignore"]);
    await git(root, ["commit", "-m", "test: base"]);
    const before = (await git(root, ["rev-parse", "--verify", "HEAD"])).trim();

    await writeFile(join(root, "dist", "manifest.js"), "selected change\n", "utf8");
    await rm(join(root, "selected-deleted.txt"));
    await writeFile(join(root, "selected-new.txt"), "new selection\n", "utf8");
    await writeFile(join(root, "unrelated.txt"), "unrelated staged change\n", "utf8");
    await git(root, ["add", "--", "unrelated.txt", "selected-deleted.txt"]);

    const finalizationGit = new FinalizationGit(new RealFinalizationGitRunner());
    const inspection = await finalizationGit.inspectCommit(root, [
      "dist/manifest.js",
      "selected-deleted.txt",
      "selected-new.txt",
    ]);
    const result = await finalizationGit.commitSelected(root, {
      branch: inspection.branch,
      expectedHead: before,
      selectedPaths: inspection.selectedPaths,
      selectedStateDigest: inspection.selectedStateDigest,
      commitMessage: "fix: selected ignored tracked and new files",
    });

    expect(result.parentOid).toBe(before);
    expect(result.committedPaths).toEqual([
      "dist/manifest.js",
      "selected-deleted.txt",
      "selected-new.txt",
    ]);
    expect((await git(root, ["show", "HEAD:dist/manifest.js"])).trim()).toBe("selected change");
    expect((await git(root, ["diff", "--cached", "--name-only"])).trim()).toBe("unrelated.txt");
  });

  test("rechecks the selected content digest immediately before staging", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-content-drift-"));
    await git(root, ["init", "--initial-branch=main"]);
    await git(root, ["config", "user.name", "Agent08 Test"]);
    await git(root, ["config", "user.email", "agent08-test@example.invalid"]);
    await writeFile(join(root, "selected.txt"), "base\n", "utf8");
    await git(root, ["add", "--", "selected.txt"]);
    await git(root, ["commit", "-m", "test: base"]);
    const before = (await git(root, ["rev-parse", "--verify", "HEAD"])).trim();
    await writeFile(join(root, "selected.txt"), "approved content\n", "utf8");

    const finalizationGit = new FinalizationGit(new RealFinalizationGitRunner());
    const inspection = await finalizationGit.inspectCommit(root, ["selected.txt"]);
    await writeFile(join(root, "selected.txt"), "unapproved content\n", "utf8");

    await expect(finalizationGit.commitSelected(root, {
      branch: inspection.branch,
      expectedHead: before,
      selectedPaths: inspection.selectedPaths,
      selectedStateDigest: inspection.selectedStateDigest,
      commitMessage: "feat: selected content",
    })).rejects.toMatchObject({ code: "FINALIZATION_SELECTED_STATE_DRIFT" });
    expect((await git(root, ["rev-parse", "--verify", "HEAD"])).trim()).toBe(before);
    expect((await git(root, ["diff", "--cached", "--name-only"])).trim()).toBe("");
  });

  test("preserves leading and trailing spaces in committed paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-spaced-path-"));
    await git(root, ["init", "--initial-branch=main"]);
    await git(root, ["config", "user.name", "Agent08 Test"]);
    await git(root, ["config", "user.email", "agent08-test@example.invalid"]);
    const selectedPath = " leading and trailing ";
    await writeFile(join(root, selectedPath), "base\n", "utf8");
    await git(root, ["add", "--", selectedPath]);
    await git(root, ["commit", "-m", "test: base"]);
    const before = (await git(root, ["rev-parse", "--verify", "HEAD"])).trim();
    await writeFile(join(root, selectedPath), "changed\n", "utf8");

    const finalizationGit = new FinalizationGit(new RealFinalizationGitRunner());
    const inspection = await finalizationGit.inspectCommit(root, [selectedPath]);
    const result = await finalizationGit.commitSelected(root, {
      branch: inspection.branch,
      expectedHead: before,
      selectedPaths: inspection.selectedPaths,
      selectedStateDigest: inspection.selectedStateDigest,
      commitMessage: "fix: retain path whitespace",
    });

    expect(result.committedPaths).toEqual([selectedPath]);
  });

  test("attaches the new HEAD when commit succeeds but exact-path verification fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-postflight-"));
    await git(root, ["init", "--initial-branch=main"]);
    await git(root, ["config", "user.name", "Agent08 Test"]);
    await git(root, ["config", "user.email", "agent08-test@example.invalid"]);
    await writeFile(join(root, "selected.txt"), "base\n", "utf8");
    await git(root, ["add", "--", "selected.txt"]);
    await git(root, ["commit", "-m", "test: base"]);
    const before = (await git(root, ["rev-parse", "--verify", "HEAD"])).trim();
    await writeFile(join(root, "selected.txt"), "selected change\n", "utf8");
    const runner: FinalizationGitRunner = {
      async run(repoPath, args) {
        if (args[0] === "diff-tree") throw new Error("postflight unavailable");
        return new RealFinalizationGitRunner().run(repoPath, args);
      },
    };
    const finalizationGit = new FinalizationGit(runner);
    const inspection = await finalizationGit.inspectCommit(root, ["selected.txt"]);

    await expect(finalizationGit.commitSelected(root, {
      branch: inspection.branch,
      expectedHead: before,
      selectedPaths: inspection.selectedPaths,
      selectedStateDigest: inspection.selectedStateDigest,
      commitMessage: "fix: verify committed paths",
    })).rejects.toMatchObject({
      code: "FINALIZATION_EXECUTION_FAILED",
      afterOid: expect.stringMatching(/^[a-f0-9]{40}$/),
    });
  });

  test("uses the manifest origin and one exact non-force push refspec", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-push-"));
    const calls: string[][] = [];
    const localOid = "b".repeat(40);
    const remoteOid = "a".repeat(40);
    const canonicalRoot = await realpath(root);
    const runner: FinalizationGitRunner = {
      async run(_repoPath, args) {
        expect(_repoPath).toBe(canonicalRoot);
        calls.push(args);
        const command = args.join(" ");
        if (command === "rev-parse --show-toplevel") return canonicalRoot;
        if (command === "symbolic-ref --quiet --short HEAD") return "feature/finalization\n";
        if (command === "rev-parse --verify HEAD") return `${localOid}\n`;
        if (command === "remote get-url origin") {
          return "https://github.com/tristanzh-dotcom/agent08-gitboard.git\n";
        }
        if (command === "remote get-url --push --all origin") {
          return "https://github.com/tristanzh-dotcom/agent08-gitboard.git\n";
        }
        if (command === "ls-remote --heads origin refs/heads/feature/finalization" ||
            command === "ls-remote --heads https://github.com/tristanzh-dotcom/agent08-gitboard.git refs/heads/feature/finalization") {
          return calls.filter((call) => call[0] === "push").length
            ? `${localOid}\trefs/heads/feature/finalization\n`
            : `${remoteOid}\trefs/heads/feature/finalization\n`;
        }
        if (command === `push --no-follow-tags --recurse-submodules=no origin ${localOid}:refs/heads/feature/finalization`) return "pushed\n";
        throw new Error(`unexpected command: ${command}`);
      },
    };
    const gitControl = new FinalizationGit(runner);

    const inspection = await gitControl.inspectPush(
      root,
      "https://github.com/tristanzh-dotcom/agent08-gitboard.git",
    );
    const result = await gitControl.pushExact(root, inspection);

    expect(inspection.remoteOid).toBe(remoteOid);
    expect(result.remoteAfterOid).toBe(localOid);
    const pushCall = calls.find((args) => args[0] === "push");
    expect(pushCall).toEqual([
      "push",
      "--no-follow-tags",
      "--recurse-submodules=no",
      "origin",
      `${localOid}:refs/heads/feature/finalization`,
    ]);
    expect(pushCall).not.toContain("--force");
    expect(pushCall).not.toContain("--force-with-lease");
  });

  test("records the remote OID if push succeeds but postflight verification is interrupted", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-push-postflight-"));
    const canonicalRoot = await realpath(root);
    const localOid = "b".repeat(40);
    const remoteOid = "a".repeat(40);
    const remoteUrl = "https://github.com/tristanzh-dotcom/agent08-gitboard.git";
    let pushed = false;
    let directPostflightCalls = 0;
    const runner: FinalizationGitRunner = {
      async run(_repoPath, args) {
        const command = args.join(" ");
        if (command === "rev-parse --show-toplevel") return `${canonicalRoot}\n`;
        if (command === "symbolic-ref --quiet --short HEAD") return "main\n";
        if (command === "rev-parse --verify HEAD") return `${localOid}\n`;
        if (command === "remote get-url origin") return `${remoteUrl}\n`;
        if (command === "remote get-url --push --all origin") return `${remoteUrl}\n`;
        if (command === "ls-remote --heads origin refs/heads/main") {
          return `${pushed ? localOid : remoteOid}\trefs/heads/main\n`;
        }
        if (command === `push --no-follow-tags --recurse-submodules=no origin ${localOid}:refs/heads/main`) {
          pushed = true;
          return "pushed\n";
        }
        if (command === `ls-remote --heads ${remoteUrl} refs/heads/main`) {
          directPostflightCalls += 1;
          if (directPostflightCalls === 1) throw new Error("temporary postflight interruption");
          return `${localOid}\trefs/heads/main\n`;
        }
        throw new Error(`unexpected command: ${command}`);
      },
    };
    const finalizationGit = new FinalizationGit(runner);
    const inspection = await finalizationGit.inspectPush(root, remoteUrl);

    await expect(finalizationGit.pushExact(root, inspection)).rejects.toMatchObject({
      code: "FINALIZATION_EXECUTION_FAILED",
      afterOid: localOid,
    });
  });

  test("rejects detached branches and a remote that differs from the manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-remote-"));
    const canonicalRoot = await realpath(root);
    const detached = scriptedRunner(canonicalRoot, {
      "rev-parse --show-toplevel": canonicalRoot,
      "symbolic-ref --quiet --short HEAD": new FinalizationError("FINALIZATION_DETACHED_HEAD"),
    });
    await expect(
      new FinalizationGit(detached).inspectPush(
        root,
        "https://github.com/tristanzh-dotcom/agent08-gitboard.git",
      ),
    ).rejects.toMatchObject({ code: "FINALIZATION_DETACHED_HEAD" });

    const mismatched = scriptedRunner(canonicalRoot, {
      "rev-parse --show-toplevel": canonicalRoot,
      "symbolic-ref --quiet --short HEAD": "main",
      "rev-parse --verify HEAD": "a".repeat(40),
      "remote get-url origin": "https://github.com/example/other.git",
    });
    await expect(
      new FinalizationGit(mismatched).inspectPush(
        root,
        "https://github.com/tristanzh-dotcom/agent08-gitboard.git",
      ),
    ).rejects.toMatchObject({ code: "FINALIZATION_REMOTE_MISMATCH" });
  });

  test("rejects a push URL that differs from the manifest origin", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-push-url-"));
    const canonicalRoot = await realpath(root);
    const runner = scriptedRunner(canonicalRoot, {
      "rev-parse --show-toplevel": canonicalRoot,
      "symbolic-ref --quiet --short HEAD": "main",
      "rev-parse --verify HEAD": "a".repeat(40),
      "remote get-url origin": "https://github.com/tristanzh-dotcom/agent08-gitboard.git\n",
      "remote get-url --push --all origin": "https://github.com/somewhere-else/gitboard.git\n",
    });

    await expect(
      new FinalizationGit(runner).inspectPush(
        root,
        "https://github.com/tristanzh-dotcom/agent08-gitboard.git",
      ),
    ).rejects.toMatchObject({ code: "FINALIZATION_REMOTE_MISMATCH" });
  });

  test("rechecks push destination drift immediately before pushing", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-finalization-push-drift-"));
    const canonicalRoot = await realpath(root);
    const remoteUrl = "https://github.com/tristanzh-dotcom/agent08-gitboard.git";
    let pushUrlChecks = 0;
    let pushCommands = 0;
    const runner: FinalizationGitRunner = {
      async run(_repoPath, args) {
        const command = args.join(" ");
        if (command === "rev-parse --show-toplevel") return `${canonicalRoot}\n`;
        if (command === "symbolic-ref --quiet --short HEAD") return "main\n";
        if (command === "rev-parse --verify HEAD") return `${"a".repeat(40)}\n`;
        if (command === "remote get-url origin") return `${remoteUrl}\n`;
        if (command === "remote get-url --push --all origin") {
          pushUrlChecks += 1;
          return `${pushUrlChecks === 1 ? remoteUrl : "https://github.com/other-owner/other-repo.git"}\n`;
        }
        if (command === "ls-remote --heads origin refs/heads/main") return `${"b".repeat(40)}\trefs/heads/main\n`;
        if (command === `ls-remote --heads ${remoteUrl} refs/heads/main`) {
          return `${pushCommands > 0 ? "a".repeat(40) : "b".repeat(40)}\trefs/heads/main\n`;
        }
        if (args[0] === "push") {
          pushCommands += 1;
          return "pushed\n";
        }
        throw new Error(`unexpected command: ${command}`);
      },
    };
    const finalizationGit = new FinalizationGit(runner);
    const inspection = await finalizationGit.inspectPush(root, remoteUrl);

    await expect(finalizationGit.pushExact(root, inspection)).rejects.toMatchObject({
      code: "FINALIZATION_REMOTE_MISMATCH",
    });
    expect(pushCommands).toBe(0);
  });
});

function scriptedRunner(
  root: string,
  script: Record<string, string | Error>,
): FinalizationGitRunner {
  return {
    async run(repoPath, args) {
      expect(repoPath).toBe(root);
      const result = script[args.join(" ")];
      if (result instanceof Error) throw result;
      if (result === undefined) throw new Error(`unexpected command: ${args.join(" ")}`);
      return result;
    },
  };
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return stdout;
}

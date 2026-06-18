import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { RealGitProxy, assertReadOnlyGitArgs } from "../src/gitboard/realGitProxy.js";
import { RepoScanner } from "../src/gitboard/repoScanner.js";
import type { RepoManifest } from "../src/gitboard/types.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("RealGitProxy integration", () => {
  test("returns different snapshots for different repo paths", async () => {
    const repoA = await createTempRepo("agent02-pvi", "main", "docs: initialize agent02");
    const repoB = await createTempRepo("agent03-prs", "feat/mantou", "feat: initialize mantou");
    const manifest: RepoManifest = {
      version: 1,
      root: tmpdir(),
      generatedAt: "2026-06-18T00:00:00.000Z",
      targets: [
        {
          id: "agent02-pvi",
          agent: "Agent02",
          label: "Vehicle Intelligence",
          path: repoA,
          remote: "local-agent02",
          visibility: "local",
          required: true
        },
        {
          id: "agent03-prs",
          agent: "Agent03",
          label: "Pet Services",
          path: repoB,
          remote: "local-agent03",
          visibility: "local",
          required: true
        }
      ]
    };

    const snapshots = await new RepoScanner(new RealGitProxy()).scanAll(manifest);

    expect(snapshots.map((snapshot) => snapshot.branch)).toEqual(["main", "feat/mantou"]);
    expect(snapshots.map((snapshot) => snapshot.lastCommit.subject)).toEqual([
      "docs: initialize agent02",
      "feat: initialize mantou"
    ]);
  });

  test("rejects mutating git commands at the allowlist boundary", () => {
    expect(() => assertReadOnlyGitArgs(["status", "--porcelain=v2", "--branch"])).not.toThrow();
    expect(() => assertReadOnlyGitArgs(["commit", "-m", "nope"])).toThrow(/not read-only/);
    expect(() => assertReadOnlyGitArgs(["stash", "pop"])).toThrow(/not read-only/);
  });
});

async function createTempRepo(name: string, branch: string, subject: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `${name}-`));
  tempDirs.push(dir);

  await execGit(dir, ["init", "-b", branch]);
  await execGit(dir, ["config", "user.email", "agent08@example.invalid"]);
  await execGit(dir, ["config", "user.name", "Agent08 Test"]);
  await writeFile(join(dir, "README.md"), `# ${name}\n`);
  await execGit(dir, ["add", "README.md"]);
  await execGit(dir, ["commit", "-m", subject]);

  return dir;
}

async function execGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

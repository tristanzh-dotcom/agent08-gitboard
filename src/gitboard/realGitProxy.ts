import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import type { GitProxy } from "./gitProxy.js";
import type { LargeFile } from "./types.js";

const execFileAsync = promisify(execFile);

const ALLOWED_COMMANDS = new Set(["status", "log", "diff", "stash"]);
const IGNORED_DIRS = new Set([".git", "node_modules", "dist", ".venv", "__pycache__", "coverage"]);

export class RealGitProxy implements GitProxy {
  async statusPorcelain(repoPath: string): Promise<string> {
    return runReadOnlyGit(repoPath, ["status", "--porcelain=v2", "--branch"]);
  }

  async lastCommit(repoPath: string): Promise<string> {
    return runReadOnlyGit(repoPath, ["log", "-1", "--format=%h|%s|%aI"]);
  }

  async diffStat(repoPath: string): Promise<string> {
    return runReadOnlyGit(repoPath, ["diff", "--stat", "HEAD"]);
  }

  async stashList(repoPath: string): Promise<string> {
    return runReadOnlyGit(repoPath, ["stash", "list"]);
  }

  async listLargeFiles(repoPath: string, thresholdBytes: number): Promise<LargeFile[]> {
    const results: LargeFile[] = [];
    await collectLargeFiles(repoPath, repoPath, thresholdBytes, results);
    return results.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  }
}

export function assertReadOnlyGitArgs(args: string[]): void {
  const [command, subcommand] = args;
  if (!command || !ALLOWED_COMMANDS.has(command)) {
    throw new Error(`git command is not read-only: ${args.join(" ")}`);
  }
  if (command === "stash" && subcommand !== "list") {
    throw new Error(`git command is not read-only: ${args.join(" ")}`);
  }
  if (args.some((arg) => /^(?:add|commit|push|pull|checkout|reset|clean|rm|mv|apply|pop)$/.test(arg))) {
    throw new Error(`git command is not read-only: ${args.join(" ")}`);
  }
}

async function runReadOnlyGit(repoPath: string, args: string[]): Promise<string> {
  assertReadOnlyGitArgs(args);
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoPath,
    timeout: 10_000,
    maxBuffer: 10 * 1024 * 1024
  });
  return stdout;
}

async function collectLargeFiles(
  root: string,
  dir: string,
  thresholdBytes: number,
  results: LargeFile[]
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) return;

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await collectLargeFiles(root, fullPath, thresholdBytes, results);
        return;
      }
      if (!entry.isFile()) return;

      const fileStat = await stat(fullPath);
      if (fileStat.size > thresholdBytes) {
        results.push({ path: relative(root, fullPath), bytes: fileStat.size });
      }
    })
  );
}

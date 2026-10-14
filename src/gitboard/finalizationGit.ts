import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readdir, readFile, readlink, realpath } from "node:fs/promises";
import { isAbsolute, join, posix } from "node:path";
import { promisify } from "node:util";
import { FinalizationError } from "./finalizationContracts.js";
import { canonicalJson } from "./storageUtils.js";

const execFileAsync = promisify(execFile);

const FULL_OID = /^[a-f0-9]{40}$/;
const SAFE_BRANCH = /^(?!-)(?!.*\.\.)(?!.*@\{)[A-Za-z0-9._/-]+$/;
const SAFE_REMOTE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/;
const BLOCKED_PATH_PREFIXES = [
  "node_modules/",
  "storage/",
  ".cache/",
  ".pytest_cache/",
  ".vite/",
  "build/",
  "coverage/",
];
const SECRET_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
  { kind: "private_key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { kind: "github_token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/ },
  { kind: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: "api_key", pattern: /\bsk-[A-Za-z0-9]{32,}\b/ },
];

export interface FinalizationGitRunner {
  run(repoPath: string, args: string[]): Promise<string>;
}

export interface CommitInspection {
  canonicalRepoPath: string;
  branch: string;
  head: string | null;
  selectedPaths: string[];
  changedPaths: string[];
  selectedStateDigest: string;
}

export interface CommitExecutionInput {
  branch: string;
  expectedHead: string | null;
  selectedPaths: string[];
  selectedStateDigest: string;
  commitMessage: string;
}

export interface CommitExecutionResult {
  commitOid: string;
  parentOid: string | null;
  committedPaths: string[];
  outputSummary: string;
}

export interface PushInspection {
  canonicalRepoPath: string;
  branch: string;
  head: string;
  remote: "origin";
  remoteUrl: string;
  remoteRef: string;
  remoteOid: string | null;
}

export interface PushExecutionResult {
  remoteAfterOid: string;
  outputSummary: string;
}

export class RealFinalizationGitRunner implements FinalizationGitRunner {
  async run(repoPath: string, args: string[]): Promise<string> {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd: repoPath,
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    return stdout || stderr;
  }
}

export class FinalizationGit {
  constructor(private readonly runner: FinalizationGitRunner = new RealFinalizationGitRunner()) {}

  async inspectCommit(repoPath: string, paths: string[]): Promise<CommitInspection> {
    const selectedPathRequests = normalizeSelectedPaths(paths, { allowDirectorySuffix: true });
    const repository = await this.inspectLocalRepository(repoPath);
    const expandedSelection = await expandSelectedPaths(repository.canonicalRepoPath, selectedPathRequests);
    const unmerged = parseNullList(
      await this.runner.run(repository.canonicalRepoPath, ["diff", "--name-only", "--diff-filter=U", "-z"]),
    );
    if (unmerged.length > 0) throw new FinalizationError("FINALIZATION_UNMERGED_PATHS");

    const status = await this.runner.run(repository.canonicalRepoPath, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ...expandedSelection.paths,
    ]);
    const changedPaths = parsePorcelainV1Paths(status);
    const selectedPaths = expandedSelection.paths.filter((path) => changedPaths.includes(path));
    for (const path of expandedSelection.paths) {
      const cameFromDirectory = [...expandedSelection.directoryRequests].some((directory) => path.startsWith(`${directory}/`));
      if (!changedPaths.includes(path) && !cameFromDirectory) {
        throw new FinalizationError("FINALIZATION_PATH_UNCHANGED", path);
      }
    }
    for (const directory of expandedSelection.directoryRequests) {
      if (!selectedPaths.some((path) => path.startsWith(`${directory}/`))) {
        throw new FinalizationError("FINALIZATION_PATH_UNCHANGED", directory);
      }
    }

    const diff = await this.runner.run(repository.canonicalRepoPath, [
      "diff",
      "--raw",
      "-z",
      "--no-ext-diff",
      ...(repository.head === null ? ["--cached"] : ["HEAD"]),
      "--",
      ...selectedPaths,
    ]);
    const fileStates = await Promise.all(
      selectedPaths.map((path) => selectedFileState(repository.canonicalRepoPath, path)),
    );
    const selectedStateDigest = createHash("sha256")
      .update(canonicalJson({
        head: repository.head,
        selectedPaths,
        status,
        diff,
        fileStates,
      }))
      .digest("hex");

    return {
      ...repository,
      selectedPaths,
      changedPaths,
      selectedStateDigest,
    };
  }

  async commitSelected(repoPath: string, input: CommitExecutionInput): Promise<CommitExecutionResult> {
    const selectedPaths = normalizeSelectedPaths(input.selectedPaths);
    const commitMessage = normalizeCommitMessage(input.commitMessage);
    const repository = await this.inspectCommit(repoPath, selectedPaths);
    if (repository.branch !== input.branch) throw new FinalizationError("FINALIZATION_BRANCH_DRIFT");
    if (repository.head !== input.expectedHead) throw new FinalizationError("FINALIZATION_HEAD_DRIFT");
    if (repository.selectedStateDigest !== input.selectedStateDigest) {
      throw new FinalizationError("FINALIZATION_SELECTED_STATE_DRIFT");
    }
    if (!sameStringSet(repository.selectedPaths, selectedPaths)) {
      throw new FinalizationError("FINALIZATION_SELECTED_PATHS_DRIFT");
    }

    const untrackedPaths = parseNullList(await this.runner.run(repository.canonicalRepoPath, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...selectedPaths,
    ]));
    if (untrackedPaths.length > 0) {
      await this.runner.run(repository.canonicalRepoPath, ["add", "--", ...untrackedPaths]);
    }
    try {
      const output = await this.runner.run(repository.canonicalRepoPath, [
        "commit",
        "--only",
        "--no-verify",
        "--no-gpg-sign",
        "-m",
        commitMessage,
        "--",
        ...selectedPaths,
      ]);
      const commitOid = requireOid(
        await this.runner.run(repository.canonicalRepoPath, ["rev-parse", "--verify", "HEAD"]),
        "FINALIZATION_COMMIT_OID_INVALID",
      );
      const parentOid = repository.head === null ? null : requireOid(
        await this.runner.run(repository.canonicalRepoPath, ["rev-parse", "--verify", "HEAD^"]),
        "FINALIZATION_COMMIT_PARENT_INVALID",
      );
      if (repository.head === null) {
        const commitAndParents = (await this.runner.run(repository.canonicalRepoPath, [
          "rev-list", "--parents", "-n", "1", "HEAD",
        ])).trim().split(/\s+/);
        if (commitAndParents.length !== 1 || commitAndParents[0] !== commitOid) {
          throw new FinalizationError("FINALIZATION_COMMIT_PARENT_DRIFT");
        }
      }
      const committedPaths = parseNullList(
        await this.runner.run(repository.canonicalRepoPath, [
          "diff-tree",
          ...(repository.head === null ? ["--root"] : []),
          "--no-commit-id",
          "--name-only",
          "-r",
          "-z",
          "HEAD",
        ]),
      ).sort();
      if (parentOid !== input.expectedHead) throw new FinalizationError("FINALIZATION_COMMIT_PARENT_DRIFT");
      if (!sameStringSet(committedPaths, selectedPaths)) {
        throw new FinalizationError("FINALIZATION_COMMITTED_PATHS_MISMATCH");
      }
      return {
        commitOid,
        parentOid,
        committedPaths,
        outputSummary: summarizeOutput(output, `commit ${commitOid.slice(0, 12)}`),
      };
    } catch (error) {
      const afterOid = await this.readHeadAfterFailure(repository.canonicalRepoPath);
      if (afterOid && afterOid !== input.expectedHead) {
        throw new FinalizationError(
          error instanceof FinalizationError ? error.code : "FINALIZATION_EXECUTION_FAILED",
          undefined,
          undefined,
          afterOid,
        );
      }
      throw error;
    }
  }

  async inspectPush(repoPath: string, manifestRemoteUrl: string): Promise<PushInspection> {
    if (!SAFE_REMOTE.test(manifestRemoteUrl)) {
      throw new FinalizationError("FINALIZATION_MANIFEST_REMOTE_INVALID");
    }
    const repository = await this.inspectLocalRepository(repoPath);
    if (repository.head === null) throw new FinalizationError("FINALIZATION_HEAD_INVALID");
    const head = repository.head;
    const remoteUrl = (
      await this.runner.run(repository.canonicalRepoPath, ["remote", "get-url", "origin"])
    ).trim();
    if (remoteUrl !== manifestRemoteUrl) throw new FinalizationError("FINALIZATION_REMOTE_MISMATCH");
    const pushUrls = parseRemoteUrls(await this.runner.run(repository.canonicalRepoPath, [
      "remote",
      "get-url",
      "--push",
      "--all",
      "origin",
    ]));
    if (pushUrls.length !== 1 || pushUrls[0] !== manifestRemoteUrl) {
      throw new FinalizationError("FINALIZATION_REMOTE_MISMATCH");
    }
    const remoteRef = `refs/heads/${repository.branch}`;
    let remoteOutput: string;
    try {
      remoteOutput = await this.runner.run(repository.canonicalRepoPath, [
        "ls-remote",
        "--heads",
        "origin",
        remoteRef,
      ]);
    } catch (error) {
      throw new FinalizationError(
        "FINALIZATION_REMOTE_INSPECTION_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
    const remoteOid = parseRemoteOid(remoteOutput, remoteRef);
    return {
      ...repository,
      head,
      remote: "origin",
      remoteUrl,
      remoteRef,
      remoteOid,
    };
  }

  async pushExact(_repoPath: string, inspection: PushInspection): Promise<PushExecutionResult> {
    assertSafeBranch(inspection.branch);
    const head = requireOid(inspection.head, "FINALIZATION_PUSH_OID_INVALID");
    const expectedRef = `refs/heads/${inspection.branch}`;
    if (inspection.remote !== "origin" || inspection.remoteRef !== expectedRef) {
      throw new FinalizationError("FINALIZATION_PUSH_TARGET_INVALID");
    }
    const current = await this.inspectPush(inspection.canonicalRepoPath, inspection.remoteUrl);
    if (current.canonicalRepoPath !== inspection.canonicalRepoPath) {
      throw new FinalizationError("FINALIZATION_REPOSITORY_DRIFT");
    }
    if (current.branch !== inspection.branch || current.head !== head) {
      throw new FinalizationError("FINALIZATION_HEAD_DRIFT");
    }
    if (current.remoteRef !== expectedRef || current.remoteOid !== inspection.remoteOid) {
      throw new FinalizationError("FINALIZATION_REMOTE_DRIFT");
    }
    try {
      const output = await this.runner.run(inspection.canonicalRepoPath, [
        "push",
        "--no-follow-tags",
        "--recurse-submodules=no",
        "origin",
        `${head}:${expectedRef}`,
      ]);
      const remoteOutput = await this.runner.run(inspection.canonicalRepoPath, [
        "ls-remote",
        "--heads",
        inspection.remoteUrl,
        expectedRef,
      ]);
      const remoteAfterOid = parseRemoteOid(remoteOutput, expectedRef);
      if (remoteAfterOid !== head) throw new FinalizationError("FINALIZATION_PUSH_POSTCONDITION_FAILED");
      return {
        remoteAfterOid,
        outputSummary: summarizeOutput(output, `pushed ${head.slice(0, 12)} to origin/${inspection.branch}`),
      };
    } catch (error) {
      const remoteAfterOid = await this.readRemoteOidAfterFailure(
        inspection.canonicalRepoPath,
        inspection.remoteUrl,
        expectedRef,
      );
      if (remoteAfterOid !== null && remoteAfterOid !== inspection.remoteOid) {
        throw new FinalizationError(
          error instanceof FinalizationError ? error.code : "FINALIZATION_EXECUTION_FAILED",
          undefined,
          undefined,
          remoteAfterOid,
        );
      }
      throw error;
    }
  }

  private async inspectLocalRepository(repoPath: string): Promise<{
    canonicalRepoPath: string;
    branch: string;
    head: string | null;
  }> {
    const canonicalRepoPath = await realpath(repoPath);
    const reportedTopLevel = (
      await this.runner.run(canonicalRepoPath, ["rev-parse", "--show-toplevel"])
    ).trim();
    if ((await realpath(reportedTopLevel)) !== canonicalRepoPath) {
      throw new FinalizationError("FINALIZATION_REPOSITORY_IDENTITY_MISMATCH");
    }
    let branch: string;
    try {
      branch = (
        await this.runner.run(canonicalRepoPath, ["symbolic-ref", "--quiet", "--short", "HEAD"])
      ).trim();
    } catch (error) {
      if (error instanceof FinalizationError) throw error;
      throw new FinalizationError("FINALIZATION_DETACHED_HEAD");
    }
    assertSafeBranch(branch);
    let head: string | null;
    try {
      head = requireOid(
        await this.runner.run(canonicalRepoPath, ["rev-parse", "--verify", "HEAD"]),
        "FINALIZATION_HEAD_INVALID",
      );
    } catch (error) {
      if (!hasExitCode(error, 128)) throw error;
      try {
        await this.runner.run(canonicalRepoPath, ["rev-parse", "--verify", "--quiet", "HEAD"]);
        throw new FinalizationError("FINALIZATION_HEAD_INVALID");
      } catch (quietError) {
        if (!hasExitCode(quietError, 1)) throw quietError;
      }
      head = null;
    }
    return { canonicalRepoPath, branch, head };
  }

  private async readHeadAfterFailure(repoPath: string): Promise<string | null> {
    try {
      return requireOid(
        await this.runner.run(repoPath, ["rev-parse", "--verify", "HEAD"]),
        "FINALIZATION_HEAD_INVALID",
      );
    } catch {
      return null;
    }
  }

  private async readRemoteOidAfterFailure(
    repoPath: string,
    remoteUrl: string,
    remoteRef: string,
  ): Promise<string | null> {
    try {
      const output = await this.runner.run(repoPath, ["ls-remote", "--heads", remoteUrl, remoteRef]);
      return parseRemoteOid(output, remoteRef);
    } catch {
      return null;
    }
  }
}

export function normalizeSelectedPaths(
  paths: string[],
  options: { allowDirectorySuffix?: boolean } = {},
): string[] {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new FinalizationError("FINALIZATION_PATHS_REQUIRED");
  }
  const normalized = paths.map((raw) => {
    if (typeof raw !== "string") throw new FinalizationError("FINALIZATION_PATH_INVALID");
    let path = raw.replaceAll("\\", "/").replace(/^\.\//, "");
    if (options.allowDirectorySuffix) path = path.replace(/\/$/, "");
    if (
      !path ||
      path === "." ||
      isAbsolute(path) ||
      path.startsWith("-") ||
      path.includes("\0") ||
      path.split("/").some((part) => part === "" || part === "." || part === "..") ||
      posix.normalize(path) !== path
    ) {
      throw new FinalizationError("FINALIZATION_PATH_INVALID", raw);
    }
    if (BLOCKED_PATH_PREFIXES.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix))) {
      throw new FinalizationError("FINALIZATION_PATH_BLOCKED", path);
    }
    return path;
  });
  const unique = [...new Set(normalized)].sort();
  if (unique.length !== normalized.length) throw new FinalizationError("FINALIZATION_PATH_DUPLICATE");
  return unique;
}

async function expandSelectedPaths(repoPath: string, selectedPathRequests: string[]): Promise<{
  paths: string[];
  directoryRequests: Set<string>;
}> {
  const expanded: string[] = [];
  const directoryRequests = new Set<string>();
  for (const path of selectedPathRequests) {
    const absolutePath = join(repoPath, ...path.split("/"));
    try {
      const metadata = await lstat(absolutePath);
      if (metadata.isDirectory()) {
        directoryRequests.add(path);
        await appendDirectoryFiles(repoPath, path, expanded);
      } else {
        expanded.push(path);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      expanded.push(path);
    }
  }
  return { paths: normalizeSelectedPaths(expanded), directoryRequests };
}

async function appendDirectoryFiles(repoPath: string, directory: string, expanded: string[]): Promise<void> {
  const absoluteDirectory = join(repoPath, ...directory.split("/"));
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      await appendDirectoryFiles(repoPath, path, expanded);
    } else {
      expanded.push(path);
    }
  }
}

function normalizeCommitMessage(message: string): string {
  const normalized = typeof message === "string" ? message.trim() : "";
  if (!normalized) throw new FinalizationError("FINALIZATION_COMMIT_MESSAGE_REQUIRED");
  if (normalized.includes("\0") || normalized.length > 500) {
    throw new FinalizationError("FINALIZATION_COMMIT_MESSAGE_INVALID");
  }
  return normalized;
}

async function selectedFileState(repoPath: string, path: string): Promise<Record<string, unknown>> {
  const absolutePath = join(repoPath, ...path.split("/"));
  try {
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) {
      const target = await readlink(absolutePath);
      detectSecret(path, target);
      return {
        path,
        kind: "symlink",
        mode: metadata.mode,
        size: Buffer.byteLength(target),
        contentDigest: createHash("sha256").update(target).digest("hex"),
      };
    }
    if (!metadata.isFile()) throw new FinalizationError("FINALIZATION_PATH_NOT_FILE", path);
    const content = await readFile(absolutePath);
    detectSecret(path, content.toString("utf8"));
    return {
      path,
      kind: "file",
      mode: metadata.mode,
      size: metadata.size,
      contentDigest: createHash("sha256").update(content).digest("hex"),
    };
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return { path, kind: "deleted" };
    throw error;
  }
}

function detectSecret(path: string, content: string): void {
  for (const secret of SECRET_PATTERNS) {
    if (secret.pattern.test(content)) {
      throw new FinalizationError("FINALIZATION_SECRET_DETECTED", `${path}:${secret.kind}`);
    }
  }
}

function parsePorcelainV1Paths(output: string): string[] {
  const records = output.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const status = record.slice(0, 2);
    paths.push(record.slice(3));
    if (/[RC]/.test(status)) {
      const originalPath = records[index + 1];
      if (originalPath) paths.push(originalPath);
      index += 1;
    }
  }
  return [...new Set(paths)].sort();
}

function parseNullList(output: string): string[] {
  return output.split("\0").filter((value) => value !== "").sort();
}

function parseRemoteUrls(output: string): string[] {
  return output.split(/\r?\n/).filter((url) => url !== "");
}

function parseRemoteOid(output: string, remoteRef: string): string | null {
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  if (lines.length !== 1) throw new FinalizationError("FINALIZATION_REMOTE_STATE_AMBIGUOUS");
  const [oid, ref] = lines[0].split(/\s+/);
  if (ref !== remoteRef) throw new FinalizationError("FINALIZATION_REMOTE_STATE_AMBIGUOUS");
  return requireOid(oid, "FINALIZATION_REMOTE_OID_INVALID");
}

function requireOid(output: string, code: string): string {
  const oid = output.trim();
  if (!FULL_OID.test(oid)) throw new FinalizationError(code);
  return oid;
}

function hasExitCode(error: unknown, code: number): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function assertSafeBranch(branch: string): void {
  if (!SAFE_BRANCH.test(branch)) throw new FinalizationError("FINALIZATION_BRANCH_INVALID");
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function summarizeOutput(output: string, fallback: string): string {
  return output.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 160) ?? fallback;
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

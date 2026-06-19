export type MutationGitOperation =
  | "commit"
  | "push"
  | "pull_ff_only"
  | "stash"
  | "rebase"
  | "stash_rebase"
  | "set_upstream"
  | "push_with_upstream";

export interface MutationGitRunner {
  runGit(repoPath: string, args: string[]): Promise<string>;
  isTrackedFile?(repoPath: string, file: string): Promise<boolean>;
}

export interface CommitMutationInput {
  repoPath: string;
  message: string;
  files?: string[];
}

export interface RepoPathMutationInput {
  repoPath: string;
}

export interface UpstreamMutationInput {
  repoPath: string;
  branch: string;
  remote: "origin";
}

export interface StashRebaseMutationInput {
  repoPath: string;
  operationId: string;
  upstream: string;
}

const ALLOWED_MUTATION_OPERATIONS = new Set<MutationGitOperation>([
  "commit",
  "push",
  "pull_ff_only",
  "stash",
  "rebase",
  "stash_rebase",
  "set_upstream",
  "push_with_upstream",
]);

const FORBIDDEN_ARGS = new Set(["--force", "--force-with-lease", "reset", "clean", "checkout", "branch", "-D", "pop", "apply"]);

const ALWAYS_BLOCKED_COMMIT_PATH_PREFIXES = [
  "node_modules/",
  "storage/",
  ".cache/",
  ".pytest_cache/",
  ".vite/",
  "build/",
  "coverage/",
];

const TRACKED_ONLY_COMMIT_PATH_PREFIXES = ["dist/"];

export class MutationGitProxy {
  readonly #runner: MutationGitRunner;

  constructor(runner: MutationGitRunner) {
    this.#runner = runner;
  }

  async commit(input: CommitMutationInput): Promise<string> {
    const message = input.message.trim();
    if (!message) throw new Error("COMMIT_MESSAGE_REQUIRED");
    const files = input.files?.length ? input.files : ["."];
    const addPlan = await planCommitFileAdds(this.#runner, input.repoPath, files);
    if (addPlan.normalFiles.length > 0) {
      await this.#runner.runGit(input.repoPath, ["add", "--", ...addPlan.normalFiles]);
    }
    if (addPlan.forceFiles.length > 0) {
      await this.#runner.runGit(input.repoPath, ["add", "-f", "--", ...addPlan.forceFiles]);
    }
    return this.#runner.runGit(input.repoPath, ["commit", "-m", message]);
  }

  async push(input: RepoPathMutationInput): Promise<string> {
    return this.#runner.runGit(input.repoPath, ["push"]);
  }

  async pullFastForward(input: RepoPathMutationInput): Promise<string> {
    return this.#runner.runGit(input.repoPath, ["pull", "--ff-only"]);
  }

  async stash(input: { repoPath: string; operationId: string }): Promise<string> {
    return this.#runner.runGit(input.repoPath, ["stash", "push", "-u", "-m", `agent08: pre-mutation ${input.operationId}`]);
  }

  async rebase(input: { repoPath: string; upstream: string }): Promise<string> {
    assertUpstream(input.upstream);
    return this.#runner.runGit(input.repoPath, ["rebase", input.upstream]);
  }

  async stashRebase(input: StashRebaseMutationInput): Promise<string> {
    assertUpstream(input.upstream);
    await this.#runner.runGit(input.repoPath, ["stash", "push", "-u", "-m", `agent08: pre-rebase ${input.operationId}`]);
    return this.#runner.runGit(input.repoPath, ["rebase", input.upstream]);
  }

  async setUpstream(input: UpstreamMutationInput): Promise<string> {
    assertOriginRemote(input.remote);
    assertBranch(input.branch);
    return this.#runner.runGit(input.repoPath, [
      "branch",
      "--set-upstream-to",
      `${input.remote}/${input.branch}`,
      input.branch,
    ]);
  }

  async pushWithUpstream(input: UpstreamMutationInput): Promise<string> {
    assertOriginRemote(input.remote);
    assertBranch(input.branch);
    return this.#runner.runGit(input.repoPath, ["push", "-u", input.remote, input.branch]);
  }
}

export function assertAllowedMutationOperation(operation: string): asserts operation is MutationGitOperation {
  if (!ALLOWED_MUTATION_OPERATIONS.has(operation as MutationGitOperation)) {
    throw new Error(`command not allowed: ${operation}`);
  }
}

export function assertMutationArgs(args: string[]): void {
  for (const arg of args) {
    if (FORBIDDEN_ARGS.has(arg)) {
      throw new Error(`command not allowed: ${args.join(" ")}`);
    }
  }
}

async function planCommitFileAdds(
  runner: MutationGitRunner,
  repoPath: string,
  files: string[],
): Promise<{ normalFiles: string[]; forceFiles: string[] }> {
  const normalFiles: string[] = [];
  const forceFiles: string[] = [];

  for (const file of files) {
    const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "");
    if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
      throw new Error(`unsafe commit file path: ${file}`);
    }
    if (pathMatchesPrefixes(normalized, ALWAYS_BLOCKED_COMMIT_PATH_PREFIXES)) {
      throw new Error("COMMIT_PATH_BLOCKED");
    }
    if (pathMatchesPrefixes(normalized, TRACKED_ONLY_COMMIT_PATH_PREFIXES)) {
      if (!(await isTrackedFile(runner, repoPath, normalized))) {
        throw new Error("COMMIT_PATH_BLOCKED");
      }
      forceFiles.push(file);
    } else {
      normalFiles.push(file);
    }
  }

  return { normalFiles, forceFiles };
}

function pathMatchesPrefixes(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix));
}

async function isTrackedFile(runner: MutationGitRunner, repoPath: string, file: string): Promise<boolean> {
  if (runner.isTrackedFile) {
    return runner.isTrackedFile(repoPath, file);
  }

  try {
    await runner.runGit(repoPath, ["ls-files", "--error-unmatch", "--", file]);
    return true;
  } catch {
    return false;
  }
}

function assertUpstream(upstream: string): void {
  if (!/^[A-Za-z0-9._/-]+$/.test(upstream) || upstream.includes("..")) {
    throw new Error(`unsafe upstream: ${upstream}`);
  }
}

function assertBranch(branch: string): void {
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes("..")) {
    throw new Error(`unsafe branch: ${branch}`);
  }
}

function assertOriginRemote(remote: string): asserts remote is "origin" {
  if (remote !== "origin") {
    throw new Error(`unsupported remote: ${remote}`);
  }
}

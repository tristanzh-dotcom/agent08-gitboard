export type MutationGitOperation = "commit" | "push" | "pull_ff_only" | "stash" | "rebase" | "stash_rebase";

export interface MutationGitRunner {
  runGit(repoPath: string, args: string[]): Promise<string>;
}

export interface CommitMutationInput {
  repoPath: string;
  message: string;
  files?: string[];
}

export interface RepoPathMutationInput {
  repoPath: string;
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
]);

const FORBIDDEN_ARGS = new Set(["--force", "--force-with-lease", "reset", "clean", "checkout", "branch", "-D", "pop", "apply"]);

export class MutationGitProxy {
  readonly #runner: MutationGitRunner;

  constructor(runner: MutationGitRunner) {
    this.#runner = runner;
  }

  async commit(input: CommitMutationInput): Promise<string> {
    const message = input.message.trim();
    if (!message) throw new Error("COMMIT_MESSAGE_REQUIRED");
    const files = input.files?.length ? input.files : ["."];
    assertCommitFilePaths(files);
    await this.#runner.runGit(input.repoPath, ["add", "--", ...files]);
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

function assertCommitFilePaths(files: string[]): void {
  for (const file of files) {
    if (file.startsWith("/") || file.includes("..")) {
      throw new Error(`unsafe commit file path: ${file}`);
    }
  }
}

function assertUpstream(upstream: string): void {
  if (!/^[A-Za-z0-9._/-]+$/.test(upstream) || upstream.includes("..")) {
    throw new Error(`unsafe upstream: ${upstream}`);
  }
}

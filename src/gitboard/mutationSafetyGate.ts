import { randomUUID } from "node:crypto";
import { normalize } from "node:path";
import type { RepoSnapshot } from "./types.js";
import type { MutationGitOperation } from "./mutationGitProxy.js";

type SafetyOperation = MutationGitOperation;

interface ConfirmationTokenRecord {
  token: string;
  operationId: string;
  repoId: string;
  operation: SafetyOperation;
  preflightSnapshotId: string;
  createdAtMs: number;
  consumed: boolean;
}

export interface CreateConfirmationTokenInput {
  operationId: string;
  repoId: string;
  operation: SafetyOperation;
  preflightSnapshotId: string;
}

export interface ConfirmationTokenResult {
  token: string;
  expiresAtMs: number;
}

export interface MutationSafetyGateOptions {
  allowedRepos: Map<string, string>;
  now?: () => number;
}

export interface AssertCanMutateInput {
  repoId: string;
  repoPath: string;
  operation: SafetyOperation;
  preflightSnapshotId: string;
  confirmationToken: string;
  currentSnapshot: RepoSnapshot;
  mergeInProgress?: boolean;
  rebaseInProgress?: boolean;
}

export class MutationSafetyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "MutationSafetyError";
    this.code = code;
  }
}

const TOKEN_TTL_MS = 60_000;

export class MutationSafetyGate {
  readonly #allowedRepos: Map<string, string>;
  readonly #now: () => number;
  readonly #tokens = new Map<string, ConfirmationTokenRecord>();

  constructor(options: MutationSafetyGateOptions) {
    this.#allowedRepos = options.allowedRepos;
    this.#now = options.now ?? (() => Date.now());
  }

  createConfirmationToken(input: CreateConfirmationTokenInput): ConfirmationTokenResult {
    const token = randomUUID();
    const createdAtMs = this.#now();
    this.#tokens.set(token, {
      token,
      operationId: input.operationId,
      repoId: input.repoId,
      operation: input.operation,
      preflightSnapshotId: input.preflightSnapshotId,
      createdAtMs,
      consumed: false,
    });
    return { token, expiresAtMs: createdAtMs + TOKEN_TTL_MS };
  }

  assertCanMutate(input: AssertCanMutateInput): void {
    this.#assertRepoAllowed(input.repoId, input.repoPath);
    this.#consumeValidToken(input);
    if (input.mergeInProgress || input.rebaseInProgress) throw new MutationSafetyError("MERGE_OR_REBASE_IN_PROGRESS");
    if (!input.currentSnapshot.branch) throw new MutationSafetyError("DETACHED_HEAD_BLOCKS_MUTATION");
    if (input.operation === "commit" && hasUnmergedFiles(input.currentSnapshot)) {
      throw new MutationSafetyError("UNMERGED_BLOCKS_COMMIT");
    }
    if (requiresUpstream(input.operation) && !input.currentSnapshot.upstream) throw new MutationSafetyError("UPSTREAM_MISSING");
    if (input.operation === "pull_ff_only") this.#assertCanPull(input.currentSnapshot);
    if (input.operation === "push") this.#assertCanPush(input.currentSnapshot);
    if (input.operation === "set_upstream") this.#assertCanSetUpstream(input.currentSnapshot);
    if (input.operation === "push_with_upstream") this.#assertCanPushWithUpstream(input.currentSnapshot);
  }

  #assertRepoAllowed(repoId: string, repoPath: string): void {
    const allowedPath = this.#allowedRepos.get(repoId);
    if (!allowedPath || normalize(repoPath) !== normalize(allowedPath)) {
      throw new MutationSafetyError("REPO_NOT_ALLOWED");
    }
  }

  #consumeValidToken(input: AssertCanMutateInput): void {
    if (!input.confirmationToken) throw new MutationSafetyError("CONFIRMATION_TOKEN_REQUIRED");
    const token = this.#tokens.get(input.confirmationToken);
    if (!token) throw new MutationSafetyError("CONFIRMATION_TOKEN_MISMATCH");
    if (token.consumed) throw new MutationSafetyError("CONFIRMATION_TOKEN_USED");
    if (this.#now() - token.createdAtMs > TOKEN_TTL_MS) {
      token.consumed = true;
      throw new MutationSafetyError("CONFIRMATION_TOKEN_EXPIRED");
    }
    if (
      token.repoId !== input.repoId ||
      token.operation !== input.operation ||
      token.preflightSnapshotId !== input.preflightSnapshotId
    ) {
      token.consumed = true;
      throw new MutationSafetyError("CONFIRMATION_TOKEN_MISMATCH");
    }
    token.consumed = true;
  }

  #assertCanPull(snapshot: RepoSnapshot): void {
    if (hasDirtyFiles(snapshot)) throw new MutationSafetyError("DIRTY_BLOCKS_PULL");
    if (snapshot.ahead > 0 && snapshot.behind > 0) throw new MutationSafetyError("DIVERGED_BLOCKS_SIMPLE_PULL");
  }

  #assertCanPush(snapshot: RepoSnapshot): void {
    if (snapshot.behind > 0) throw new MutationSafetyError("DIVERGED_BLOCKS_SIMPLE_PUSH");
    if (hasDirtyFiles(snapshot)) throw new MutationSafetyError("DIRTY_BLOCKS_PUSH");
  }

  #assertCanSetUpstream(snapshot: RepoSnapshot): void {
    if (hasDirtyFiles(snapshot)) throw new MutationSafetyError("DIRTY_BLOCKS_SET_UPSTREAM");
    if (snapshot.upstream) throw new MutationSafetyError("UPSTREAM_ALREADY_SET");
    if (!snapshot.remoteHasBranch) throw new MutationSafetyError("REMOTE_BRANCH_REQUIRED_FOR_SET_UPSTREAM");
    assertSafeBranch(snapshot.branch);
  }

  #assertCanPushWithUpstream(snapshot: RepoSnapshot): void {
    if (hasDirtyFiles(snapshot)) throw new MutationSafetyError("DIRTY_BLOCKS_PUSH_WITH_UPSTREAM");
    if (snapshot.upstream) throw new MutationSafetyError("UPSTREAM_ALREADY_SET");
    if (snapshot.ahead > 0 && snapshot.behind > 0) throw new MutationSafetyError("DIVERGED_BLOCKS_PUSH_WITH_UPSTREAM");
    if (snapshot.behind > 0) throw new MutationSafetyError("BEHIND_BLOCKS_PUSH_WITH_UPSTREAM");
    if (snapshot.commitsToPushCount <= 0) throw new MutationSafetyError("NO_COMMITS_TO_PUSH_WITH_UPSTREAM");
    assertSafeBranch(snapshot.branch);
  }
}

function requiresUpstream(operation: SafetyOperation): boolean {
  return operation === "push" || operation === "pull_ff_only" || operation === "rebase" || operation === "stash_rebase";
}

function hasDirtyFiles(snapshot: RepoSnapshot): boolean {
  return (
    snapshot.dirty.modified.length +
      snapshot.dirty.untracked.length +
      snapshot.dirty.deleted.length +
      snapshot.dirty.renamed.length +
      (snapshot.dirty.unmerged?.length ?? 0) >
    0
  );
}

function hasUnmergedFiles(snapshot: RepoSnapshot): boolean {
  return (snapshot.dirty.unmerged?.length ?? 0) > 0;
}

function assertSafeBranch(branch: string | null): asserts branch is string {
  if (!branch || !/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes("..")) {
    throw new MutationSafetyError("UNSAFE_BRANCH_NAME");
  }
}

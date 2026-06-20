import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface MutationPreflightSnapshot {
  operationId: string;
  repoId: string;
  repoPath: string;
  operation: string;
  createdAt: string;
  branch: string | null;
  upstream: string | null;
  remote?: "origin";
  remoteTrackingBranch?: string | null;
  remoteHasBranch?: boolean;
  ahead: number;
  behind: number;
  commitsToPushCount?: number;
  commitsToPushSubjects?: string[];
  dirty: {
    modified: string[];
    untracked: string[];
    deleted: string[];
    renamed: string[];
    unmerged?: string[];
  };
  lastCommitSha: string | null;
  worktreeState: string;
}

export interface MutationSnapshotResult<T> {
  snapshotPath: string;
  result: T;
}

export class MutationSnapshotError extends Error {
  readonly code = "SNAPSHOT_WRITE_FAILED";

  constructor(cause: unknown) {
    super(`SNAPSHOT_WRITE_FAILED: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "MutationSnapshotError";
  }
}

export class MutationSnapshotStore {
  constructor(private readonly root: string) {}

  async runWithPreflightSnapshot<T>(
    input: MutationPreflightSnapshot,
    mutation: (snapshotPath: string) => Promise<T>,
  ): Promise<MutationSnapshotResult<T>> {
    const snapshotPath = await this.savePreflightSnapshot(input);
    const result = await mutation(snapshotPath);
    return { snapshotPath, result };
  }

  async savePreflightSnapshot(input: MutationPreflightSnapshot): Promise<string> {
    const dir = join(this.root, "storage", "mutations");
    const snapshotPath = join(dir, `${input.operationId}.json`);
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(snapshotPath, `${JSON.stringify(sanitizePreflight(input), null, 2)}\n`, "utf8");
      return snapshotPath;
    } catch (error) {
      throw new MutationSnapshotError(error);
    }
  }
}

function sanitizePreflight(input: MutationPreflightSnapshot): MutationPreflightSnapshot & { selfMutation: boolean } {
  return {
    operationId: input.operationId,
    repoId: input.repoId,
    repoPath: input.repoPath,
    operation: input.operation,
    createdAt: input.createdAt,
    branch: input.branch,
    upstream: input.upstream,
    remote: input.remote,
    remoteTrackingBranch: input.remoteTrackingBranch,
    remoteHasBranch: input.remoteHasBranch,
    ahead: input.ahead,
    behind: input.behind,
    commitsToPushCount: input.commitsToPushCount,
    commitsToPushSubjects: input.commitsToPushSubjects ? [...input.commitsToPushSubjects] : undefined,
    dirty: {
      modified: [...input.dirty.modified],
      untracked: [...input.dirty.untracked],
      deleted: [...input.dirty.deleted],
      renamed: [...input.dirty.renamed],
      unmerged: [...(input.dirty.unmerged ?? [])],
    },
    lastCommitSha: input.lastCommitSha,
    worktreeState: input.worktreeState,
    selfMutation: input.repoId === "agent08-gitboard",
  };
}

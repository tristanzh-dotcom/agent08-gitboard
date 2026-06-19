import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function preflight(overrides = {}) {
  return {
    operationId: "op-1",
    repoId: "agent02-pvi",
    repoPath: "/Users/tristanzh/agent/agent02-pvi",
    operation: "commit",
    createdAt: "2026-06-19T00:00:00.000Z",
    branch: "main",
    upstream: "origin/main",
    ahead: 1,
    behind: 0,
    dirty: {
      modified: ["src/index.ts"],
      untracked: [],
      deleted: [],
      renamed: [],
    },
    lastCommitSha: "abc123",
    worktreeState: "dirty",
    confirmationToken: "secret-token-must-not-persist",
    rawFileContents: "private source must not persist",
    ...overrides,
  };
}

describe("MutationSnapshotStore", () => {
  test("writes the preflight snapshot before executing the mutation callback", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-mutation-store-"));
    tempDirs.push(root);
    const { MutationSnapshotStore } = await import("../src/gitboard/mutationSnapshotStore.js");
    const store = new MutationSnapshotStore(root);
    const events: string[] = [];

    const result = await store.runWithPreflightSnapshot(preflight(), async (snapshotPath: string) => {
      events.push("mutation");
      const json = JSON.parse(await readFile(snapshotPath, "utf8"));
      expect(json.operationId).toBe("op-1");
      events.push("snapshot-readable-before-command");
      return "ok";
    });

    expect(result.result).toBe("ok");
    expect(events).toEqual(["mutation", "snapshot-readable-before-command"]);
    expect(result.snapshotPath).toBe(join(root, "storage", "mutations", "op-1.json"));
  });

  test("blocks mutation execution when the preflight snapshot cannot be written", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-mutation-store-block-"));
    tempDirs.push(root);
    await writeFile(join(root, "storage"), "not a directory");
    const { MutationSnapshotStore } = await import("../src/gitboard/mutationSnapshotStore.js");
    const store = new MutationSnapshotStore(root);
    let executed = false;

    await expect(
      store.runWithPreflightSnapshot(preflight(), async () => {
        executed = true;
      }),
    ).rejects.toThrow(/SNAPSHOT_WRITE_FAILED/);

    expect(executed).toBe(false);
  });

  test("does not persist confirmation tokens or raw file contents", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-mutation-store-redact-"));
    tempDirs.push(root);
    const { MutationSnapshotStore } = await import("../src/gitboard/mutationSnapshotStore.js");
    const store = new MutationSnapshotStore(root);

    const result = await store.runWithPreflightSnapshot(preflight(), async () => "ok");
    const text = await readFile(result.snapshotPath, "utf8");

    expect(text).not.toContain("secret-token-must-not-persist");
    expect(text).not.toContain("private source must not persist");
    expect(text).toContain("src/index.ts");
  });

  test("marks self-mutation snapshots for agent08-gitboard", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent08-mutation-store-self-"));
    tempDirs.push(root);
    const { MutationSnapshotStore } = await import("../src/gitboard/mutationSnapshotStore.js");
    const store = new MutationSnapshotStore(root);

    const result = await store.runWithPreflightSnapshot(
      preflight({
        operationId: "self-op",
        repoId: "agent08-gitboard",
        repoPath: "/Users/tristanzh/agent/agent08-gitboard",
      }),
      async () => "ok",
    );
    const json = JSON.parse(await readFile(result.snapshotPath, "utf8"));

    expect(json.selfMutation).toBe(true);
  });
});

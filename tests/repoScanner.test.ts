import { describe, expect, test } from "vitest";
import { createDefaultManifest } from "../src/gitboard/manifest.js";
import { RepoScanner } from "../src/gitboard/repoScanner.js";
import type { GitProxy } from "../src/gitboard/gitProxy.js";

const fakeGit: GitProxy = {
  async statusPorcelain(_repoPath) {
    return [
      "# branch.oid abcdef1234567890",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1"
    ].join("\n");
  },
  async lastCommit(_repoPath) {
    return "abcdef1|docs: restore repo split state|2026-06-18T15:00:00.000Z";
  },
  async diffStat(_repoPath) {
    return "3 files changed, 20 insertions(+), 4 deletions(-)";
  },
  async stashList(_repoPath) {
    return "";
  },
  async listLargeFiles(_repoPath, _thresholdBytes) {
    return [];
  }
};

describe("RepoScanner M1 multi-repo dashboard scan", () => {
  test("scans all 9 manifest targets including self-monitoring agent08", async () => {
    const manifest = createDefaultManifest("/Users/tristanzh/agent");
    const scanner = new RepoScanner(fakeGit);

    const snapshots = await scanner.scanAll(manifest);

    expect(snapshots).toHaveLength(9);
    expect(snapshots.map((snapshot) => snapshot.id)).toContain("agent08-gitboard");
    expect(snapshots[0]).toMatchObject({
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
      lastCommit: {
        sha: "abcdef1",
        subject: "docs: restore repo split state",
        authorDate: "2026-06-18T15:00:00.000Z"
      }
    });
  });

  test("marks upstream null as missing upstream when origin branch exists", async () => {
    const git = {
      ...fakeGit,
      async statusPorcelain(_repoPath: string) {
        return ["# branch.head main"].join("\n");
      },
      async remoteHasBranch(_repoPath: string, branch: string) {
        expect(branch).toBe("main");
        return true;
      },
      async commitsToPushSubjects(_repoPath: string, _branch: string, _remoteHasBranch: boolean) {
        return [];
      }
    } as unknown as GitProxy;
    const scanner = new RepoScanner(git);

    const [snapshot] = await scanner.scanAll(createDefaultManifest("/Users/tristanzh/agent"));

    expect(snapshot).toMatchObject({
      upstream: null,
      remoteTrackingBranch: "origin/main",
      remoteHasBranch: true,
      upstreamState: "missing_upstream_remote_exists",
      commitsToPushCount: 0,
      commitsToPushSubjects: []
    });
  });

  test("marks configured upstream as orphaned when origin branch is unreachable", async () => {
    const git = {
      ...fakeGit,
      async statusPorcelain(_repoPath: string) {
        return ["# branch.head main", "# branch.upstream origin/main", "# branch.ab +0 -0"].join("\n");
      },
      async remoteHasBranch(_repoPath: string, branch: string) {
        expect(branch).toBe("main");
        return false;
      },
      async commitsToPushSubjects(_repoPath: string, _branch: string, _remoteHasBranch: boolean) {
        return [];
      }
    } as unknown as GitProxy;
    const scanner = new RepoScanner(git);

    const [snapshot] = await scanner.scanAll(createDefaultManifest("/Users/tristanzh/agent"));

    expect(snapshot).toMatchObject({
      upstream: "origin/main",
      remoteTrackingBranch: "origin/main",
      remoteHasBranch: false,
      upstreamState: "orphaned_upstream"
    });
  });

  test("reports no commits to publish when upstream and remote branch are missing", async () => {
    const git = {
      ...fakeGit,
      async statusPorcelain(_repoPath: string) {
        return ["# branch.head main"].join("\n");
      },
      async remoteHasBranch(_repoPath: string, branch: string) {
        expect(branch).toBe("main");
        return false;
      },
      async commitsToPushSubjects(_repoPath: string, branch: string, remoteHasBranch: boolean) {
        expect(branch).toBe("main");
        expect(remoteHasBranch).toBe(false);
        return [];
      }
    } as unknown as GitProxy;
    const scanner = new RepoScanner(git);

    const [snapshot] = await scanner.scanAll(createDefaultManifest("/Users/tristanzh/agent"));

    expect(snapshot).toMatchObject({
      upstreamState: "missing_upstream_remote_missing",
      remoteHasBranch: false,
      commitsToPushCount: 0,
      commitsToPushSubjects: []
    });
  });

  test("caps candidate commit subjects to five entries", async () => {
    const git = {
      ...fakeGit,
      async statusPorcelain(_repoPath: string) {
        return ["# branch.head main"].join("\n");
      },
      async remoteHasBranch(_repoPath: string, _branch: string) {
        return false;
      },
      async commitsToPushSubjects(_repoPath: string, _branch: string, _remoteHasBranch: boolean) {
        return ["one", "two", "three", "four", "five", "six"];
      }
    } as unknown as GitProxy;
    const scanner = new RepoScanner(git);

    const [snapshot] = await scanner.scanAll(createDefaultManifest("/Users/tristanzh/agent"));

    expect(snapshot.commitsToPushSubjects).toEqual(["one", "two", "three", "four", "five"]);
    expect(snapshot.commitsToPushCount).toBe(5);
  });
});

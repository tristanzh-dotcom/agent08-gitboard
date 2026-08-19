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
  test("scans all 15 manifest targets including Agent11, Agent12, Agent13, Agent14, and home-platform projects", async () => {
    const manifest = createDefaultManifest("/Users/tristanzh/agent");
    const scanner = new RepoScanner(fakeGit);

    const snapshots = await scanner.scanAll(manifest);

    expect(snapshots).toHaveLength(15);
    expect(snapshots.map((snapshot) => snapshot.id)).toContain("agent08-gitboard");
    expect(snapshots.map((snapshot) => snapshot.id)).toContain("agent10-asset-library");
    expect(snapshots.map((snapshot) => snapshot.id)).toContain("agent11-fishtank-monitor");
    expect(snapshots.map((snapshot) => snapshot.id)).toContain("agent12-fishtank-3dtwin");
    expect(snapshots.map((snapshot) => snapshot.id)).toContain("agent13-esp-reminder");
    expect(snapshots.map((snapshot) => snapshot.id)).toContain("home-platform");
    expect(snapshots.map((snapshot) => snapshot.id)).toContain("agent14-ppt2html");
    expect(manifest.targets).toContainEqual(
      expect.objectContaining({
        id: "agent11-fishtank-monitor",
        agent: "Agent11",
        path: "/Users/tristanzh/agent/agent11-fishtank-monitor",
        remote: "https://github.com/tristanzh-dotcom/agent11-fishtank-monitor.git",
        visibility: "private",
      }),
    );
    expect(manifest.targets).toContainEqual(
      expect.objectContaining({
        id: "agent12-fishtank-3dtwin",
        agent: "Agent12",
        label: "Fishtank 3D Twin",
        path: "/Users/tristanzh/agent/agent12-fishtank-3Dtwin",
        remote: "https://github.com/tristanzh-dotcom/agent12-fishtank-3dtwin.git",
        visibility: "private",
      }),
    );
    expect(manifest.targets).toContainEqual(
      expect.objectContaining({
        id: "agent13-esp-reminder",
        agent: "Agent13",
        label: "ESP Reminder",
        path: "/Users/tristanzh/agent/agent13-esp-reminder",
        remote: "https://github.com/tristanzh-dotcom/agent13-esp-reminder.git",
        visibility: "private",
      }),
    );
    expect(manifest.targets).toContainEqual(
      expect.objectContaining({
        id: "home-platform",
        agent: null,
        label: "Home Platform",
        path: "/Users/tristanzh/agent/home-platform",
        remote: "https://github.com/tristanzh-dotcom/home-platform.git",
        visibility: "private",
      }),
    );
    expect(manifest.targets).toContainEqual(
      expect.objectContaining({
        id: "agent14-ppt2html",
        agent: "Agent14",
        label: "PPT/PDF to Editable HTML",
        path: "/Users/tristanzh/agent/agent14-ppt2html",
        remote: "https://github.com/tristanzh-dotcom/agent14-ppt2html.git",
        visibility: "private",
      }),
    );
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

  test("marks an existing non-Git directory as initializable", async () => {
    const nonGitDirectory: GitProxy = {
      async statusPorcelain() {
        throw new Error("fatal: not a git repository (or any of the parent directories): .git");
      },
      async lastCommit() {
        return "";
      },
      async diffStat() {
        return "";
      },
      async stashList() {
        return "";
      },
      async listLargeFiles() {
        return [];
      },
    };
    const scanner = new RepoScanner(nonGitDirectory, { exists: async () => true });
    const [snapshot] = await scanner.scanAll({
      version: 1,
      root: "/Users/tristanzh/agent",
      generatedAt: "2026-07-16T00:00:00.000Z",
      targets: [
        {
          id: "agent11-fishtank-monitor",
          agent: "Agent11",
          label: "Fishtank Monitor",
          path: "/Users/tristanzh/agent/agent11-fishtank-monitor",
          remote: "",
          visibility: "local",
          required: true,
        },
      ],
    });

    expect(snapshot).toMatchObject({
      id: "agent11-fishtank-monitor",
      exists: false,
      initializable: true,
      branch: null,
      upstream: null,
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

  test("marks remote probe failures separately from missing upstream branches", async () => {
    const git = {
      ...fakeGit,
      async statusPorcelain(_repoPath: string) {
        return [
          "# branch.head main",
          "# branch.upstream origin/main",
          "# branch.ab +0 -0",
          "1 .M N... 100644 100644 100644 abcdef1234567890 abcdef1234567890 workflows/mantou-dog/mcht_app.py"
        ].join("\n");
      },
      async remoteBranchState(_repoPath: string, branch: string) {
        expect(branch).toBe("main");
        return "unknown" as const;
      },
      async commitsToPushSubjects(_repoPath: string, _branch: string, remoteHasBranch: boolean) {
        expect(remoteHasBranch).toBe(false);
        return [];
      }
    } as unknown as GitProxy;
    const scanner = new RepoScanner(git);

    const [snapshot] = await scanner.scanAll(createDefaultManifest("/Users/tristanzh/agent"));

    expect(snapshot).toMatchObject({
      upstream: "origin/main",
      remoteTrackingBranch: "origin/main",
      remoteHasBranch: false,
      upstreamState: "remote_check_failed",
      dirty: {
        modified: ["workflows/mantou-dog/mcht_app.py"]
      }
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

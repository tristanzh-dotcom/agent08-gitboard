import { describe, expect, test } from "vitest";
import type { FinalizationService } from "../src/gitboard/finalizationService.js";
import { createGitControlService, parseStashList } from "../src/gitboard/gitControlService.js";
import type { GitProxy } from "../src/gitboard/gitProxy.js";
import type { RepoManifest } from "../src/gitboard/types.js";

const manifest: RepoManifest = {
  version: 2,
  root: "/Users/tristanzh/agent",
  generatedAt: "2026-07-30T00:00:00.000Z",
  targets: [{
    id: "agent08-gitboard",
    agent: "Agent08",
    ownerId: "agent08",
    kind: "governance",
    lifecycle: "active",
    label: "Git Console",
    path: "/Users/tristanzh/agent/agent08-gitboard",
    remote: "https://github.com/tristanzh-dotcom/agent08-gitboard.git",
    visibility: "public",
    required: true,
  }],
};

const dirtyGit: GitProxy = {
  async statusPorcelain() {
    return [
      "# branch.oid abcdef1234567890",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +1 -0",
      "1 .M N... 100644 100644 100644 abcdef abcdef src/app.ts",
    ].join("\n");
  },
  async lastCommit() {
    return "abcdef1|feat: current|2026-07-30T00:00:00.000Z";
  },
  async diffStat() {
    return " src/app.ts | 1 +";
  },
  async stashList() {
    return "stash@{0}: WIP on main: abcdef1 local work";
  },
  async listLargeFiles() {
    return [];
  },
  async remoteHasBranch() {
    return true;
  },
  async commitsToPushSubjects() {
    return ["feat: current"];
  },
};

describe("GitControlService v1.4 facade", () => {
  test("includes staged additions in the browser repository truth", async () => {
    const service = createGitControlService({
      manifest,
      git: {
        ...dirtyGit,
        async statusPorcelain() {
          return "# branch.head main\n1 A. N... 000000 100644 100644 000000 abcdef docs/new.md";
        },
      },
      finalizationService: finalizationFixture(),
    });

    const scan = await service.scan();

    expect(scan.repositories[0].repoTruth).toMatchObject({
      state: "dirty",
      changeCount: 1,
      changes: [{ path: "docs/new.md", status: "added" }],
    });
  });

  test("returns one browser-safe canonical scan and detail projection", async () => {
    const service = createGitControlService({
      manifest,
      git: dirtyGit,
      finalizationService: finalizationFixture(),
      now: () => new Date("2026-07-30T10:00:00.000Z"),
    });

    const scan = await service.scan();
    const detail = await service.repoDetail("agent08-gitboard");

    expect(scan).toMatchObject({
      schemaVersion: 2,
      observation: {
        state: "verified",
        observedAt: "2026-07-30T10:00:00.000Z",
        reasonCode: null,
      },
      repositories: [{
        repoId: "agent08-gitboard",
        label: "Git Console",
        ownerId: "agent08",
        kind: "governance",
        lifecycle: "active",
        availability: "git_repository",
        repoTruth: {
          state: "dirty",
          changeCount: 1,
          conflictCount: 0,
          changes: [{ path: "src/app.ts", status: "modified" }],
        },
        pushability: {
          state: "pushable",
          commitCount: 1,
          ahead: 1,
          behind: 0,
          reasonCode: null,
        },
        actions: {
          commit: { state: "enabled", reasonCode: null },
          push: { state: "enabled", reasonCode: null },
        },
      }],
    });
    expect(scan).not.toHaveProperty("dashboard");
    expect(scan).not.toHaveProperty("cards");
    expect(detail).toEqual({
      schemaVersion: 2,
      repository: scan.repositories[0],
      stashCount: 1,
    });
    const serialized = JSON.stringify({ scan, detail });
    expect(serialized).not.toContain("/Users/tristanzh/agent");
    expect(serialized).not.toContain("github.com");
    expect(serialized).not.toContain("stash@{0}");
    expect(serialized).not.toContain("local work");
  });

  test("forwards source-aware commit and push finalization proposals", async () => {
    const calls: unknown[] = [];
    const finalization = finalizationFixture();
    finalization.prepareCommit = async (repoId, proposal) => {
      calls.push(["prepareCommit", repoId, proposal]);
      return { operationId: "op-1" } as never;
    };
    finalization.preparePush = async (repoId, proposal) => {
      calls.push(["preparePush", repoId, proposal]);
      return { operationId: "op-2" } as never;
    };
    finalization.confirmFinalization = async (operationId) => {
      calls.push(["confirm", operationId]);
      return { operationId, confirmationToken: "token", expiresAt: "later" };
    };
    finalization.executeFinalization = async (operationId, token) => {
      calls.push(["execute", operationId, token]);
      return { operationId } as never;
    };
    const service = createGitControlService({ manifest, git: dirtyGit, finalizationService: finalization });
    const commitProposal = {
      selectedPaths: ["src/app.ts"],
      commitMessage: "feat: selected",
      source: "codex" as const,
    };
    const pushProposal = { expectedHead: "a".repeat(40), source: "manual" as const };

    await service.prepareCommit("agent08-gitboard", commitProposal);
    await service.preparePush("agent08-gitboard", pushProposal);
    await service.confirmFinalization("op-1");
    await service.executeFinalization("op-1", "token");

    expect(calls).toEqual([
      ["prepareCommit", "agent08-gitboard", commitProposal],
      ["preparePush", "agent08-gitboard", pushProposal],
      ["confirm", "op-1"],
      ["execute", "op-1", "token"],
    ]);
    expect("prepareMutation" in service).toBe(false);
    expect("mutate" in service).toBe(false);
  });

  test("keeps a failed repository detail unverified without a second stash read", async () => {
    let stashReads = 0;
    const failingGit: GitProxy = {
      ...dirtyGit,
      async statusPorcelain() {
        throw new Error("fatal: index.lock prevents reading status");
      },
      async stashList() {
        stashReads += 1;
        if (stashReads > 1) throw new Error("detail repeated the failed repository read");
        return "";
      },
    };
    const service = createGitControlService({
      manifest,
      git: failingGit,
      finalizationService: finalizationFixture(),
      now: () => new Date("2026-07-30T10:00:00.000Z"),
    });

    await expect(service.repoDetail("agent08-gitboard")).resolves.toMatchObject({
      schemaVersion: 2,
      repository: {
        observation: { state: "unverified", reasonCode: "REPO_SCAN_FAILED" },
        repoTruth: { state: "unknown", changes: [] },
        pushability: { state: "unknown" },
      },
      stashCount: 0,
    });
    expect(stashReads).toBe(1);
  });

  test("parses read-only stash metadata without making it a controlled mutation", () => {
    expect(parseStashList("stash@{2}: On feature: local checkpoint")).toEqual([{
      index: 2,
      selector: "stash@{2}",
      message: "On feature: local checkpoint",
      branch: null,
      createdAt: null,
    }]);
  });
});

function finalizationFixture(): FinalizationService {
  return {
    async prepareCommit() {
      return {} as never;
    },
    async preparePush() {
      return {} as never;
    },
    async confirmFinalization() {
      return {} as never;
    },
    async executeFinalization() {
      return {} as never;
    },
    async finalizationStatus() {
      return {} as never;
    },
  };
}

import { describe, expect, test } from "vitest";
import {
  createGitControlHttpServiceWithBackendManager,
  resolveGitControlListenConfig,
} from "../src/gitboard/gitControlServerMain.js";

describe("git control server config", () => {
  test("uses loopback and a stable Agent08 port by default", () => {
    expect(resolveGitControlListenConfig({})).toEqual({
      host: "127.0.0.1",
      port: 3108,
    });
  });

  test("accepts explicit environment overrides", () => {
    expect(
      resolveGitControlListenConfig({
        AGENT08_GIT_CONTROL_HOST: "localhost",
        AGENT08_GIT_CONTROL_PORT: "4108",
      }),
    ).toEqual({
      host: "localhost",
      port: 4108,
    });
  });

  test("git control service wrapper exposes backend start and restart through BackendProcessManager", async () => {
    const calls: string[] = [];
    const service = createGitControlHttpServiceWithBackendManager({
      baseService: {
        async scan() {
          return {};
        },
        async repoDetail() {
          return {};
        },
        async mutationStatus() {
          return {};
        },
        async prepareMutation() {
          return {};
        },
        async mutate() {
          return {};
        },
      },
      backendManager: {
        async start(agentId: string) {
          calls.push(`start:${agentId}`);
          return { agentId, status: "started" as const, pid: 4204, port: 8004 };
        },
        async restart(agentId: string) {
          calls.push(`restart:${agentId}`);
          return { agentId, status: "restarted" as const, pid: 4206, port: 8086 };
        },
      },
    });

    await expect(service.backendStart?.("agent04")).resolves.toMatchObject({ status: "started" });
    await expect(service.backendRestart?.("agent06")).resolves.toMatchObject({ status: "restarted" });
    expect(calls).toEqual(["start:agent04", "restart:agent06"]);
  });
});

import { describe, expect, test } from "vitest";
import { dispatchAgent08Cli, type Agent08CliBackendManager } from "../src/gitboard/agent08Cli.js";

describe("agent08 CLI", () => {
  test("routes backend start/stop/restart commands to the backend manager", async () => {
    const calls: string[] = [];
    const manager: Agent08CliBackendManager = {
      async start(agentId: string) {
        calls.push(`start:${agentId}`);
        return { agentId, status: "started", pid: 8004, port: 8004 };
      },
      async stop(agentId: string) {
        calls.push(`stop:${agentId}`);
        return { agentId, status: "stopped", pid: 8004, port: 8004 };
      },
      async restart(agentId: string) {
        calls.push(`restart:${agentId}`);
        return { agentId, status: "restarted", pid: 8004, port: 8004 };
      },
    };

    await expect(dispatchAgent08Cli(["backend", "start", "agent04"], { manager })).resolves.toMatchObject({
      exitCode: 0,
      body: { agentId: "agent04", status: "started" },
    });
    await expect(dispatchAgent08Cli(["backend", "stop", "agent04"], { manager })).resolves.toMatchObject({
      exitCode: 0,
      body: { agentId: "agent04", status: "stopped" },
    });
    await expect(dispatchAgent08Cli(["backend", "restart", "agent04"], { manager })).resolves.toMatchObject({
      exitCode: 0,
      body: { agentId: "agent04", status: "restarted" },
    });
    expect(calls).toEqual(["start:agent04", "stop:agent04", "restart:agent04"]);
  });

  test("returns a productized CLI error for unsupported backend commands", async () => {
    const result = await dispatchAgent08Cli(["backend", "launch", "agent04"], {
      manager: {
        async start() {
          throw new Error("unexpected");
        },
        async stop() {
          throw new Error("unexpected");
        },
        async restart() {
          throw new Error("unexpected");
        },
      },
    });

    expect(result).toEqual({
      exitCode: 2,
      body: {
        error: {
          code: "AGENT08_CLI_USAGE",
          summary: "Usage: agent08 backend start|stop|restart <agent-id>",
        },
      },
    });
  });
});

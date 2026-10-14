import { describe, expect, test } from "vitest";
import { dispatchAgent08Cli } from "../src/gitboard/agent08Cli.js";

describe("agent08 CLI", () => {
  test("returns productized deprecation guidance for backend commands", async () => {
    const result = await dispatchAgent08Cli(["backend", "start", "agent04"]);
    expect(result).toEqual({
      exitCode: 1,
      body: {
        error: {
          code: "AGENT08_BACKEND_DEPRECATED",
          summary: "Agent08 backend process manager has been unified into Web platform supervisor.",
          suggestedAction: "Manage services via Web UI or direct agent repository scripts.",
        },
      },
    });
  });

  test("returns a productized CLI error for unsupported backend commands", async () => {
    const result = await dispatchAgent08Cli(["backend", "launch", "agent04"]);
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

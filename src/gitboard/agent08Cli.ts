import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { BackendProcessManager, createDefaultBackendProcessRegistry, type BackendProcessResult } from "./backendProcessManager.js";

export interface Agent08CliBackendManager {
  start(agentId: string): Promise<BackendProcessResult>;
  stop(agentId: string): Promise<BackendProcessResult>;
  restart(agentId: string): Promise<BackendProcessResult>;
}

export interface Agent08CliOptions {
  manager?: Agent08CliBackendManager;
}

export interface Agent08CliResult {
  exitCode: number;
  body: unknown;
}

const USAGE = "Usage: agent08 backend start|stop|restart <agent-id>";

export async function dispatchAgent08Cli(args: string[], options: Agent08CliOptions = {}): Promise<Agent08CliResult> {
  const [domain, action, agentId] = args;
  if (domain !== "backend" || !agentId || !["start", "stop", "restart"].includes(action ?? "")) {
    return usageError();
  }

  const manager = options.manager ?? createDefaultBackendManager();
  try {
    const body = await manager[action as "start" | "stop" | "restart"](agentId);
    return { exitCode: 0, body };
  } catch (error) {
    return {
      exitCode: 1,
      body: {
        error: {
          code: "AGENT08_BACKEND_COMMAND_FAILED",
          summary: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }
}

function usageError(): Agent08CliResult {
  return {
    exitCode: 2,
    body: {
      error: {
        code: "AGENT08_CLI_USAGE",
        summary: USAGE,
      },
    },
  };
}

function createDefaultBackendManager(): BackendProcessManager {
  return new BackendProcessManager({
    specs: createDefaultBackendProcessRegistry("/Users/tristanzh/agent"),
    stateDir: process.env.AGENT08_BACKEND_STATE_DIR ?? join("/Users/tristanzh/agent/agent08-gitboard", "storage", "backends"),
  });
}

async function main(): Promise<void> {
  const result = await dispatchAgent08Cli(process.argv.slice(2));
  const output = result.exitCode === 0 ? process.stdout : process.stderr;
  output.write(`${JSON.stringify(result.body)}\n`);
  process.exitCode = result.exitCode;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ error: { code: "AGENT08_CLI_FATAL", summary: String(error) } })}\n`);
    process.exitCode = 1;
  });
}

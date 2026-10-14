import { fileURLToPath } from "node:url";

export interface Agent08CliResult {
  exitCode: number;
  body: unknown;
}

const USAGE = "Usage: agent08 backend start|stop|restart <agent-id>";

export async function dispatchAgent08Cli(args: string[]): Promise<Agent08CliResult> {
  const [domain, action, agentId] = args;
  if (domain === "backend" && agentId && ["start", "stop", "restart"].includes(action ?? "")) {
    return {
      exitCode: 1,
      body: {
        error: {
          code: "AGENT08_BACKEND_DEPRECATED",
          summary: "Agent08 backend process manager has been unified into Web platform supervisor.",
          suggestedAction: "Manage services via Web UI or direct agent repository scripts.",
        },
      },
    };
  }
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

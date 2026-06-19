import { createGitControlHttpServer } from "./gitControlHttpServer.js";
import { gitControlService } from "./gitControlService.js";

export interface GitControlListenConfig {
  host: string;
  port: number;
}

export function resolveGitControlListenConfig(env: Record<string, string | undefined>): GitControlListenConfig {
  return {
    host: env.AGENT08_GIT_CONTROL_HOST ?? "127.0.0.1",
    port: Number(env.AGENT08_GIT_CONTROL_PORT ?? "3108"),
  };
}

export function startGitControlServer(config = resolveGitControlListenConfig(process.env)): void {
  const server = createGitControlHttpServer({ service: gitControlService });
  server.listen(config.port, config.host, () => {
    console.log(`agent08-git-control listening on http://${config.host}:${config.port}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startGitControlServer();
}

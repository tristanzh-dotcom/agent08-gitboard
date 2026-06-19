import { createGitControlHttpServer } from "./gitControlHttpServer.js";
import type { GitControlHttpService } from "./gitControlHttpServer.js";
import { BackendProcessManager, createDefaultBackendProcessRegistry } from "./backendProcessManager.js";
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

export function createGitControlHttpServiceWithBackendManager({
  baseService,
  backendManager,
}: {
  baseService: GitControlHttpService;
  backendManager: Pick<BackendProcessManager, "start" | "restart">;
}): GitControlHttpService {
  return {
    ...baseService,
    backendStart: (agentId) => backendManager.start(agentId),
    backendRestart: (agentId) => backendManager.restart(agentId),
  };
}

export function startGitControlServer(config = resolveGitControlListenConfig(process.env)): void {
  const backendManager = new BackendProcessManager({
    specs: createDefaultBackendProcessRegistry("/Users/tristanzh/agent"),
    stateDir: process.env.AGENT08_BACKEND_STATE_DIR ?? "/tmp/agent08-backends",
  });
  const service = createGitControlHttpServiceWithBackendManager({
    baseService: gitControlService,
    backendManager,
  });
  const server = createGitControlHttpServer({ service });
  server.listen(config.port, config.host, () => {
    console.log(`agent08-git-control listening on http://${config.host}:${config.port}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startGitControlServer();
}

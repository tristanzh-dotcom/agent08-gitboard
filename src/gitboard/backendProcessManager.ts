import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface BackendProcessSpec {
  agentId: string;
  port: number;
  cwd: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface BackendProcessResult {
  agentId: string;
  status: "already_running" | "not_running" | "started" | "stopped" | "restarted";
  pid: number | null;
  port: number | null;
}

export interface BackendProcessRunner {
  spawnDetached(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): { pid: number | undefined };
  isProcessAlive(pid: number): boolean;
  terminate(pid: number): void;
}

export interface BackendProcessManagerOptions {
  specs: Map<string, BackendProcessSpec>;
  stateDir: string;
  runner?: BackendProcessRunner;
}

export class BackendProcessManager {
  private readonly specs: Map<string, BackendProcessSpec>;
  private readonly stateDir: string;
  private readonly runner: BackendProcessRunner;

  constructor({ specs, stateDir, runner = new NodeBackendProcessRunner() }: BackendProcessManagerOptions) {
    this.specs = specs;
    this.stateDir = stateDir;
    this.runner = runner;
  }

  async start(agentId: string): Promise<BackendProcessResult> {
    const spec = this.requireSpec(agentId);
    const existingPid = await this.readPid(spec.agentId);
    if (existingPid && this.runner.isProcessAlive(existingPid)) {
      return { agentId: spec.agentId, status: "already_running", pid: existingPid, port: spec.port };
    }

    await mkdir(this.stateDir, { recursive: true });
    const child = this.runner.spawnDetached(spec.command, spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
    });
    const pid = child.pid ?? null;
    if (pid) {
      await writeFile(this.pidPath(spec.agentId), `${pid}\n`, "utf8");
    }
    return { agentId: spec.agentId, status: "started", pid, port: spec.port };
  }

  async stop(agentId: string): Promise<BackendProcessResult> {
    const spec = this.requireSpec(agentId);
    const pid = await this.readPid(spec.agentId);
    if (!pid || !this.runner.isProcessAlive(pid)) {
      await rm(this.pidPath(spec.agentId), { force: true });
      return { agentId: spec.agentId, status: "not_running", pid: pid ?? null, port: spec.port };
    }

    this.runner.terminate(pid);
    await rm(this.pidPath(spec.agentId), { force: true });
    return { agentId: spec.agentId, status: "stopped", pid, port: spec.port };
  }

  async restart(agentId: string): Promise<BackendProcessResult> {
    const stopped = await this.stop(agentId);
    const started = await this.start(agentId);
    return { ...started, status: "restarted", pid: started.pid ?? stopped.pid };
  }

  private requireSpec(agentId: string): BackendProcessSpec {
    const spec = this.specs.get(agentId);
    if (!spec) {
      throw new Error(`No Agent08-managed backend command is registered for ${agentId}`);
    }
    return spec;
  }

  private pidPath(agentId: string): string {
    return join(this.stateDir, `${agentId}.pid`);
  }

  private async readPid(agentId: string): Promise<number | null> {
    try {
      const raw = await readFile(this.pidPath(agentId), "utf8");
      const pid = Number(raw.trim());
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }
}

class NodeBackendProcessRunner implements BackendProcessRunner {
  spawnDetached(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): { pid: number | undefined } {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return { pid: child.pid };
  }

  isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  terminate(pid: number): void {
    process.kill(pid, "SIGTERM");
  }
}

export function createDefaultBackendProcessRegistry(agentRoot = "/Users/tristanzh/agent"): Map<string, BackendProcessSpec> {
  const home = process.env.HOME ?? "/Users/tristanzh";
  return new Map<string, BackendProcessSpec>([
    [
      "agent04",
      {
        agentId: "agent04",
        port: 8004,
        cwd: `${agentRoot}/agent04-lpm`,
        command: "python3",
        args: ["-m", "uvicorn", "backend.ark_main:app", "--host", "127.0.0.1", "--port", "8004"],
        env: {
          PYTHONUNBUFFERED: "1",
          LIMB_PHOTO_ROOT:
            process.env.LIMB_PHOTO_ROOT ?? "/Users/tristanzh/Pictures/Photos Library.photoslibrary/originals",
          LIMB_ARK_DB: process.env.LIMB_ARK_DB ?? "data/limb_ark.sqlite3",
          LIMB_THUMBNAIL_DIR: process.env.LIMB_THUMBNAIL_DIR ?? `${home}/.cache/local-photo-model/thumbnails`,
          LIMB_PHOTOS_BASE_URL: process.env.LIMB_PHOTOS_BASE_URL ?? "http://127.0.0.1:8004/photos",
        },
      },
    ],
    [
      "agent05",
      {
        agentId: "agent05",
        port: 8000,
        cwd: `${agentRoot}/agent05-pptx`,
        command: "python3",
        args: ["-m", "uvicorn", "backend.app.main:app", "--host", "127.0.0.1", "--port", "8000"],
        env: {
          PYTHONUNBUFFERED: "1",
        },
      },
    ],
    [
      "agent06",
      {
        agentId: "agent06",
        port: 8086,
        cwd: `${agentRoot}/agent06-pka`,
        command: "python3",
        args: ["-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", "8086"],
        env: {
          PYTHONUNBUFFERED: "1",
        },
      },
    ],
  ]);
}

import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import {
  BackendProcessManager,
  createDefaultBackendProcessRegistry,
  type BackendProcessRunner,
} from "../src/gitboard/backendProcessManager.js";

describe("BackendProcessManager", () => {
  test("starts an agent backend through a detached process and records its pid", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "agent08-backend-state-"));
    const calls: unknown[] = [];
    const runner: BackendProcessRunner = {
      spawnDetached(command, args, options) {
        calls.push({ command, args, options });
        return { pid: 4204 };
      },
      isProcessAlive() {
        return false;
      },
      terminate() {
        calls.push({ terminate: true });
      },
    };
    const manager = new BackendProcessManager({
      specs: createDefaultBackendProcessRegistry("/Users/tristanzh/agent"),
      stateDir,
      runner,
    });

    const result = await manager.start("agent04");

    expect(result).toEqual({ agentId: "agent04", status: "started", pid: 4204, port: 8004 });
    expect(calls).toEqual([
      {
        command: "python3",
        args: ["-m", "uvicorn", "backend.ark_main:app", "--host", "127.0.0.1", "--port", "8004"],
        options: expect.objectContaining({ cwd: "/Users/tristanzh/agent/agent04-lpm" }),
      },
    ]);
    await expect(readFile(join(stateDir, "agent04.pid"), "utf8")).resolves.toBe("4204\n");
  });

  test("stops a running backend by pid without touching web-platform", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "agent08-backend-state-"));
    const runner: BackendProcessRunner = {
      spawnDetached() {
        return { pid: 8086 };
      },
      isProcessAlive(pid) {
        return pid === 8086;
      },
      terminate(pid) {
        expect(pid).toBe(8086);
      },
    };
    const manager = new BackendProcessManager({
      specs: createDefaultBackendProcessRegistry("/Users/tristanzh/agent"),
      stateDir,
      runner,
    });

    await manager.start("agent06");
    const result = await manager.stop("agent06");

    expect(result).toEqual({ agentId: "agent06", status: "stopped", pid: 8086, port: 8086 });
  });

  test("starts the Agent05 PPT Maker backend with its explicit FastAPI command", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "agent08-backend-state-"));
    const calls: unknown[] = [];
    const runner: BackendProcessRunner = {
      spawnDetached(command, args, options) {
        calls.push({ command, args, options });
        return { pid: 8000 };
      },
      isProcessAlive() {
        return false;
      },
      terminate() {
        throw new Error("not expected");
      },
    };
    const manager = new BackendProcessManager({
      specs: createDefaultBackendProcessRegistry("/Users/tristanzh/agent"),
      stateDir,
      runner,
    });

    const result = await manager.start("agent05");

    expect(result).toEqual({ agentId: "agent05", status: "started", pid: 8000, port: 8000 });
    expect(calls).toEqual([
      {
        command: "python3",
        args: ["-m", "uvicorn", "backend.app.main:app", "--host", "127.0.0.1", "--port", "8000"],
        options: expect.objectContaining({ cwd: "/Users/tristanzh/agent/agent05-pptx" }),
      },
    ]);
  });

  test("rejects agents with no Agent08-managed backend command", async () => {
    const manager = new BackendProcessManager({
      specs: createDefaultBackendProcessRegistry("/Users/tristanzh/agent"),
      stateDir: await mkdtemp(join(tmpdir(), "agent08-backend-state-")),
    });

    await expect(manager.start("agent03")).rejects.toThrow("No Agent08-managed backend command is registered for agent03");
  });
});

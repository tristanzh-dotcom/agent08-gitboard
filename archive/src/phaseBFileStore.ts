import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PhaseBError, assertSafePersistedValue, toCanonicalJsonValue } from "./machineOperationContracts.js";

export async function writeJsonExclusive(path: string, value: unknown): Promise<void> {
  assertSafePersistedValue(value);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = join(directory, `.${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(toCanonicalJsonValue(value), null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporaryPath, path);
  } catch (error) {
    if (isNodeError(error, "EEXIST")) throw new PhaseBError("RECORD_ALREADY_EXISTS");
    throw new PhaseBError("STORE_WRITE_FAILED", error instanceof Error ? error.message : String(error));
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

export async function readJson<T>(path: string, notFoundCode = "RECORD_NOT_FOUND"): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) throw new PhaseBError(notFoundCode);
    if (error instanceof SyntaxError) throw new PhaseBError("STORE_RECORD_INVALID");
    throw error;
  }
}

export async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    return await readJson<T>(path);
  } catch (error) {
    if (error instanceof PhaseBError && error.code === "RECORD_NOT_FOUND") return null;
    throw error;
  }
}

export async function listJsonFileNames(path: string): Promise<string[]> {
  try {
    return (await readdir(path)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return [];
    throw error;
  }
}

export function isRecordAlreadyExists(error: unknown): boolean {
  return error instanceof PhaseBError && error.code === "RECORD_ALREADY_EXISTS";
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

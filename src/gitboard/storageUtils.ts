import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export class StorageError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(toCanonicalJsonValue(value));
}

export function toCanonicalJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new StorageError("NON_CANONICAL_VALUE");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => toCanonicalJsonValue(item));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) throw new StorageError("NON_CANONICAL_VALUE");
      result[key] = toCanonicalJsonValue(record[key]);
    }
    return result;
  }
  throw new StorageError("NON_CANONICAL_VALUE");
}

export function assertSafePersistedValue(value: unknown): void {
  visitPersistedValue(value, []);
}

function visitPersistedValue(value: unknown, path: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitPersistedValue(item, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    const safeDerivedField =
      normalized.endsWith("id") ||
      normalized.endsWith("idhash") ||
      normalized.endsWith("digest") ||
      normalized.endsWith("fingerprint");
    if (
      !safeDerivedField &&
      /(credential|secret|rawcapability|confirmationtoken|privatefile|unrestrictedstderr)/i.test(key)
    ) {
      throw new StorageError("SENSITIVE_MATERIAL_FORBIDDEN", [...path, key].join("."));
    }
    visitPersistedValue(child, [...path, key]);
  }
}

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
    if (isNodeError(error, "EEXIST")) throw new StorageError("RECORD_ALREADY_EXISTS");
    throw new StorageError("STORE_WRITE_FAILED", error instanceof Error ? error.message : String(error));
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

export async function readJson<T>(path: string, notFoundCode = "RECORD_NOT_FOUND"): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) throw new StorageError(notFoundCode);
    if (error instanceof SyntaxError) throw new StorageError("STORE_RECORD_INVALID");
    throw error;
  }
}

export async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    return await readJson<T>(path);
  } catch (error) {
    if (error instanceof StorageError && error.code === "RECORD_NOT_FOUND") return null;
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
  return error instanceof StorageError && error.code === "RECORD_ALREADY_EXISTS";
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

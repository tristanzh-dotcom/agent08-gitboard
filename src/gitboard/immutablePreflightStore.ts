import { join } from "node:path";
import {
  PhaseBError,
  assertSafePersistedValue,
  assertSafeRecordId,
  digestCanonicalJson,
  type GitControlMachineOperation,
  type JsonValue,
  type TaskPrincipal,
} from "./machineOperationContracts.js";
import { isRecordAlreadyExists, readJson, writeJsonExclusive } from "./phaseBFileStore.js";

export interface ImmutablePreflightInput {
  operationId: string;
  repoId: string;
  repositoryIdentityDigest: string;
  principal: TaskPrincipal;
  operation: GitControlMachineOperation;
  parameterDigest: string;
  relevantState: JsonValue | Record<string, unknown>;
  createdAt: string;
}

export interface ImmutablePreflightRecord extends ImmutablePreflightInput {
  schemaVersion: 1;
  immutableDigest: string;
}

export interface ImmutablePreflightPhaseRecord {
  schemaVersion: 1;
  operationId: string;
  phase: string;
  recordedAt: string;
  immutablePreflightDigest: string;
}

export class ImmutablePreflightStore {
  constructor(private readonly root: string) {}

  async create(input: ImmutablePreflightInput): Promise<ImmutablePreflightRecord> {
    assertSafeRecordId(input.operationId);
    assertPreflightInput(input);
    const digestInput = {
      schemaVersion: 1 as const,
      operationId: input.operationId,
      repoId: input.repoId,
      repositoryIdentityDigest: input.repositoryIdentityDigest,
      principal: { ...input.principal },
      operation: input.operation,
      parameterDigest: input.parameterDigest,
      relevantState: input.relevantState,
      createdAt: input.createdAt,
    };
    assertSafePersistedValue(digestInput);
    const record: ImmutablePreflightRecord = {
      ...digestInput,
      immutableDigest: digestCanonicalJson(digestInput),
    };
    try {
      await writeJsonExclusive(this.recordPath(input.operationId), record);
    } catch (error) {
      if (isRecordAlreadyExists(error)) throw new PhaseBError("PREFLIGHT_ALREADY_EXISTS");
      throw error;
    }
    return record;
  }

  async read(operationId: string): Promise<ImmutablePreflightRecord> {
    assertSafeRecordId(operationId);
    const record = await readJson<ImmutablePreflightRecord>(
      this.recordPath(operationId),
      "PREFLIGHT_NOT_FOUND",
    );
    const { immutableDigest, ...digestInput } = record;
    if (digestCanonicalJson(digestInput) !== immutableDigest) {
      throw new PhaseBError("PREFLIGHT_DIGEST_MISMATCH");
    }
    return record;
  }

  async appendPhaseRecord(input: Omit<ImmutablePreflightPhaseRecord, "schemaVersion">): Promise<void> {
    assertSafeRecordId(input.operationId);
    assertSafeRecordId(input.phase);
    const preflight = await this.read(input.operationId);
    if (preflight.immutableDigest !== input.immutablePreflightDigest) {
      throw new PhaseBError("PREFLIGHT_DIGEST_MISMATCH");
    }
    try {
      await writeJsonExclusive(this.phasePath(input.operationId, input.phase), {
        schemaVersion: 1,
        ...input,
      });
    } catch (error) {
      if (isRecordAlreadyExists(error)) throw new PhaseBError("PREFLIGHT_PHASE_ALREADY_EXISTS");
      throw error;
    }
  }

  private recordPath(operationId: string): string {
    return join(this.root, "phase-b", "preflight", operationId, "record.json");
  }

  private phasePath(operationId: string, phase: string): string {
    return join(this.root, "phase-b", "preflight", operationId, "phases", `${phase}.json`);
  }
}

function assertPreflightInput(input: ImmutablePreflightInput): void {
  for (const [value, code] of [
    [input.repoId, "REPO_NOT_ALLOWED"],
    [input.repositoryIdentityDigest, "REPO_IDENTITY_MISMATCH"],
    [input.parameterDigest, "PARAMETER_DIGEST_REQUIRED"],
    [input.createdAt, "PREFLIGHT_CREATED_AT_REQUIRED"],
  ] as const) {
    if (!value.trim()) throw new PhaseBError(code);
  }
}

import { join } from "node:path";
import {
  PhaseBError,
  assertSafePersistedValue,
  assertSafeRecordId,
  type AuthorizationMode,
  type GitControlMachineOperation,
  type OperationTier,
} from "./machineOperationContracts.js";
import {
  isRecordAlreadyExists,
  listJsonFileNames,
  readJson,
  writeJsonExclusive,
} from "./phaseBFileStore.js";

export type MachineAuditPhase =
  | "requested"
  | "policy_decided"
  | "preflight_recorded"
  | "capability_issued"
  | "capability_consumed"
  | "command_started"
  | "command_finished"
  | "postflight_recorded"
  | "result_recorded";

const PHASE_ORDINAL: Record<MachineAuditPhase, number> = {
  requested: 1,
  policy_decided: 2,
  preflight_recorded: 3,
  capability_issued: 4,
  capability_consumed: 5,
  command_started: 6,
  command_finished: 7,
  postflight_recorded: 8,
  result_recorded: 9,
};

export interface MachineAuditRecord {
  schemaVersion: 1;
  auditId: string;
  operationId: string;
  phase: MachineAuditPhase;
  timestamp: string;
  operation?: GitControlMachineOperation;
  operationTier?: OperationTier;
  authorizationMode?: AuthorizationMode;
  principalId?: string;
  taskId?: string;
  sessionId?: string;
  policyVersion?: string;
  policyDecisionId?: string;
  capabilityIdHash?: string;
  repoId?: string;
  repositoryIdentityDigest?: string;
  leaseId?: string | null;
  leaseVersion?: number;
  parameterDigest?: string;
  preflightDigest?: string;
  postflightDigest?: string;
  commandTemplateId?: string;
  resultCode?: string;
}

export type MachineAuditAppendInput = Omit<MachineAuditRecord, "schemaVersion">;

export interface MachineOperationAuditStatus {
  operationId: string;
  latestPhase: MachineAuditPhase | null;
  status: "unknown" | "requested" | "authorized" | "capability_issued" | "consumed" | "running" | "finished";
}

export class MachineOperationAuditStore {
  constructor(private readonly root: string) {}

  async append(input: MachineAuditAppendInput): Promise<MachineAuditRecord> {
    assertSafeRecordId(input.operationId);
    assertSafeRecordId(input.auditId);
    assertSafePersistedValue(input);
    const existing = await listJsonFileNames(this.operationPath(input.operationId));
    const ordinal = PHASE_ORDINAL[input.phase];
    const latestOrdinal = Math.max(0, ...existing.map((name) => Number(name.slice(0, 2))));
    if (latestOrdinal > ordinal) throw new PhaseBError("AUDIT_PHASE_ORDER_INVALID");
    const record: MachineAuditRecord = { schemaVersion: 1, ...input };
    try {
      await writeJsonExclusive(this.phasePath(input.operationId, input.phase), record);
    } catch (error) {
      if (isRecordAlreadyExists(error)) throw new PhaseBError("AUDIT_PHASE_ALREADY_EXISTS");
      throw error;
    }
    return record;
  }

  async readOperation(operationId: string): Promise<MachineAuditRecord[]> {
    assertSafeRecordId(operationId);
    const names = await listJsonFileNames(this.operationPath(operationId));
    return Promise.all(names.map((name) => readJson<MachineAuditRecord>(join(this.operationPath(operationId), name))));
  }

  async status(operationId: string): Promise<MachineOperationAuditStatus> {
    const records = await this.readOperation(operationId);
    const latestPhase = records.at(-1)?.phase ?? null;
    return {
      operationId,
      latestPhase,
      status: statusForPhase(latestPhase),
    };
  }

  private operationPath(operationId: string): string {
    return join(this.root, "phase-b", "audit", operationId);
  }

  private phasePath(operationId: string, phase: MachineAuditPhase): string {
    return join(
      this.operationPath(operationId),
      `${String(PHASE_ORDINAL[phase]).padStart(2, "0")}-${phase}.json`,
    );
  }
}

function statusForPhase(phase: MachineAuditPhase | null): MachineOperationAuditStatus["status"] {
  if (!phase) return "unknown";
  if (phase === "requested" || phase === "preflight_recorded") return "requested";
  if (phase === "policy_decided") return "authorized";
  if (phase === "capability_issued") return "capability_issued";
  if (phase === "capability_consumed") return "consumed";
  if (phase === "command_started") return "running";
  return "finished";
}

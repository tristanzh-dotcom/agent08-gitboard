import { join } from "node:path";
import {
  PhaseBError,
  assertSafePersistedValue,
  assertSafeRecordId,
  type PolicyDecision,
} from "./machineOperationContracts.js";
import { isRecordAlreadyExists, readJson, writeJsonExclusive } from "./phaseBFileStore.js";

export interface PolicyDecisionStore {
  create(decision: PolicyDecision): Promise<void>;
  read(policyDecisionId: string): Promise<PolicyDecision>;
}

export class PolicyDecisionStore implements PolicyDecisionStore {
  constructor(private readonly root: string) {}

  async create(decision: PolicyDecision): Promise<void> {
    assertSafeRecordId(decision.policyDecisionId);
    assertSafePersistedValue(decision);
    try {
      await writeJsonExclusive(this.path(decision.policyDecisionId), decision);
    } catch (error) {
      if (isRecordAlreadyExists(error)) throw new PhaseBError("POLICY_DECISION_ALREADY_EXISTS");
      throw error;
    }
  }

  async read(policyDecisionId: string): Promise<PolicyDecision> {
    assertSafeRecordId(policyDecisionId);
    const decision = await readJson<PolicyDecision>(
      this.path(policyDecisionId),
      "POLICY_DECISION_NOT_FOUND",
    );
    if (decision.schemaVersion !== 1 || decision.policyDecisionId !== policyDecisionId) {
      throw new PhaseBError("POLICY_DECISION_INVALID");
    }
    assertSafePersistedValue(decision);
    return decision;
  }

  private path(policyDecisionId: string): string {
    return join(this.root, "phase-b", "policy-decisions", `${policyDecisionId}.json`);
  }
}

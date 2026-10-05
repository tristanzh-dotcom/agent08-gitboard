export type FinalizationOperation = "commit" | "push";
export type ProposalSource = "codex" | "manual";
export type PathSelectionDeclaration = "exact_paths" | "mixed_or_indeterminate";
export type FinalizationOutcome =
  | "ready_for_confirmation"
  | "proposal_stale"
  | "proposal_rejected"
  | "confirmation_expired"
  | "execution_failed"
  | "committed"
  | "pushed";

export class FinalizationError extends Error {
  readonly code: string;
  readonly operationId: string | undefined;
  readonly afterOid: string | null;

  constructor(code: string, detail?: string, operationId?: string, afterOid?: string | null) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "FinalizationError";
    this.code = code;
    this.operationId = operationId;
    this.afterOid = afterOid ?? null;
  }
}

export interface CommitProposal {
  selectedPaths: string[];
  commitMessage: string;
  expectedHead?: string;
  rationale?: string;
  source?: ProposalSource;
  taskIntentId?: string;
  selectionDeclaration?: PathSelectionDeclaration;
}

export interface PushProposal {
  expectedHead?: string;
  source?: ProposalSource;
  taskIntentId?: string;
}

interface BaseFinalizationPlan {
  schemaVersion: 1;
  operationId: string;
  operation: FinalizationOperation;
  repoId: string;
  canonicalRepoPath: string;
  branch: string;
  expectedHead: string | null;
  proposalSource: ProposalSource;
  taskIntentId?: string | null;
  planDigest: string;
  createdAt: string;
  expiresAt: string;
}

export interface CommitPlan extends BaseFinalizationPlan {
  operation: "commit";
  selectedPaths: string[];
  selectedStateDigest: string;
  commitMessage: string;
  rationale: string | null;
  selectionDeclaration?: "exact_paths" | null;
}

export interface PushPlan extends BaseFinalizationPlan {
  operation: "push";
  expectedHead: string;
  remote: "origin";
  remoteUrl: string;
  remoteRef: string;
  expectedRemoteOid: string | null;
}

export type FinalizationPlan = CommitPlan | PushPlan;

export interface FinalizationConfirmation {
  schemaVersion: 1;
  operationId: string;
  planDigest: string;
  confirmationSurface: "local_agent08_ui";
  confirmedBy: "local_operator";
  confirmationTokenDigest: string;
  confirmedAt: string;
  expiresAt: string;
}

export interface FinalizationReceipt {
  schemaVersion: 1;
  operationId: string;
  operation: FinalizationOperation;
  repoId: string;
  taskIntentId?: string | null;
  status: "succeeded" | "failed";
  resultCode: string;
  beforeOid: string | null;
  afterOid: string | null;
  branch: string;
  completedAt: string;
  outputSummary: string;
}

export interface FinalizationAttempt {
  schemaVersion: 1;
  operationId: string;
  operation: FinalizationOperation;
  repoId: string;
  proposalSource: ProposalSource;
  taskIntentId?: string | null;
  status: "ready" | "rejected" | "failed" | "succeeded";
  outcome: FinalizationOutcome;
  resultCode: string;
  createdAt: string;
  completedAt: string | null;
}

export interface FinalizationStatus {
  operationId: string;
  status: FinalizationAttempt["status"] | "confirmed" | "consumed";
  attempt: FinalizationAttempt;
  plan: FinalizationPlan | null;
  receipt: FinalizationReceipt | null;
}

export interface PublicFinalizationAttempt {
  operation: FinalizationOperation;
  repoId: string;
  proposalSource: ProposalSource;
  taskIntentId: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface PublicBaseFinalizationPlan {
  operation: FinalizationOperation;
  repoId: string;
  branch: string;
  expectedHead: string | null;
  proposalSource: ProposalSource;
  taskIntentId: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface PublicCommitPlan extends PublicBaseFinalizationPlan {
  operation: "commit";
  selectedPaths: string[];
  selectionDeclaration: "exact_paths" | null;
  commitMessage: string;
  rationale: string | null;
}

export interface PublicPushPlan extends PublicBaseFinalizationPlan {
  operation: "push";
  expectedHead: string;
}

export type PublicFinalizationPlan = PublicCommitPlan | PublicPushPlan;

export interface PublicFinalizationReceipt {
  operation: FinalizationOperation;
  repoId: string;
  taskIntentId: string | null;
  state: FinalizationReceipt["status"];
  resultCode: string;
  beforeOid: string | null;
  afterOid: string | null;
  branch: string;
  completedAt: string;
}

export interface PublicFinalizationStatus {
  schemaVersion: 2;
  operationId: string;
  state: FinalizationStatus["status"];
  outcome: FinalizationOutcome;
  resultCode: string;
  attempt: PublicFinalizationAttempt;
  plan: PublicFinalizationPlan | null;
  receipt: PublicFinalizationReceipt | null;
}

export interface PublicFinalizationConfirmation {
  schemaVersion: 2;
  operationId: string;
  state: "confirmed";
  confirmationToken: string;
  expiresAt: string;
}

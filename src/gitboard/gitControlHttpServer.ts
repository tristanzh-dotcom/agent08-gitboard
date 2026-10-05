import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  FinalizationError,
  type FinalizationPlan,
  type FinalizationStatus,
  type CommitProposal,
  type FinalizationOutcome,
  type PathSelectionDeclaration,
  type ProposalSource,
  type PublicFinalizationConfirmation,
  type PublicFinalizationPlan,
  type PublicFinalizationStatus,
  type PushProposal,
} from "./finalizationContracts.js";

export interface GitControlHttpService {
  scan(): Promise<unknown>;
  repoDetail(repoId: string): Promise<unknown>;
  prepareCommit(repoId: string, proposal: CommitProposal): Promise<unknown>;
  preparePush(repoId: string, proposal?: PushProposal): Promise<unknown>;
  confirmFinalization(operationId: string): Promise<unknown>;
  executeFinalization(operationId: string, confirmationToken: string): Promise<unknown>;
  finalizationStatus(operationId: string): Promise<unknown>;
  backendStart?(agentId: string): Promise<unknown>;
  backendRestart?(agentId: string): Promise<unknown>;
}

export interface GitControlHttpServerOptions {
  service: GitControlHttpService;
}

export interface GitControlDispatchRequest {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

export interface GitControlDispatchResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export function createGitControlHttpServer(options: GitControlHttpServerOptions): Server {
  return createServer(async (request, response) => {
    try {
      const body = request.method === "POST" ? await readJsonBody(request) : undefined;
      const result = await dispatchGitControlHttpRequest(options.service, {
        method: request.method ?? "GET",
        path: request.url ?? "/",
        body,
      });
      sendJson(response, result.status, result.body);
    } catch (_error) {
      sendJson(response, 500, serviceUnavailableBody());
    }
  });
}

export async function dispatchGitControlHttpRequest(
  service: GitControlHttpService,
  request: GitControlDispatchRequest,
): Promise<GitControlDispatchResponse> {
  try {
    const body = await dispatchGitControlHttpRequestUnsafe(service, request);
    return {
      status: body.status,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: body.body,
    };
  } catch (error) {
    if (error instanceof FinalizationError) {
      return {
        status: 409,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: finalizationErrorBody(error),
      };
    }
    if (isScanRequest(request)) {
      return {
        status: 503,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: unverifiedScanBody(),
      };
    }
    return {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: serviceUnavailableBody(),
    };
  }
}

async function dispatchGitControlHttpRequestUnsafe(
  service: GitControlHttpService,
  request: GitControlDispatchRequest,
): Promise<{ status: number; body: unknown }> {
  const url = new URL(request.path, "http://127.0.0.1");

  if (request.method === "GET" && url.pathname === "/api/git-control/scan") {
    return { status: 200, body: await service.scan() };
  }

  if (request.method === "GET" && url.pathname === "/api/git-control/identity") {
    return { status: 200, body: { ok: true, agentId: "agent08", service: "git-control" } };
  }

  if (request.method === "GET" && url.pathname === "/api/git-control/health") {
    return {
      status: 200,
      body: { ok: true, agentId: "agent08", service: "agent08-gitboard", status: "ok" },
    };
  }

  const backendMatch = url.pathname.match(/^\/api\/git-control\/backend\/([^/]+)\/(start|restart)$/);
  if (request.method === "POST" && backendMatch) {
    const agentId = decodeURIComponent(backendMatch[1]);
    const action = backendMatch[2];
    if (!["agent04", "agent06"].includes(agentId)) {
      return {
        status: 409,
        body: {
          error: {
            code: "BACKEND_REPAIR_UNSUPPORTED_AGENT",
            title: "Backend repair not available",
            summary: `${agentId} is not managed by the Agent08 backend repair executor.`,
            suggestedAction: "Use the documented manual startup path for this Agent.",
          },
        },
      };
    }
    const repair = action === "start" ? service.backendStart : service.backendRestart;
    if (!repair) {
      return {
        status: 503,
        body: {
          error: {
            code: "BACKEND_REPAIR_EXECUTOR_UNAVAILABLE",
            title: "Backend repair executor unavailable",
            summary: "Agent08 Git Control is running without a backend process manager.",
            suggestedAction: "Restart Agent08 Git Control with backend process manager support.",
          },
        },
      };
    }
    return { status: 200, body: { ok: true, agentId, action, process: await repair(agentId) } };
  }

  const repoDetailMatch = url.pathname.match(/^\/api\/git-control\/repos\/([^/]+)$/);
  if (request.method === "GET" && repoDetailMatch) {
    return { status: 200, body: await service.repoDetail(decodeURIComponent(repoDetailMatch[1])) };
  }

  const finalizationStatusMatch = url.pathname.match(/^\/api\/git-control\/finalizations\/([^/]+)$/);
  if (request.method === "GET" && finalizationStatusMatch) {
    return {
      status: 200,
      body: publicFinalizationStatus(await service.finalizationStatus(decodeURIComponent(finalizationStatusMatch[1]))),
    };
  }

  const commitPrepareMatch = url.pathname.match(/^\/api\/git-control\/repos\/([^/]+)\/commit\/prepare$/);
  if (request.method === "POST" && commitPrepareMatch) {
    const plan = await service.prepareCommit(
      decodeURIComponent(commitPrepareMatch[1]),
      toCommitProposal(request.body ?? {}),
    );
    return {
      status: 200,
      body: publicFinalizationStatus(await service.finalizationStatus(requireOperationId(plan))),
    };
  }

  const pushPrepareMatch = url.pathname.match(/^\/api\/git-control\/repos\/([^/]+)\/push\/prepare$/);
  if (request.method === "POST" && pushPrepareMatch) {
    const plan = await service.preparePush(
      decodeURIComponent(pushPrepareMatch[1]),
      toPushProposal(request.body ?? {}),
    );
    return {
      status: 200,
      body: publicFinalizationStatus(await service.finalizationStatus(requireOperationId(plan))),
    };
  }

  const confirmMatch = url.pathname.match(/^\/api\/git-control\/finalizations\/([^/]+)\/confirm$/);
  if (request.method === "POST" && confirmMatch) {
    return {
      status: 200,
      body: publicFinalizationConfirmation(
        await service.confirmFinalization(decodeURIComponent(confirmMatch[1])),
      ),
    };
  }

  const executeMatch = url.pathname.match(/^\/api\/git-control\/finalizations\/([^/]+)\/execute$/);
  if (request.method === "POST" && executeMatch) {
    const operationId = decodeURIComponent(executeMatch[1]);
    await service.executeFinalization(
      operationId,
      requireBodyString(request.body ?? {}, "confirmationToken"),
    );
    return {
      status: 200,
      body: publicFinalizationStatus(await service.finalizationStatus(operationId)),
    };
  }

  return { status: 404, body: { error: { code: "NOT_FOUND" } } };
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(body)}\n`);
}

function serviceUnavailableBody(): unknown {
  return {
    error: {
      code: "AGENT08_SERVICE_ERROR",
      title: "Agent08 service unavailable",
      summary: "The Git Control service could not complete the request.",
      suggestedAction: "Check the local agent08-gitboard service logs and retry.",
    },
  };
}

function unverifiedScanBody(): unknown {
  return {
    schemaVersion: 2,
    observation: {
      state: "unverified",
      observedAt: null,
      reasonCode: "AGENT08_SCAN_FAILED",
    },
    repositories: [],
  };
}

function finalizationErrorBody(error: FinalizationError): unknown {
  const outcome = publicFinalizationOutcome(error.code);
  return {
    error: {
      code: error.code,
      ...(error.operationId === undefined ? {} : { operationId: error.operationId }),
      outcome,
      ...publicFinalizationOutcomeCopy(outcome),
    },
  };
}

function publicFinalizationStatus(status: unknown): PublicFinalizationStatus {
  const source = status as FinalizationStatus;
  const resultCode = source.receipt?.resultCode ?? source.attempt.resultCode;
  const outcome = source.receipt === null
    ? source.attempt.outcome
    : source.receipt.status === "succeeded"
      ? source.receipt.operation === "commit" ? "committed" : "pushed"
      : publicFinalizationOutcome(resultCode);
  return {
    schemaVersion: 2,
    operationId: source.operationId,
    state: source.status,
    outcome,
    resultCode,
    attempt: {
      operation: source.attempt.operation,
      repoId: source.attempt.repoId,
      proposalSource: source.attempt.proposalSource,
      taskIntentId: source.attempt.taskIntentId ?? null,
      createdAt: source.attempt.createdAt,
      completedAt: source.attempt.completedAt,
    },
    plan: source.plan === null ? null : publicFinalizationPlan(source.plan),
    receipt: source.receipt === null ? null : {
      operation: source.receipt.operation,
      repoId: source.receipt.repoId,
      taskIntentId: source.receipt.taskIntentId ?? null,
      state: source.receipt.status,
      resultCode: source.receipt.resultCode,
      beforeOid: source.receipt.beforeOid,
      afterOid: source.receipt.afterOid,
      branch: source.receipt.branch,
      completedAt: source.receipt.completedAt,
    },
  };
}

function publicFinalizationPlan(plan: FinalizationPlan): PublicFinalizationPlan {
  const display = {
    repoId: plan.repoId,
    branch: plan.branch,
    expectedHead: plan.expectedHead,
    proposalSource: plan.proposalSource,
    taskIntentId: plan.taskIntentId ?? null,
    createdAt: plan.createdAt,
    expiresAt: plan.expiresAt,
  };
  if (plan.operation === "push") return { operation: "push", ...display, expectedHead: plan.expectedHead };
  return {
    operation: "commit",
    ...display,
    selectedPaths: [...plan.selectedPaths],
    selectionDeclaration: plan.selectionDeclaration ?? null,
    commitMessage: plan.commitMessage,
    rationale: plan.rationale,
  };
}

export function publicFinalizationOutcome(code: string): FinalizationOutcome {
  if ([
    "FINALIZATION_REPOSITORY_DRIFT",
    "FINALIZATION_SELECTED_STATE_DRIFT",
    "FINALIZATION_SELECTED_PATHS_DRIFT",
    "FINALIZATION_HEAD_DRIFT",
    "FINALIZATION_BRANCH_DRIFT",
    "FINALIZATION_REMOTE_DRIFT",
  ].includes(code)) {
    return "proposal_stale";
  }
  if (["FINALIZATION_PLAN_EXPIRED", "FINALIZATION_CONFIRMATION_EXPIRED"].includes(code)) {
    return "confirmation_expired";
  }
  if ([
    "FINALIZATION_REPOSITORY_NOT_ALLOWED",
    "FINALIZATION_TASK_INTENT_INVALID",
    "FINALIZATION_TASK_INTENT_REQUIRED",
    "FINALIZATION_SELECTION_DECLARATION_INVALID",
    "FINALIZATION_SELECTION_DECLARATION_REQUIRED",
    "FINALIZATION_PATHS_REQUIRED",
    "FINALIZATION_PATH_INVALID",
    "FINALIZATION_PATH_DUPLICATE",
    "FINALIZATION_PATH_BLOCKED",
    "FINALIZATION_PATH_UNCHANGED",
    "FINALIZATION_PATH_NOT_FILE",
    "FINALIZATION_UNMERGED_PATHS",
    "FINALIZATION_SECRET_DETECTED",
    "FINALIZATION_COMMIT_MESSAGE_REQUIRED",
    "FINALIZATION_COMMIT_MESSAGE_INVALID",
    "FINALIZATION_RATIONALE_INVALID",
    "FINALIZATION_BRANCH_INVALID",
    "FINALIZATION_PROPOSAL_SOURCE_INVALID",
    "FINALIZATION_REQUEST_INVALID",
    "MIXED_PATH_REQUIRES_OWNER_SPLIT",
  ].includes(code)) {
    return "proposal_rejected";
  }
  return "execution_failed";
}

function publicFinalizationOutcomeCopy(outcome: FinalizationOutcome): {
  title: string;
  summary: string;
  suggestedAction: string;
} {
  if (outcome === "proposal_stale") {
    return {
      title: "Proposal needs refresh",
      summary: "The approved selected content changed before finalization.",
      suggestedAction: "Ask Codex to prepare a new proposal, then review and confirm it.",
    };
  }
  if (outcome === "confirmation_expired") {
    return {
      title: "Confirmation expired",
      summary: "The confirmation for this finalization plan has expired.",
      suggestedAction: "Prepare or confirm the unchanged plan again before finalization.",
    };
  }
  if (outcome === "proposal_rejected") {
    return {
      title: "Proposal rejected",
      summary: "The proposal does not satisfy the finalization contract.",
      suggestedAction: "Correct the proposal, then prepare it again.",
    };
  }
  return {
    title: "Finalization could not be completed",
    summary: "Agent08 could not complete this finalization request.",
    suggestedAction: "Review the request and repository state, then prepare a new proposal.",
  };
}

function toCommitProposal(body: Record<string, unknown>): CommitProposal {
  if (
    !Array.isArray(body.selectedPaths) ||
    body.selectedPaths.some((path) => typeof path !== "string")
  ) {
    throw new FinalizationError("FINALIZATION_PATHS_REQUIRED");
  }
  const commitMessage = requireBodyString(body, "commitMessage");
  const expectedHead = optionalBodyString(body, "expectedHead");
  const rationale = optionalBodyString(body, "rationale");
  const source = toProposalSource(body);
  const taskIntentId = optionalBodyString(body, "taskIntentId");
  const selectionDeclaration = toSelectionDeclaration(body);
  return {
    selectedPaths: body.selectedPaths as string[],
    commitMessage,
    source,
    ...(expectedHead === undefined ? {} : { expectedHead }),
    ...(rationale === undefined ? {} : { rationale }),
    ...(taskIntentId === undefined ? {} : { taskIntentId }),
    ...(selectionDeclaration === undefined ? {} : { selectionDeclaration }),
  };
}

function toPushProposal(body: Record<string, unknown>): PushProposal {
  const expectedHead = optionalBodyString(body, "expectedHead");
  const taskIntentId = optionalBodyString(body, "taskIntentId");
  return {
    source: toProposalSource(body),
    ...(expectedHead === undefined ? {} : { expectedHead }),
    ...(taskIntentId === undefined ? {} : { taskIntentId }),
  };
}

function toProposalSource(body: Record<string, unknown>): ProposalSource {
  const source = body.source;
  if (source === undefined) return "manual";
  if (source === "codex" || source === "manual") return source;
  throw new FinalizationError("FINALIZATION_PROPOSAL_SOURCE_INVALID");
}

function toSelectionDeclaration(
  body: Record<string, unknown>,
): PathSelectionDeclaration | undefined {
  const declaration = body.selectionDeclaration;
  if (declaration === undefined) return undefined;
  if (declaration === "exact_paths" || declaration === "mixed_or_indeterminate") {
    return declaration;
  }
  throw new FinalizationError("FINALIZATION_REQUEST_INVALID", "selectionDeclaration");
}

function publicFinalizationConfirmation(value: unknown): PublicFinalizationConfirmation {
  const source = value as {
    operationId: string;
    confirmationToken: string;
    expiresAt: string;
  };
  return {
    schemaVersion: 2,
    operationId: source.operationId,
    state: "confirmed",
    confirmationToken: source.confirmationToken,
    expiresAt: source.expiresAt,
  };
}

function requireOperationId(value: unknown): string {
  const operationId = (value as { operationId?: unknown } | null)?.operationId;
  if (typeof operationId !== "string" || !operationId) {
    throw new Error("finalization service did not return an operation ID");
  }
  return operationId;
}

function isScanRequest(request: GitControlDispatchRequest): boolean {
  return request.method === "GET" && new URL(request.path, "http://127.0.0.1").pathname === "/api/git-control/scan";
}

function requireBodyString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new FinalizationError("FINALIZATION_REQUEST_INVALID", field);
  }
  return value;
}

function optionalBodyString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new FinalizationError("FINALIZATION_REQUEST_INVALID", field);
  return value;
}

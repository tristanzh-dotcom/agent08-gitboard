import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { MutationSafetyError } from "./mutationSafetyGate.js";

export interface GitControlHttpService {
  scan(): Promise<unknown>;
  repoDetail(repoId: string): Promise<unknown>;
  mutationStatus(operationId: string): Promise<unknown>;
  prepareMutation(repoId: string, operation: string): Promise<unknown>;
  mutate(repoId: string, operation: string, body: Record<string, unknown>): Promise<unknown>;
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

const MUTATION_ROUTE_TO_OPERATION = new Map<string, string>([
  ["commit", "commit"],
  ["push", "push"],
  ["pull", "pull_ff_only"],
  ["stash-rebase", "stash_rebase"],
]);

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
    if (error instanceof MutationSafetyError) {
      return {
        status: 409,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: mutationSafetyErrorBody(error),
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

  const repoDetailMatch = url.pathname.match(/^\/api\/git-control\/repos\/([^/]+)$/);
  if (request.method === "GET" && repoDetailMatch) {
    return { status: 200, body: await service.repoDetail(decodeURIComponent(repoDetailMatch[1])) };
  }

  const mutationStatusMatch = url.pathname.match(/^\/api\/git-control\/mutations\/([^/]+)$/);
  if (request.method === "GET" && mutationStatusMatch) {
    return { status: 200, body: await service.mutationStatus(decodeURIComponent(mutationStatusMatch[1])) };
  }

  const prepareMatch = url.pathname.match(/^\/api\/git-control\/repos\/([^/]+)\/([^/]+)\/prepare$/);
  if (request.method === "POST" && prepareMatch) {
    const operation = MUTATION_ROUTE_TO_OPERATION.get(prepareMatch[2]);
    if (!operation) {
      return { status: 404, body: { error: { code: "NOT_FOUND" } } };
    }
    return { status: 200, body: await service.prepareMutation(decodeURIComponent(prepareMatch[1]), operation) };
  }

  const mutationMatch = url.pathname.match(/^\/api\/git-control\/repos\/([^/]+)\/([^/]+)$/);
  if (request.method === "POST" && mutationMatch) {
    const operation = MUTATION_ROUTE_TO_OPERATION.get(mutationMatch[2]);
    if (!operation) {
      return { status: 404, body: { error: { code: "NOT_FOUND" } } };
    }
    return {
      status: 200,
      body: await service.mutate(decodeURIComponent(mutationMatch[1]), operation, request.body ?? {}),
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

function mutationSafetyErrorBody(error: MutationSafetyError): unknown {
  const detail = mutationSafetyErrorDetails(error.code);
  return {
    error: {
      code: error.code,
      ...detail,
    },
  };
}

function mutationSafetyErrorDetails(code: string): {
  title: string;
  summary: string;
  suggestedAction: string;
} {
  if (code === "DIRTY_BLOCKS_PUSH") {
    return {
      title: "Push blocked by local changes",
      summary: "The repository has local working tree changes, so push was not started.",
      suggestedAction: "Commit or stash the local changes, rescan the repo, then retry push.",
    };
  }
  if (code === "DIRTY_BLOCKS_PULL") {
    return {
      title: "Pull blocked by local changes",
      summary: "The repository has local working tree changes, so pull was not started.",
      suggestedAction: "Commit or stash the local changes, rescan the repo, then retry pull.",
    };
  }
  if (code === "DIVERGED_BLOCKS_SIMPLE_PUSH") {
    return {
      title: "Push blocked by remote divergence",
      summary: "The repository is behind or diverged from its upstream, so simple push was not started.",
      suggestedAction: "Rescan the repo and use the appropriate pull or stash+rebase workflow before pushing.",
    };
  }
  if (code === "DIVERGED_BLOCKS_SIMPLE_PULL") {
    return {
      title: "Pull blocked by divergence",
      summary: "The repository has local commits and remote commits, so fast-forward pull was not started.",
      suggestedAction: "Resolve the divergence outside v1.1 simple pull, then rescan.",
    };
  }
  if (code === "DETACHED_HEAD_BLOCKS_MUTATION") {
    return {
      title: "Mutation blocked on detached HEAD",
      summary: "The repository is not on a branch, so Agent08 did not start a Git mutation.",
      suggestedAction: "Checkout the intended branch manually, rescan, then retry.",
    };
  }
  if (code === "MERGE_OR_REBASE_IN_PROGRESS") {
    return {
      title: "Mutation blocked by in-progress Git operation",
      summary: "A merge or rebase is already in progress, so Agent08 did not start another mutation.",
      suggestedAction: "Finish or abort the existing Git operation manually, then rescan.",
    };
  }
  if (code === "UPSTREAM_MISSING") {
    return {
      title: "Mutation blocked by missing upstream",
      summary: "The branch has no upstream configured for this operation.",
      suggestedAction: "Configure an upstream branch manually, rescan, then retry.",
    };
  }
  return {
    title: "Mutation blocked by safety gate",
    summary: "Agent08 blocked the Git mutation before running any command.",
    suggestedAction: "Review the repo state, rescan, and retry only when the preconditions are satisfied.",
  };
}

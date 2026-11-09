import {
  parseProvidedOutputDatasetSnapshot,
  parseProvidedOutputEvalSetSource,
  parseProvidedOutputRunRecord,
  prepareProvidedOutputRunDraft,
  prepareProvidedOutputRunRecord,
  prepareProvidedOutputRunRequest,
  resolveProvidedOutputRun
} from "@open-evals/core";
import {
  getProvidedOutputInputs,
  getProvidedOutputRun,
  isDatabaseUnavailable,
  listProvidedOutputRuns,
  listProvidedOutputSources,
  saveProvidedOutputRun as persistProvidedOutputRun
} from "@open-evals/db";
import type { RouteAuthContext } from "./auth";
import { customEvalAccessAllowed } from "./custom-eval-access";
import { requireCustomEvalAuth } from "./custom-evals";
import { InstructionRequestError, readInstructionJson } from "./instruction-request";
import type { LoadState } from "./loaders";
import type { ProvidedOutputInputsView, ProvidedOutputSourcesResponse } from "./provided-output-types";

class ProvidedOutputRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ProvidedOutputRequestError";
  }
}

function canWrite(auth: RouteAuthContext) {
  return customEvalAccessAllowed(auth, "write", process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL));
}

export async function readProvidedOutputJson(request: Request): Promise<unknown> {
  try {
    return await readInstructionJson(request);
  } catch (error) {
    if (error instanceof InstructionRequestError && error.status === 413) {
      throw new ProvidedOutputRequestError(413, "provided_output_request_too_large");
    }
    throw error;
  }
}

async function readInputs(workspaceId: string, ids: { datasetVersionId: string; evalSetVersionId: string }): Promise<ProvidedOutputInputsView> {
  const inputs = await getProvidedOutputInputs(workspaceId, ids);
  if (!inputs) throw new ProvidedOutputRequestError(404, "provided_output_sources_not_found");
  const validated = {
    dataset: parseProvidedOutputDatasetSnapshot(inputs.dataset),
    evalSet: parseProvidedOutputEvalSetSource(inputs.evalSet)
  };
  if (validated.dataset.version.id !== ids.datasetVersionId || validated.evalSet.contract.id !== ids.evalSetVersionId) {
    throw new ProvidedOutputRequestError(500, "provided_output_source_identity_invalid");
  }
  return validated;
}

export async function readProvidedOutputSources(auth: RouteAuthContext, query: URLSearchParams): Promise<ProvidedOutputSourcesResponse> {
  const entries = [...query.entries()];
  let inputs: ProvidedOutputInputsView | undefined;
  if (entries.length) {
    if (entries.length !== 2 || query.getAll("datasetVersionId").length !== 1 || query.getAll("evalSetVersionId").length !== 1
      || entries.some(([key]) => key !== "datasetVersionId" && key !== "evalSetVersionId")) {
      throw new ProvidedOutputRequestError(400, "provided_output_source_query_invalid");
    }
    const datasetVersionId = query.get("datasetVersionId");
    const evalSetVersionId = query.get("evalSetVersionId");
    if (!datasetVersionId || !evalSetVersionId || new TextEncoder().encode(datasetVersionId).length > 512
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(evalSetVersionId)) {
      throw new ProvidedOutputRequestError(422, "provided_output_source_ids_invalid");
    }
    inputs = await readInputs(auth.workspaceId, { datasetVersionId, evalSetVersionId });
  }
  return { sources: await listProvidedOutputSources(auth.workspaceId), canWrite: canWrite(auth), ...(inputs ? { inputs } : {}) };
}

export async function previewProvidedOutputRun(workspaceId: string, value: unknown) {
  const draft = prepareProvidedOutputRunDraft(value);
  const inputs = await readInputs(workspaceId, draft);
  return resolveProvidedOutputRun({ workspaceId, draft, dataset: inputs.dataset, evalSet: inputs.evalSet });
}

export async function saveProvidedOutputRun(auth: RouteAuthContext, value: unknown) {
  const request = prepareProvidedOutputRunRequest(value);
  const result = await persistProvidedOutputRun({ workspaceId: auth.workspaceId, actorId: auth.user.id }, request, {
    prepare: prepareProvidedOutputRunRecord,
    validateRecord: parseProvidedOutputRunRecord
  });
  return { record: parseProvidedOutputRunRecord(result.record), replayed: result.replayed };
}

export async function readProvidedOutputRun(workspaceId: string, runId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(runId)) return undefined;
  return getProvidedOutputRun(workspaceId, runId, parseProvidedOutputRunRecord);
}

export function listProvidedOutputHistory(workspaceId: string) {
  return listProvidedOutputRuns(workspaceId, parseProvidedOutputRunRecord);
}

export function providedOutputJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export function providedOutputErrorResponse(error: unknown) {
  const candidate = error instanceof Error && "status" in error ? Number(error.status) : 500;
  const status = isDatabaseUnavailable(error) ? 503 : Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500;
  const message = status < 500 && error instanceof Error && /^[a-z0-9_:.-]{1,160}$/.test(error.message)
    ? error.message : status === 503 ? "database_unavailable" : "provided_output_request_failed";
  return providedOutputJson({ error: message }, status);
}

async function loadProvided<T>(load: (auth: RouteAuthContext) => Promise<T>): Promise<LoadState<T>> {
  try {
    const auth = await requireCustomEvalAuth("read");
    return { status: "ready", auth, data: await load(auth) };
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : undefined;
    if (isDatabaseUnavailable(error) || status === 503) return { status: "database_unavailable", message: "database_unavailable" };
    if (status === 401) return { status: "auth_required", message: "authentication_required" };
    if (status === 403) return { status: "access_denied", message: "provided_output_access_forbidden" };
    throw error;
  }
}

export function loadProvidedOutputHome() {
  return loadProvided(async auth => {
    const [sources, history] = await Promise.all([listProvidedOutputSources(auth.workspaceId), listProvidedOutputHistory(auth.workspaceId)]);
    return { sources, history, canWrite: canWrite(auth) };
  });
}

export function loadProvidedOutputDetail(runId: string) {
  return loadProvided(async auth => ({ record: await readProvidedOutputRun(auth.workspaceId, runId) }));
}

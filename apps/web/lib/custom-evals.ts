import { parseCustomEvalSetContract, prepareCustomEvalSet } from "@open-evals/core";
import { getCustomEvalSet, isDatabaseUnavailable, listCustomEvalSets, saveCustomEvalSet } from "@open-evals/db";
import { requireRouteAuth, type RouteAuthContext } from "./auth";
import { customEvalAccessAllowed } from "./custom-eval-access";
import type { CustomEvalDetailView, CustomEvalSaveView, CustomEvalVersionView } from "./custom-eval-types";
import { InstructionRequestError, readInstructionJson } from "./instruction-request";
import type { LoadState } from "./loaders";

class CustomEvalRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "CustomEvalRequestError";
  }
}

function hostedRuntime() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}

export async function requireCustomEvalAuth(mode: "read" | "write") {
  const auth = await requireRouteAuth(mode === "write" ? "editor" : "viewer", mode === "write" ? "evals:write" : "evals:read");
  if (!customEvalAccessAllowed(auth, mode, hostedRuntime())) {
    throw new CustomEvalRequestError(403, "custom_eval_workspace_session_required");
  }
  return auth;
}

export async function readCustomEvalJson(request: Request): Promise<unknown> {
  try {
    return await readInstructionJson(request);
  } catch (error) {
    if (error instanceof InstructionRequestError && error.message === "instruction_request_too_large") {
      throw new CustomEvalRequestError(413, "custom_eval_request_too_large");
    }
    throw error;
  }
}

function versionView(row: { id: string; version: number; fingerprint: string; createdAt: Date | string; contract: unknown }): CustomEvalVersionView {
  try {
    const contract = parseCustomEvalSetContract(row.contract);
    const createdAt = row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt;
    if (contract.id !== row.id || contract.fingerprint !== row.fingerprint || contract.authoring.version !== row.version
      || !Number.isFinite(Date.parse(createdAt))) throw new Error("invalid_stored_version");
    return { id: row.id, version: row.version, fingerprint: row.fingerprint, createdAt, contract };
  } catch {
    throw new CustomEvalRequestError(500, "custom_eval_stored_contract_invalid");
  }
}

export async function readCustomEvalDetail(workspaceId: string, setId: string): Promise<CustomEvalDetailView | undefined> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(setId)) return undefined;
  const detail = await getCustomEvalSet(workspaceId, setId);
  if (!detail) return undefined;
  const versions = detail.versions.map(versionView);
  if (!versions.length || versions.some(version => version.contract.setId !== detail.id)) {
    throw new CustomEvalRequestError(500, "custom_eval_stored_contract_invalid");
  }
  return { id: detail.id, name: detail.name, versions, hasMore: detail.hasMore };
}

export async function saveCustomEval(auth: RouteAuthContext, value: unknown): Promise<CustomEvalSaveView> {
  const prepared = prepareCustomEvalSet(value);
  const result = await saveCustomEvalSet({ workspaceId: auth.workspaceId, actorId: auth.user.id }, prepared);
  const evalSet = await readCustomEvalDetail(auth.workspaceId, result.id);
  if (!evalSet) throw new CustomEvalRequestError(500, "custom_eval_saved_set_unavailable");
  return { id: result.id, name: result.name, version: versionView(result.version), evalSet, replayed: result.replayed };
}

export function customEvalJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export function customEvalErrorResponse(error: unknown): Response {
  const candidate = error instanceof Error && "status" in error ? Number(error.status) : 500;
  const status = isDatabaseUnavailable(error) ? 503 : Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500;
  const message = status < 500 && error instanceof Error && /^[a-z0-9_:.-]{1,160}$/.test(error.message)
    ? error.message : status === 503 ? "database_unavailable" : "custom_eval_request_failed";
  return customEvalJson({ error: message }, status);
}

async function loadCustom<T>(load: (auth: RouteAuthContext) => Promise<T>): Promise<LoadState<T>> {
  try {
    const auth = await requireCustomEvalAuth("read");
    return { status: "ready", auth, data: await load(auth) };
  } catch (error) {
    if (isDatabaseUnavailable(error) || error instanceof Error && "status" in error && Number(error.status) === 503) {
      return { status: "database_unavailable", message: "database_unavailable" };
    }
    if (error instanceof Error && "status" in error && Number(error.status) === 401) return { status: "auth_required", message: "authentication_required" };
    if (error instanceof Error && "status" in error && Number(error.status) === 403) return { status: "access_denied", message: "custom_eval_access_forbidden" };
    throw error;
  }
}

export async function loadCustomEvalList() {
  return loadCustom(async auth => ({ sets: await listCustomEvalSets(auth.workspaceId), canWrite: customEvalAccessAllowed(auth, "write", hostedRuntime()) }));
}

export async function loadCustomEvalDetail(setId: string) {
  return loadCustom(async auth => ({ detail: await readCustomEvalDetail(auth.workspaceId, setId), canWrite: customEvalAccessAllowed(auth, "write", hostedRuntime()) }));
}

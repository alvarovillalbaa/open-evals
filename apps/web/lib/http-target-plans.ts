import {
  httpEvalPlanHeadFromRecord, parseHttpEvalJson, parseHttpEvalPlanVersionRecord,
  prepareHttpEvalPlanDraft, prepareHttpEvalPlanSaveRequest, prepareHttpEvalPlanVersionRecord,
  resolveHttpEvalPlanPreview, restoreCustomEvalSetVersionRecordV2, restoreCustomEvalItemVersionRecordV2,
  restoreCustomEvalSetVersionRecordV3, restoreMatchingEvalItemVersionRecord
} from "@open-evals/core";
import type { HttpEvalPlanFamily, MatchingHttpEvalSetRef as HttpEvalSetRef } from "@open-evals/core";
import {
  getHttpEvalPlan, getHttpEvalPlanHead, getHttpEvalPlanSources, getHttpEvalPlanVersion, getCustomEvalSetVersionV2, getCustomEvalSetVersionV3,
  isDatabaseUnavailable, listHttpEvalPlans, listHttpEvalSources, saveHttpEvalPlanVersion
} from "@open-evals/db";
import type { RouteAuthContext } from "./auth";
import { customEvalAccessAllowed } from "./custom-eval-access";
import { requireCustomEvalAuth } from "./custom-evals";
import type { HttpTargetPlanDetailView, HttpTargetPlanListView, HttpTargetPlanView, HttpTargetPlansView } from "./http-target-types";
import type { LoadState } from "./loaders";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const compositionReaders = { restoreSet: restoreCustomEvalSetVersionRecordV2, restoreItem: restoreCustomEvalItemVersionRecordV2, restoreSetV3: restoreCustomEvalSetVersionRecordV3, restoreMatchingItem: restoreMatchingEvalItemVersionRecord };

export class HttpTargetRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "HttpTargetRequestError"; }
}

export function httpTargetCanWrite(auth: RouteAuthContext) {
  return customEvalAccessAllowed(auth, "write", process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL));
}

/** Call after session authorization; preserve raw JSON until precision/duplicate validation. */
export async function readHttpTargetJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new HttpTargetRequestError(400, "json_content_type_required");
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_REQUEST_BYTES) {
    await request.body?.cancel().catch(() => undefined);
    throw new HttpTargetRequestError(413, "http_eval_request_too_large");
  }
  if (!request.body) throw new HttpTargetRequestError(400, "json_body_required");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_REQUEST_BYTES) { await reader.cancel().catch(() => undefined); throw new HttpTargetRequestError(413, "http_eval_request_too_large"); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new HttpTargetRequestError(400, "http_eval_utf8_invalid"); }
    return parseHttpEvalJson(text, MAX_REQUEST_BYTES);
  } finally { reader.releaseLock(); }
}

export function httpTargetJson(value: unknown, status = 200): Response {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") throw new HttpTargetRequestError(500, "http_eval_response_invalid");
  let payload: Uint8Array | undefined = new TextEncoder().encode(serialized);
  if (payload.byteLength > 16 * 1024 * 1024 + 4096) throw new HttpTargetRequestError(500, "http_eval_response_too_large");
  let offset = 0;
  // Stream byte slices with backpressure: Unicode remains intact when chunks are
  // decoded together, and valid large records avoid the nonstreaming platform cap.
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!payload) { controller.close(); return; }
      const end = Math.min(offset + 65536, payload.byteLength);
      controller.enqueue(payload.subarray(offset, end)); offset = end;
      if (offset === payload.byteLength) { payload = undefined; controller.close(); }
    },
    cancel() { payload = undefined; }
  });
  return new Response(body, { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

export function httpTargetErrorResponse(error: unknown): Response {
  const candidate = error instanceof Error && "status" in error ? Number(error.status) : 500;
  const status = isDatabaseUnavailable(error) ? 503 : Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500;
  const message = status < 500 && error instanceof Error && /^[a-z0-9_:.-]{1,160}$/.test(error.message)
    ? error.message : status === 503 ? "database_unavailable" : "http_eval_request_failed";
  return httpTargetJson({ error: message }, status);
}

export async function previewHttpTargetPlan(workspaceId: string, value: unknown) {
  const draft = prepareHttpEvalPlanDraft(value);
  const [sources, head] = await Promise.all([
    getHttpEvalPlanSources(workspaceId, draft, compositionReaders),
    getHttpEvalPlanHead(workspaceId, draft.planId, parseHttpEvalPlanVersionRecord)
  ]);
  if (!sources) throw new HttpTargetRequestError(404, "http_eval_sources_not_found");
  return resolveHttpEvalPlanPreview({ workspaceId, draft, ...sources, head });
}

export async function saveHttpTargetPlan(auth: RouteAuthContext, value: unknown) {
  const request = prepareHttpEvalPlanSaveRequest(value);
  const result = await saveHttpEvalPlanVersion({ workspaceId: auth.workspaceId, actorId: auth.user.id }, request, {
    prepare: prepareHttpEvalPlanVersionRecord, parse: parseHttpEvalPlanVersionRecord, ...compositionReaders
  });
  // A post-commit readback failure must retain an unknown client outcome for exact retry.
  try {
    const record = parseHttpEvalPlanVersionRecord(result.record);
    if (record.workspaceId !== auth.workspaceId || record.content.draft.schemaVersion !== request.draft.schemaVersion || record.content.draft.planId !== request.draft.planId
      || record.content.draft.versionId !== request.draft.versionId || record.previewFingerprint !== request.expectedPreviewFingerprint) throw new Error("identity");
    return { record, replayed: result.replayed };
  } catch { throw new HttpTargetRequestError(500, "http_eval_saved_plan_invalid"); }
}

export async function readHttpTargetPlanVersion(workspaceId: string, planId: string, versionId: string) {
  if (!UUID.test(planId) || !UUID.test(versionId)) return undefined;
  const value = await getHttpEvalPlanVersion(workspaceId, planId, versionId, parseHttpEvalPlanVersionRecord);
  if (!value) return undefined;
  const record = parseHttpEvalPlanVersionRecord(value);
  if (record.workspaceId !== workspaceId || record.content.draft.planId !== planId || record.content.draft.versionId !== versionId) throw new HttpTargetRequestError(500, "http_eval_plan_identity_invalid");
  return record;
}

export async function readHttpTargetPlanDetail(workspaceId: string, planId: string): Promise<HttpTargetPlanDetailView | undefined> {
  if (!UUID.test(planId)) return undefined;
  const detail = await getHttpEvalPlan(workspaceId, planId);
  if (!detail) return undefined;
  const latest = detail.versions[0];
  if (!latest) throw new HttpTargetRequestError(500, "http_eval_head_invalid");
  const record = await readHttpTargetPlanVersion(workspaceId, planId, latest.versionId);
  if (!record || record.fingerprint !== latest.fingerprint || record.storage.versionId !== latest.storageVersionId || record.content.schemaVersion !== latest.family) throw new HttpTargetRequestError(500, "http_eval_head_invalid");
  return { ...detail, head: httpEvalPlanHeadFromRecord(record), record };
}

export async function readHttpTargetPlanList(auth: RouteAuthContext): Promise<HttpTargetPlanListView> {
  const [list, sources] = await Promise.all([listHttpEvalPlans(auth.workspaceId), listHttpEvalSources(auth.workspaceId)]);
  return { list, sources, canWrite: httpTargetCanWrite(auth) };
}

export async function loadHttpTarget<T>(load: (auth: RouteAuthContext) => Promise<T>): Promise<LoadState<T>> {
  try {
    const auth = await requireCustomEvalAuth("read");
    // Strict core JSON copies have null prototypes. Client props need ordinary
    // JSON containers; this projection preserves validated values and fingerprints.
    const data = JSON.parse(JSON.stringify(await load(auth))) as T;
    return { status: "ready", auth, data };
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : undefined;
    if (isDatabaseUnavailable(error) || status === 503) return { status: "database_unavailable", message: "database_unavailable" };
    if (status === 401) return { status: "auth_required", message: "authentication_required" };
    if (status === 403) return { status: "access_denied", message: "http_eval_workspace_session_required" };
    throw error;
  }
}

export function loadHttpTargetPlans(requested?: { composition?: boolean; matching?: boolean; setId?: string; setVersionId?: string; copyPlanId?: string; copyVersionId?: string; sourceRequested?: boolean }): Promise<LoadState<HttpTargetPlansView>> {
  return loadHttpTarget(async auth => {
    const data = await readHttpTargetPlanList(auth);
    const initialFamily: HttpEvalPlanFamily = requested?.matching ? "http-target-eval-v3" : requested?.composition ? "http-target-eval-v2" : "http-target-eval-v1";
    let initialSetRefs: HttpEvalSetRef[] = [], initialDatasetId: string | undefined;
    if ((requested?.composition || requested?.matching) && requested.setId && requested.setVersionId && !requested.copyPlanId) {
      if (UUID.test(requested.setId) && UUID.test(requested.setVersionId)) {
        const stored = requested?.matching
          ? await getCustomEvalSetVersionV3(auth.workspaceId, requested.setId, requested.setVersionId, { restoreSet: restoreCustomEvalSetVersionRecordV3, restoreItem: restoreMatchingEvalItemVersionRecord })
          : await getCustomEvalSetVersionV2(auth.workspaceId, requested.setId, requested.setVersionId, compositionReaders);
        if (stored) {
          const record = stored.schemaVersion === "custom-eval-set-record-v3" ? restoreCustomEvalSetVersionRecordV3(stored, auth.workspaceId) : restoreCustomEvalSetVersionRecordV2(stored, auth.workspaceId);
          initialSetRefs = [{ schemaVersion: requested?.matching ? "custom-eval-set-ref-v3" : "custom-eval-set-ref-v2", setId: record.draft.setId, versionId: record.draft.versionId, fingerprint: record.contract.fingerprint }];
        }
      }
    } else if ((requested?.composition || requested?.matching) && requested.copyPlanId && requested.copyVersionId && !requested.setId) {
      const source = await readHttpTargetPlanVersion(auth.workspaceId, requested.copyPlanId, requested.copyVersionId);
      if (source && (requested?.matching || source.content.schemaVersion !== "http-target-eval-v3")) {
        initialDatasetId = source.content.draft.datasetVersionId;
        initialSetRefs = source.content.schemaVersion !== "http-target-eval-v1" ? source.content.draft.evalSetVersions : source.content.evalSets.map(set => ({ schemaVersion: "custom-eval-set-ref-v1", setId: set.contract.setId, versionId: set.contract.id, fingerprint: set.contract.fingerprint }));
      }
    }
    return { ...data, initialFamily, initialSetRefs, initialDatasetId, requestedSourceUnavailable: Boolean(requested?.sourceRequested && initialSetRefs.length === 0) };
  });
}
export function loadHttpTargetPlan(planId: string): Promise<LoadState<HttpTargetPlanView>> {
  return loadHttpTarget(async auth => {
    const [detail, sources] = await Promise.all([readHttpTargetPlanDetail(auth.workspaceId, planId), listHttpEvalSources(auth.workspaceId)]);
    return { detail, sources, canWrite: httpTargetCanWrite(auth) };
  });
}

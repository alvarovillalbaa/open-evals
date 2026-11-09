import {
  CustomDatasetError,
  customDatasetHeadFromRecord,
  parseCustomDatasetVersionRecord,
  prepareCustomDatasetDraft,
  prepareCustomDatasetSaveRequest,
  prepareCustomDatasetVersionRecord,
  resolveCustomDatasetPreview,
  restoreCustomDatasetVersionRecord
} from "@open-evals/core";
import {
  getCustomDataset,
  getCustomDatasetHead,
  getCustomDatasetVersion,
  isDatabaseUnavailable,
  listCustomDatasets,
  saveCustomDatasetVersion
} from "@open-evals/db";
import type { RouteAuthContext } from "./auth";
import { customEvalAccessAllowed } from "./custom-eval-access";
import { requireCustomEvalAuth } from "./custom-evals";
import { InstructionRequestError, readInstructionJson } from "./instruction-request";
import type { LoadState } from "./loaders";
import type { CustomDatasetDetailView } from "./custom-dataset-types";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

class CustomDatasetRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "CustomDatasetRequestError";
  }
}

function canWrite(auth: RouteAuthContext) {
  return customEvalAccessAllowed(auth, "write", process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL));
}

export async function readCustomDatasetJson(request: Request): Promise<unknown> {
  try {
    return await readInstructionJson(request);
  } catch (error) {
    if (error instanceof InstructionRequestError && error.status === 413) {
      throw new CustomDatasetRequestError(413, "custom_dataset_request_too_large");
    }
    throw error;
  }
}

export async function readCustomDatasetVersion(workspaceId: string, datasetId: string, versionId: string) {
  if (!UUID.test(datasetId) || !UUID.test(versionId)) return undefined;
  const stored = await getCustomDatasetVersion(workspaceId, datasetId, versionId);
  if (!stored) return undefined;
  const record = parseCustomDatasetVersionRecord(stored);
  if (record.workspaceId !== workspaceId || record.content.dataset.publicId !== datasetId || record.content.version.publicId !== versionId) {
    throw new CustomDatasetRequestError(500, "custom_dataset_stored_identity_invalid");
  }
  return record;
}

export async function readCustomDatasetDetail(workspaceId: string, datasetId: string): Promise<CustomDatasetDetailView | undefined> {
  if (!UUID.test(datasetId)) return undefined;
  const dataset = await getCustomDataset(workspaceId, datasetId);
  if (!dataset) return undefined;
  const latest = dataset.versions[0];
  if (!latest || dataset.id !== datasetId) throw new CustomDatasetRequestError(500, "custom_dataset_stored_head_invalid");
  // Use the exact version observed by this history read. A later append is checked again by preview/save.
  const record = await readCustomDatasetVersion(workspaceId, datasetId, latest.id);
  if (!record || record.content.dataset.id !== dataset.storageDatasetId || record.content.dataset.name !== dataset.name
    || record.content.version.id !== latest.storageVersionId || record.content.version.version !== latest.version
    || record.content.fingerprint !== latest.contentFingerprint) {
    throw new CustomDatasetRequestError(500, "custom_dataset_stored_head_invalid");
  }
  return { dataset, head: customDatasetHeadFromRecord(record), record };
}

export async function previewCustomDataset(workspaceId: string, value: unknown) {
  const draft = prepareCustomDatasetDraft(value);
  const head = await getCustomDatasetHead(workspaceId, draft.datasetId);
  return resolveCustomDatasetPreview({ workspaceId, draft, head });
}

export async function saveCustomDataset(auth: RouteAuthContext, value: unknown) {
  const request = prepareCustomDatasetSaveRequest(value);
  const result = await saveCustomDatasetVersion({ workspaceId: auth.workspaceId, actorId: auth.user.id }, request, {
    prepare: prepareCustomDatasetVersionRecord,
    restore: restoreCustomDatasetVersionRecord
  });
  let record: ReturnType<typeof parseCustomDatasetVersionRecord>;
  try {
    record = parseCustomDatasetVersionRecord(result.record);
  } catch {
    // The store has returned after commit; preserve an unknown outcome for exact recovery.
    throw new CustomDatasetRequestError(500, "custom_dataset_saved_record_invalid");
  }
  if (record.workspaceId !== auth.workspaceId || record.content.dataset.publicId !== request.draft.datasetId
    || record.content.version.publicId !== request.draft.versionId || record.manifest.previewFingerprint !== request.expectedPreviewFingerprint) {
    throw new CustomDatasetRequestError(500, "custom_dataset_saved_identity_invalid");
  }
  return { record, replayed: result.replayed };
}

export function customDatasetJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export function customDatasetErrorResponse(error: unknown): Response {
  const candidate = error instanceof Error && "status" in error ? Number(error.status) : 500;
  const status = isDatabaseUnavailable(error) ? 503 : Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500;
  const message = status < 500 && error instanceof Error && /^[a-z0-9_:.-]{1,160}$/.test(error.message)
    ? error.message : status === 503 ? "database_unavailable" : "custom_dataset_request_failed";
  const source: { rowIndex?: number; line?: number; column?: number } = {};
  if (error instanceof CustomDatasetError && status === 422) {
    if (Number.isInteger(error.rowIndex) && Number(error.rowIndex) >= 0 && Number(error.rowIndex) <= 2097152) source.rowIndex = Number(error.rowIndex);
    for (const key of ["line", "column"] as const) {
      if (Number.isInteger(error[key]) && Number(error[key]) >= 1 && Number(error[key]) <= 2097153) source[key] = Number(error[key]);
    }
  }
  return customDatasetJson({ error: message, ...source }, status);
}

async function loadCustomDataset<T>(load: (auth: RouteAuthContext) => Promise<T>): Promise<LoadState<T>> {
  try {
    const auth = await requireCustomEvalAuth("read");
    return { status: "ready", auth, data: await load(auth) };
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : undefined;
    if (isDatabaseUnavailable(error) || status === 503) return { status: "database_unavailable", message: "database_unavailable" };
    if (status === 401) return { status: "auth_required", message: "authentication_required" };
    if (status === 403) return { status: "access_denied", message: "custom_dataset_access_forbidden" };
    throw error;
  }
}

export function loadCustomDatasetList() {
  return loadCustomDataset(async auth => ({ list: await listCustomDatasets(auth.workspaceId), canWrite: canWrite(auth) }));
}

export function loadCustomDatasetDetail(datasetId: string) {
  return loadCustomDataset(async auth => ({ detail: await readCustomDatasetDetail(auth.workspaceId, datasetId), canWrite: canWrite(auth) }));
}

export function loadCustomDatasetVersion(datasetId: string, versionId: string) {
  return loadCustomDataset(async auth => ({ record: await readCustomDatasetVersion(auth.workspaceId, datasetId, versionId) }));
}

export async function readCustomDatasetList(auth: RouteAuthContext) {
  return { list: await listCustomDatasets(auth.workspaceId), canWrite: canWrite(auth) };
}

export function customDatasetCanWrite(auth: RouteAuthContext) {
  return canWrite(auth);
}

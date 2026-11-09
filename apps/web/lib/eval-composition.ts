import {
  customEvalItemHeadV2, customEvalSetHeadV2,
  prepareCustomEvalItemDraftV2, prepareCustomEvalItemSaveRequestV2,
  prepareCustomEvalItemVersionRecordV2, resolveCustomEvalItemPreviewV2,
  restoreCustomEvalItemVersionRecordV2,
  prepareCustomEvalSetDraftV2, prepareCustomEvalSetSaveRequestV2,
  prepareCustomEvalSetVersionRecordV2, resolveCustomEvalSetPreviewV2,
  restoreCustomEvalSetVersionRecordV2
} from "@open-evals/core";
import {
  getCustomEvalItemV2, getCustomEvalItemHeadV2, getCustomEvalItemVersionV2,
  getCustomEvalSetV2, getCustomEvalSetHeadV2, getCustomEvalSetVersionV2, getCustomEvalSetItemsV2,
  listCustomEvalItemsV2, listCustomEvalSetsV2,
  saveCustomEvalItemVersionV2, saveCustomEvalSetVersionV2
} from "@open-evals/db";
import type { RouteAuthContext } from "./auth";
import { httpTargetCanWrite, HttpTargetRequestError, loadHttpTarget } from "./http-target-plans";
import { compositionId, type CompositionKind, type CompositionResource } from "./eval-composition-types";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const itemCallbacks = { prepare: prepareCustomEvalItemVersionRecordV2, restore: restoreCustomEvalItemVersionRecordV2 };
const setCallbacks = { prepare: prepareCustomEvalSetVersionRecordV2, restore: restoreCustomEvalSetVersionRecordV2, restoreItem: restoreCustomEvalItemVersionRecordV2 };

export async function readCompositionList(workspaceId: string, kind: CompositionKind) {
  return kind === "item"
    ? { items: await listCustomEvalItemsV2(workspaceId, restoreCustomEvalItemVersionRecordV2) }
    : { sets: await listCustomEvalSetsV2(workspaceId, restoreCustomEvalSetVersionRecordV2, restoreCustomEvalItemVersionRecordV2) };
}

export async function readCompositionVersion(workspaceId: string, kind: CompositionKind, id: string, versionId: string) {
  if (!UUID.test(id) || !UUID.test(versionId)) return undefined;
  const stored = kind === "item"
    ? await getCustomEvalItemVersionV2(workspaceId, id, versionId, restoreCustomEvalItemVersionRecordV2)
    : await getCustomEvalSetVersionV2(workspaceId, id, versionId, { restoreSet: restoreCustomEvalSetVersionRecordV2, restoreItem: restoreCustomEvalItemVersionRecordV2 });
  if (!stored) return undefined;
  const record = kind === "item" ? restoreCustomEvalItemVersionRecordV2(stored, workspaceId) : restoreCustomEvalSetVersionRecordV2(stored, workspaceId);
  if (compositionId(record.draft) !== id || record.draft.versionId !== versionId) throw new HttpTargetRequestError(500, "eval_composition_stored_identity_invalid");
  return record;
}

export async function readCompositionResource(workspaceId: string, kind: CompositionKind, id: string): Promise<CompositionResource | undefined> {
  if (!UUID.test(id)) return undefined;
  const detail = kind === "item"
    ? await getCustomEvalItemV2(workspaceId, id, restoreCustomEvalItemVersionRecordV2)
    : await getCustomEvalSetV2(workspaceId, id, restoreCustomEvalSetVersionRecordV2, restoreCustomEvalItemVersionRecordV2);
  if (!detail) return undefined;
  const record = await readCompositionVersion(workspaceId, kind, id, detail.head.versionId);
  if (!record || record.fingerprint !== detail.head.recordFingerprint || record.contract.fingerprint !== detail.head.contractFingerprint) throw new HttpTargetRequestError(500, "eval_composition_head_invalid");
  return { detail, record };
}

export async function previewComposition(workspaceId: string, kind: CompositionKind, value: unknown) {
  if (kind === "item") {
    const draft = prepareCustomEvalItemDraftV2(value);
    const head = await getCustomEvalItemHeadV2(workspaceId, draft.itemId, restoreCustomEvalItemVersionRecordV2);
    return resolveCustomEvalItemPreviewV2({ workspaceId, draft, head });
  }
  const draft = prepareCustomEvalSetDraftV2(value);
  const [head, items] = await Promise.all([
    getCustomEvalSetHeadV2(workspaceId, draft.setId, restoreCustomEvalSetVersionRecordV2, restoreCustomEvalItemVersionRecordV2),
    getCustomEvalSetItemsV2(workspaceId, draft.members, restoreCustomEvalItemVersionRecordV2)
  ]);
  if (!items) throw new HttpTargetRequestError(404, "eval_composition_items_not_found");
  return resolveCustomEvalSetPreviewV2({ workspaceId, draft, head, items });
}

export async function saveComposition(auth: RouteAuthContext, kind: CompositionKind, value: unknown) {
  const scope = { workspaceId: auth.workspaceId, actorId: auth.user.id };
  if (kind === "item") {
    const request = prepareCustomEvalItemSaveRequestV2(value);
    const result = await saveCustomEvalItemVersionV2(scope, request, itemCallbacks);
    // Commit may already have completed. Invalid readback is unknown, never a 422 rejection.
    try {
      const record = restoreCustomEvalItemVersionRecordV2(result.record, auth.workspaceId);
      if (record.draft.itemId !== request.draft.itemId || record.draft.versionId !== request.draft.versionId || record.previewFingerprint !== request.expectedPreviewFingerprint) throw new Error("identity");
      return { record, replayed: result.replayed };
    } catch { throw new HttpTargetRequestError(500, "eval_composition_saved_record_invalid"); }
  }
  const request = prepareCustomEvalSetSaveRequestV2(value);
  const result = await saveCustomEvalSetVersionV2(scope, request, setCallbacks);
  try {
    const record = restoreCustomEvalSetVersionRecordV2(result.record, auth.workspaceId);
    if (record.draft.setId !== request.draft.setId || record.draft.versionId !== request.draft.versionId || record.previewFingerprint !== request.expectedPreviewFingerprint) throw new Error("identity");
    return { record, replayed: result.replayed };
  } catch { throw new HttpTargetRequestError(500, "eval_composition_saved_record_invalid"); }
}

export function compositionHead(record: Awaited<ReturnType<typeof readCompositionVersion>>) {
  if (!record) return null;
  return record.schemaVersion === "custom-eval-item-record-v2" ? customEvalItemHeadV2(record) : customEvalSetHeadV2(record);
}
export function loadComposition(requested?: { itemId?: string; itemVersionId?: string }) {
  return loadHttpTarget(async auth => {
    const [items, sets, source] = await Promise.all([
      listCustomEvalItemsV2(auth.workspaceId, restoreCustomEvalItemVersionRecordV2),
      listCustomEvalSetsV2(auth.workspaceId, restoreCustomEvalSetVersionRecordV2, restoreCustomEvalItemVersionRecordV2),
      requested?.itemId && requested.itemVersionId ? readCompositionVersion(auth.workspaceId, "item", requested.itemId, requested.itemVersionId) : undefined
    ]);
    const initialMember = source?.schemaVersion === "custom-eval-item-record-v2" ? {
      itemId: source.draft.itemId, versionId: source.draft.versionId, fingerprint: source.contract.fingerprint, name: source.draft.name, version: source.draft.version
    } : undefined;
    return { items, sets, initialMember, requestedSourceUnavailable: Boolean(requested && !initialMember), workspaceId: auth.workspaceId, canWrite: httpTargetCanWrite(auth) };
  });
}
export function loadCompositionResource(kind: CompositionKind, id: string) {
  return loadHttpTarget(async auth => ({
    resource: await readCompositionResource(auth.workspaceId, kind, id),
    items: kind === "set" ? await listCustomEvalItemsV2(auth.workspaceId, restoreCustomEvalItemVersionRecordV2) : [],
    workspaceId: auth.workspaceId, canWrite: httpTargetCanWrite(auth)
  }));
}
export function loadCompositionVersion(kind: CompositionKind, id: string, versionId: string) {
  return loadHttpTarget(async auth => ({ record: await readCompositionVersion(auth.workspaceId, kind, id, versionId) }));
}

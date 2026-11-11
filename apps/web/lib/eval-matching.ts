import { restoreMatchingEvalItemVersionRecord } from "@open-evals/core";
import { listCustomEvalItemsV2 } from "@open-evals/db";
import { restoreCustomEvalItemVersionRecordV2 } from "@open-evals/core";
import {
  customEvalItemHeadV3, customEvalSetHeadV3,
  prepareCustomEvalItemDraftV3, prepareCustomEvalItemSaveRequestV3,
  prepareCustomEvalItemVersionRecordV3, resolveCustomEvalItemPreviewV3,
  restoreCustomEvalItemVersionRecordV3,
  prepareCustomEvalSetDraftV3, prepareCustomEvalSetSaveRequestV3,
  prepareCustomEvalSetVersionRecordV3, resolveCustomEvalSetPreviewV3,
  restoreCustomEvalSetVersionRecordV3
} from "@open-evals/core";
import {
  getCustomEvalItemV3, getCustomEvalItemHeadV3, getCustomEvalItemVersionV3,
  getCustomEvalSetV3, getCustomEvalSetHeadV3, getCustomEvalSetVersionV3, getCustomEvalSetItemsV3,
  listCustomEvalItemsV3, listCustomEvalSetsV3,
  saveCustomEvalItemVersionV3, saveCustomEvalSetVersionV3
} from "@open-evals/db";
import type { RouteAuthContext } from "./auth";
import { httpTargetCanWrite, HttpTargetRequestError, loadHttpTarget } from "./http-target-plans";
import { matchingId, type MatchingKind, type MatchingResource } from "./eval-matching-types";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const itemCallbacks = { prepare: prepareCustomEvalItemVersionRecordV3, restore: restoreCustomEvalItemVersionRecordV3 };
const setCallbacks = { prepare: prepareCustomEvalSetVersionRecordV3, restore: restoreCustomEvalSetVersionRecordV3, restoreItem: restoreMatchingEvalItemVersionRecord };

export async function readMatchingList(workspaceId: string, kind: MatchingKind) {
  return kind === "item"
    ? { items: await listCustomEvalItemsV3(workspaceId, restoreCustomEvalItemVersionRecordV3) }
    : { sets: await listCustomEvalSetsV3(workspaceId, restoreCustomEvalSetVersionRecordV3, restoreMatchingEvalItemVersionRecord) };
}

export async function readMatchingVersion(workspaceId: string, kind: MatchingKind, id: string, versionId: string) {
  if (!UUID.test(id) || !UUID.test(versionId)) return undefined;
  const stored = kind === "item"
    ? await getCustomEvalItemVersionV3(workspaceId, id, versionId, restoreCustomEvalItemVersionRecordV3)
    : await getCustomEvalSetVersionV3(workspaceId, id, versionId, { restoreSet: restoreCustomEvalSetVersionRecordV3, restoreItem: restoreMatchingEvalItemVersionRecord });
  if (!stored) return undefined;
  const record = kind === "item" ? restoreCustomEvalItemVersionRecordV3(stored, workspaceId) : restoreCustomEvalSetVersionRecordV3(stored, workspaceId);
  if (matchingId(record.draft) !== id || record.draft.versionId !== versionId) throw new HttpTargetRequestError(500, "eval_matching_stored_identity_invalid");
  return record;
}

export async function readMatchingResource(workspaceId: string, kind: MatchingKind, id: string): Promise<MatchingResource | undefined> {
  if (!UUID.test(id)) return undefined;
  const detail = kind === "item"
    ? await getCustomEvalItemV3(workspaceId, id, restoreCustomEvalItemVersionRecordV3)
    : await getCustomEvalSetV3(workspaceId, id, restoreCustomEvalSetVersionRecordV3, restoreMatchingEvalItemVersionRecord);
  if (!detail) return undefined;
  const record = await readMatchingVersion(workspaceId, kind, id, detail.head.versionId);
  if (!record || record.fingerprint !== detail.head.recordFingerprint || record.contract.fingerprint !== detail.head.contractFingerprint) throw new HttpTargetRequestError(500, "eval_matching_head_invalid");
  return { detail, record };
}

export async function previewMatching(workspaceId: string, kind: MatchingKind, value: unknown) {
  if (kind === "item") {
    const draft = prepareCustomEvalItemDraftV3(value);
    const head = await getCustomEvalItemHeadV3(workspaceId, draft.itemId, restoreCustomEvalItemVersionRecordV3);
    return resolveCustomEvalItemPreviewV3({ workspaceId, draft, head });
  }
  const draft = prepareCustomEvalSetDraftV3(value);
  const [head, items] = await Promise.all([
    getCustomEvalSetHeadV3(workspaceId, draft.setId, restoreCustomEvalSetVersionRecordV3, restoreMatchingEvalItemVersionRecord),
    getCustomEvalSetItemsV3(workspaceId, draft.members, restoreMatchingEvalItemVersionRecord)
  ]);
  if (!items) throw new HttpTargetRequestError(404, "eval_matching_items_not_found");
  return resolveCustomEvalSetPreviewV3({ workspaceId, draft, head, items });
}

export async function saveMatching(auth: RouteAuthContext, kind: MatchingKind, value: unknown) {
  const scope = { workspaceId: auth.workspaceId, actorId: auth.user.id };
  if (kind === "item") {
    const request = prepareCustomEvalItemSaveRequestV3(value);
    const result = await saveCustomEvalItemVersionV3(scope, request, itemCallbacks);
    // Commit may already have completed. Invalid readback is unknown, never a 422 rejection.
    try {
      const record = restoreCustomEvalItemVersionRecordV3(result.record, auth.workspaceId);
      if (record.draft.itemId !== request.draft.itemId || record.draft.versionId !== request.draft.versionId || record.previewFingerprint !== request.expectedPreviewFingerprint) throw new Error("identity");
      return { record, replayed: result.replayed };
    } catch { throw new HttpTargetRequestError(500, "eval_matching_saved_record_invalid"); }
  }
  const request = prepareCustomEvalSetSaveRequestV3(value);
  const result = await saveCustomEvalSetVersionV3(scope, request, setCallbacks);
  try {
    const record = restoreCustomEvalSetVersionRecordV3(result.record, auth.workspaceId);
    if (record.draft.setId !== request.draft.setId || record.draft.versionId !== request.draft.versionId || record.previewFingerprint !== request.expectedPreviewFingerprint) throw new Error("identity");
    return { record, replayed: result.replayed };
  } catch { throw new HttpTargetRequestError(500, "eval_matching_saved_record_invalid"); }
}

export function matchingHead(record: Awaited<ReturnType<typeof readMatchingVersion>>) {
  if (!record) return null;
  return record.schemaVersion === "custom-eval-item-record-v3" ? customEvalItemHeadV3(record) : customEvalSetHeadV3(record);
}
export function loadMatching(requested?: { itemId?: string; itemVersionId?: string }) {
  return loadHttpTarget(async auth => {
    const [items, sets, source] = await Promise.all([
      matchingLibraryItems(auth.workspaceId),
      listCustomEvalSetsV3(auth.workspaceId, restoreCustomEvalSetVersionRecordV3, restoreMatchingEvalItemVersionRecord),
      requested?.itemId && requested.itemVersionId ? readMatchingVersion(auth.workspaceId, "item", requested.itemId, requested.itemVersionId) : undefined
    ]);
    const initialMember = source?.schemaVersion === "custom-eval-item-record-v3" ? {
      schemaVersion: "custom-eval-item-ref-v3" as const, itemId: source.draft.itemId, versionId: source.draft.versionId, fingerprint: source.contract.fingerprint, name: source.draft.name, version: source.draft.version
    } : undefined;
    return { items, sets, initialMember, requestedSourceUnavailable: Boolean(requested && !initialMember), workspaceId: auth.workspaceId, canWrite: httpTargetCanWrite(auth) };
  });
}
export function loadMatchingResource(kind: MatchingKind, id: string) {
  return loadHttpTarget(async auth => ({
    resource: await readMatchingResource(auth.workspaceId, kind, id),
    items: kind === "set" ? await matchingLibraryItems(auth.workspaceId) : [],
    workspaceId: auth.workspaceId, canWrite: httpTargetCanWrite(auth)
  }));
}
export function loadMatchingVersion(kind: MatchingKind, id: string, versionId: string) {
  return loadHttpTarget(async auth => ({ record: await readMatchingVersion(auth.workspaceId, kind, id, versionId) }));
}

async function matchingLibraryItems(workspaceId: string) {
  const [contains, exact] = await Promise.all([listCustomEvalItemsV2(workspaceId, restoreCustomEvalItemVersionRecordV2), listCustomEvalItemsV3(workspaceId, restoreCustomEvalItemVersionRecordV3)]);
  return [...contains, ...exact];
}

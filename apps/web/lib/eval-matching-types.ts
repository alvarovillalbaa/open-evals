import type { CustomEvalItemSummaryV2, CustomEvalItemSummaryV3, CustomEvalItemRefV3 } from "@open-evals/core";
import type {
  CustomEvalItemDetailV3, CustomEvalItemDraftV3, CustomEvalItemHeadV3,
  CustomEvalItemPreviewV3, CustomEvalItemVersionRecordV3,
  CustomEvalSetDetailV3, CustomEvalSetDraftV3, CustomEvalSetHeadV3,
  CustomEvalSetPreviewV3, CustomEvalSetVersionRecordV3
} from "@open-evals/core";

export type MatchingKind = "item" | "set";
export type MatchingDraft = CustomEvalItemDraftV3 | CustomEvalSetDraftV3;
export type MatchingHead = CustomEvalItemHeadV3 | CustomEvalSetHeadV3;
export type MatchingPreview = CustomEvalItemPreviewV3 | CustomEvalSetPreviewV3;
export type MatchingRecord = CustomEvalItemVersionRecordV3 | CustomEvalSetVersionRecordV3;
export type MatchingDetail = CustomEvalItemDetailV3 | CustomEvalSetDetailV3;
export interface MatchingResource { detail: MatchingDetail; record: MatchingRecord }

export function matchingId(value: MatchingDraft | MatchingHead): string {
  return "itemId" in value ? value.itemId : value.setId;
}
export function matchingPath(kind: MatchingKind, id?: string, versionId?: string): string {
  const base = `/evals/matching/${kind === "item" ? "items" : "sets"}`;
  return `${base}${id ? `/${encodeURIComponent(id)}` : ""}${versionId ? `/versions/${encodeURIComponent(versionId)}` : ""}`;
}
export function matchingApi(kind: MatchingKind): string { return `/api/v3/eval-${kind === "item" ? "items" : "sets"}`; }

export type MatchingLibraryItem = CustomEvalItemSummaryV2 | CustomEvalItemSummaryV3;
export function matchingItemPath(ref: CustomEvalItemRefV3): string { return ref.schemaVersion === "custom-eval-item-ref-v2" ? `/evals/composition/items/${encodeURIComponent(ref.itemId)}/versions/${encodeURIComponent(ref.versionId)}` : matchingPath("item", ref.itemId, ref.versionId); }

import type {
  CustomEvalItemDetailV2, CustomEvalItemDraftV2, CustomEvalItemHeadV2,
  CustomEvalItemPreviewV2, CustomEvalItemVersionRecordV2,
  CustomEvalSetDetailV2, CustomEvalSetDraftV2, CustomEvalSetHeadV2,
  CustomEvalSetPreviewV2, CustomEvalSetVersionRecordV2
} from "@open-evals/core";

export type CompositionKind = "item" | "set";
export type CompositionDraft = CustomEvalItemDraftV2 | CustomEvalSetDraftV2;
export type CompositionHead = CustomEvalItemHeadV2 | CustomEvalSetHeadV2;
export type CompositionPreview = CustomEvalItemPreviewV2 | CustomEvalSetPreviewV2;
export type CompositionRecord = CustomEvalItemVersionRecordV2 | CustomEvalSetVersionRecordV2;
export type CompositionDetail = CustomEvalItemDetailV2 | CustomEvalSetDetailV2;
export interface CompositionResource { detail: CompositionDetail; record: CompositionRecord }

export function compositionId(value: CompositionDraft | CompositionHead): string {
  return "itemId" in value ? value.itemId : value.setId;
}
export function compositionPath(kind: CompositionKind, id?: string, versionId?: string): string {
  const base = `/evals/composition/${kind === "item" ? "items" : "sets"}`;
  return `${base}${id ? `/${encodeURIComponent(id)}` : ""}${versionId ? `/versions/${encodeURIComponent(versionId)}` : ""}`;
}
export function compositionApi(kind: CompositionKind): string { return `/api/v2/eval-${kind === "item" ? "items" : "sets"}`; }

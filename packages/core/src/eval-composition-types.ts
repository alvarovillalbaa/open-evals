import type { CustomEvalSetContract } from "./custom-evals";
import type { ProvidedOutputMemberProof } from "./provided-output-types";
import type { EvalItemVersion, EvalSetVersion } from "./types";
import type {
  HttpEvalPlanDraft, HttpEvalPlanSaveRequest, HttpEvalPlanContent,
  HttpEvalPlanPreview, HttpEvalPlanVersionRecord, HttpEvalPlanHead, HttpEvalStartRequest,
  HttpEvalRunLedger, HttpEvalRowEvent, HttpEvalExecution, HttpEvalRunRecord
} from "./http-eval-types";

export interface CustomEvalItemRefV2 {
  itemId: string;
  versionId: string;
  fingerprint: string;
}
export interface CustomEvalItemDraftV2 {
  schemaVersion: "custom-eval-item-draft-v2";
  itemId: string;
  versionId: string;
  version: number;
  expectedVersionId: string | null;
  name: string;
  contains: string;
}
export interface CustomEvalSetDraftV2 {
  schemaVersion: "custom-eval-set-draft-v2";
  setId: string;
  versionId: string;
  version: number;
  expectedVersionId: string | null;
  name: string;
  members: CustomEvalItemRefV2[];
  datasetPassRateThreshold: number;
}
export interface CustomEvalItemHeadV2 {
  itemId: string;
  versionId: string;
  version: number;
  name: string;
  contractFingerprint: string;
  recordFingerprint: string;
}
export interface CustomEvalSetHeadV2 {
  setId: string;
  versionId: string;
  version: number;
  name: string;
  contractFingerprint: string;
  recordFingerprint: string;
}
export interface CustomEvalItemContractV2 extends EvalItemVersion {
  schemaVersion: "custom-eval-item-v2";
  workspaceId: string;
  type: "string_check";
  config: { contains: string };
  criticality: "critical";
  authoring: {
    itemId: string;
    versionId: string;
    expectedVersionId: string | null;
    version: number;
    draftFingerprint: string;
  };
}
export interface CustomEvalSetContractV2 extends EvalSetVersion {
  schemaVersion: "custom-eval-set-v2";
  workspaceId: string;
  itemVersions: Array<{ item: CustomEvalItemContractV2; weight: 1; criticality: "critical" }>;
  memberProofs: CustomEvalSetMemberProofV2[];
  authoring: {
    setId: string;
    versionId: string;
    expectedVersionId: string | null;
    version: number;
    draftFingerprint: string;
  };
}
export interface CustomEvalItemStorageIdsV2 { itemId: string; versionId: string; auditId: string }
export interface CustomEvalSetStorageIdsV2 { setId: string; versionId: string; auditId: string }
export interface CustomEvalSetMemberProofV2 extends ProvidedOutputMemberProof {
  publicItemId: string;
  publicItemVersionId: string;
  itemRecordFingerprint: string;
}
export interface CustomEvalItemPreviewV2 {
  schemaVersion: "custom-eval-item-preview-v2";
  workspaceId: string;
  draft: CustomEvalItemDraftV2;
  head: CustomEvalItemHeadV2 | null;
  contract: CustomEvalItemContractV2;
  recordByteAllowance: number;
  fingerprint: string;
}
export interface CustomEvalSetPreviewV2 {
  schemaVersion: "custom-eval-set-preview-v2";
  workspaceId: string;
  draft: CustomEvalSetDraftV2;
  head: CustomEvalSetHeadV2 | null;
  contract: CustomEvalSetContractV2;
  members: CustomEvalSetMemberProofV2[];
  recordByteAllowance: number;
  fingerprint: string;
}
export interface CustomEvalItemSaveRequestV2 {
  schemaVersion: "custom-eval-item-save-v2";
  draft: CustomEvalItemDraftV2;
  expectedPreviewFingerprint: string;
}
export interface CustomEvalSetSaveRequestV2 {
  schemaVersion: "custom-eval-set-save-v2";
  draft: CustomEvalSetDraftV2;
  expectedPreviewFingerprint: string;
}
export interface CustomEvalItemVersionRecordV2 {
  schemaVersion: "custom-eval-item-record-v2";
  workspaceId: string;
  storage: CustomEvalItemStorageIdsV2;
  createdAt: string;
  draft: CustomEvalItemDraftV2;
  head: CustomEvalItemHeadV2 | null;
  contract: CustomEvalItemContractV2;
  previewFingerprint: string;
  requestFingerprint: string;
  fingerprint: string;
}
export interface CustomEvalSetVersionRecordV2 {
  schemaVersion: "custom-eval-set-record-v2";
  workspaceId: string;
  storage: CustomEvalSetStorageIdsV2;
  createdAt: string;
  draft: CustomEvalSetDraftV2;
  head: CustomEvalSetHeadV2 | null;
  contract: CustomEvalSetContractV2;
  members: CustomEvalSetMemberProofV2[];
  previewFingerprint: string;
  requestFingerprint: string;
  fingerprint: string;
}
export interface CustomEvalItemVersionSummaryV2 extends CustomEvalItemHeadV2 { createdAt: string }
export interface CustomEvalSetVersionSummaryV2 extends CustomEvalSetHeadV2 { createdAt: string; memberCount: number }
export interface CustomEvalItemSummaryV2 { itemId: string; name: string; versionCount: number; head: CustomEvalItemHeadV2 }
export interface CustomEvalSetSummaryV2 { setId: string; name: string; versionCount: number; head: CustomEvalSetHeadV2; memberCount: number }
export interface CustomEvalItemDetailV2 {
  schemaVersion: "custom-eval-item-detail-v2";
  itemId: string;
  head: CustomEvalItemHeadV2;
  versions: CustomEvalItemVersionSummaryV2[];
  hasMore: boolean;
}
export interface CustomEvalSetDetailV2 {
  schemaVersion: "custom-eval-set-detail-v2";
  setId: string;
  head: CustomEvalSetHeadV2;
  versions: CustomEvalSetVersionSummaryV2[];
  hasMore: boolean;
}
export interface ResolveCustomEvalItemPreviewV2Input { workspaceId: string; draft: unknown; head: unknown }
export interface ResolveCustomEvalSetPreviewV2Input extends ResolveCustomEvalItemPreviewV2Input { items: unknown[] }
export interface PrepareCustomEvalItemRecordV2Input { workspaceId: string; request: unknown; head: unknown; createdAt: string }
export interface PrepareCustomEvalSetRecordV2Input extends PrepareCustomEvalItemRecordV2Input { items: unknown[] }

export interface HttpEvalSetRefV1 { schemaVersion: "custom-eval-set-ref-v1"; setId: string; versionId: string; fingerprint: string }
export interface HttpEvalSetRefV2 { schemaVersion: "custom-eval-set-ref-v2"; setId: string; versionId: string; fingerprint: string }
export type HttpEvalSetRef = HttpEvalSetRefV1 | HttpEvalSetRefV2;
export interface HttpEvalPlanDraftV2 extends Omit<HttpEvalPlanDraft, "schemaVersion" | "evalSetVersionIds"> {
  schemaVersion: "http-eval-plan-draft-v2";
  evalSetVersions: HttpEvalSetRef[];
}
export interface HttpEvalPlanSaveRequestV2 extends Omit<HttpEvalPlanSaveRequest, "schemaVersion" | "draft"> {
  schemaVersion: "http-eval-plan-save-v2";
  draft: HttpEvalPlanDraftV2;
}
export interface HttpEvalV1SetInComposition {
  ref: HttpEvalSetRefV1;
  contract: CustomEvalSetContract;
  members: ProvidedOutputMemberProof[];
  sourceRecordFingerprint: null;
}
export interface HttpEvalV2SetInComposition {
  ref: HttpEvalSetRefV2;
  contract: CustomEvalSetContractV2;
  members: CustomEvalSetMemberProofV2[];
  /** Provenance from source admission, not a reconstructed complete source record. */
  sourceRecordFingerprint: string;
}
export type HttpEvalResolvedSetV2 = HttpEvalV1SetInComposition | HttpEvalV2SetInComposition;
export interface HttpEvalPlanContentV2 extends Omit<HttpEvalPlanContent, "schemaVersion" | "draft" | "evalSets" | "policy"> {
  schemaVersion: "http-target-eval-v2";
  draft: HttpEvalPlanDraftV2;
  evalSets: HttpEvalResolvedSetV2[];
  policy: Omit<HttpEvalPlanContent["policy"], "codeVersion"> & { codeVersion: "http-target-eval-v2" };
}
export interface HttpEvalCompositionCounts {
  rowCount: number;
  evalSetCount: number;
  uniqueItemCount: number;
  resultPairs: number;
  targetCalls: number;
}
export interface HttpEvalPlanHeadV2 extends HttpEvalPlanHead { profile: "http-target-eval-v2" }
export interface HttpEvalPlanPreviewV2 extends Omit<HttpEvalPlanPreview, "schemaVersion" | "draft" | "content" | "head"> {
  schemaVersion: "http-eval-plan-preview-v2";
  draft: HttpEvalPlanDraftV2;
  content: HttpEvalPlanContentV2;
  head: HttpEvalPlanHeadV2 | null;
  counts: HttpEvalCompositionCounts;
}
export interface HttpEvalPlanVersionRecordV2 extends Omit<HttpEvalPlanVersionRecord, "schemaVersion" | "content" | "head"> {
  schemaVersion: "http-eval-plan-record-v2";
  content: HttpEvalPlanContentV2;
  head: HttpEvalPlanHeadV2 | null;
}
export interface HttpEvalStartRequestV2 extends Omit<HttpEvalStartRequest, "schemaVersion"> { schemaVersion: "http-eval-start-v2" }
export interface HttpEvalRunLedgerV2 extends Omit<HttpEvalRunLedger, "schemaVersion"> { schemaVersion: "http-eval-run-ledger-v2" }
export interface HttpEvalRowEventV2 extends Omit<HttpEvalRowEvent, "schemaVersion"> { schemaVersion: "http-eval-row-event-v2" }
export interface HttpEvalExecutionV2 extends Omit<HttpEvalExecution, "schemaVersion"> { schemaVersion: "http-eval-execution-v2" }
export interface HttpEvalRunRecordV2 extends Omit<HttpEvalRunRecord, "schemaVersion" | "plan" | "ledger" | "events" | "execution"> {
  schemaVersion: "http-eval-run-record-v2";
  plan: HttpEvalPlanVersionRecordV2;
  ledger: HttpEvalRunLedgerV2;
  events: HttpEvalRowEventV2[];
  execution: HttpEvalExecutionV2;
}
export type AnyHttpEvalPlanDraft = HttpEvalPlanDraft | HttpEvalPlanDraftV2;
export type AnyHttpEvalPlanSaveRequest = HttpEvalPlanSaveRequest | HttpEvalPlanSaveRequestV2;
export type AnyHttpEvalPlanContent = HttpEvalPlanContent | HttpEvalPlanContentV2;
export type AnyHttpEvalPlanPreview = HttpEvalPlanPreview | HttpEvalPlanPreviewV2;
export type AnyHttpEvalPlanVersionRecord = HttpEvalPlanVersionRecord | HttpEvalPlanVersionRecordV2;
export type AnyHttpEvalPlanHead = HttpEvalPlanHead | HttpEvalPlanHeadV2;
export type AnyHttpEvalStartRequest = HttpEvalStartRequest | HttpEvalStartRequestV2;
export type AnyHttpEvalRunLedger = HttpEvalRunLedger | HttpEvalRunLedgerV2;
export type AnyHttpEvalRowEvent = HttpEvalRowEvent | HttpEvalRowEventV2;
export type AnyHttpEvalExecution = HttpEvalExecution | HttpEvalExecutionV2;
export type AnyHttpEvalRunRecord = HttpEvalRunRecord | HttpEvalRunRecordV2;
export interface AnyHttpEvalFinalizedRow {
  ledger: AnyHttpEvalRunLedger;
  event: AnyHttpEvalRowEvent;
  results: HttpEvalExecution["results"];
}
export type HttpEvalPlanFamily = "http-target-eval-v1" | "http-target-eval-v2";

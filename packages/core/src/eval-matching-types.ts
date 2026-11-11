import type { EvalItemVersion, EvalSetVersion } from "./types";
import type {
  CustomEvalItemContractV2, CustomEvalItemHeadV2, CustomEvalSetHeadV2,
  CustomEvalItemStorageIdsV2, CustomEvalSetStorageIdsV2,
  CustomEvalSetMemberProofV2, CustomEvalItemVersionRecordV2,
  HttpEvalSetRef, HttpEvalResolvedSetV2, HttpEvalPlanDraftV2, HttpEvalPlanSaveRequestV2,
  HttpEvalPlanContentV2, HttpEvalPlanPreviewV2, HttpEvalPlanVersionRecordV2,
  HttpEvalPlanHeadV2, HttpEvalStartRequestV2, HttpEvalRunLedgerV2, HttpEvalRowEventV2,
  HttpEvalExecutionV2, HttpEvalRunRecordV2
} from "./eval-composition-types";

export interface HttpEvalSetRefV3 { schemaVersion: "custom-eval-set-ref-v3"; setId: string; versionId: string; fingerprint: string }
export type MatchingHttpEvalSetRef = HttpEvalSetRef | HttpEvalSetRefV3;
export interface HttpEvalV3SetInMatching {
  ref: HttpEvalSetRefV3; contract: CustomEvalSetContractV3;
  members: CustomEvalSetMemberProofV3[]; sourceRecordFingerprint: string;
}
export type MatchingHttpEvalResolvedSet = HttpEvalResolvedSetV2 | HttpEvalV3SetInMatching;
export interface HttpEvalPlanDraftV3 extends Omit<HttpEvalPlanDraftV2, "schemaVersion" | "evalSetVersions"> {
  schemaVersion: "http-eval-plan-draft-v3"; evalSetVersions: MatchingHttpEvalSetRef[];
}
export interface HttpEvalPlanSaveRequestV3 extends Omit<HttpEvalPlanSaveRequestV2, "schemaVersion" | "draft"> {
  schemaVersion: "http-eval-plan-save-v3"; draft: HttpEvalPlanDraftV3;
}
export interface HttpEvalPlanContentV3 extends Omit<HttpEvalPlanContentV2, "schemaVersion" | "draft" | "evalSets" | "policy"> {
  schemaVersion: "http-target-eval-v3"; draft: HttpEvalPlanDraftV3; evalSets: MatchingHttpEvalResolvedSet[];
  policy: Omit<HttpEvalPlanContentV2["policy"], "codeVersion" | "evaluator"> & { codeVersion: "http-target-eval-v3"; evaluator: "text_matching_v3" };
}
export interface HttpEvalPlanHeadV3 extends Omit<HttpEvalPlanHeadV2, "profile"> { profile: "http-target-eval-v3" }
export interface HttpEvalPlanPreviewV3 extends Omit<HttpEvalPlanPreviewV2, "schemaVersion" | "draft" | "content" | "head"> {
  schemaVersion: "http-eval-plan-preview-v3"; draft: HttpEvalPlanDraftV3; content: HttpEvalPlanContentV3; head: HttpEvalPlanHeadV3 | null;
}
export interface HttpEvalPlanVersionRecordV3 extends Omit<HttpEvalPlanVersionRecordV2, "schemaVersion" | "content" | "head"> {
  schemaVersion: "http-eval-plan-record-v3"; content: HttpEvalPlanContentV3; head: HttpEvalPlanHeadV3 | null;
}
export interface HttpEvalStartRequestV3 extends Omit<HttpEvalStartRequestV2, "schemaVersion"> { schemaVersion: "http-eval-start-v3" }
export interface HttpEvalRunLedgerV3 extends Omit<HttpEvalRunLedgerV2, "schemaVersion"> { schemaVersion: "http-eval-run-ledger-v3" }
export interface HttpEvalRowEventV3 extends Omit<HttpEvalRowEventV2, "schemaVersion"> { schemaVersion: "http-eval-row-event-v3" }
export interface HttpEvalExecutionV3 extends Omit<HttpEvalExecutionV2, "schemaVersion"> { schemaVersion: "http-eval-execution-v3" }
export interface HttpEvalRunRecordV3 extends Omit<HttpEvalRunRecordV2, "schemaVersion" | "plan" | "ledger" | "events" | "execution"> {
  schemaVersion: "http-eval-run-record-v3"; plan: HttpEvalPlanVersionRecordV3; ledger: HttpEvalRunLedgerV3; events: HttpEvalRowEventV3[]; execution: HttpEvalExecutionV3;
}

export interface CustomEvalItemDraftV3 {
  schemaVersion: "custom-eval-item-draft-v3";
  itemId: string;
  versionId: string;
  version: number;
  expectedVersionId: string | null;
  name: string;
  expected: string;
}
export interface CustomEvalItemRefV3 {
  schemaVersion: "custom-eval-item-ref-v2" | "custom-eval-item-ref-v3";
  itemId: string;
  versionId: string;
  fingerprint: string;
}
export interface CustomEvalSetDraftV3 {
  schemaVersion: "custom-eval-set-draft-v3";
  setId: string;
  versionId: string;
  version: number;
  expectedVersionId: string | null;
  name: string;
  members: CustomEvalItemRefV3[];
  datasetPassRateThreshold: number;
}
export interface CustomEvalItemHeadV3 extends CustomEvalItemHeadV2 { profile: "eval-matching-v3" }
export interface CustomEvalSetHeadV3 extends CustomEvalSetHeadV2 { profile: "eval-matching-v3" }
export type CustomEvalItemStorageIdsV3 = CustomEvalItemStorageIdsV2;
export type CustomEvalSetStorageIdsV3 = CustomEvalSetStorageIdsV2;
export interface CustomEvalItemContractV3 extends EvalItemVersion {
  schemaVersion: "custom-eval-item-v3";
  workspaceId: string;
  type: "exact_match";
  config: { expected: string };
  criticality: "critical";
  authoring: {
    itemId: string;
    versionId: string;
    expectedVersionId: string | null;
    version: number;
    draftFingerprint: string;
  };
}
export type MatchingEvalItemContract = CustomEvalItemContractV2 | CustomEvalItemContractV3;
export interface CustomEvalSetMemberProofV3 extends CustomEvalSetMemberProofV2 {
  itemSchemaVersion: "custom-eval-item-v2" | "custom-eval-item-v3";
}
export interface CustomEvalSetContractV3 extends EvalSetVersion {
  schemaVersion: "custom-eval-set-v3";
  workspaceId: string;
  itemVersions: Array<{ item: MatchingEvalItemContract; weight: 1; criticality: "critical" }>;
  memberProofs: CustomEvalSetMemberProofV3[];
  authoring: {
    setId: string;
    versionId: string;
    expectedVersionId: string | null;
    version: number;
    draftFingerprint: string;
  };
}
export interface CustomEvalItemPreviewV3 {
  schemaVersion: "custom-eval-item-preview-v3";
  workspaceId: string;
  draft: CustomEvalItemDraftV3;
  head: CustomEvalItemHeadV3 | null;
  contract: CustomEvalItemContractV3;
  recordByteAllowance: number;
  fingerprint: string;
}
export interface CustomEvalSetPreviewV3 {
  schemaVersion: "custom-eval-set-preview-v3";
  workspaceId: string;
  draft: CustomEvalSetDraftV3;
  head: CustomEvalSetHeadV3 | null;
  contract: CustomEvalSetContractV3;
  members: CustomEvalSetMemberProofV3[];
  recordByteAllowance: number;
  fingerprint: string;
}
export interface CustomEvalItemSaveRequestV3 {
  schemaVersion: "custom-eval-item-save-v3";
  draft: CustomEvalItemDraftV3;
  expectedPreviewFingerprint: string;
}
export interface CustomEvalSetSaveRequestV3 {
  schemaVersion: "custom-eval-set-save-v3";
  draft: CustomEvalSetDraftV3;
  expectedPreviewFingerprint: string;
}
export interface CustomEvalItemVersionRecordV3 {
  schemaVersion: "custom-eval-item-record-v3";
  workspaceId: string;
  storage: CustomEvalItemStorageIdsV3;
  createdAt: string;
  draft: CustomEvalItemDraftV3;
  head: CustomEvalItemHeadV3 | null;
  contract: CustomEvalItemContractV3;
  previewFingerprint: string;
  requestFingerprint: string;
  fingerprint: string;
}
export interface CustomEvalSetVersionRecordV3 {
  schemaVersion: "custom-eval-set-record-v3";
  workspaceId: string;
  storage: CustomEvalSetStorageIdsV3;
  createdAt: string;
  draft: CustomEvalSetDraftV3;
  head: CustomEvalSetHeadV3 | null;
  contract: CustomEvalSetContractV3;
  members: CustomEvalSetMemberProofV3[];
  previewFingerprint: string;
  requestFingerprint: string;
  fingerprint: string;
}
export type MatchingEvalItemRecord = CustomEvalItemVersionRecordV2 | CustomEvalItemVersionRecordV3;
export interface ResolveCustomEvalItemPreviewV3Input { workspaceId: string; draft: unknown; head: unknown }
export interface ResolveCustomEvalSetPreviewV3Input extends ResolveCustomEvalItemPreviewV3Input { items: unknown[] }
export interface PrepareCustomEvalItemRecordV3Input { workspaceId: string; request: unknown; head: unknown; createdAt: string }
export interface PrepareCustomEvalSetRecordV3Input extends PrepareCustomEvalItemRecordV3Input { items: unknown[] }
export interface CustomEvalItemVersionSummaryV3 extends CustomEvalItemHeadV3 { createdAt: string }
export interface CustomEvalSetVersionSummaryV3 extends CustomEvalSetHeadV3 { createdAt: string; memberCount: number }
export interface CustomEvalItemSummaryV3 { itemId: string; name: string; versionCount: number; head: CustomEvalItemHeadV3 }
export interface CustomEvalSetSummaryV3 { setId: string; name: string; versionCount: number; head: CustomEvalSetHeadV3; memberCount: number }
export interface CustomEvalItemDetailV3 {
  schemaVersion: "custom-eval-item-detail-v3";
  itemId: string;
  head: CustomEvalItemHeadV3;
  versions: CustomEvalItemVersionSummaryV3[];
  hasMore: boolean;
}
export interface CustomEvalSetDetailV3 {
  schemaVersion: "custom-eval-set-detail-v3";
  setId: string;
  head: CustomEvalSetHeadV3;
  versions: CustomEvalSetVersionSummaryV3[];
  hasMore: boolean;
}

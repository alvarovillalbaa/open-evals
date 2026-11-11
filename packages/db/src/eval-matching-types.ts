import type { EvalCompositionItemContract, EvalCompositionItemRecord } from "./eval-composition-types";
/** Structural boundary: complete versioned parsing stays in the trusted core callbacks. */
export interface EvalMatchingScope { workspaceId: string; actorId: string }
export interface EvalMatchingItemRef { schemaVersion: "custom-eval-item-ref-v2" | "custom-eval-item-ref-v3"; itemId: string; versionId: string; fingerprint: string }
export interface EvalMatchingItemDraft {
  schemaVersion: "custom-eval-item-draft-v3"; itemId: string; versionId: string; version: number;
  expectedVersionId: string | null; name: string; expected: string;
}
export interface EvalMatchingSetDraft {
  schemaVersion: "custom-eval-set-draft-v3"; setId: string; versionId: string; version: number;
  expectedVersionId: string | null; name: string; members: EvalMatchingItemRef[]; datasetPassRateThreshold: number;
}
export interface EvalMatchingItemHead { profile: "eval-matching-v3";
  itemId: string; versionId: string; version: number; name: string; contractFingerprint: string; recordFingerprint: string;
}
export interface EvalMatchingSetHead { profile: "eval-matching-v3";
  setId: string; versionId: string; version: number; name: string; contractFingerprint: string; recordFingerprint: string;
}
export interface EvalMatchingItemContract {
  schemaVersion: "custom-eval-item-v3"; workspaceId: string; id: string; itemId: string; name: string;
  type: "exact_match"; version: number; fingerprint: string; outputSchema: unknown; config: { expected: string };
  criticality: "critical"; evaluationUnits: string[];
  authoring: { itemId: string; versionId: string; expectedVersionId: string | null; version: number; draftFingerprint: string };
}
export interface EvalMatchingMemberProof { itemSchemaVersion: "custom-eval-item-v2" | "custom-eval-item-v3";
  evalSetVersionId: string; evalItemVersionId: string; position: number; weight: number; criticality: "critical";
  itemFingerprint: string; publicItemId: string; publicItemVersionId: string; itemRecordFingerprint: string;
}
export interface EvalMatchingSetContract {
  schemaVersion: "custom-eval-set-v3"; workspaceId: string; id: string; setId: string; name: string; fingerprint: string;
  itemVersions: Array<{ item: EvalMatchingItemContract | EvalCompositionItemContract; weight: 1; criticality: "critical" }>;
  memberProofs: EvalMatchingMemberProof[];
  gates: { rowThreshold: number; datasetPassRateThreshold: number; evalSetThreshold: number; runThreshold: number };
  authoring: { setId: string; versionId: string; expectedVersionId: string | null; version: number; draftFingerprint: string };
}
export interface EvalMatchingItemRecord {
  schemaVersion: "custom-eval-item-record-v3"; workspaceId: string;
  storage: { itemId: string; versionId: string; auditId: string }; createdAt: string; draft: EvalMatchingItemDraft;
  head: EvalMatchingItemHead | null; contract: EvalMatchingItemContract;
  previewFingerprint: string; requestFingerprint: string; fingerprint: string;
}
export interface EvalMatchingSetRecord {
  schemaVersion: "custom-eval-set-record-v3"; workspaceId: string;
  storage: { setId: string; versionId: string; auditId: string }; createdAt: string; draft: EvalMatchingSetDraft;
  head: EvalMatchingSetHead | null; contract: EvalMatchingSetContract; members: EvalMatchingMemberProof[];
  previewFingerprint: string; requestFingerprint: string; fingerprint: string;
}
export interface EvalMatchingItemSummary { itemId: string; name: string; versionCount: number; head: EvalMatchingItemHead }
export interface EvalMatchingSetSummary { setId: string; name: string; versionCount: number; head: EvalMatchingSetHead; memberCount: number }
export interface EvalMatchingItemDetail {
  schemaVersion: "custom-eval-item-detail-v3"; itemId: string; head: EvalMatchingItemHead;
  versions: Array<EvalMatchingItemHead & { createdAt: string }>; hasMore: boolean;
}
export interface EvalMatchingSetDetail {
  schemaVersion: "custom-eval-set-detail-v3"; setId: string; head: EvalMatchingSetHead;
  versions: Array<EvalMatchingSetHead & { createdAt: string; memberCount: number }>; hasMore: boolean;
}
export type EvalMatchingRestore<T> = (value: unknown, expectedWorkspaceId?: string) => T;
export interface EvalMatchingItemCallbacks<T extends EvalMatchingItemRecord> {
  prepare(input: { workspaceId: string; request: unknown; head: unknown; createdAt: string }): T;
  restore: EvalMatchingRestore<T>;
}
export interface EvalMatchingSetCallbacks<T extends EvalMatchingSetRecord> {
  prepare(input: { workspaceId: string; request: unknown; head: unknown; createdAt: string; items: unknown[] }): T;
  restore: EvalMatchingRestore<T>; restoreItem: EvalMatchingRestore<MatchingSourceRecord>;
}
export interface EvalMatchingSetReaders<T extends EvalMatchingSetRecord> {
  restoreSet: EvalMatchingRestore<T>; restoreItem: EvalMatchingRestore<MatchingSourceRecord>;
}

export type MatchingSourceRecord = EvalCompositionItemRecord | EvalMatchingItemRecord;

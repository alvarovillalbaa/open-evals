/** Structural boundary: complete versioned parsing stays in the trusted core callbacks. */
export interface EvalCompositionScope { workspaceId: string; actorId: string }
export interface EvalCompositionItemRef { itemId: string; versionId: string; fingerprint: string }
export interface EvalCompositionItemDraft {
  schemaVersion: "custom-eval-item-draft-v2"; itemId: string; versionId: string; version: number;
  expectedVersionId: string | null; name: string; contains: string;
}
export interface EvalCompositionSetDraft {
  schemaVersion: "custom-eval-set-draft-v2"; setId: string; versionId: string; version: number;
  expectedVersionId: string | null; name: string; members: EvalCompositionItemRef[]; datasetPassRateThreshold: number;
}
export interface EvalCompositionItemHead {
  itemId: string; versionId: string; version: number; name: string; contractFingerprint: string; recordFingerprint: string;
}
export interface EvalCompositionSetHead {
  setId: string; versionId: string; version: number; name: string; contractFingerprint: string; recordFingerprint: string;
}
export interface EvalCompositionItemContract {
  schemaVersion: "custom-eval-item-v2"; workspaceId: string; id: string; itemId: string; name: string;
  type: "string_check"; version: number; fingerprint: string; outputSchema: unknown; config: { contains: string };
  criticality: "critical"; evaluationUnits: string[];
  authoring: { itemId: string; versionId: string; expectedVersionId: string | null; version: number; draftFingerprint: string };
}
export interface EvalCompositionMemberProof {
  evalSetVersionId: string; evalItemVersionId: string; position: number; weight: number; criticality: "critical";
  itemFingerprint: string; publicItemId: string; publicItemVersionId: string; itemRecordFingerprint: string;
}
export interface EvalCompositionSetContract {
  schemaVersion: "custom-eval-set-v2"; workspaceId: string; id: string; setId: string; name: string; fingerprint: string;
  itemVersions: Array<{ item: EvalCompositionItemContract; weight: 1; criticality: "critical" }>;
  memberProofs: EvalCompositionMemberProof[];
  gates: { rowThreshold: number; datasetPassRateThreshold: number; evalSetThreshold: number; runThreshold: number };
  authoring: { setId: string; versionId: string; expectedVersionId: string | null; version: number; draftFingerprint: string };
}
export interface EvalCompositionItemRecord {
  schemaVersion: "custom-eval-item-record-v2"; workspaceId: string;
  storage: { itemId: string; versionId: string; auditId: string }; createdAt: string; draft: EvalCompositionItemDraft;
  head: EvalCompositionItemHead | null; contract: EvalCompositionItemContract;
  previewFingerprint: string; requestFingerprint: string; fingerprint: string;
}
export interface EvalCompositionSetRecord {
  schemaVersion: "custom-eval-set-record-v2"; workspaceId: string;
  storage: { setId: string; versionId: string; auditId: string }; createdAt: string; draft: EvalCompositionSetDraft;
  head: EvalCompositionSetHead | null; contract: EvalCompositionSetContract; members: EvalCompositionMemberProof[];
  previewFingerprint: string; requestFingerprint: string; fingerprint: string;
}
export interface EvalCompositionItemSummary { itemId: string; name: string; versionCount: number; head: EvalCompositionItemHead }
export interface EvalCompositionSetSummary { setId: string; name: string; versionCount: number; head: EvalCompositionSetHead; memberCount: number }
export interface EvalCompositionItemDetail {
  schemaVersion: "custom-eval-item-detail-v2"; itemId: string; head: EvalCompositionItemHead;
  versions: Array<EvalCompositionItemHead & { createdAt: string }>; hasMore: boolean;
}
export interface EvalCompositionSetDetail {
  schemaVersion: "custom-eval-set-detail-v2"; setId: string; head: EvalCompositionSetHead;
  versions: Array<EvalCompositionSetHead & { createdAt: string; memberCount: number }>; hasMore: boolean;
}
export type EvalCompositionRestore<T> = (value: unknown, expectedWorkspaceId?: string) => T;
export interface EvalCompositionItemCallbacks<T extends EvalCompositionItemRecord> {
  prepare(input: { workspaceId: string; request: unknown; head: unknown; createdAt: string }): T;
  restore: EvalCompositionRestore<T>;
}
export interface EvalCompositionSetCallbacks<T extends EvalCompositionSetRecord> {
  prepare(input: { workspaceId: string; request: unknown; head: unknown; createdAt: string; items: unknown[] }): T;
  restore: EvalCompositionRestore<T>; restoreItem: EvalCompositionRestore<EvalCompositionItemRecord>;
}
export interface EvalCompositionSetReaders<T extends EvalCompositionSetRecord> {
  restoreSet: EvalCompositionRestore<T>; restoreItem: EvalCompositionRestore<EvalCompositionItemRecord>;
}

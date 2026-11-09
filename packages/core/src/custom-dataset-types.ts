import type { ProvidedOutputDatasetRow, ProvidedOutputDatasetSnapshot } from "./provided-output-types";

export type CustomDatasetFormat = "json" | "jsonl";
export type CustomDatasetReviewStatus = "synthetic" | "reviewed" | "golden";

export interface CustomDatasetDraft {
  schemaVersion: "custom-dataset-draft-v1";
  datasetId: string;
  versionId: string;
  version: number;
  expectedVersionId: string | null;
  name: string;
  format: CustomDatasetFormat;
  defaultReviewStatus: CustomDatasetReviewStatus | null;
  sourceText: string;
}

export interface CustomDatasetHead {
  datasetId: string;
  publicDatasetId: string;
  name: string;
  kind: "custom-dataset-v1";
  versionId: string;
  publicVersionId: string;
  version: number;
  contentFingerprint: string;
}

export interface CustomDatasetVersionContent {
  schemaVersion: "custom-dataset-version-v1";
  workspaceId: string;
  dataset: { id: string; publicId: string; name: string; kind: "custom-dataset-v1" };
  version: {
    id: string;
    publicId: string;
    version: number;
    previousVersionId: string | null;
    previousPublicVersionId: string | null;
  };
  rows: ProvidedOutputDatasetRow[];
  fingerprint: string;
}

/** Reconstructable intent: raw source text is represented by its full UTF-8 SHA256. */
export interface CustomDatasetIntent {
  schemaVersion: "custom-dataset-intent-v1";
  workspaceId: string;
  datasetId: string;
  versionId: string;
  version: number;
  expectedVersionId: string | null;
  name: string;
  format: CustomDatasetFormat;
  defaultReviewStatus: CustomDatasetReviewStatus | null;
  sourceDigest: string;
  contentFingerprint: string;
  fingerprint: string;
}

export interface CustomDatasetPreview {
  schemaVersion: "custom-dataset-preview-v1";
  workspaceId: string;
  intent: CustomDatasetIntent;
  head: CustomDatasetHead | null;
  content: CustomDatasetVersionContent;
  canonicalSnapshotBytes: number;
  createdAtByteAllowance: 24;
  fingerprint: string;
}

export interface CustomDatasetSaveRequest {
  schemaVersion: "custom-dataset-save-v1";
  draft: CustomDatasetDraft;
  expectedPreviewFingerprint: string;
}

/** Small system-only audit metadata. User row metadata is not modified. */
export interface CustomDatasetManifest {
  schemaVersion: "custom-dataset-manifest-v1";
  workspaceId: string;
  datasetId: string;
  versionId: string;
  createdAt: string;
  intent: CustomDatasetIntent;
  head: CustomDatasetHead | null;
  rowCount: number;
  contentFingerprint: string;
  previewFingerprint: string;
  requestFingerprint: string;
}

export interface CustomDatasetVersionRecord {
  schemaVersion: "custom-dataset-record-v1";
  workspaceId: string;
  content: CustomDatasetVersionContent;
  snapshot: ProvidedOutputDatasetSnapshot;
  manifest: CustomDatasetManifest;
  fingerprint: string;
}

export interface ResolveCustomDatasetPreviewInput {
  workspaceId: string;
  draft: unknown;
  head: CustomDatasetHead | null;
}

export interface PrepareCustomDatasetVersionRecordInput {
  workspaceId: string;
  request: unknown;
  head: CustomDatasetHead | null;
  createdAt: string;
}

export interface RestoreCustomDatasetVersionRecordInput {
  workspaceId: string;
  snapshot: unknown;
  manifest: unknown;
}

export interface CustomDatasetVersionSummary {
  id: string;
  datasetId: string;
  storageVersionId: string;
  version: number;
  contentFingerprint: string;
  createdAt: string;
  rowCount: number;
}

export interface CustomDatasetSummary {
  id: string;
  storageDatasetId: string;
  name: string;
  head: CustomDatasetVersionSummary;
  versionCount: number;
}

export interface CustomDatasetDetail {
  id: string;
  storageDatasetId: string;
  name: string;
  versions: CustomDatasetVersionSummary[];
  hasMore: boolean;
}

export interface CustomDatasetList {
  datasets: CustomDatasetSummary[];
  hasMore: boolean;
}

export interface CustomDatasetSaveResult {
  record: CustomDatasetVersionRecord;
  replayed: boolean;
}

export interface CustomDatasetStorageIds {
  datasetId: string;
  versionId: string;
  auditId: string;
}

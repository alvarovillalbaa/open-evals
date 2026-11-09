import type { DatasetSnapshot } from "./dataset-snapshots";

export interface CustomDatasetStoreDraft {
  schemaVersion: "custom-dataset-draft-v1";
  datasetId: string;
  versionId: string;
  version: number;
  expectedVersionId: string | null;
  name: string;
  format: "json" | "jsonl";
  defaultReviewStatus: "synthetic" | "reviewed" | "golden" | null;
  sourceText: string;
}
export interface CustomDatasetStoreHead {
  datasetId: string;
  publicDatasetId: string;
  name: string;
  kind: "custom-dataset-v1";
  versionId: string;
  publicVersionId: string;
  version: number;
  contentFingerprint: string;
}
export interface CustomDatasetStoreContent {
  schemaVersion: "custom-dataset-version-v1";
  workspaceId: string;
  dataset: { id: string; publicId: string; name: string; kind: "custom-dataset-v1" };
  version: {
    id: string; publicId: string; version: number;
    previousVersionId: string | null; previousPublicVersionId: string | null;
  };
  rows: DatasetSnapshot["rows"];
  fingerprint: string;
}
export interface CustomDatasetStoreIntent {
  schemaVersion: "custom-dataset-intent-v1";
  workspaceId: string;
  datasetId: string;
  versionId: string;
  version: number;
  expectedVersionId: string | null;
  name: string;
  format: "json" | "jsonl";
  defaultReviewStatus: "synthetic" | "reviewed" | "golden" | null;
  sourceDigest: string;
  contentFingerprint: string;
  fingerprint: string;
}
export interface CustomDatasetStoreSaveRequest {
  schemaVersion: "custom-dataset-save-v1";
  draft: CustomDatasetStoreDraft;
  expectedPreviewFingerprint: string;
}
export interface CustomDatasetStoreManifest {
  schemaVersion: "custom-dataset-manifest-v1";
  workspaceId: string;
  datasetId: string;
  versionId: string;
  createdAt: string;
  intent: CustomDatasetStoreIntent;
  head: CustomDatasetStoreHead | null;
  rowCount: number;
  contentFingerprint: string;
  previewFingerprint: string;
  requestFingerprint: string;
}
export interface CustomDatasetStoreRecord {
  schemaVersion: "custom-dataset-record-v1";
  workspaceId: string;
  content: CustomDatasetStoreContent;
  snapshot: DatasetSnapshot;
  manifest: CustomDatasetStoreManifest;
  fingerprint: string;
}
export interface CustomDatasetStoreCallbacks<T extends CustomDatasetStoreRecord> {
  prepare(input: {
    workspaceId: string; request: unknown; head: CustomDatasetStoreHead | null; createdAt: string;
  }): T;
  restore(input: { workspaceId: string; snapshot: unknown; manifest: unknown }): T;
}
export interface CustomDatasetStoreVersionSummary {
  id: string;
  datasetId: string;
  storageVersionId: string;
  version: number;
  contentFingerprint: string;
  createdAt: string;
  rowCount: number;
}
export interface CustomDatasetStoreSummary {
  id: string;
  storageDatasetId: string;
  name: string;
  head: CustomDatasetStoreVersionSummary;
  versionCount: number;
}
export interface CustomDatasetStoreDetail {
  id: string;
  storageDatasetId: string;
  name: string;
  versions: CustomDatasetStoreVersionSummary[];
  hasMore: boolean;
}

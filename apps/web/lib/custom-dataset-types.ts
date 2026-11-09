import type {
  CustomDatasetDetail,
  CustomDatasetHead,
  CustomDatasetList,
  CustomDatasetPreview,
  CustomDatasetSaveResult,
  CustomDatasetVersionRecord
} from "@open-evals/core";

export interface CustomDatasetDetailView {
  dataset: CustomDatasetDetail;
  head: CustomDatasetHead;
  record: CustomDatasetVersionRecord;
}

export interface CustomDatasetListResponse {
  list: CustomDatasetList;
  canWrite: boolean;
}

export interface CustomDatasetDetailResponse extends CustomDatasetDetailView {
  canWrite: boolean;
}

export interface CustomDatasetPreviewResponse {
  preview: CustomDatasetPreview;
}

export type CustomDatasetSaveResponse = CustomDatasetSaveResult;

export interface CustomDatasetVersionResponse {
  record: CustomDatasetVersionRecord;
}

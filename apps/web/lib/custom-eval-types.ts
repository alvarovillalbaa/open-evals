import type { CustomEvalSetContract } from "@open-evals/core";

export interface CustomEvalVersionView {
  id: string;
  version: number;
  fingerprint: string;
  createdAt: string;
  contract: CustomEvalSetContract;
}

export interface CustomEvalDetailView {
  id: string;
  name: string;
  versions: CustomEvalVersionView[];
  hasMore: boolean;
}

export interface CustomEvalSaveView {
  id: string;
  name: string;
  version: CustomEvalVersionView;
  evalSet: CustomEvalDetailView;
  replayed: boolean;
}

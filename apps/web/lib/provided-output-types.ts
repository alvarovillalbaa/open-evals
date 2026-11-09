import type {
  ProvidedOutputDatasetSnapshot,
  ProvidedOutputRunPlan,
  ProvidedOutputRunRecord,
  ProvidedOutputSavedEvalSet
} from "@open-evals/core";
import type { listProvidedOutputRuns, listProvidedOutputSources } from "@open-evals/db";

export type ProvidedOutputSourcesView = Awaited<ReturnType<typeof listProvidedOutputSources>>;
export type ProvidedOutputHistoryView = Awaited<ReturnType<typeof listProvidedOutputRuns>>;

export interface ProvidedOutputInputsView {
  dataset: ProvidedOutputDatasetSnapshot;
  evalSet: ProvidedOutputSavedEvalSet;
}

export interface ProvidedOutputSourcesResponse {
  sources: ProvidedOutputSourcesView;
  canWrite: boolean;
  inputs?: ProvidedOutputInputsView;
}

export interface ProvidedOutputPreviewResponse {
  plan: ProvidedOutputRunPlan;
}

export interface ProvidedOutputRunResponse {
  record: ProvidedOutputRunRecord;
  replayed: boolean;
}

import type { AnyHttpEvalPlanHead as HttpEvalPlanHead, AnyHttpEvalPlanVersionRecord, HttpEvalPlanFamily, MatchingHttpEvalSetRef as HttpEvalSetRef } from "@open-evals/core";
import type { HttpEvalPlanSummary, listHttpEvalSources } from "@open-evals/db";

export type HttpTargetSourcesView = Awaited<ReturnType<typeof listHttpEvalSources>>;

export interface HttpTargetPlanDetailView {
  planId: string;
  versions: HttpEvalPlanSummary[];
  hasMore: boolean;
  head: HttpEvalPlanHead;
  record: AnyHttpEvalPlanVersionRecord;
}

export interface HttpTargetPlanListView {
  list: { plans: HttpEvalPlanSummary[]; hasMore: boolean };
  sources: HttpTargetSourcesView;
  canWrite: boolean;
}

export interface HttpTargetPlansView extends HttpTargetPlanListView {
  initialFamily: HttpEvalPlanFamily;
  initialSetRefs: HttpEvalSetRef[];
  initialDatasetId: string | undefined;
  requestedSourceUnavailable: boolean;
}

export interface HttpTargetPlanView {
  detail: HttpTargetPlanDetailView | undefined;
  sources: HttpTargetSourcesView;
  canWrite: boolean;
}

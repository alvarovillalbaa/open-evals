import type { AnyHttpEvalPlanHead as HttpEvalPlanHead, AnyHttpEvalPlanVersionRecord } from "@open-evals/core";
import type { HttpEvalPlanSummary, listHttpEvalSources } from "@open-evals/db";

export type HttpTargetSourcesView = Awaited<ReturnType<typeof listHttpEvalSources>>;

export interface HttpTargetPlanDetailView {
  planId: string;
  versions: HttpEvalPlanSummary[];
  hasMore: boolean;
  head: HttpEvalPlanHead;
  record: AnyHttpEvalPlanVersionRecord;
}

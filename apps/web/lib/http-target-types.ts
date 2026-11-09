import type { HttpEvalPlanHead, HttpEvalPlanVersionRecord } from "@open-evals/core";
import type { HttpEvalPlanSummary } from "@open-evals/db";

export interface HttpTargetPlanDetailView {
  planId: string;
  versions: HttpEvalPlanSummary[];
  hasMore: boolean;
  head: HttpEvalPlanHead;
  record: HttpEvalPlanVersionRecord;
}

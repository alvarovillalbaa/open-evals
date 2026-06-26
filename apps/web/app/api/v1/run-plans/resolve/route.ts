import { resolveRunPlan, type DatasetRow, type EvalSetVersion, type TargetKind } from "@open-evals/core";
import { authErrorResponse, requireRouteAuth } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    await requireRouteAuth("viewer", "evals:read");
    const body = (await request.json().catch(() => ({}))) as {
      id?: string;
      targetId?: string;
      targetKind?: TargetKind;
      rows?: DatasetRow[];
      evalSet?: EvalSetVersion;
      promptVersionId?: string;
      candidateId?: string;
      historicalDataAllowed?: boolean;
    };
    if (!body.targetId || !body.targetKind || !body.rows?.length || !body.evalSet) {
      return Response.json({ error: "run_plan_requires_target_rows_and_eval_set" }, { status: 400 });
    }
    const plan = resolveRunPlan({
      id: body.id ?? "run_plan_preview",
      targetId: body.targetId,
      targetKind: body.targetKind,
      rows: body.rows,
      evalSet: body.evalSet,
      promptVersionId: body.promptVersionId,
      candidateId: body.candidateId,
      historicalDataAllowed: body.historicalDataAllowed === true
    });
    return Response.json({ plan, dryRunEstimate: { rows: plan.sampleManifest.rows.length, maxCostUsd: 0, requiresAiCredentials: false } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

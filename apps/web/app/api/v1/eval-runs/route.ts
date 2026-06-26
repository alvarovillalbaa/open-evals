import { evaluateGates, resolveRunPlan, runDeterministicEval, type DatasetRow, type EvalSetVersion, type TargetKind } from "@open-evals/core";
import { listRunBatches, persistEvalRun } from "@open-evals/db";
import { evalRunWorkflow } from "@open-evals/workflows";
import { authErrorResponse, requireRouteAuth } from "@/lib/auth";

export async function GET() {
  try {
    const auth = await requireRouteAuth("viewer", "evals:read");
    return Response.json({ batches: await listRunBatches(auth.workspaceId) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireRouteAuth("editor", "evals:write");
    const body = (await request.json().catch(() => ({}))) as {
      id?: string;
      targetId?: string;
      targetKind?: TargetKind;
      rows?: DatasetRow[];
      evalSet?: EvalSetVersion;
      promptVersionId?: string;
      candidateId?: string;
      historicalDataAllowed?: boolean;
      idempotencyKey?: string;
    };
    if (!body.targetId || !body.targetKind || !body.rows?.length || !body.evalSet) {
      return Response.json({ error: "run_request_requires_target_rows_and_eval_set" }, { status: 400 });
    }
    const plan = resolveRunPlan({
      id: body.id ?? `run_plan_${Date.now()}`,
      targetId: body.targetId,
      targetKind: body.targetKind,
      rows: body.rows,
      evalSet: body.evalSet,
      promptVersionId: body.promptVersionId,
      candidateId: body.candidateId,
      historicalDataAllowed: body.historicalDataAllowed === true
    });
    const item = body.evalSet.itemVersions[0]?.item;
    if (!item) return Response.json({ error: "eval_set_requires_item_versions" }, { status: 400 });
    const results = plan.sampleManifest.rows.map((sample) => runDeterministicEval(item, sample));
    const gates = evaluateGates(plan.id, body.evalSet, results);
    const persisted = await persistEvalRun(auth.workspaceId, { plan, results, gates, idempotencyKey: body.idempotencyKey });
    const workflow = await evalRunWorkflow({
      workspaceId: auth.workspaceId,
      subjectId: plan.id,
      idempotencyKey: body.idempotencyKey ?? `eval_run:${plan.planFingerprint}`,
      input: { runPlanId: plan.id, planFingerprint: plan.planFingerprint }
    });
    return Response.json({ plan, results, gates, persisted, workflow }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

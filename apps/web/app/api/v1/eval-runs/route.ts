import { demoEvalSet, demoRows, evaluateGates, resolveRunPlan, runDeterministicEval } from "@open-evals/core";
import { evalRunWorkflow } from "@open-evals/workflows";
import { authErrorResponse, requireRouteAuth } from "@/lib/auth";

export async function GET() {
  try {
    await requireRouteAuth("viewer", "evals:read");
    return Response.json(runDemoEval("run_demo_get"));
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST() {
  try {
    const auth = await requireRouteAuth("editor", "evals:write");
    const demo = runDemoEval("run_demo_post");
    const workflow = await evalRunWorkflow({
      workspaceId: auth.workspaceId,
      subjectId: demo.plan.id,
      idempotencyKey: `eval_run:${demo.plan.planFingerprint}`,
      input: { runPlanId: demo.plan.id, planFingerprint: demo.plan.planFingerprint }
    });
    return Response.json({ ...demo, workflow }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

function runDemoEval(id: string) {
  const plan = resolveRunPlan({
    id,
    targetId: "target_demo_reservation_agent",
    targetKind: "provided_output",
    rows: demoRows,
    evalSet: demoEvalSet,
    historicalDataAllowed: true
  });
  const item = demoEvalSet.itemVersions[0]!.item;
  const results = plan.sampleManifest.rows.map((sample) => runDeterministicEval(item, sample));
  const gates = evaluateGates(plan.id, demoEvalSet, results);
  return { plan, results, gates };
}

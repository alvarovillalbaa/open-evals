import { demoEvalSet, demoRows, resolveRunPlan } from "@open-evals/core";
import { authErrorResponse, requireRouteAuth } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    await requireRouteAuth("viewer", "evals:read");
    const body = (await request.json().catch(() => ({}))) as { targetKind?: "provided_output" | "historical_output" };
    const plan = resolveRunPlan({
      id: "run_plan_preview",
      targetId: "target_demo_reservation_agent",
      targetKind: body.targetKind ?? "provided_output",
      rows: demoRows,
      evalSet: demoEvalSet,
      historicalDataAllowed: body.targetKind !== "historical_output"
    });
    return Response.json({ plan, dryRunEstimate: { rows: plan.sampleManifest.rows.length, maxCostUsd: 0, requiresAiCredentials: false } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

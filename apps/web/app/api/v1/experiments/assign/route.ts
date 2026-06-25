import { assignExperimentArm, baselinePrompt, candidatePrompt } from "@open-evals/core";
import { authErrorResponse, requireRouteAuth } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    await requireRouteAuth("editor", "experiments:write");
    const body = (await request.json().catch(() => ({}))) as { experimentId?: string; assignmentUnitId?: string };
    const arm = assignExperimentArm(body.experimentId ?? "exp_demo_reservation", body.assignmentUnitId ?? "session_demo_001", [
      { id: "control", promptVersionId: baselinePrompt.id, weight: 5000 },
      { id: "candidate", promptVersionId: candidatePrompt.id, weight: 5000 }
    ]);
    return Response.json({ arm, exposureRecordedBeforeCall: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

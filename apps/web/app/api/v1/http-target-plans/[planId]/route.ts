import { requireCustomEvalAuth } from "@/lib/custom-evals";
import { httpTargetErrorResponse, httpTargetJson, readHttpTargetPlanDetail } from "@/lib/http-target-plans";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const auth = await requireCustomEvalAuth("read");
    const { planId } = await params;
    const detail = await readHttpTargetPlanDetail(auth.workspaceId, planId);
    return detail ? httpTargetJson({ detail }) : httpTargetJson({ error: "http_eval_plan_not_found" }, 404);
  } catch (error) { return httpTargetErrorResponse(error); }
}

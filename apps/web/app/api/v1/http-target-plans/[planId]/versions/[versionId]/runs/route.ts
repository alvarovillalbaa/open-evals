import { requireCustomEvalAuth } from "@/lib/custom-evals";
import { httpTargetErrorResponse, httpTargetJson, readHttpTargetJson } from "@/lib/http-target-plans";
import { executeHttpTargetPlan, readHttpTargetPlanRuns } from "@/lib/http-target-runs";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET(_request: Request, { params }: { params: Promise<{ planId: string; versionId: string }> }) {
  try {
    const auth = await requireCustomEvalAuth("read");
    const { planId, versionId } = await params;
    const detail = await readHttpTargetPlanRuns(auth, planId, versionId);
    return detail ? httpTargetJson(detail) : httpTargetJson({ error: "http_eval_plan_version_not_found" }, 404);
  } catch (error) { return httpTargetErrorResponse(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ planId: string; versionId: string }> }) {
  try {
    const auth = await requireCustomEvalAuth("write");
    const { planId, versionId } = await params;
    const result = await executeHttpTargetPlan(auth, planId, versionId, await readHttpTargetJson(request));
    return httpTargetJson(result, result.replayed ? 200 : 201);
  } catch (error) { return httpTargetErrorResponse(error); }
}

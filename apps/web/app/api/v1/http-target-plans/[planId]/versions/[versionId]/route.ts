import { requireCustomEvalAuth } from "@/lib/custom-evals";
import { httpTargetCanWrite, httpTargetErrorResponse, httpTargetJson, readHttpTargetPlanVersion } from "@/lib/http-target-plans";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ planId: string; versionId: string }> }) {
  try {
    const auth = await requireCustomEvalAuth("read");
    const { planId, versionId } = await params;
    const record = await readHttpTargetPlanVersion(auth.workspaceId, planId, versionId);
    return record ? httpTargetJson({ record, canWrite: httpTargetCanWrite(auth) }) : httpTargetJson({ error: "http_eval_plan_version_not_found" }, 404);
  } catch (error) { return httpTargetErrorResponse(error); }
}

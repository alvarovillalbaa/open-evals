import { requireCustomEvalAuth } from "@/lib/custom-evals";
import { httpTargetErrorResponse, httpTargetJson, previewHttpTargetPlan, readHttpTargetJson } from "@/lib/http-target-plans";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = await requireCustomEvalAuth("read");
    const preview = await previewHttpTargetPlan(auth.workspaceId, await readHttpTargetJson(request));
    return httpTargetJson({ preview });
  } catch (error) { return httpTargetErrorResponse(error); }
}

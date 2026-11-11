import { requireCustomEvalAuth } from "@/lib/custom-evals";
import { httpTargetJson, httpTargetErrorResponse } from "@/lib/http-target-plans";
import { readMatchingResource } from "@/lib/eval-matching";
export async function GET(_request: Request, { params }: { params: Promise<{ setId: string }> }) {
  try { const auth = await requireCustomEvalAuth("read"); const { setId } = await params; const resource = await readMatchingResource(auth.workspaceId, "set", setId); return resource ? httpTargetJson(resource) : httpTargetJson({ error: "eval_matching_not_found" }, 404); }
  catch (error) { return httpTargetErrorResponse(error); }
}

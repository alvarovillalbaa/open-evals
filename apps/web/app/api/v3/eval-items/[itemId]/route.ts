import { requireCustomEvalAuth } from "@/lib/custom-evals";
import { httpTargetJson, httpTargetErrorResponse } from "@/lib/http-target-plans";
import { readMatchingResource } from "@/lib/eval-matching";
export async function GET(_request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try { const auth = await requireCustomEvalAuth("read"); const { itemId } = await params; const resource = await readMatchingResource(auth.workspaceId, "item", itemId); return resource ? httpTargetJson(resource) : httpTargetJson({ error: "eval_matching_not_found" }, 404); }
  catch (error) { return httpTargetErrorResponse(error); }
}

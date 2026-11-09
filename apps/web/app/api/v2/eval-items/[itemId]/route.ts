import { requireCustomEvalAuth } from "@/lib/custom-evals";
import { httpTargetJson, httpTargetErrorResponse } from "@/lib/http-target-plans";
import { readCompositionResource } from "@/lib/eval-composition";
export async function GET(_request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try { const auth = await requireCustomEvalAuth("read"); const { itemId } = await params; const resource = await readCompositionResource(auth.workspaceId, "item", itemId); return resource ? httpTargetJson(resource) : httpTargetJson({ error: "eval_composition_not_found" }, 404); }
  catch (error) { return httpTargetErrorResponse(error); }
}

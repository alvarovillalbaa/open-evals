import { requireCustomEvalAuth } from "@/lib/custom-evals";
import { httpTargetJson, httpTargetErrorResponse } from "@/lib/http-target-plans";
import { readCompositionVersion } from "@/lib/eval-composition";
export async function GET(_request: Request, { params }: { params: Promise<{ itemId: string; versionId: string }> }) {
  try { const auth = await requireCustomEvalAuth("read"); const { itemId, versionId } = await params; const record = await readCompositionVersion(auth.workspaceId, "item", itemId, versionId); return record ? httpTargetJson({ record }) : httpTargetJson({ error: "eval_composition_version_not_found" }, 404); }
  catch (error) { return httpTargetErrorResponse(error); }
}

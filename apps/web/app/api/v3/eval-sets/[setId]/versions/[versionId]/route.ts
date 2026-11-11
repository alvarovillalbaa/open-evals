import { requireCustomEvalAuth } from "@/lib/custom-evals";
import { httpTargetJson, httpTargetErrorResponse } from "@/lib/http-target-plans";
import { readMatchingVersion } from "@/lib/eval-matching";
export async function GET(_request: Request, { params }: { params: Promise<{ setId: string; versionId: string }> }) {
  try { const auth = await requireCustomEvalAuth("read"); const { setId, versionId } = await params; const record = await readMatchingVersion(auth.workspaceId, "set", setId, versionId); return record ? httpTargetJson({ record }) : httpTargetJson({ error: "eval_matching_version_not_found" }, 404); }
  catch (error) { return httpTargetErrorResponse(error); }
}

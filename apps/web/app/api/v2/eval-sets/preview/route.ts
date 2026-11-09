import { requireCustomEvalAuth } from "@/lib/custom-evals";
import { readHttpTargetJson, httpTargetJson, httpTargetErrorResponse } from "@/lib/http-target-plans";
import { previewComposition } from "@/lib/eval-composition";
export async function POST(request: Request) {
  try { const auth = await requireCustomEvalAuth("read"); return httpTargetJson({ preview: await previewComposition(auth.workspaceId, "set", await readHttpTargetJson(request)) }); }
  catch (error) { return httpTargetErrorResponse(error); }
}

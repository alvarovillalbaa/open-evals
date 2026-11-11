import { requireCustomEvalAuth } from "@/lib/custom-evals";
import { readHttpTargetJson, httpTargetJson, httpTargetErrorResponse } from "@/lib/http-target-plans";
import { readMatchingList, saveMatching } from "@/lib/eval-matching";
export async function GET() {
  try { const auth = await requireCustomEvalAuth("read"); return httpTargetJson(await readMatchingList(auth.workspaceId, "item")); }
  catch (error) { return httpTargetErrorResponse(error); }
}
export async function POST(request: Request) {
  try { const auth = await requireCustomEvalAuth("write"); const result = await saveMatching(auth, "item", await readHttpTargetJson(request)); return httpTargetJson(result, result.replayed ? 200 : 201); }
  catch (error) { return httpTargetErrorResponse(error); }
}

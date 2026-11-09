import { requireCustomEvalAuth } from "@/lib/custom-evals";
import { httpTargetErrorResponse, httpTargetJson, readHttpTargetJson, readHttpTargetPlanList, saveHttpTargetPlan } from "@/lib/http-target-plans";

export const runtime = "nodejs";

export async function GET() {
  try { return httpTargetJson(await readHttpTargetPlanList(await requireCustomEvalAuth("read"))); }
  catch (error) { return httpTargetErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireCustomEvalAuth("write");
    const result = await saveHttpTargetPlan(auth, await readHttpTargetJson(request));
    return httpTargetJson(result, result.replayed ? 200 : 201);
  } catch (error) { return httpTargetErrorResponse(error); }
}

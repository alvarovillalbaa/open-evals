import { requireCustomEvalAuth } from "@/lib/custom-evals";
import { httpTargetErrorResponse, httpTargetJson, readHttpTargetJson } from "@/lib/http-target-plans";
import { recoverHttpTargetRun } from "@/lib/http-target-runs";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const auth = await requireCustomEvalAuth("write");
    const { runId } = await params;
    const record = await recoverHttpTargetRun(auth, runId, await readHttpTargetJson(request));
    return httpTargetJson({ record });
  } catch (error) { return httpTargetErrorResponse(error); }
}

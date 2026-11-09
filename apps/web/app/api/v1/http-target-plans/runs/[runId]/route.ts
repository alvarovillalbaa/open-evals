import { requireCustomEvalAuth } from "@/lib/custom-evals";
import { httpTargetCanWrite, httpTargetErrorResponse, httpTargetJson } from "@/lib/http-target-plans";
import { readHttpTargetRun } from "@/lib/http-target-runs";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const auth = await requireCustomEvalAuth("read");
    const { runId } = await params;
    const record = await readHttpTargetRun(auth.workspaceId, runId);
    return record ? httpTargetJson({ record, canWrite: httpTargetCanWrite(auth) }) : httpTargetJson({ error: "http_eval_run_not_found" }, 404);
  } catch (error) { return httpTargetErrorResponse(error); }
}

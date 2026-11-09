import { requireCustomEvalAuth } from "@/lib/custom-evals";
import { providedOutputErrorResponse, providedOutputJson, readProvidedOutputRun } from "@/lib/provided-output-runs";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const auth = await requireCustomEvalAuth("read");
    const { runId } = await params;
    const record = await readProvidedOutputRun(auth.workspaceId, runId);
    return record ? providedOutputJson({ record }) : providedOutputJson({ error: "provided_output_run_not_found" }, 404);
  } catch (error) {
    return providedOutputErrorResponse(error);
  }
}

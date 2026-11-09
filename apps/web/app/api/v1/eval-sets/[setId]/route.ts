import { customEvalErrorResponse, customEvalJson, readCustomEvalDetail, requireCustomEvalAuth } from "@/lib/custom-evals";

export async function GET(_request: Request, { params }: { params: Promise<{ setId: string }> }) {
  try {
    const auth = await requireCustomEvalAuth("read");
    const { setId } = await params;
    const evalSet = await readCustomEvalDetail(auth.workspaceId, setId);
    return evalSet ? customEvalJson({ evalSet }) : customEvalJson({ error: "custom_eval_set_not_found" }, 404);
  } catch (error) {
    return customEvalErrorResponse(error);
  }
}

import { getRunBatch } from "@open-evals/db";
import { authErrorResponse, requireRouteAuth } from "@/lib/auth";

export async function GET(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  try {
    const auth = await requireRouteAuth("viewer", "evals:read");
    const { batchId } = await params;
    const batch = await getRunBatch(auth.workspaceId, batchId);
    if (!batch) return Response.json({ error: "run_batch_not_found" }, { status: 404 });
    return Response.json({ batch });
  } catch (error) {
    return authErrorResponse(error);
  }
}

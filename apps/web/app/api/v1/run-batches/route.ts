import { listRunBatches } from "@open-evals/db";
import { authErrorResponse, requireRouteAuth } from "@/lib/auth";

export async function GET() {
  try {
    const auth = await requireRouteAuth("viewer", "evals:read");
    return Response.json({ batches: await listRunBatches(auth.workspaceId) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

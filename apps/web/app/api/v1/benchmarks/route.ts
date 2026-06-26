import { listBenchmarks } from "@open-evals/db";
import { authErrorResponse, requireRouteAuth } from "@/lib/auth";

export async function GET() {
  try {
    const auth = await requireRouteAuth("viewer", "evals:read");
    return Response.json(await listBenchmarks(auth.workspaceId));
  } catch (error) {
    return authErrorResponse(error);
  }
}

import { listInstructions } from "@open-evals/db";
import { authErrorResponse, requireRouteAuth } from "@/lib/auth";

export async function GET() {
  try {
    const auth = await requireRouteAuth("viewer", "prompts:read");
    return Response.json(await listInstructions(auth.workspaceId));
  } catch (error) {
    return authErrorResponse(error);
  }
}

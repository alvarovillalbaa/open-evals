import { GenericJsonTraceAdapter } from "@open-evals/adapters/trace-sources";
import { authErrorResponse, requireRouteAuth } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const auth = await requireRouteAuth("editor", "traces:write");
    const payload = (await request.json()) as unknown;
    const adapter = new GenericJsonTraceAdapter();
    const result = await adapter.importBatch({ workspaceId: auth.workspaceId, payload: payload as never, dryRun: false, redact: true });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

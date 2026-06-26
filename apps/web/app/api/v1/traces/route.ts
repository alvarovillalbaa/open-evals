import { GenericJsonTraceAdapter } from "@open-evals/adapters/trace-sources";
import { persistTraceImport } from "@open-evals/db";
import { authErrorResponse, requireRouteAuth } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const auth = await requireRouteAuth("editor", "traces:write");
    const payload = (await request.json()) as unknown;
    const adapter = new GenericJsonTraceAdapter();
    const result = await adapter.importBatch({ workspaceId: auth.workspaceId, projectId: auth.projectId, payload: payload as never, dryRun: false, redact: true });
    const persisted = await persistTraceImport(auth.workspaceId, result, "manual_json", auth.projectId);
    return Response.json(persisted, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

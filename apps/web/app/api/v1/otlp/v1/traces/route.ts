import { authErrorResponse, requireRouteAuth } from "@/lib/auth";

export async function POST() {
  try {
    await requireRouteAuth("editor", "traces:write");
    return Response.json({
      error: "trace_import_retired",
      message: "Send execution evidence through the SDK. See /evals/sdk."
    }, { status: 410 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

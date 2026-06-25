import { authErrorResponse, getRouteAuthContext } from "@/lib/auth";

export async function GET() {
  try {
    const context = await getRouteAuthContext();
    return Response.json({
      authenticated: true,
      mode: process.env.AUTH_MODE ?? "local",
      user: context.user,
      workspaceId: context.workspaceId,
      role: context.role,
      authKind: context.authKind
    });
  } catch (error) {
    if ((process.env.AUTH_MODE ?? "local") === "local") return authErrorResponse(error);
    return Response.json({ authenticated: false, mode: "hosted", error: error instanceof Error ? error.message : "authentication_required" }, { status: 401 });
  }
}


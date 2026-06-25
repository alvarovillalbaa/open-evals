import { cookies } from "next/headers";
import { createOauthState } from "@/lib/auth";

export async function GET(request: Request) {
  if ((process.env.AUTH_MODE ?? "local") === "local") {
    return Response.redirect(new URL("/", request.url));
  }
  const clientId = process.env.AUTH_GITHUB_ID;
  if (!clientId) return Response.json({ error: "AUTH_GITHUB_ID is not configured" }, { status: 503 });
  const state = createOauthState();
  const cookieStore = await cookies();
  cookieStore.set("open_evals_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  const callback = new URL("/api/v1/auth/github/callback", process.env.AUTH_BASE_URL ?? request.url);
  const authUrl = new URL("https://github.com/login/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", callback.toString());
  authUrl.searchParams.set("scope", "read:user user:email");
  authUrl.searchParams.set("state", state);
  return Response.redirect(authUrl);
}


import { cookies } from "next/headers";
import { createSessionCookie, sessionCookieName, verifyOauthState } from "@/lib/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("open_evals_oauth_state")?.value ?? null;
  if (!code || !verifyOauthState(state) || state !== expectedState) {
    return Response.json({ error: "invalid_oauth_callback" }, { status: 400 });
  }
  const clientId = process.env.AUTH_GITHUB_ID;
  const clientSecret = process.env.AUTH_GITHUB_SECRET;
  if (!clientId || !clientSecret) return Response.json({ error: "GitHub OAuth credentials are not configured" }, { status: 503 });
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: new URL("/api/v1/auth/github/callback", process.env.AUTH_BASE_URL ?? request.url).toString()
    })
  });
  const tokenPayload = (await tokenResponse.json()) as { access_token?: string; error?: string };
  if (!tokenResponse.ok || !tokenPayload.access_token) return Response.json({ error: tokenPayload.error ?? "oauth_token_exchange_failed" }, { status: 502 });
  const userResponse = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${tokenPayload.access_token}`, accept: "application/vnd.github+json" }
  });
  const profile = (await userResponse.json()) as { id?: number; email?: string; name?: string; login?: string };
  if (!userResponse.ok || !profile.id) return Response.json({ error: "oauth_profile_fetch_failed" }, { status: 502 });
  const session = createSessionCookie({
    userId: `github_${profile.id}`,
    email: profile.email,
    name: profile.name ?? profile.login,
    workspaceId: process.env.HOSTED_DEMO_WORKSPACE_ID ?? "ws_demo",
    role: "owner"
  });
  cookieStore.set(sessionCookieName(), session, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 7 });
  cookieStore.delete("open_evals_oauth_state");
  return Response.redirect(new URL("/", process.env.AUTH_BASE_URL ?? request.url));
}


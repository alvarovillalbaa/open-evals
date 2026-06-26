import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import type { ApiKeyScope, AuthenticatedUser, WorkspaceRole } from "@open-evals/core";
import { hashApiKey, verifyApiKey } from "@open-evals/core";
import { ensureWorkspaceForHostedUser, findApiKeyByHash, isDatabaseUnavailable } from "@open-evals/db";
import { getSupabaseServerClient, hasSupabaseConfig } from "@/lib/supabase/server";

export interface RouteAuthContext {
  user: AuthenticatedUser;
  workspaceId: string;
  role: WorkspaceRole;
  scopes: ApiKeyScope[];
  authKind: "local" | "session" | "supabase" | "api_key";
  projectId?: string;
}

const SESSION_COOKIE = "open_evals_session";

export async function requireRouteAuth(requiredRole: WorkspaceRole, requiredScope?: ApiKeyScope): Promise<RouteAuthContext> {
  const context = await getRouteAuthContext();
  if (!roleAtLeast(context.role, requiredRole)) throw httpError(403, `workspace_role_forbidden:${requiredRole}`);
  if (requiredScope && !context.scopes.includes("admin") && !context.scopes.includes(requiredScope)) {
    throw httpError(403, `api_key_scope_forbidden:${requiredScope}`);
  }
  return context;
}

export async function getRouteAuthContext(): Promise<RouteAuthContext> {
  if ((process.env.AUTH_MODE ?? "local") === "local") {
    return {
      user: { id: "user_local", email: "local@open-evals.dev", name: "Local Developer", authMode: "local" },
      workspaceId: "ws_demo",
      role: "owner",
      scopes: ["admin"],
      authKind: "local"
    };
  }
  const headerList = await headers();
  const authorization = headerList.get("authorization");
  if (authorization?.startsWith("Bearer ")) return apiKeyContext(authorization.slice("Bearer ".length));
  if (hasSupabaseConfig()) return supabaseSessionContext();
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE)?.value;
  if (!session) throw httpError(401, "authentication_required");
  return sessionContext(session);
}

export function createSessionCookie(input: { userId: string; email?: string; name?: string; workspaceId: string; role: WorkspaceRole; maxAgeSeconds?: number }) {
  const secret = authSecret();
  const expiresAt = Date.now() + (input.maxAgeSeconds ?? 60 * 60 * 24 * 7) * 1000;
  const payload = Buffer.from(JSON.stringify({ ...input, expiresAt })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function createOauthState() {
  const nonce = randomBytes(16).toString("base64url");
  const signature = createHmac("sha256", authSecret()).update(nonce).digest("base64url");
  return `${nonce}.${signature}`;
}

export function verifyOauthState(value: string | null): boolean {
  if (!value) return false;
  const [nonce, signature] = value.split(".");
  if (!nonce || !signature) return false;
  const expected = createHmac("sha256", authSecret()).update(nonce).digest("base64url");
  return safeEqual(signature, expected);
}

export function sessionCookieName() {
  return SESSION_COOKIE;
}

function sessionContext(value: string): RouteAuthContext {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) throw httpError(401, "invalid_session");
  const expected = createHmac("sha256", authSecret()).update(payload).digest("base64url");
  if (!safeEqual(signature, expected)) throw httpError(401, "invalid_session_signature");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    userId: string;
    email?: string;
    name?: string;
    workspaceId: string;
    role: WorkspaceRole;
    expiresAt: number;
  };
  if (decoded.expiresAt < Date.now()) throw httpError(401, "session_expired");
  return {
    user: { id: decoded.userId, email: decoded.email, name: decoded.name, authMode: "hosted" },
    workspaceId: decoded.workspaceId,
    role: decoded.role,
    scopes: ["admin"],
    authKind: "session"
  };
}

async function apiKeyContext(plaintext: string): Promise<RouteAuthContext> {
  const pepper = process.env.API_KEY_PEPPER ?? "";
  if (pepper) {
    try {
      const persisted = await findApiKeyByHash(hashApiKey(plaintext, pepper));
      if (persisted && !persisted.revokedAt) {
        return {
          user: { id: `api_key:${persisted.id}`, name: persisted.name, authMode: "hosted" },
          workspaceId: persisted.workspaceId,
          role: "editor",
          scopes: normalizeScopes(persisted.scopes),
          authKind: "api_key",
          projectId: persisted.projectId
        };
      }
    } catch (error) {
      if (!isDatabaseUnavailable(error)) throw error;
    }
  }
  const configuredHash = process.env.HOSTED_DEMO_API_KEY_HASH;
  if (!configuredHash || !pepper || !verifyApiKey(plaintext, configuredHash, pepper)) throw httpError(401, "api_key_invalid");
  return {
    user: { id: "api_key", name: "API key", authMode: "hosted" },
    workspaceId: process.env.HOSTED_DEMO_WORKSPACE_ID ?? "ws_demo",
    role: "editor",
    scopes: (process.env.HOSTED_DEMO_API_KEY_SCOPES?.split(",").filter(Boolean) as ApiKeyScope[] | undefined) ?? ["traces:write", "evals:write", "evals:read"],
    authKind: "api_key"
  };
}

async function supabaseSessionContext(): Promise<RouteAuthContext> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) throw httpError(500, "supabase_not_configured");
  const claims = await supabase.auth.getClaims();
  if (claims.error || !claims.data?.claims?.sub) throw httpError(401, "authentication_required");
  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;
  const userId = claims.data.claims.sub;
  const email = user?.email ?? (typeof claims.data.claims.email === "string" ? claims.data.claims.email : undefined);
  const name =
    typeof user?.user_metadata?.name === "string"
      ? user.user_metadata.name
      : typeof user?.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : undefined;
  const membership = await ensureWorkspaceForHostedUser({ id: userId, email, name });
  return {
    user: { id: userId, email, name, authMode: "hosted" },
    workspaceId: membership.workspaceId,
    role: membership.role,
    scopes: ["admin"],
    authKind: "supabase"
  };
}

function roleAtLeast(actual: WorkspaceRole, required: WorkspaceRole) {
  const rank: Record<WorkspaceRole, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };
  return rank[actual] >= rank[required];
}

function authSecret() {
  const secret = process.env.AUTH_SECRET ?? process.env.ENCRYPTION_KEY;
  if (!secret || secret.length < 16) throw httpError(500, "auth_secret_not_configured");
  return secret;
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function httpError(status: number, message: string) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function normalizeScopes(scopes: string[]): ApiKeyScope[] {
  const allowed = new Set<ApiKeyScope>(["traces:write", "traces:read", "evals:write", "evals:read", "prompts:write", "prompts:read", "experiments:write", "admin"]);
  return scopes.filter((scope): scope is ApiKeyScope => allowed.has(scope as ApiKeyScope));
}

export function authErrorResponse(error: unknown) {
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : 500;
  return Response.json({ error: error instanceof Error ? error.message : "auth_error" }, { status: Number.isInteger(status) ? status : 500 });
}

export function demoApiKeyHash(plaintext: string) {
  return hashApiKey(plaintext, process.env.API_KEY_PEPPER ?? "dev-open-evals-pepper");
}

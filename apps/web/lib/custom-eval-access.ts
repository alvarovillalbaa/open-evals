import type { RouteAuthContext } from "./auth";

type AccessContext = Pick<RouteAuthContext, "authKind" | "role" | "scopes">;

/** Custom sets are workspace-owned; project keys cannot acquire workspace authorship. */
export function customEvalAccessAllowed(auth: AccessContext, mode: "read" | "write", hostedRuntime: boolean): boolean {
  if (auth.authKind === "api_key" || (auth.authKind === "local" && hostedRuntime)) return false;
  const roles = mode === "write" ? ["owner", "admin", "editor"] : ["owner", "admin", "editor", "viewer"];
  const scope = mode === "write" ? "evals:write" : "evals:read";
  return roles.includes(auth.role) && (auth.scopes.includes("admin") || auth.scopes.includes(scope));
}

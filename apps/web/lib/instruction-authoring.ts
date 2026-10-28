import { createPromptDefinition, type PromptAuthoringScope } from "@open-evals/db";
import { getRouteAuthContext, requireRouteAuth, type RouteAuthContext } from "./auth";
import { InstructionRequestError } from "./instruction-request";
import { getInstructionDetail } from "./instruction-service";

/** Approved in docs/proposals/prompt-authoring-contract.md; provider/role grants are unchanged. */
export async function requireInstructionAuth(mode: "read" | "write") {
  const auth = await requireRouteAuth(mode === "write" ? "editor" : "viewer", mode === "write" ? "prompts:write" : "prompts:read");
  if (auth.authKind === "api_key" && !auth.projectId) throw new InstructionRequestError(403, "instruction_project_key_required");
  const canWrite = await instructionWriteAllowed(auth);
  if (mode === "write" && !canWrite) throw new InstructionRequestError(403, "instruction_authoring_forbidden");
  const scope: PromptAuthoringScope = {
    workspaceId: auth.workspaceId,
    actorId: auth.user.id,
    ...(auth.authKind === "api_key" ? { projectId: auth.projectId } : {})
  };
  return { auth, scope, canWrite };
}

export async function instructionWriteAllowed(context?: RouteAuthContext): Promise<boolean> {
  let auth: RouteAuthContext;
  try {
    auth = context ?? await getRouteAuthContext();
  } catch (error) {
    if (error instanceof Error && "status" in error && [401, 403].includes(Number(error.status))) return false;
    throw error;
  }
  if (!["owner", "admin", "editor"].includes(auth.role)) return false;
  if (!auth.scopes.includes("admin") && !auth.scopes.includes("prompts:write")) return false;
  if (auth.authKind === "api_key" && !auth.projectId) return false;
  if (auth.authKind === "local" && (process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL))) return false;
  return true;
}

export async function loadInstructionDetail(definitionId: string, versionId?: string) {
  const { scope, canWrite } = await requireInstructionAuth("read");
  return getInstructionDetail(scope, definitionId, versionId, canWrite);
}

export async function createInstructionDefinition(scope: PromptAuthoringScope, value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InstructionRequestError(400, "prompt_definition_object_required");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["id", "stableKey", "targetId"].includes(key))
    || typeof input.id !== "string" || typeof input.stableKey !== "string"
    || (Object.hasOwn(input, "targetId") && typeof input.targetId !== "string")) {
    throw new InstructionRequestError(400, "prompt_definition_fields_invalid");
  }
  const result = await createPromptDefinition({ scope, id: input.id, stableKey: input.stableKey, ...(typeof input.targetId === "string" ? { targetId: input.targetId } : {}) });
  return {
    definition: { id: result.definition.id, stableKey: result.definition.stableKey, ...(result.definition.targetId ? { targetId: result.definition.targetId } : {}) },
    replayed: result.replayed
  };
}

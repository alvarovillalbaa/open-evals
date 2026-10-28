import { resolvePromptRelease } from "@open-evals/core";
import { queryRows } from "@open-evals/db";
import { requireInstructionAuth } from "@/lib/instruction-authoring";
import { InstructionRequestError, instructionErrorResponse, instructionJson, readInstructionJson } from "@/lib/instruction-request";

interface ResolvePromptInput {
  definitionId?: string;
  stableKey?: string;
  candidateVersionId?: string;
  experimentVersionId?: string;
  projectId?: string;
  workspaceId?: string;
  userId?: string;
  sessionId?: string;
}

function resolveInput(value: unknown): ResolvePromptInput {
  const fields = ["definitionId", "stableKey", "candidateVersionId", "experimentVersionId", "projectId", "workspaceId", "userId", "sessionId"];
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InstructionRequestError(400, "prompt_resolution_object_required");
  for (const [key, field] of Object.entries(value)) {
    if (!fields.includes(key) || typeof field !== "string" || !field || field.length > 128
      || field.trim() !== field || /[\u0000-\u001f\u007f]/.test(field)) throw new InstructionRequestError(400, "prompt_resolution_fields_invalid");
    for (let index = 0; index < field.length; index++) {
      const unit = field.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = field.charCodeAt(++index);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new InstructionRequestError(400, "prompt_resolution_fields_invalid");
      } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new InstructionRequestError(400, "prompt_resolution_fields_invalid");
    }
  }
  const input = value as ResolvePromptInput;
  if (!input.definitionId && !input.stableKey) throw new InstructionRequestError(400, "prompt_definition_identity_required");
  return input;
}

export async function POST(request: Request) {
  try {
    const { auth, scope } = await requireInstructionAuth("read");
    const body = resolveInput(await readInstructionJson(request));
    const definitions = await queryRows<{ id: string }>(
      `
        select prompt_definitions.id
        from prompt_definitions
        where workspace_id = $1 and (prompt_definitions.id = $2 or stable_key = $3)
          and ($4::text is null or exists (
            select 1 from targets
            where targets.id = prompt_definitions.target_id
              and targets.workspace_id = $1 and targets.project_id = $4
          ))
        order by prompt_definitions.id
        limit 2
      `,
      [scope.workspaceId, body.definitionId ?? "", body.stableKey ?? "", scope.projectId ?? null]
    );
    if (definitions.length > 1) return instructionJson({ error: "prompt_definition_ambiguous" }, 409);
    const definition = definitions[0];
    if (!definition) return instructionJson({ error: "prompt_definition_not_found" }, 404);
    const versions = await queryRows<{ id: string; compiledText: string; contentHash: string; status: string; createdAt: Date }>(
      `
        select id, compiled_text as "compiledText", content_hash as "contentHash", status, created_at as "createdAt"
        from prompt_versions
        where prompt_definition_id = $1
        order by created_at asc, id
      `,
      [definition.id]
    );
    if (!versions.length) return instructionJson({ error: "prompt_versions_not_found" }, 404);
    const baseline = versions.find((version) => version.status === "active");
    const releases = await queryRows<{
      id: string;
      definitionId: string;
      versionId: string;
      scopeType: "session" | "user" | "company" | "project" | "workspace" | "platform";
      scopeId: string;
      stage: "shadow" | "canary" | "active";
      active: boolean;
    }>(
      `
        select
          id,
          prompt_definition_id as "definitionId",
          prompt_version_id as "versionId",
          scope_type as "scopeType",
          scope_id as "scopeId",
          stage,
          active
        from prompt_releases
        where prompt_definition_id = $1 and stage in ('shadow', 'canary', 'active')
      `,
      [definition.id]
    );
    const resolved = resolvePromptRelease({
      definitionId: definition.id,
      releases,
      baselineVersionId: baseline?.id ?? "",
      explicitCandidateVersionId: body.candidateVersionId,
      experimentVersionId: body.experimentVersionId,
      scopes: {
        session: body.sessionId,
        user: body.userId ?? auth.user.id,
        project: scope.projectId ?? body.projectId,
        workspace: auth.workspaceId
      }
    });
    if (!resolved.versionId) return instructionJson({ error: "prompt_no_active_version" }, 409);
    const version = versions.find((item) => item.id === resolved.versionId);
    if (!version) return instructionJson({ error: "resolved_prompt_version_not_found" }, 404);
    if (!body.candidateVersionId && !["offline_validated", "shadow", "canary", "active"].includes(version.status)) {
      return instructionJson({ error: "resolved_prompt_version_not_servable" }, 409);
    }
    return instructionJson({
      ...resolved,
      compiledText: version.compiledText,
      contentHash: version.contentHash
    });
  } catch (error) {
    return instructionErrorResponse(error);
  }
}

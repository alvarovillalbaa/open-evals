import { resolvePromptRelease } from "@open-evals/core";
import { queryOne, queryRows } from "@open-evals/db";
import { authErrorResponse, requireRouteAuth } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const auth = await requireRouteAuth("viewer", "prompts:read");
    const body = (await request.json().catch(() => ({}))) as {
      definitionId?: string;
      stableKey?: string;
      candidateVersionId?: string;
      experimentVersionId?: string;
      projectId?: string;
      workspaceId?: string;
      userId?: string;
      sessionId?: string;
    };
    const definition = await queryOne<{ id: string }>(
      `
        select id
        from prompt_definitions
        where workspace_id = $1 and (id = $2 or stable_key = $3)
        order by stable_key
        limit 1
      `,
      [auth.workspaceId, body.definitionId ?? "", body.stableKey ?? ""]
    );
    if (!definition) return Response.json({ error: "prompt_definition_not_found" }, { status: 404 });
    const versions = await queryRows<{ id: string; compiledText: string; contentHash: string; createdAt: Date }>(
      `
        select id, compiled_text as "compiledText", content_hash as "contentHash", created_at as "createdAt"
        from prompt_versions
        where prompt_definition_id = $1
        order by created_at asc
      `,
      [definition.id]
    );
    const baseline = versions[0];
    if (!baseline) return Response.json({ error: "prompt_versions_not_found" }, { status: 404 });
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
      baselineVersionId: baseline.id,
      explicitCandidateVersionId: body.candidateVersionId,
      experimentVersionId: body.experimentVersionId,
      scopes: {
        session: body.sessionId,
        user: body.userId ?? auth.user.id,
        project: body.projectId,
        workspace: body.workspaceId ?? auth.workspaceId
      }
    });
    const version = versions.find((item) => item.id === resolved.versionId);
    if (!version) return Response.json({ error: "resolved_prompt_version_not_found" }, { status: 404 });
    return Response.json({
      ...resolved,
      compiledText: version.compiledText,
      contentHash: version.contentHash
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

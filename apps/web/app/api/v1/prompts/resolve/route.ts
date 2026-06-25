import { baselinePrompt, candidatePrompt, resolvePromptRelease } from "@open-evals/core";
import { authErrorResponse, requireRouteAuth } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    await requireRouteAuth("viewer", "prompts:read");
    const body = (await request.json().catch(() => ({}))) as { candidate?: boolean; projectId?: string };
    const resolved = resolvePromptRelease({
      definitionId: "reservation-agent",
      releases: [],
      baselineVersionId: baselinePrompt.id,
      explicitCandidateVersionId: body.candidate ? candidatePrompt.id : undefined,
      scopes: { project: body.projectId ?? "proj_demo" }
    });
    const version = resolved.versionId === candidatePrompt.id ? candidatePrompt : baselinePrompt;
    return Response.json({
      ...resolved,
      compiledText: version.compiledText,
      contentHash: version.contentHash
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

import type { PromptComponent, PromptRelease, PromptVersion } from "./types";
import { stableHash, textHash } from "./hash";

export function compilePromptVersion(args: {
  id: string;
  definitionId: string;
  components: PromptComponent[];
  parentVersionIds?: string[];
  status?: PromptVersion["status"];
}): PromptVersion {
  const compiledText = args.components.map((component) => `<!-- ${component.id}:${component.kind} -->\n${component.content}`).join("\n\n");
  return {
    id: args.id,
    definitionId: args.definitionId,
    components: args.components,
    compiledText,
    parentVersionIds: args.parentVersionIds ?? [],
    contentHash: textHash(compiledText),
    status: args.status ?? "draft"
  };
}

export function assertLockedComponentsPreserved(base: PromptVersion, candidate: PromptVersion): void {
  const candidateById = new Map(candidate.components.map((component) => [component.id, component]));
  for (const component of base.components) {
    if (!component.locked) continue;
    const next = candidateById.get(component.id);
    if (!next || next.content !== component.content) {
      throw new Error(`locked_component_changed:${component.id}`);
    }
  }
}

export function resolvePromptRelease(args: {
  definitionId: string;
  releases: PromptRelease[];
  baselineVersionId: string;
  explicitCandidateVersionId?: string;
  experimentVersionId?: string;
  scopes: Partial<Record<PromptRelease["scopeType"], string>>;
}): { versionId: string; appliedReleaseIds: string[]; resolutionFingerprint: string } {
  if (args.explicitCandidateVersionId) {
    return finish(args.explicitCandidateVersionId, ["explicit_eval_candidate_override"]);
  }
  if (args.experimentVersionId) return finish(args.experimentVersionId, ["active_experiment_assignment"]);
  const order: PromptRelease["scopeType"][] = ["session", "user", "company", "project", "workspace", "platform"];
  for (const scopeType of order) {
    const scopeId = args.scopes[scopeType];
    if (!scopeId) continue;
    const release = args.releases.find(
      (item) =>
        item.definitionId === args.definitionId &&
        item.scopeType === scopeType &&
        item.scopeId === scopeId &&
        item.active &&
        item.stage === "active"
    );
    if (release) return finish(release.versionId, [release.id]);
  }
  return finish(args.baselineVersionId, ["baseline"]);

  function finish(versionId: string, appliedReleaseIds: string[]) {
    return {
      versionId,
      appliedReleaseIds,
      resolutionFingerprint: stableHash({ definitionId: args.definitionId, versionId, appliedReleaseIds, scopes: args.scopes })
    };
  }
}

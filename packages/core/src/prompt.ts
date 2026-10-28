import type { PromptComponentSource, PromptComposition, PromptRelease, PromptVersion } from "./types";
import { stableHash, textHash } from "./hash";
import {
  freezePromptValue, inspectPromptVersion, materializePromptComponents, promptArray,
  promptField, promptIdentity, promptRecord, promptStatus, promptText
} from "./prompt-composition";

export interface CompilePromptVersionInput {
  id: string;
  definitionId: string;
  components: readonly PromptComponentSource[];
  parentVersionIds?: readonly string[];
  status?: PromptVersion["status"];
  composition?: PromptComposition;
  baseVersion?: PromptVersion;
}

export function compilePromptVersion(args: CompilePromptVersionInput): PromptVersion {
  const input = promptRecord(args, "compile_input", ["id", "definitionId", "components", "parentVersionIds", "status", "composition", "baseVersion"]);
  const id = promptIdentity(promptField(input, "id", "compile_input"), "prompt_id");
  const definitionId = promptIdentity(promptField(input, "definitionId", "compile_input"), "definition_id");
  const parentVersionIds = (input.parentVersionIds !== undefined ? promptArray(input.parentVersionIds, "parents") : [])
    .map(parent => promptIdentity(parent, "parent_id"));
  if (new Set(parentVersionIds).size !== parentVersionIds.length || parentVersionIds.includes(id)) throw new TypeError("compile_input:invalid_parents");
  const prepared = materializePromptComponents(promptField(input, "components", "compile_input") as readonly PromptComponentSource[], input.composition as PromptComposition | undefined);
  const compiledText = promptText(prepared.components);
  const version: PromptVersion = freezePromptValue({
    id, definitionId, components: prepared.components,
    compiledText,
    parentVersionIds,
    contentHash: textHash(compiledText),
    status: input.status !== undefined ? promptStatus(input.status) : "draft",
    ...(prepared.compositionSnapshot ? { compositionSnapshot: prepared.compositionSnapshot } : {})
  });
  if (input.baseVersion !== undefined) {
    const base = inspectPromptVersion(input.baseVersion as PromptVersion);
    if (!parentVersionIds.includes(base.id)) throw new TypeError("compile_input:base_parent_required");
    assertLockedComponentsPreserved(base, version);
  }
  return version;
}

export function assertLockedComponentsPreserved(base: PromptVersion, candidate: PromptVersion): void {
  inspectPromptVersion(base); inspectPromptVersion(candidate);
  if (base.definitionId !== candidate.definitionId) throw new Error("locked_components:definition_mismatch");
  const candidateById = new Map(candidate.components.map((component) => [component.id, component]));
  const lockedIds = base.components.filter(component => component.locked).map(component => component.id);
  for (const component of base.components) {
    if (!component.locked) continue;
    const next = candidateById.get(component.id);
    if (!next || !next.locked || next.kind !== component.kind || next.content !== component.content) {
      throw new Error(`locked_component_changed:${component.id}`);
    }
  }
  const candidateLockedOrder = candidate.components.filter(component => lockedIds.includes(component.id)).map(component => component.id);
  if (candidateLockedOrder.some((id, index) => id !== lockedIds[index])) throw new Error("locked_component_order_changed");
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

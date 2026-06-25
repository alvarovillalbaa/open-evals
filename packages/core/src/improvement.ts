import type { PromptVersion } from "./types";
import { compilePromptVersion } from "./prompt";

export type InstructionMutation =
  | "delete_one_instruction"
  | "leave_one_instruction_out"
  | "rewrite_one_instruction"
  | "split_instruction"
  | "strictness_tighten"
  | "strictness_relax"
  | "order_test";

export interface AblationVariant {
  id: string;
  mutation: InstructionMutation;
  componentId: string;
  promptVersion: PromptVersion;
  evidenceLevel: "controlled ablation evidence" | "hypothesis only";
}

export function buildAblationVariants(base: PromptVersion, componentId: string): AblationVariant[] {
  const component = base.components.find((item) => item.id === componentId);
  if (!component) throw new Error(`unknown_component:${componentId}`);
  if (component.locked) throw new Error(`locked_component_ablation_denied:${componentId}`);
  const variants: Array<[InstructionMutation, string]> = [
    ["delete_one_instruction", ""],
    ["split_instruction", component.content.replace(". ", ".\n- ")],
    ["rewrite_one_instruction", `${component.content} Be explicit and concise.`],
    ["strictness_tighten", `${component.content} Treat violations as release-blocking.`],
    ["strictness_relax", component.content.replace("Never", "Avoid")],
    ["order_test", base.components.map((item) => item.content).reverse().join("\n")]
  ];
  return variants.map(([mutation, content]) => {
    const promptVersion = compilePromptVersion({
      id: `${base.id}-${mutation}`,
      definitionId: base.definitionId,
      parentVersionIds: [base.id],
      status: "draft",
      components: base.components.map((item) => (item.id === componentId ? { ...item, content } : item))
    });
    return {
      id: `ablation_${base.id}_${mutation}`,
      mutation,
      componentId,
      promptVersion,
      evidenceLevel: "controlled ablation evidence"
    };
  });
}

export function verifyCandidateHash(expectedHash: string, actualHash: string) {
  if (expectedHash !== actualHash) throw new Error("candidate_prompt_hash_mismatch");
}

export function rollbackPointer(activeReleaseId: string, previousReleaseId?: string) {
  if (!previousReleaseId) throw new Error("rollback_pointer_missing");
  return {
    promptReleaseId: activeReleaseId,
    restoredReleaseId: previousReleaseId,
    status: "rolled_back" as const
  };
}

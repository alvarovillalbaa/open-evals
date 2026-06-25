export {
  createApprovalRequest,
  type ApprovalRequest,
  type ApprovalAction,
  type JsonValue
} from "@open-evals/core";

export function fapoRouteForAgent(category: string) {
  const normalized = category.toLowerCase();
  if (normalized.includes("evaluator")) {
    return { category: "evaluator defect", engine: "instrument_review", requiresReview: true, reason: "target prompt optimization must stop" };
  }
  if (normalized.includes("dataset")) {
    return { category: "dataset defect", engine: "instrument_review", requiresReview: true, reason: "dataset defects require instrument review" };
  }
  if (normalized.includes("retrieval") || normalized.includes("data")) {
    return { category: "retrieval/data deficiency", engine: "data_work_order", requiresReview: true, reason: "retrieval fixes require owner review" };
  }
  if (normalized.includes("parameter")) {
    return { category: "parameter deficiency", engine: "bounded_parameter_search", requiresReview: false, reason: "parameters can be searched without prompt mutation" };
  }
  if (normalized.includes("structure") || normalized.includes("pipeline")) {
    return { category: "pipeline structure", engine: "sandboxed_structural_work_order", requiresReview: true, reason: "structural work cannot auto-merge" };
  }
  if (normalized.includes("provider") || normalized.includes("transient")) {
    return { category: "transient provider failure", engine: "retry_or_postpone", requiresReview: false, reason: "provider instability should not mutate prompts" };
  }
  if (normalized.includes("prompt")) {
    return { category: "prompt deficiency", engine: "gepa_or_hill_climb", requiresReview: false, reason: "prompt-addressable failures may use prompt optimizers" };
  }
  return { category: "unknown", engine: "review", requiresReview: true, reason: "ambiguous attribution needs more evidence" };
}


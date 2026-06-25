export type ToolApproval = {
  tool: string;
  required: boolean;
  reason: string;
};

export const approvals: ToolApproval[] = [
  { tool: "start_eval_run", required: true, reason: "may call targets and judges" },
  { tool: "request_gepa_campaign", required: true, reason: "creates prompt candidates and consumes budget" },
  { tool: "request_variant_matrix", required: true, reason: "executes incumbent and candidates" },
  { tool: "request_release_promotion", required: true, reason: "updates release pointers" },
  { tool: "request_rollback", required: true, reason: "updates release pointers" },
  { tool: "create_structural_work_order", required: true, reason: "may create reviewable code changes in a sandbox" }
];

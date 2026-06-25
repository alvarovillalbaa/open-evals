import { baselinePrompt, candidatePrompt, demoEvalSet, demoRows, resolveRunPlan } from "@open-evals/core";

export type McpToolResult = { content: Array<{ type: "text"; text: string }>; requiresApproval?: boolean };

export const tools = {
  list_eval_sets(): McpToolResult {
    return text([{ id: demoEvalSet.id, name: demoEvalSet.name }]);
  },
  list_datasets(): McpToolResult {
    return text([{ id: "demo-dataset-v1", rows: demoRows.length }]);
  },
  list_targets(): McpToolResult {
    return text([{ id: "target_demo_reservation_agent", kinds: ["provided_output", "invoke_http_target", "invoke_mcp_target"] }]);
  },
  create_draft_run_plan(): McpToolResult {
    return text(resolveRunPlan({ id: "mcp_draft_plan", targetId: "target_demo_reservation_agent", targetKind: "provided_output", rows: demoRows, evalSet: demoEvalSet, historicalDataAllowed: true }));
  },
  start_eval_run(): McpToolResult {
    return { ...text({ runId: "mcp_run_requires_approval" }), requiresApproval: true };
  },
  get_eval_run(): McpToolResult {
    return text({ id: "run_demo", status: "completed" });
  },
  compare_prompt_versions(): McpToolResult {
    return text({ baseline: baselinePrompt.id, candidate: candidatePrompt.id, changedComponentIds: ["decision-rules"] });
  },
  create_draft_optimization_campaign(): McpToolResult {
    return { ...text({ campaignId: "mcp_campaign_draft", status: "draft" }), requiresApproval: true };
  },
  get_prompt_release(): McpToolResult {
    return text({ active: baselinePrompt.id, canary: candidatePrompt.id });
  }
};

function text(value: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

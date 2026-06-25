import { createApprovalRequest, fapoRouteForAgent, type JsonValue } from "./tools/open-evals";

type ToolHandler<TInput extends Record<string, JsonValue>> = (input: TInput) => Promise<Record<string, JsonValue>>;

function defineTool<TInput extends Record<string, JsonValue>>(tool: { name: string; description: string; mutating?: boolean; handler: ToolHandler<TInput> }) {
  return tool;
}

function defineAgent(agent: { name: string; instructions: string; tools: Array<ReturnType<typeof defineTool<Record<string, JsonValue>>>> }) {
  return agent;
}

const workspaceId = "ws_demo";

export const inspect_campaign = defineTool({
  name: "inspect_campaign",
  description: "Read an optimization campaign summary and known guardrails.",
  async handler(input: { campaignId?: JsonValue }) {
    return {
      campaignId: input.campaignId ?? "campaign_demo",
      status: "draft",
      guardrails: ["critical evaluator failures block promotion", "blind holdout is not exposed to reflection"]
    };
  }
});

export const create_draft_run_plan = defineTool({
  name: "create_draft_run_plan",
  description: "Create a draft run-plan summary without starting execution.",
  async handler(input: { objective?: JsonValue }) {
    return {
      status: "draft",
      objective: input.objective ?? "Evaluate reservation assistant behavior",
      approvalRequiredToStart: true
    };
  }
});

export const run_attribution = defineTool({
  name: "run_attribution",
  description: "Route a failure category using deterministic FAPO rules.",
  async handler(input: { category?: JsonValue }) {
    return fapoRouteForAgent(String(input.category ?? "unknown"));
  }
});

export const request_variant_matrix = defineTool({
  name: "request_variant_matrix",
  description: "Request approval to run same-manifest incumbent/candidate comparisons.",
  mutating: true,
  async handler(input: { requesterId?: JsonValue; campaignId?: JsonValue }) {
    const approval = createApprovalRequest({
      workspaceId,
      action: "run_variant_matrix",
      requesterId: String(input.requesterId ?? "eve_agent"),
      summary: `Run variant matrix for ${String(input.campaignId ?? "campaign_demo")}`,
      risk: "medium",
      payloadPreview: { campaignId: input.campaignId ?? "campaign_demo" }
    });
    return { requiresApproval: true, approval };
  }
});

export const request_release_promotion = defineTool({
  name: "request_release_promotion",
  description: "Request approval for a prompt release promotion.",
  mutating: true,
  async handler(input: { requesterId?: JsonValue; candidateId?: JsonValue; stage?: JsonValue }) {
    const approval = createApprovalRequest({
      workspaceId,
      action: "promote_prompt_release",
      requesterId: String(input.requesterId ?? "eve_agent"),
      summary: `Promote ${String(input.candidateId ?? "candidate")} to ${String(input.stage ?? "canary")}`,
      risk: "high",
      payloadPreview: { candidateId: input.candidateId ?? "candidate", stage: input.stage ?? "canary" }
    });
    return { requiresApproval: true, approval };
  }
});

export const request_rollback = defineTool({
  name: "request_rollback",
  description: "Request approval to roll back a prompt release pointer.",
  mutating: true,
  async handler(input: { requesterId?: JsonValue; releaseId?: JsonValue; reason?: JsonValue }) {
    const approval = createApprovalRequest({
      workspaceId,
      action: "rollback_prompt_release",
      requesterId: String(input.requesterId ?? "eve_agent"),
      summary: `Rollback ${String(input.releaseId ?? "release")}`,
      risk: "high",
      payloadPreview: { releaseId: input.releaseId ?? "release", reason: input.reason ?? "not provided" }
    });
    return { requiresApproval: true, approval };
  }
});

export const agent = defineAgent({
  name: "open-evals-agent",
  instructions:
    "Use typed tools to draft eval plans and optimization actions. Mutating or costly operations require explicit approval. The deterministic eval engine and persisted gates are authoritative.",
  tools: [inspect_campaign, create_draft_run_plan, run_attribution, request_variant_matrix, request_release_promotion, request_rollback]
});

export default agent;


export type McpToolResult = { content: Array<{ type: "text"; text: string }>; requiresApproval?: boolean };

export const tools = {
  async list_runs(): Promise<McpToolResult> {
    return text(await get("/api/v1/run-batches"));
  },
  async list_benchmarks(): Promise<McpToolResult> {
    return text(await get("/api/v1/benchmarks"));
  },
  async list_scenarios(): Promise<McpToolResult> {
    return text(await get("/api/v1/scenarios"));
  },
  async list_instructions(): Promise<McpToolResult> {
    return text(await get("/api/v1/instructions"));
  },
  async list_campaigns(): Promise<McpToolResult> {
    return text(await get("/api/v1/campaigns"));
  },
  async ingest_traces(payload: unknown): Promise<McpToolResult> {
    return text(await post("/api/v1/traces", payload));
  },
  create_draft_run_plan(): McpToolResult {
    return text({ status: "requires_rows_eval_set_and_target", endpoint: "/api/v1/run-plans/resolve" });
  },
  create_draft_optimization_campaign(): McpToolResult {
    return { ...text({ status: "approval_required", resource: "optimization_campaign" }), requiresApproval: true };
  },
  start_eval_run(): McpToolResult {
    return { ...text({ status: "approval_required", endpoint: "/api/v1/eval-runs" }), requiresApproval: true };
  }
};

function text(value: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

async function get(path: string) {
  const endpoint = serviceEndpoint();
  if (!endpoint) return { error: "OPEN_EVALS_URL_required" };
  const response = await fetch(`${endpoint}${path}`, { headers: authHeaders() });
  return response.json();
}

async function post(path: string, payload: unknown) {
  const endpoint = serviceEndpoint();
  if (!endpoint) return { error: "OPEN_EVALS_URL_required" };
  const response = await fetch(`${endpoint}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  return response.json();
}

function serviceEndpoint() {
  return process.env.OPEN_EVALS_URL?.replace(/\/$/, "");
}

function authHeaders() {
  const headers: Record<string, string> = {};
  if (process.env.OPEN_EVALS_API_KEY) headers.authorization = `Bearer ${process.env.OPEN_EVALS_API_KEY}`;
  return headers;
}

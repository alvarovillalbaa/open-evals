import type { JsonValue, RunSample, TargetKind } from "@open-evals/core";

export interface TargetExecution {
  output: JsonValue;
  traceId?: string;
  promptHash?: string;
}

export interface TargetAdapter {
  kind: TargetKind;
  invoke(sample: RunSample, config: Record<string, JsonValue>): Promise<TargetExecution>;
  health(): Promise<{ ok: boolean; message: string }>;
}

export class ProvidedOutputTarget implements TargetAdapter {
  kind: TargetKind = "provided_output";

  async invoke(sample: RunSample, _config: Record<string, JsonValue> = {}) {
    if (sample.output === undefined || sample.output === null || sample.output === "") {
      throw new Error(`blank_target_output:${sample.rowId}`);
    }
    return { output: sample.output, traceId: sample.traceId };
  }

  async health() {
    return { ok: true, message: "Provided output target is deterministic and local." };
  }
}

export class DemoHttpTarget implements TargetAdapter {
  kind: TargetKind = "invoke_http_target";

  async invoke(sample: RunSample, config: Record<string, JsonValue>) {
    const promptHash = String(config.promptHash ?? "demo-prompt-hash");
    return {
      output: `Demo HTTP target response for ${JSON.stringify(sample.input)}. Use this pre-populated self-service link; I have not completed the change.`,
      promptHash
    };
  }

  async health() {
    return { ok: true, message: "Demo HTTP target is local; configure endpoint for real calls." };
  }
}

export class DemoMcpTarget extends DemoHttpTarget {
  override kind: TargetKind = "invoke_mcp_target";

  override async health() {
    return { ok: true, message: "Demo MCP target uses fixture capabilities; configure a remote MCP transport for live calls." };
  }
}

export class RemoteMcpTargetAdapter implements TargetAdapter {
  kind: TargetKind = "invoke_mcp_target";

  async invoke(sample: RunSample, config: Record<string, JsonValue>) {
    const endpoint = String(config.endpoint ?? "");
    const allowlist = Array.isArray(config.allowedHosts) ? config.allowedHosts.map(String) : [];
    const toolName = String(config.toolName ?? "");
    if (!toolName) throw new Error("mcp_tool_name_required");
    assertSafeOutboundUrl(endpoint, allowlist);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(isRecord(config.headers) ? Object.fromEntries(Object.entries(config.headers).map(([key, value]) => [key, String(value)])) : {})
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: sample.rowId,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: {
            input: sample.input,
            rowId: sample.rowId,
            promptOverride: config.promptOverride ?? undefined
          }
        }
      })
    });
    if (!response.ok) throw new Error(`mcp_target_failed:${response.status}`);
    const data = (await response.json()) as Record<string, JsonValue>;
    const result = isRecord(data.result) ? data.result : data;
    const content = extractPath(result, String(config.responsePath ?? "content.0.text")) ?? result.output ?? result;
    if (content === undefined || content === null || content === "") throw new Error(`blank_target_output:${sample.rowId}`);
    return {
      output: content,
      traceId: typeof result.traceId === "string" ? result.traceId : undefined,
      promptHash: typeof result.promptHash === "string" ? result.promptHash : undefined
    };
  }

  async health() {
    return { ok: true, message: "Remote MCP target requires an HTTP transport endpoint, allowlisted host, and explicit tool name." };
  }
}

export class HttpTargetAdapter implements TargetAdapter {
  kind: TargetKind = "invoke_http_target";

  async invoke(sample: RunSample, config: Record<string, JsonValue>) {
    const endpoint = String(config.endpoint ?? "");
    const method = String(config.method ?? "POST").toUpperCase();
    const allowlist = Array.isArray(config.allowedHosts) ? config.allowedHosts.map(String) : [];
    assertSafeOutboundUrl(endpoint, allowlist);
    const controller = new AbortController();
    const timeoutMs = Number(config.timeoutMs ?? 30_000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method,
        headers: {
          "content-type": "application/json",
          ...(isRecord(config.headers) ? Object.fromEntries(Object.entries(config.headers).map(([key, value]) => [key, String(value)])) : {})
        },
        body: method === "GET" ? undefined : JSON.stringify({ input: sample.input, rowId: sample.rowId, promptOverride: config.promptOverride ?? null }),
        signal: controller.signal
      });
      const data = (await response.json().catch(() => ({ output: "" }))) as Record<string, JsonValue>;
      const output = extractPath(data, String(config.responsePath ?? "output"));
      if (output === undefined || output === null || output === "") throw new Error(`blank_target_output:${sample.rowId}`);
      return {
        output,
        traceId: typeof data.traceId === "string" ? data.traceId : undefined,
        promptHash: typeof data.promptHash === "string" ? data.promptHash : undefined
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async health() {
    return { ok: true, message: "HTTP target adapter requires an endpoint and host allowlist at invocation time." };
  }
}

export class OpenAICompatibleTargetAdapter extends HttpTargetAdapter {
  async invoke(sample: RunSample, config: Record<string, JsonValue>) {
    return super.invoke(sample, {
      ...config,
      requestShape: "openai-compatible",
      responsePath: config.responsePath ?? "choices.0.message.content"
    });
  }
}

function extractPath(value: Record<string, JsonValue>, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const part of path.split(".")) {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      current = current[part];
      continue;
    }
    if (Array.isArray(current)) {
      const index = Number(part);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }
    return undefined;
  }
  return current;
}

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function assertSafeOutboundUrl(endpoint: string, allowedHosts: string[]) {
  const url = new URL(endpoint);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("unsupported_target_protocol");
  const host = url.hostname.toLowerCase();
  if (!allowedHosts.includes(host)) throw new Error(`outbound_host_not_allowed:${host}`);
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) throw new Error(`ssrf_blocked_host:${host}`);
  if (/^(10|127)\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) {
    throw new Error(`ssrf_blocked_host:${host}`);
  }
}

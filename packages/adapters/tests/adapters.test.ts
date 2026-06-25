import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DeepEvalExportAdapter,
  GenericJsonTraceAdapter,
  LangfuseExportAdapter,
  LocalFixtureSandboxRunner,
  OtlpHttpJsonAdapter,
  ProvidedOutputTarget,
  RemoteMcpTargetAdapter,
  VercelBlobArtifactStore,
  assertSafeOutboundUrl,
  decryptSecret,
  encryptSecret,
  redactValue
} from "../src/index";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("trace source adapters", () => {
  it("normalizes generic JSONL and deduplicates content", async () => {
    const adapter = new GenericJsonTraceAdapter();
    const payload = '{"id":"t1","spans":[{"id":"s1","name":"llm","attributes":{"gen_ai.request.model":"fake"}}]}\n{"id":"t1","spans":[{"id":"s1","name":"llm","attributes":{"gen_ai.request.model":"fake"}}]}';
    const result = await adapter.importBatch({ workspaceId: "ws", payload });
    expect(result.traceCount).toBe(1);
    expect(result.duplicates).toHaveLength(1);
  });

  it("supports OTLP-like JSON payloads", async () => {
    const adapter = new OtlpHttpJsonAdapter();
    const trace = await adapter.normalizeTrace({ id: "otlp-1", spans: [{ id: "s1", name: "tool", attributes: { "tool.name": "lookup" } }] });
    expect(trace.spans[0]!.kind).toBe("TOOL");
  });

  it("pulls Langfuse-compatible provider records with cursor checkpoints", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "lf-1", spans: [] }], nextCursor: "next" }), { status: 200 }))
    );
    const adapter = new LangfuseExportAdapter();
    const result = await adapter.importBatch({ workspaceId: "ws", connection: { baseUrl: "https://langfuse.test", apiKey: "secret" } });
    expect(result.traceCount).toBe(1);
    expect(result.checkpoint.cursor).toBe("next");
  });

  it("fails provider pulls on rate limits", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));
    await expect(new DeepEvalExportAdapter().importBatch({ workspaceId: "ws", connection: { baseUrl: "https://deepeval.test", apiKey: "secret" } })).rejects.toThrow(
      "provider_rate_limited"
    );
  });
});

describe("privacy and targets", () => {
  it("redacts secrets and PII", () => {
    expect(redactValue({ email: "a@example.com", token: "sk-abcdefghijklmnopqrstuvwxyz" })).toEqual({
      email: "[redacted]",
      token: "[redacted]"
    });
  });

  it("rejects blank provided output", async () => {
    const target = new ProvidedOutputTarget();
    await expect(target.invoke({ rowId: "row-1", rowIndex: 0, sourceId: "x", sourceKind: "test", snapshotHash: "h", input: "x" }, {})).rejects.toThrow("blank_target_output");
  });

  it("blocks non-allowlisted and private HTTP target hosts", () => {
    expect(() => assertSafeOutboundUrl("http://127.0.0.1:8080", ["127.0.0.1"])).toThrow("ssrf_blocked_host");
    expect(() => assertSafeOutboundUrl("https://example.com/eval", ["api.example.com"])).toThrow("outbound_host_not_allowed");
    expect(() => assertSafeOutboundUrl("https://api.example.com/eval", ["api.example.com"])).not.toThrow();
  });

  it("round-trips encrypted connection secrets", () => {
    const encrypted = encryptSecret("provider-token", "dev-open-evals-change-me-32-bytes");
    expect(encrypted.ciphertext).not.toContain("provider-token");
    expect(decryptSecret(encrypted, "dev-open-evals-change-me-32-bytes")).toBe("provider-token");
  });

  it("reports Blob as disabled without hosted credentials or SDK", async () => {
    const health = await new VercelBlobArtifactStore("").health();
    expect(health.ok).toBe(false);
  });

  it("runs deterministic sandbox fixture without arbitrary execution", async () => {
    const result = await new LocalFixtureSandboxRunner().run({
      language: "javascript",
      source: "return input",
      input: { value: 1 },
      timeoutMs: 1000,
      network: false,
      maxOutputBytes: 1024
    });
    expect(result.output).toEqual({ deterministic: true, input: { value: 1 }, language: "javascript" });
  });

  it("invokes a remote MCP tool over HTTP JSON-RPC", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ result: { content: [{ type: "text", text: "ok" }], traceId: "trace", promptHash: "hash" } }), { status: 200 }))
    );
    const target = new RemoteMcpTargetAdapter();
    const result = await target.invoke(
      { rowId: "row", rowIndex: 0, sourceId: "src", sourceKind: "dataset", snapshotHash: "hash", input: "hello" },
      { endpoint: "https://mcp.example.com", allowedHosts: ["mcp.example.com"], toolName: "run" }
    );
    expect(result.output).toBe("ok");
    expect(result.promptHash).toBe("hash");
  });
});

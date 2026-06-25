import { normalizeGenericTrace, stableHash, type CanonicalTrace, type JsonValue } from "@open-evals/core";
import { redactValue } from "./redaction";

export interface CapabilityReport {
  ok: boolean;
  capabilities: string[];
  warnings: string[];
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

export interface ImportBatchRequest {
  workspaceId: string;
  projectId?: string;
  payload?: JsonValue | string;
  connection?: Record<string, JsonValue>;
  cursor?: string;
  dryRun?: boolean;
  redact?: boolean;
}

export interface ImportBatchResult {
  id: string;
  dryRun: boolean;
  traceCount: number;
  traces: CanonicalTrace[];
  duplicates: string[];
  checkpoint: { cursor: string };
}

export interface TraceSourceAdapter {
  kind: string;
  probe(connection: Record<string, JsonValue>): Promise<CapabilityReport>;
  testConnection(connection: Record<string, JsonValue>): Promise<ConnectionTestResult>;
  importBatch(request: ImportBatchRequest): Promise<ImportBatchResult>;
  normalizeTrace(raw: JsonValue): Promise<CanonicalTrace>;
  checkpoint(state: Record<string, JsonValue>): Promise<{ cursor: string }>;
  supportsWebhooks(): boolean;
  supportsBackfill(): boolean;
}

export class GenericJsonTraceAdapter implements TraceSourceAdapter {
  kind = "generic_json";

  async probe(_connection: Record<string, JsonValue> = {}): Promise<CapabilityReport> {
    return { ok: true, capabilities: ["upload", "preview", "field_mapping"], warnings: [] };
  }

  async testConnection(_connection: Record<string, JsonValue> = {}): Promise<ConnectionTestResult> {
    return { ok: true, message: "File upload adapter is local-only and ready." };
  }

  async importBatch(request: ImportBatchRequest): Promise<ImportBatchResult> {
    if (request.payload === undefined) throw new Error(`adapter_payload_required:${this.kind}`);
    const rawRecords = parseJsonOrJsonl(request.payload);
    const seen = new Set<string>();
    const duplicates: string[] = [];
    const traces: CanonicalTrace[] = [];
    for (const raw of rawRecords) {
      const payload = request.redact ? redactValue(raw) : raw;
      const trace = await this.normalizeTrace(payload);
      const key = `${trace.source}:${trace.externalTraceId}:${trace.contentHash}`;
      if (seen.has(key)) {
        duplicates.push(key);
        continue;
      }
      seen.add(key);
      traces.push({ ...trace, workspaceId: request.workspaceId, projectId: request.projectId ?? trace.projectId });
    }
    return {
      id: `import_${stableHash({ request, traceCount: traces.length }, 18)}`,
      dryRun: Boolean(request.dryRun),
      traceCount: traces.length,
      traces,
      duplicates,
      checkpoint: { cursor: stableHash(traces.map((trace) => trace.contentHash)) }
    };
  }

  async normalizeTrace(raw: JsonValue) {
    return normalizeGenericTrace(raw, { source: this.kind });
  }

  async checkpoint(state: Record<string, JsonValue>) {
    return { cursor: stableHash(state) };
  }

  supportsWebhooks() {
    return true;
  }

  supportsBackfill() {
    return true;
  }
}

export class OtlpHttpJsonAdapter extends GenericJsonTraceAdapter {
  override kind = "otlp_http_json";

  override async normalizeTrace(raw: JsonValue): Promise<CanonicalTrace> {
    const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return normalizeGenericTrace(record, { source: this.kind });
  }
}

export abstract class ProviderPullTraceAdapter extends GenericJsonTraceAdapter {
  override supportsBackfill() {
    return true;
  }

  override supportsWebhooks() {
    return true;
  }

  override async probe(connection: Record<string, JsonValue> = {}): Promise<CapabilityReport> {
    const hasBase = typeof connection.baseUrl === "string" && connection.baseUrl.length > 0;
    const hasToken = typeof connection.apiKey === "string" && connection.apiKey.length > 0;
    return {
      ok: hasBase && hasToken,
      capabilities: ["remote_pull", "cursor_backfill", "webhook_import", "dry_run_preview"],
      warnings: hasBase && hasToken ? [] : ["Remote pull requires baseUrl and apiKey in encrypted connection secret material."]
    };
  }

  override async testConnection(connection: Record<string, JsonValue> = {}): Promise<ConnectionTestResult> {
    const report = await this.probe(connection);
    if (!report.ok) return { ok: false, message: report.warnings.join("; ") };
    const response = await fetch(this.endpoint(connection), { method: "HEAD", headers: authHeaders(connection) });
    if (response.status === 429) return { ok: false, message: "Provider rate limit reached; retry later." };
    return { ok: response.ok || response.status === 405, message: response.ok || response.status === 405 ? "Connection reachable." : `Provider returned ${response.status}.` };
  }

  override async importBatch(request: ImportBatchRequest): Promise<ImportBatchResult> {
    if (request.payload !== undefined) return super.importBatch(request);
    const connection = request.connection ?? {};
    const response = await fetch(this.endpoint(connection, request.cursor), { headers: authHeaders(connection) });
    if (response.status === 429) throw new Error("provider_rate_limited");
    if (!response.ok) throw new Error(`provider_pull_failed:${response.status}`);
    const payload = (await response.json()) as JsonValue;
    const records = extractRecords(payload);
    const result = await super.importBatch({ ...request, payload: records });
    return {
      ...result,
      checkpoint: { cursor: extractCursor(payload) ?? result.checkpoint.cursor }
    };
  }

  protected abstract endpoint(connection: Record<string, JsonValue>, cursor?: string): string;
}

export class PromptfooArtifactAdapter extends GenericJsonTraceAdapter {
  override kind = "promptfoo_artifact";

  override async probe(): Promise<CapabilityReport> {
    return { ok: true, capabilities: ["artifact_upload", "json_export"], warnings: ["Promptfoo ingestion uses result artifacts, not a remote pull API."] };
  }
}

export class OpenAIExportAdapter extends GenericJsonTraceAdapter {
  override kind = "openai_agents_export";

  override async probe(): Promise<CapabilityReport> {
    return { ok: true, capabilities: ["export_upload", "agents_trace_export"], warnings: ["OpenAI Agents traces are imported from official export payloads or push SDK submissions."] };
  }
}

export class LangfuseExportAdapter extends ProviderPullTraceAdapter {
  override kind = "langfuse_export";

  protected endpoint(connection: Record<string, JsonValue>, cursor?: string): string {
    const baseUrl = String(connection.baseUrl ?? "https://cloud.langfuse.com");
    const projectId = connection.projectId ? `projectId=${encodeURIComponent(String(connection.projectId))}` : "";
    const cursorQuery = cursor ? `cursor=${encodeURIComponent(cursor)}` : "";
    return joinUrl(baseUrl, `/api/public/traces?${[projectId, cursorQuery].filter(Boolean).join("&")}`);
  }
}

export class DeepEvalExportAdapter extends ProviderPullTraceAdapter {
  override kind = "deepeval_export";

  protected endpoint(connection: Record<string, JsonValue>, cursor?: string): string {
    const baseUrl = String(connection.baseUrl ?? "https://api.confident-ai.com");
    return joinUrl(baseUrl, `/v1/traces${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
  }
}

export function parseJsonOrJsonl(payload: JsonValue | string): JsonValue[] {
  if (typeof payload !== "string") return Array.isArray(payload) ? payload : [payload];
  const trimmed = payload.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) return JSON.parse(trimmed) as JsonValue[];
  if (trimmed.startsWith("{") && !trimmed.includes("\n")) return [JSON.parse(trimmed) as JsonValue];
  return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as JsonValue);
}

function authHeaders(connection: Record<string, JsonValue>): HeadersInit {
  const apiKey = typeof connection.apiKey === "string" ? connection.apiKey : "";
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

function extractRecords(payload: JsonValue): JsonValue[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, JsonValue>;
    for (const key of ["data", "traces", "items", "results"]) {
      if (Array.isArray(record[key])) return record[key] as JsonValue[];
    }
  }
  return [payload];
}

function extractCursor(payload: JsonValue): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, JsonValue>;
  const cursor = record.nextCursor ?? record.next_cursor ?? record.cursor;
  return typeof cursor === "string" && cursor ? cursor : undefined;
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

import type { CanonicalSpan, CanonicalTrace, JsonValue, SpanKind } from "./types";
import { stableHash } from "./hash";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asJson(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  return value as JsonValue;
}

function attrMap(attributes: unknown): Record<string, JsonValue> {
  if (Array.isArray(attributes)) {
    const out: Record<string, JsonValue> = {};
    for (const attr of attributes) {
      const item = asRecord(attr);
      const key = String(item.key ?? "");
      const value = asRecord(item.value);
      if (!key) continue;
      out[key] = (value.stringValue ??
        value.intValue ??
        value.doubleValue ??
        value.boolValue ??
        item.value ??
        null) as JsonValue;
    }
    return out;
  }
  return asRecord(attributes) as Record<string, JsonValue>;
}

function spanKindFromAttributes(attrs: Record<string, JsonValue>, name: string): SpanKind {
  const explicit = String(attrs["openinference.span.kind"] ?? attrs["span.kind"] ?? "").toUpperCase();
  if (explicit === "LLM" || explicit === "AGENT" || explicit === "CHAIN" || explicit === "TOOL") return explicit;
  if (attrs["gen_ai.operation.name"] || attrs["gen_ai.request.model"]) return "LLM";
  if (attrs["tool.name"] || name.toLowerCase().includes("tool")) return "TOOL";
  if (name.toLowerCase().includes("retriev")) return "RETRIEVER";
  return "OTHER";
}

export function normalizeGenericTrace(raw: unknown, defaults: Partial<CanonicalTrace> = {}): CanonicalTrace {
  const payload = asRecord(raw);
  const rawSpans = Array.isArray(payload.spans) ? payload.spans : [];
  const externalTraceId = String(payload.traceId ?? payload.id ?? stableHash(payload, 16));
  const traceId = String(defaults.id ?? `tr_${stableHash({ source: defaults.source ?? "generic", externalTraceId }, 20)}`);
  const spans: CanonicalSpan[] = rawSpans.map((spanRaw, index) => {
    const span = asRecord(spanRaw);
    const attrs = attrMap(span.attributes);
    const externalSpanId = String(span.spanId ?? span.id ?? `span-${index + 1}`);
    const kind = spanKindFromAttributes(attrs, String(span.name ?? "span"));
    return {
      id: `sp_${stableHash({ traceId, externalSpanId }, 20)}`,
      traceId,
      externalSpanId,
      parentSpanId: span.parentSpanId ? String(span.parentSpanId) : undefined,
      kind,
      name: String(span.name ?? kind.toLowerCase()),
      startedAt: String(span.startTime ?? span.startTimeUnixNano ?? payload.startedAt ?? new Date().toISOString()),
      endedAt: span.endTime || span.endTimeUnixNano ? String(span.endTime ?? span.endTimeUnixNano) : undefined,
      status: String(span.status ?? "").toLowerCase().includes("error") ? "error" : "ok",
      error: span.error ? String(span.error) : undefined,
      input: asJson(span.input ?? attrs["input.value"] ?? attrs["gen_ai.prompt"]),
      output: asJson(span.output ?? attrs["output.value"] ?? attrs["gen_ai.completion"]),
      provider: String(attrs["gen_ai.system"] ?? attrs["llm.provider"] ?? payload.provider ?? ""),
      model: String(attrs["gen_ai.request.model"] ?? attrs["llm.model_name"] ?? ""),
      modelParameters: asRecord(span.modelParameters) as Record<string, JsonValue>,
      messages: Array.isArray(span.messages) ? (span.messages as Array<{ role: string; content: JsonValue }>) : undefined,
      usage: {
        inputTokens: Number(attrs["gen_ai.usage.input_tokens"] ?? attrs["llm.token_count.prompt"] ?? 0) || undefined,
        outputTokens: Number(attrs["gen_ai.usage.output_tokens"] ?? attrs["llm.token_count.completion"] ?? 0) || undefined
      },
      costUsd: Number(attrs["cost.usd"] ?? 0) || undefined,
      toolName: attrs["tool.name"] ? String(attrs["tool.name"]) : undefined,
      toolCallId: attrs["tool.call.id"] ? String(attrs["tool.call.id"]) : undefined,
      toolArguments: asJson(attrs["tool.arguments"]),
      toolResult: asJson(attrs["tool.result"]),
      attributes: attrs,
      events: Array.isArray(span.events) ? (span.events as CanonicalSpan["events"]) : [],
      links: Array.isArray(span.links) ? (span.links as CanonicalSpan["links"]) : [],
      promptVersionId: span.promptVersionId ? String(span.promptVersionId) : undefined,
      promptHash: span.promptHash ? String(span.promptHash) : undefined,
      rawSourceRef: span.rawSourceRef ? String(span.rawSourceRef) : undefined
    };
  });
  return {
    id: traceId,
    source: defaults.source ?? String(payload.source ?? "generic"),
    externalTraceId,
    workspaceId: defaults.workspaceId ?? String(payload.workspaceId ?? "local"),
    projectId: defaults.projectId ?? (payload.projectId ? String(payload.projectId) : undefined),
    environment: defaults.environment ?? String(payload.environment ?? "development"),
    targetId: payload.targetId ? String(payload.targetId) : defaults.targetId,
    targetVersion: payload.targetVersion ? String(payload.targetVersion) : defaults.targetVersion,
    targetFingerprint: payload.targetFingerprint ? String(payload.targetFingerprint) : defaults.targetFingerprint,
    promptDefinitionId: payload.promptDefinitionId ? String(payload.promptDefinitionId) : defaults.promptDefinitionId,
    promptVersionId: payload.promptVersionId ? String(payload.promptVersionId) : defaults.promptVersionId,
    promptHash: payload.promptHash ? String(payload.promptHash) : defaults.promptHash,
    sessionId: payload.sessionId ? String(payload.sessionId) : defaults.sessionId,
    scopeKeys: asRecord(payload.scopeKeys) as Record<string, string>,
    startedAt: String(payload.startedAt ?? payload.startTime ?? new Date().toISOString()),
    endedAt: payload.endedAt ? String(payload.endedAt) : undefined,
    status: payload.status === "error" ? "error" : "ok",
    input: asJson(payload.input),
    output: asJson(payload.output),
    metadata: asRecord(payload.metadata) as Record<string, JsonValue>,
    tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
    usage: asRecord(payload.usage),
    costUsd: Number(payload.costUsd ?? 0) || undefined,
    latencyMs: Number(payload.latencyMs ?? 0) || undefined,
    rawArtifactRef: payload.rawArtifactRef ? String(payload.rawArtifactRef) : undefined,
    canonicalSchemaVersion: "canonical-trace-v1",
    contentHash: stableHash(payload),
    redactionState: "raw",
    ingestedAt: new Date().toISOString(),
    spans
  };
}

export function reconstructSpanTree(spans: CanonicalSpan[]): Array<CanonicalSpan & { children: CanonicalSpan[] }> {
  const byId = new Map(spans.map((span) => [span.externalSpanId, { ...span, children: [] as CanonicalSpan[] }]));
  const roots: Array<CanonicalSpan & { children: CanonicalSpan[] }> = [];
  for (const span of byId.values()) {
    if (span.parentSpanId && byId.has(span.parentSpanId)) {
      byId.get(span.parentSpanId)!.children.push(span);
    } else {
      roots.push(span);
    }
  }
  return roots;
}

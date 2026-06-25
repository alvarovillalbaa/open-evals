import { normalizeGenericTrace, type CanonicalTrace, type JsonValue } from "@open-evals/core";

export interface OpenEvalsSdkOptions {
  endpoint?: string;
  apiKey?: string;
  flushIntervalMs?: number;
}

export class OpenEvalsClient {
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly buffer: CanonicalTrace[] = [];

  constructor(options: OpenEvalsSdkOptions = {}) {
    this.endpoint = options.endpoint ?? "http://127.0.0.1:3000";
    this.apiKey = options.apiKey;
  }

  startTrace(payload: JsonValue): CanonicalTrace {
    const trace = normalizeGenericTrace(payload, { source: "sdk" });
    this.buffer.push(trace);
    return trace;
  }

  startSpan(trace: CanonicalTrace, span: JsonValue): CanonicalTrace {
    const normalized = normalizeGenericTrace({ ...trace, spans: [...trace.spans, span] }, { source: trace.source });
    return normalized;
  }

  endSpan(trace: CanonicalTrace): CanonicalTrace {
    return trace;
  }

  async submitTrace(payload: JsonValue): Promise<Response> {
    return this.post("/api/v1/traces", payload);
  }

  async recordExposure(payload: JsonValue): Promise<Response> {
    return this.post("/api/v1/experiments/assign", payload);
  }

  async recordOutcome(payload: JsonValue): Promise<Response> {
    return this.post("/api/v1/experiments/outcomes", payload);
  }

  async resolvePrompt(payload: JsonValue): Promise<Response> {
    return this.post("/api/v1/prompts/resolve", payload);
  }

  async evaluate(payload: JsonValue): Promise<Response> {
    return this.post("/api/v1/eval-runs", payload);
  }

  async flush(): Promise<number> {
    const count = this.buffer.length;
    for (const trace of this.buffer.splice(0)) await this.submitTrace(trace as unknown as JsonValue);
    return count;
  }

  private async post(path: string, payload: JsonValue) {
    return fetch(`${this.endpoint}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
      },
      body: JSON.stringify(payload)
    });
  }
}

export const submitTrace = (payload: JsonValue, options?: OpenEvalsSdkOptions) => new OpenEvalsClient(options).submitTrace(payload);
export const startTrace = (payload: JsonValue, options?: OpenEvalsSdkOptions) => new OpenEvalsClient(options).startTrace(payload);
export const startSpan = (trace: CanonicalTrace, span: JsonValue, options?: OpenEvalsSdkOptions) => new OpenEvalsClient(options).startSpan(trace, span);
export const endSpan = (trace: CanonicalTrace, options?: OpenEvalsSdkOptions) => new OpenEvalsClient(options).endSpan(trace);
export const resolvePrompt = (payload: JsonValue, options?: OpenEvalsSdkOptions) => new OpenEvalsClient(options).resolvePrompt(payload);
export const recordExposure = (payload: JsonValue, options?: OpenEvalsSdkOptions) => new OpenEvalsClient(options).recordExposure(payload);
export const recordOutcome = (payload: JsonValue, options?: OpenEvalsSdkOptions) => new OpenEvalsClient(options).recordOutcome(payload);
export const evaluate = (payload: JsonValue, options?: OpenEvalsSdkOptions) => new OpenEvalsClient(options).evaluate(payload);
export const flush = (options?: OpenEvalsSdkOptions) => new OpenEvalsClient(options).flush();

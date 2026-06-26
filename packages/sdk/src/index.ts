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
  private flushTimer?: ReturnType<typeof setInterval>;

  constructor(options: OpenEvalsSdkOptions = {}) {
    this.endpoint = (options.endpoint ?? process.env.OPEN_EVALS_URL ?? "http://127.0.0.1:3216").replace(/\/$/, "");
    this.apiKey = options.apiKey;
    if (options.flushIntervalMs && options.flushIntervalMs > 0) {
      this.flushTimer = setInterval(() => void this.flush(), options.flushIntervalMs);
    }
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

  async submitTraces(payload: string | JsonValue[]): Promise<Response> {
    return fetch(`${this.endpoint}/api/v1/traces/batch`, {
      method: "POST",
      headers: {
        "content-type": typeof payload === "string" ? "application/jsonl" : "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
      },
      body: typeof payload === "string" ? payload : JSON.stringify(payload)
    });
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
    if (!count) return 0;
    const response = await this.submitTraces(this.buffer.splice(0) as unknown as JsonValue[]);
    if (!response.ok) throw new Error(`open_evals_flush_failed:${response.status}`);
    return count;
  }

  close() {
    if (this.flushTimer) clearInterval(this.flushTimer);
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
export const submitTraces = (payload: string | JsonValue[], options?: OpenEvalsSdkOptions) => new OpenEvalsClient(options).submitTraces(payload);
export const startTrace = (payload: JsonValue, options?: OpenEvalsSdkOptions) => new OpenEvalsClient(options).startTrace(payload);
export const startSpan = (trace: CanonicalTrace, span: JsonValue, options?: OpenEvalsSdkOptions) => new OpenEvalsClient(options).startSpan(trace, span);
export const endSpan = (trace: CanonicalTrace, options?: OpenEvalsSdkOptions) => new OpenEvalsClient(options).endSpan(trace);
export const resolvePrompt = (payload: JsonValue, options?: OpenEvalsSdkOptions) => new OpenEvalsClient(options).resolvePrompt(payload);
export const recordExposure = (payload: JsonValue, options?: OpenEvalsSdkOptions) => new OpenEvalsClient(options).recordExposure(payload);
export const recordOutcome = (payload: JsonValue, options?: OpenEvalsSdkOptions) => new OpenEvalsClient(options).recordOutcome(payload);
export const evaluate = (payload: JsonValue, options?: OpenEvalsSdkOptions) => new OpenEvalsClient(options).evaluate(payload);

import { stableHash, stableStringify } from "./hash";
import { parseProvidedOutputDatasetSnapshot, parseProvidedOutputEvalSetSource } from "./provided-output-runs";
import type { JsonValue } from "./types";
import type { HttpEvalPlanDraft, HttpEvalPlanSaveRequest, HttpEvalPlanHead, HttpEvalPlanContent, HttpEvalPlanPreview, HttpEvalPlanVersionRecord, ResolveHttpEvalPlanInput, PrepareHttpEvalPlanRecordInput } from "./http-eval-types";
export type * from "./http-eval-types";

export const HTTP_EVAL_LIMITS = Object.freeze({ requestBytes: 2097152, recordBytes: 16777216, responseBytes: 65536, callBytes: 1056768, rows: 100, sets: 8, items: 32, recoveryGraceMs: 15000 });
export class HttpEvalError extends Error {
  readonly code: string;
  readonly status: 422 | 409;
  constructor(code = "http_eval_invalid", status: 422 | 409 = 422) { super(code); this.name = "HttpEvalError"; this.code = code; this.status = status; }
}
export const httpEvalFail = (code = "http_eval_invalid", status: 422 | 409 = 422): never => { throw new HttpEvalError(code, status); };
export const httpEvalHash = (value: unknown): string => stableHash(value, 64);
export const httpEvalSame = (a: unknown, b: unknown): boolean => stableStringify(a) === stableStringify(b);
const encoder = new TextEncoder();
export const httpEvalBytes = (value: string): number => encoder.encode(value).byteLength;
function unicode(s: string): boolean {
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c === 0 || c >= 0xdc00 && c <= 0xdfff) return false;
    if (c >= 0xd800 && c <= 0xdbff) { const n = s.charCodeAt(++i); if (!(n >= 0xdc00 && n <= 0xdfff)) return false; }
  } return true;
}
export function httpEvalText(v: unknown, maximum = 512, nonblank = true): string {
  return typeof v === "string" && unicode(v) && httpEvalBytes(v) <= maximum && (!nonblank || v.trim().length > 0) ? v : httpEvalFail();
}
export function httpEvalUuid(v: unknown): string { return typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v) ? v : httpEvalFail(); }
export function httpEvalDigest(v: unknown): string { return typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : httpEvalFail(); }
export function httpEvalInteger(v: unknown, minimum: number, maximum: number): number { return typeof v === "number" && Number.isSafeInteger(v) && v >= minimum && v <= maximum ? v : httpEvalFail(); }
export function httpEvalTimestamp(v: unknown): string {
  const t = httpEvalText(v, 24); return t.length === 24 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(t) && Number.isFinite(Date.parse(t)) && new Date(t).toISOString() === t ? t : httpEvalFail();
}
export function httpEvalObject(v: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return httpEvalFail();
  const r = v as Record<string, unknown>, keys = Object.keys(r);
  if (required.some(k => !Object.hasOwn(r, k)) || keys.some(k => !required.includes(k) && !optional.includes(k))) return httpEvalFail();
  return r;
}
/** Descriptor inspection precedes any hash/stringification of caller-owned values. */
export function copyHttpEvalJson(value: unknown, maximumBytes: number = HTTP_EVAL_LIMITS.recordBytes): JsonValue {
  let nodes = 0, strings = 0; const seen = new Set<object>();
  function copy(v: unknown, depth: number): JsonValue {
    if (++nodes > 2000000 || depth > 64) return httpEvalFail("http_eval_budget_exceeded");
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") return Number.isFinite(v) ? (v === 0 ? 0 : v) : httpEvalFail();
    if (typeof v === "string") { if (!unicode(v) || (strings += httpEvalBytes(v)) > maximumBytes) return httpEvalFail(); return v; }
    if (!v || typeof v !== "object" || seen.has(v)) return httpEvalFail();
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return httpEvalFail();
    const ds = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(ds).filter(k => !(array && k === "length"));
    if (keys.length > 150000 || keys.some(k => typeof k !== "string") || array && (ds.length?.value !== keys.length || keys.some((k, i) => k !== String(i)))) return httpEvalFail();
    const result: JsonValue[] | Record<string, JsonValue> = array ? [] : Object.create(null); seen.add(v);
    try { for (const k of keys) { const d = ds[k as string]; if (!d?.enumerable || !("value" in d) || !unicode(k as string) || (strings += httpEvalBytes(k as string)) > maximumBytes) return httpEvalFail(); Object.defineProperty(result, k, { value: copy(d.value, depth + 1), enumerable: true, configurable: true, writable: true }); } }
    finally { seen.delete(v); } return result;
  }
  const result = copy(value, 0); if (httpEvalBytes(stableStringify(result)) > maximumBytes) return httpEvalFail("http_eval_budget_exceeded"); return result;
}
function decimal(token: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token); if (!m) return httpEvalFail("http_eval_json_invalid");
  let c = `${m[2]}${m[3] ?? ""}`.replace(/^0+/, ""); if (!c) return "0";
  const trailing = c.length - c.replace(/0+$/, "").length; c = c.slice(0, c.length - trailing);
  const raw = m[4] ?? "0", digits = raw.replace(/^[+-]/, "").replace(/^0+/, "") || "0";
  if (digits.length > 8) return httpEvalFail("http_eval_json_precision");
  const e = BigInt(`${raw.startsWith("-") ? "-" : ""}${digits}`) - BigInt(m[3]?.length ?? 0) + BigInt(trailing);
  return `${m[1]}${c}e${e}`;
}
/** Raw text is parsed before JavaScript can round numbers or discard duplicate decoded keys. */
export function parseHttpEvalJson(sourceText: string, maximumBytes: number = HTTP_EVAL_LIMITS.requestBytes): JsonValue {
  if (typeof sourceText !== "string" || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > HTTP_EVAL_LIMITS.recordBytes || httpEvalBytes(sourceText) > maximumBytes || !unicode(sourceText)) return httpEvalFail("http_eval_json_invalid");
  let at = 0, nodes = 0;
  function ws() { while (at < sourceText.length && /[\x20\t\r\n]/.test(sourceText[at]!)) at++; }
  function str(): string {
    const start = at++; for (;;) { const c = sourceText[at++]; if (c === undefined) return httpEvalFail("http_eval_json_invalid");
      if (c === "\\") { if (at >= sourceText.length) return httpEvalFail("http_eval_json_invalid"); at++; }
      else if (c === '"') { let value: unknown; try { value = JSON.parse(sourceText.slice(start, at)); } catch { return httpEvalFail("http_eval_json_invalid"); } return httpEvalText(value, maximumBytes, false); }
    }
  }
  function read(depth: number): JsonValue {
    if (++nodes > 2000000 || depth > 64) return httpEvalFail("http_eval_budget_exceeded"); ws(); const c = sourceText[at];
    if (c === '"') return str();
    if (c === "{" || c === "[") {
      const array = c === "[", result: JsonValue[] | Record<string, JsonValue> = array ? [] : Object.create(null), keys = new Set<string>(); at++; ws();
      if (sourceText[at] === (array ? "]" : "}")) { at++; return result; }
      for (;;) { ws(); let key: string;
        if (array) key = String((result as JsonValue[]).length);
        else { if (sourceText[at] !== '"') return httpEvalFail("http_eval_json_invalid"); key = str(); if (keys.has(key)) return httpEvalFail("http_eval_json_duplicate_key"); keys.add(key); ws(); if (sourceText[at++] !== ":") return httpEvalFail("http_eval_json_invalid"); }
        const value = read(depth + 1); Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true }); ws();
        if (sourceText[at] === (array ? "]" : "}")) { at++; return result; } if (sourceText[at++] !== ",") return httpEvalFail("http_eval_json_invalid");
      }
    }
    for (const [token, value] of [["true", true], ["false", false], ["null", null]] as const) if (sourceText.startsWith(token, at)) { at += token.length; return value; }
    const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(sourceText.slice(at))?.[0];
    if (!token) return httpEvalFail("http_eval_json_invalid"); at += token.length; const value = Number(token);
    if (!Number.isFinite(value) || decimal(token) !== decimal(JSON.stringify(value))) return httpEvalFail("http_eval_json_precision"); return value === 0 ? 0 : value;
  }
  const result = read(0); ws(); if (at !== sourceText.length) return httpEvalFail("http_eval_json_invalid"); return result;
}
export function prepareHttpEvalPlanDraft(value: unknown): HttpEvalPlanDraft {
  const s = httpEvalObject(copyHttpEvalJson(value, HTTP_EVAL_LIMITS.requestBytes), ["schemaVersion", "planId", "versionId", "version", "expectedVersionId", "name", "datasetVersionId", "evalSetVersionIds", "target", "limits"]);
  if (s.schemaVersion !== "http-eval-plan-draft-v1" || !Array.isArray(s.evalSetVersionIds) || !s.evalSetVersionIds.length || s.evalSetVersionIds.length > HTTP_EVAL_LIMITS.sets) return httpEvalFail();
  const version = httpEvalInteger(s.version, 1, 2147483647), expectedVersionId = s.expectedVersionId === null ? null : httpEvalUuid(s.expectedVersionId), versionId = httpEvalUuid(s.versionId);
  if ((version === 1) !== (expectedVersionId === null) || expectedVersionId === versionId) return httpEvalFail();
  const ids = s.evalSetVersionIds.map(httpEvalUuid).sort(); if (new Set(ids).size !== ids.length) return httpEvalFail();
  const target = httpEvalObject(s.target, ["targetId", "targetVersion", "endpoint", "timeoutMs"]), limits = httpEvalObject(s.limits, ["concurrency", "maxDurationSeconds"]);
  const endpoint = httpEvalText(target.endpoint, 4096); let url: URL; try { url = new URL(endpoint); } catch { return httpEvalFail("http_eval_endpoint_invalid"); }
  const hostname = url.hostname, labels = hostname.split("."), reserved = ["local", "localhost", "internal", "lan", "home", "onion", "test", "invalid", "example", "home.arpa"];
  if (url.protocol !== "https:" || url.port && url.port !== "443" || url.username || url.password || endpoint.includes("?") || endpoint.includes("#") || url.href !== endpoint
    || hostname.length > 253 || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    || reserved.some(suffix => hostname === suffix || hostname.endsWith(`.${suffix}`)) || /^[\d.]+$/.test(hostname)) return httpEvalFail("http_eval_endpoint_invalid");
  return { schemaVersion: "http-eval-plan-draft-v1", planId: httpEvalUuid(s.planId), versionId, version, expectedVersionId,
    name: httpEvalText(s.name, 4096).trim(), datasetVersionId: httpEvalText(s.datasetVersionId), evalSetVersionIds: ids,
    target: { targetId: httpEvalText(target.targetId), targetVersion: httpEvalText(target.targetVersion), endpoint, timeoutMs: httpEvalInteger(target.timeoutMs, 500, 10000) },
    limits: { concurrency: httpEvalInteger(limits.concurrency, 1, 4), maxDurationSeconds: httpEvalInteger(limits.maxDurationSeconds, 5, 120) } };
}
export function prepareHttpEvalPlanSaveRequest(value: unknown): HttpEvalPlanSaveRequest {
  const s = httpEvalObject(copyHttpEvalJson(value, HTTP_EVAL_LIMITS.requestBytes), ["schemaVersion", "draft", "expectedPreviewFingerprint"]);
  if (s.schemaVersion !== "http-eval-plan-save-v1") return httpEvalFail(); return { schemaVersion: "http-eval-plan-save-v1", draft: prepareHttpEvalPlanDraft(s.draft), expectedPreviewFingerprint: httpEvalDigest(s.expectedPreviewFingerprint) };
}
function head(value: unknown): HttpEvalPlanHead | null {
  if (value === null) return null; const s = httpEvalObject(copyHttpEvalJson(value), ["planId", "versionId", "version", "name", "fingerprint"]);
  return { planId: httpEvalUuid(s.planId), versionId: httpEvalUuid(s.versionId), version: httpEvalInteger(s.version, 1, 2147483647), name: httpEvalText(s.name, 4096), fingerprint: httpEvalDigest(s.fingerprint) };
}
export function httpEvalPlanStorageIds(workspaceId: string, planId: string, versionId: string) {
  workspaceId = httpEvalText(workspaceId); planId = httpEvalUuid(planId); versionId = httpEvalUuid(versionId);
  const key = httpEvalHash({ workspaceId, planId, versionId }); return { planId: `http_eval_plan_${httpEvalHash({ workspaceId, planId })}`, versionId: `http_eval_plan_version_${key}`, auditId: `audit_http_eval_plan_${key}` };
}
export function httpEvalPlanRequestFingerprint(workspaceId: string, request: unknown): string { return httpEvalHash({ schemaVersion: "http-eval-plan-save-fingerprint-v1", workspaceId: httpEvalText(workspaceId), request: prepareHttpEvalPlanSaveRequest(request) }); }
function recordAllowance(content: HttpEvalPlanContent, workspaceId: string, parent: HttpEvalPlanHead | null): number {
  // Internal byte scaffold, never returned as domain data. Each field bounds the actual
  // serialized field; impossible combinations deliberately overbound failure/success cases.
  const fp = "f".repeat(64), time = "2000-01-01T00:00:00.000Z", uuid = "00000000-0000-4000-8000-000000000000", runId = `http_eval_run_${fp}`;
  const sampleIds = content.samples.map(s => s.rowId), itemIds = content.items.map(i => i.id), resultId = (rowId: string, itemId: string) => `http_eval_result_${httpEvalHash({ rowId, itemId })}`;
  const claim = (rowId: string) => ({ rowId, claimToken: uuid, claimedAt: time, requestFingerprint: fp });
  const plan = { schemaVersion: "http-eval-plan-record-v1", workspaceId, storage: httpEvalPlanStorageIds(workspaceId, content.draft.planId, content.draft.versionId), createdAt: time, head: parent, content, previewFingerprint: fp, requestFingerprint: fp, fingerprint: fp };
  const ledger = { schemaVersion: "http-eval-run-ledger-v1", workspaceId, publicRunId: uuid, runId, workflowId: `http_eval_workflow_${fp}`, planVersionId: plan.storage.versionId, planFingerprint: fp, requestFingerprint: fp, leaseToken: uuid, startedAt: time, deadlineAt: time, leaseExpiresAt: time, stopReason: "http_target_" + "x".repeat(100), status: "outcome_unknown", rows: sampleIds.map(rowId => ({ rowId, status: "outcome_unknown", claim: claim(rowId), eventId: `http_eval_event_${fp}`, eventFingerprint: fp })), fingerprint: fp };
  const events = sampleIds.map(rowId => ({ schemaVersion: "http-eval-row-event-v1", id: `http_eval_event_${fp}`, workspaceId, publicRunId: uuid, rowId, claim: claim(rowId), status: "outcome_unknown", completedAt: time,
    response: { schemaVersion: "http-json-target-response-v1", requestFingerprint: fp, output: "", usage: { inputTokens: 1000000000, outputTokens: 1000000000, totalTokens: 1000000000 }, costUsd: "x".repeat(32) }, rawResponseHash: fp, errorCode: "http_target_" + "x".repeat(100), fingerprint: fp }));
  const results = sampleIds.flatMap(rowId => content.items.map(item => ({ id: resultId(rowId, item.id), rowId, evalItemVersionId: item.id, originalOutput: { contains_expected: false }, fields: [{ key: "contains_expected", value: false, passed: false, decision: "hard_fail" }], conciseRationale: "Configured text is present.", evidenceRefs: [`http_eval_event_${fp}`], evaluatorVersion: item.fingerprint, provider: "local", model: "case_insensitive_contains_v1", sourceOutputFingerprint: fp, fingerprint: fp })));
  const gates: unknown[] = [];
  function gate(level: string, scopeId: string, rows: string[], items: string[]) {
    gates.push({ id: `http_eval_gate_${fp}`, runId, level, scopeId, score: "x".repeat(32), passed: false, decision: "hard_fail", thresholdVersion: `http-eval-thresholds-v1:${fp}`, formula: "x".repeat(160),
      reasons: ["coverage_incomplete", "threshold_failed", "critical_evaluator_failed"], failedCriticalComponents: items, sourceResultIds: rows.flatMap(rowId => items.map(itemId => resultId(rowId, itemId))).sort(), fingerprint: fp });
  }
  for (const rowId of sampleIds) { for (const itemId of itemIds) { gate("field", `${rowId}/${itemId}/contains_expected`, [rowId], [itemId]); gate("item_row", `${rowId}/${itemId}`, [rowId], [itemId]); } gate("row", rowId, [rowId], itemIds); }
  gate("dataset", content.dataset.version.id, sampleIds, itemIds);
  for (const set of content.evalSets) gate("eval_set", set.contract.id, sampleIds, set.members.map(m => m.evalItemVersionId));
  gate("target", content.target.fingerprint, sampleIds, itemIds); gate("criticality", "critical", sampleIds, itemIds); gate("run", runId, sampleIds, itemIds);
  // Replace each two-byte empty JSON string with the full 65536-byte output allowance
  // arithmetically, avoiding a multi-megabyte synthetic string allocation during readback.
  return httpEvalBytes(stableStringify({ schemaVersion: "http-eval-run-record-v1", workspaceId, plan, ledger, events, execution: { schemaVersion: "http-eval-execution-v1", results, gates, fingerprint: fp }, fingerprint: fp })) + sampleIds.length * (HTTP_EVAL_LIMITS.responseBytes - 2);
}
export function resolveHttpEvalPlanPreview(input: ResolveHttpEvalPlanInput): HttpEvalPlanPreview {
  const workspaceId = httpEvalText(input.workspaceId), draft = prepareHttpEvalPlanDraft(input.draft), parent = head(input.head);
  if (parent ? parent.planId !== draft.planId || draft.expectedVersionId !== parent.versionId || draft.version !== parent.version + 1 : draft.version !== 1 || draft.expectedVersionId !== null) return httpEvalFail("http_eval_plan_stale", 409);
  let dataset: HttpEvalPlanContent["dataset"], evalSets: HttpEvalPlanContent["evalSets"];
  try { dataset = parseProvidedOutputDatasetSnapshot(input.dataset); if (!Array.isArray(input.evalSets) || input.evalSets.length !== draft.evalSetVersionIds.length) return httpEvalFail(); evalSets = input.evalSets.map(parseProvidedOutputEvalSetSource).sort((a, b) => a.contract.id < b.contract.id ? -1 : a.contract.id > b.contract.id ? 1 : 0); }
  catch { return httpEvalFail("http_eval_sources_invalid"); }
  if (dataset.version.id !== draft.datasetVersionId || !httpEvalSame(evalSets.map(s => s.contract.id), draft.evalSetVersionIds)) return httpEvalFail("http_eval_sources_invalid");
  const distinct = new Map<string, HttpEvalPlanContent["items"][number]>();
  for (const set of evalSets) for (const member of set.contract.itemVersions) {
    const item = member.item;
    if (item.type !== "string_check" || typeof item.config.contains !== "string" || !item.config.contains.trim() || member.weight !== 1 || member.criticality !== "critical" || item.outputSchema.fields.length !== 1 || item.outputSchema.fields[0]?.key !== "contains_expected" || item.outputSchema.fields[0]?.type !== "boolean") return httpEvalFail("http_eval_evaluator_unavailable");
    const old = distinct.get(item.id); if (old && !httpEvalSame(old, item)) return httpEvalFail("http_eval_evaluator_conflict"); distinct.set(item.id, item);
  }
  const items = [...distinct.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0); if (!items.length || items.length > HTTP_EVAL_LIMITS.items) return httpEvalFail();
  const samples = dataset.rows.map(row => ({ rowId: `http_eval_row_${httpEvalHash({ datasetVersionId: dataset.version.id, datasetRowId: row.id, fingerprint: httpEvalHash(row) })}`, datasetRowId: row.id, rowKey: row.rowKey, fingerprint: httpEvalHash(row) }));
  const base = { schemaVersion: "http-target-eval-v1" as const, draft, dataset, datasetFingerprint: httpEvalHash(dataset), evalSets, items, samples,
    target: { ...draft.target, protocol: "http-json-target-v1" as const, fingerprint: httpEvalHash({ protocol: "http-json-target-v1", ...draft.target }) },
    policy: { evaluator: "case_insensitive_contains_v1" as const, expectedOutputVisibility: "hidden" as const, maxTargetCalls: samples.length, maxJudgeCalls: 0 as const, codeVersion: "http-target-eval-v1" as const } };
  const content: HttpEvalPlanContent = { ...base, fingerprint: httpEvalHash(base) };
  const recordByteAllowance = recordAllowance(content, workspaceId, parent);
  if (recordByteAllowance > HTTP_EVAL_LIMITS.recordBytes) return httpEvalFail("http_eval_record_allowance_exceeded");
  const preview = { schemaVersion: "http-eval-plan-preview-v1" as const, workspaceId, draft, head: parent, content, recordByteAllowance };
  return { ...preview, fingerprint: httpEvalHash(preview) };
}
export function parseHttpEvalPlanPreview(value: unknown): HttpEvalPlanPreview {
  try {
  const s = httpEvalObject(copyHttpEvalJson(value), ["schemaVersion", "workspaceId", "draft", "head", "content", "recordByteAllowance", "fingerprint"]), c = httpEvalObject(s.content, ["schemaVersion", "draft", "dataset", "datasetFingerprint", "evalSets", "items", "samples", "target", "policy", "fingerprint"]);
  const result = resolveHttpEvalPlanPreview({ workspaceId: httpEvalText(s.workspaceId), draft: s.draft, head: s.head as HttpEvalPlanHead | null, dataset: c.dataset, evalSets: c.evalSets as ResolveHttpEvalPlanInput["evalSets"] });
  if (!httpEvalSame(result, s)) return httpEvalFail("http_eval_plan_corrupt"); return result;
  } catch { return httpEvalFail("http_eval_plan_corrupt"); }
}
export function prepareHttpEvalPlanVersionRecord(input: PrepareHttpEvalPlanRecordInput): HttpEvalPlanVersionRecord {
  const request = prepareHttpEvalPlanSaveRequest(input.request), preview = resolveHttpEvalPlanPreview({ ...input, draft: request.draft });
  if (request.expectedPreviewFingerprint !== preview.fingerprint) return httpEvalFail("http_eval_preview_stale", 409);
  const base = { schemaVersion: "http-eval-plan-record-v1" as const, workspaceId: preview.workspaceId, storage: httpEvalPlanStorageIds(preview.workspaceId, request.draft.planId, request.draft.versionId), createdAt: httpEvalTimestamp(input.createdAt), head: preview.head, content: preview.content, previewFingerprint: preview.fingerprint, requestFingerprint: httpEvalPlanRequestFingerprint(preview.workspaceId, request) };
  const result = { ...base, fingerprint: httpEvalHash(base) }; copyHttpEvalJson(result); return result;
}
export function parseHttpEvalPlanVersionRecord(value: unknown): HttpEvalPlanVersionRecord {
  try {
  const s = httpEvalObject(copyHttpEvalJson(value), ["schemaVersion", "workspaceId", "storage", "createdAt", "head", "content", "previewFingerprint", "requestFingerprint", "fingerprint"]), c = httpEvalObject(s.content, ["schemaVersion", "draft", "dataset", "datasetFingerprint", "evalSets", "items", "samples", "target", "policy", "fingerprint"]);
  const result = prepareHttpEvalPlanVersionRecord({ workspaceId: httpEvalText(s.workspaceId), request: { schemaVersion: "http-eval-plan-save-v1", draft: c.draft, expectedPreviewFingerprint: s.previewFingerprint }, dataset: c.dataset, evalSets: c.evalSets as ResolveHttpEvalPlanInput["evalSets"], head: s.head as HttpEvalPlanHead | null, createdAt: httpEvalTimestamp(s.createdAt) });
  if (!httpEvalSame(result, s)) return httpEvalFail("http_eval_plan_corrupt"); return result;
  } catch { return httpEvalFail("http_eval_plan_corrupt"); }
}
export function httpEvalPlanHeadFromRecord(value: unknown): HttpEvalPlanHead { const r = parseHttpEvalPlanVersionRecord(value), d = r.content.draft; return { planId: d.planId, versionId: d.versionId, version: d.version, name: d.name, fingerprint: r.fingerprint }; }

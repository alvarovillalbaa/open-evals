import { stableHash, stableStringify } from "./hash";
import { parseProvidedOutputDatasetSnapshot, parseProvidedOutputEvalSetSource } from "./provided-output-runs";
import type { JsonValue, EvalItemVersion } from "./types";
import type { HttpEvalPlanHead, ResolveHttpEvalPlanInput, PrepareHttpEvalPlanRecordInput } from "./http-eval-types";
import type { AnyHttpEvalPlanDraft as HttpEvalPlanDraft, AnyHttpEvalPlanSaveRequest as HttpEvalPlanSaveRequest, AnyHttpEvalPlanContent as HttpEvalPlanContent, AnyHttpEvalPlanPreview as HttpEvalPlanPreview, AnyHttpEvalPlanVersionRecord as HttpEvalPlanVersionRecord, AnyHttpEvalPlanHead, HttpEvalPlanFamily } from "./eval-composition-types";
import { parseCustomEvalSetContractV3, parseCustomEvalItemContractV3 } from "./eval-matching";
import type { MatchingHttpEvalSetRef as HttpEvalSetRef, MatchingHttpEvalResolvedSet as HttpEvalResolvedSetV2 } from "./eval-matching-types";
import { parseCustomEvalSetContractV2 } from "./eval-composition";
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
const profileTagsV1 = {
  draft: "http-eval-plan-draft-v1", save: "http-eval-plan-save-v1", preview: "http-eval-plan-preview-v1",
  content: "http-target-eval-v1", planRecord: "http-eval-plan-record-v1", planStorage: "http-eval-plan-storage-v1",
  saveFingerprint: "http-eval-plan-save-fingerprint-v1", start: "http-eval-start-v1", startFingerprint: "http-eval-start-fingerprint-v1",
  ledger: "http-eval-run-ledger-v1", rowEvent: "http-eval-row-event-v1", rowEventStorage: "http-eval-row-event-storage-v1",
  execution: "http-eval-execution-v1", runRecord: "http-eval-run-record-v1", thresholds: "http-eval-thresholds-v1"
} as const;
const profileTagsV2 = {
  draft: "http-eval-plan-draft-v2", save: "http-eval-plan-save-v2", preview: "http-eval-plan-preview-v2",
  content: "http-target-eval-v2", planRecord: "http-eval-plan-record-v2", planStorage: "http-eval-plan-storage-v2",
  saveFingerprint: "http-eval-plan-save-fingerprint-v2", start: "http-eval-start-v2", startFingerprint: "http-eval-start-fingerprint-v2",
  ledger: "http-eval-run-ledger-v2", rowEvent: "http-eval-row-event-v2", rowEventStorage: "http-eval-row-event-storage-v2",
  execution: "http-eval-execution-v2", runRecord: "http-eval-run-record-v2", thresholds: "http-eval-thresholds-v2"
} as const;
const profileTagsV3 = {
  draft: "http-eval-plan-draft-v3", save: "http-eval-plan-save-v3", preview: "http-eval-plan-preview-v3",
  content: "http-target-eval-v3", planRecord: "http-eval-plan-record-v3", planStorage: "http-eval-plan-storage-v3",
  saveFingerprint: "http-eval-plan-save-fingerprint-v3", start: "http-eval-start-v3", startFingerprint: "http-eval-start-fingerprint-v3",
  ledger: "http-eval-run-ledger-v3", rowEvent: "http-eval-row-event-v3", rowEventStorage: "http-eval-row-event-storage-v3",
  execution: "http-eval-execution-v3", runRecord: "http-eval-run-record-v3", thresholds: "http-eval-thresholds-v3"
} as const;
export function httpEvalProfileTags(profile: unknown): typeof profileTagsV1 | typeof profileTagsV2 | typeof profileTagsV3 {
  if (profile === "http-target-eval-v1") return profileTagsV1;
  if (profile === "http-target-eval-v2") return profileTagsV2;
  if (profile === "http-target-eval-v3") return profileTagsV3;
  return httpEvalFail("http_eval_profile_invalid");
}
export function httpEvalDraftFamily(draft: HttpEvalPlanDraft): HttpEvalPlanFamily {
  if (draft.schemaVersion === "http-eval-plan-draft-v1") return "http-target-eval-v1";
  if (draft.schemaVersion === "http-eval-plan-draft-v2") return "http-target-eval-v2";
  if (draft.schemaVersion === "http-eval-plan-draft-v3") return "http-target-eval-v3";
  return httpEvalFail("http_eval_profile_invalid");
}
export function prepareHttpEvalSetRef(value: unknown): HttpEvalSetRef {
  const s = httpEvalObject(copyHttpEvalJson(value, HTTP_EVAL_LIMITS.requestBytes), ["schemaVersion", "setId", "versionId", "fingerprint"]);
  if (s.schemaVersion !== "custom-eval-set-ref-v1" && s.schemaVersion !== "custom-eval-set-ref-v2" && s.schemaVersion !== "custom-eval-set-ref-v3") return httpEvalFail();
  return { schemaVersion: s.schemaVersion, setId: httpEvalUuid(s.setId), versionId: httpEvalUuid(s.versionId), fingerprint: httpEvalDigest(s.fingerprint) };
}
function refKey(ref: HttpEvalSetRef): string { return ref.schemaVersion + "/" + ref.setId + "/" + ref.versionId; }
function compositionSet(value: unknown, workspaceId: string): HttpEvalResolvedSetV2 {
  const s = httpEvalObject(copyHttpEvalJson(value), ["ref", "contract", "members", "sourceRecordFingerprint"]), ref = prepareHttpEvalSetRef(s.ref);
  if (ref.schemaVersion === "custom-eval-set-ref-v1") {
    const source = parseProvidedOutputEvalSetSource({ contract: s.contract, members: s.members });
    if (source.contract.setId !== ref.setId || source.contract.id !== ref.versionId || source.contract.fingerprint !== ref.fingerprint || s.sourceRecordFingerprint !== null) return httpEvalFail("http_eval_sources_invalid");
    return { ref, ...source, sourceRecordFingerprint: null };
  }
  const contract = ref.schemaVersion === "custom-eval-set-ref-v3" ? parseCustomEvalSetContractV3(s.contract, workspaceId) : parseCustomEvalSetContractV2(s.contract, workspaceId);
  if (contract.authoring.setId !== ref.setId || contract.authoring.versionId !== ref.versionId || contract.fingerprint !== ref.fingerprint || !httpEvalSame(contract.memberProofs, s.members)) return httpEvalFail("http_eval_sources_invalid");
  return { ref, contract, members: contract.memberProofs, sourceRecordFingerprint: httpEvalDigest(s.sourceRecordFingerprint) } as HttpEvalResolvedSetV2;
}
export function prepareHttpEvalPlanDraft(value: unknown): HttpEvalPlanDraft {
  const copied = copyHttpEvalJson(value, HTTP_EVAL_LIMITS.requestBytes), tag = copied && typeof copied === "object" && !Array.isArray(copied) ? copied.schemaVersion : null;
  if (tag !== "http-eval-plan-draft-v1" && tag !== "http-eval-plan-draft-v2" && tag !== "http-eval-plan-draft-v3") return httpEvalFail();
  const selectionKey = tag === "http-eval-plan-draft-v1" ? "evalSetVersionIds" : "evalSetVersions";
  const s = httpEvalObject(copied, ["schemaVersion", "planId", "versionId", "version", "expectedVersionId", "name", "datasetVersionId", selectionKey, "target", "limits"]), selection = s[selectionKey];
  if (!Array.isArray(selection) || !selection.length || selection.length > HTTP_EVAL_LIMITS.sets) return httpEvalFail();
  const version = httpEvalInteger(s.version, 1, 2147483647), expectedVersionId = s.expectedVersionId === null ? null : httpEvalUuid(s.expectedVersionId), versionId = httpEvalUuid(s.versionId);
  if ((version === 1) !== (expectedVersionId === null) || expectedVersionId === versionId) return httpEvalFail();
  const ids = tag === "http-eval-plan-draft-v1" ? selection.map(httpEvalUuid).sort() : [];
  const refs = tag !== "http-eval-plan-draft-v1" ? selection.map(prepareHttpEvalSetRef).sort((a, b) => refKey(a) < refKey(b) ? -1 : refKey(a) > refKey(b) ? 1 : 0) : [];
  if (tag === "http-eval-plan-draft-v2" && refs.some(ref => ref.schemaVersion === "custom-eval-set-ref-v3")) return httpEvalFail("http_eval_profile_invalid");
  if (new Set(tag === "http-eval-plan-draft-v1" ? ids : refs.map(refKey)).size !== selection.length) return httpEvalFail();
  const target = httpEvalObject(s.target, ["targetId", "targetVersion", "endpoint", "timeoutMs"]), limits = httpEvalObject(s.limits, ["concurrency", "maxDurationSeconds"]);
  const endpoint = httpEvalText(target.endpoint, 4096); let url: URL; try { url = new URL(endpoint); } catch { return httpEvalFail("http_eval_endpoint_invalid"); }
  const hostname = url.hostname, labels = hostname.split("."), reserved = ["local", "localhost", "internal", "lan", "home", "onion", "test", "invalid", "example", "home.arpa"];
  if (url.protocol !== "https:" || url.port && url.port !== "443" || url.username || url.password || endpoint.includes("?") || endpoint.includes("#") || url.href !== endpoint
    || hostname.length > 253 || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    || reserved.some(suffix => hostname === suffix || hostname.endsWith(`.${suffix}`)) || /^[\d.]+$/.test(hostname)) return httpEvalFail("http_eval_endpoint_invalid");
  const common = { planId: httpEvalUuid(s.planId), versionId, version, expectedVersionId,
    name: httpEvalText(s.name, 4096).trim(), datasetVersionId: httpEvalText(s.datasetVersionId),
    target: { targetId: httpEvalText(target.targetId), targetVersion: httpEvalText(target.targetVersion), endpoint, timeoutMs: httpEvalInteger(target.timeoutMs, 500, 10000) },
    limits: { concurrency: httpEvalInteger(limits.concurrency, 1, 4), maxDurationSeconds: httpEvalInteger(limits.maxDurationSeconds, 5, 120) } };
  return tag === "http-eval-plan-draft-v1" ? { schemaVersion: tag, ...common, evalSetVersionIds: ids } : { schemaVersion: tag, ...common, evalSetVersions: refs } as HttpEvalPlanDraft;
}
export function prepareHttpEvalPlanSaveRequest(value: unknown): HttpEvalPlanSaveRequest {
  const s = httpEvalObject(copyHttpEvalJson(value, HTTP_EVAL_LIMITS.requestBytes), ["schemaVersion", "draft", "expectedPreviewFingerprint"]);
  const draft = prepareHttpEvalPlanDraft(s.draft), expectedPreviewFingerprint = httpEvalDigest(s.expectedPreviewFingerprint);
  if (draft.schemaVersion === "http-eval-plan-draft-v1" && s.schemaVersion === "http-eval-plan-save-v1") return { schemaVersion: s.schemaVersion, draft, expectedPreviewFingerprint };
  if (draft.schemaVersion === "http-eval-plan-draft-v2" && s.schemaVersion === "http-eval-plan-save-v2") return { schemaVersion: s.schemaVersion, draft, expectedPreviewFingerprint };
  if (draft.schemaVersion === "http-eval-plan-draft-v3" && s.schemaVersion === "http-eval-plan-save-v3") return { schemaVersion: s.schemaVersion, draft, expectedPreviewFingerprint };
  return httpEvalFail("http_eval_profile_invalid");
}
function head(value: unknown, family: HttpEvalPlanFamily): AnyHttpEvalPlanHead | null {
  if (value === null) return null; const s = httpEvalObject(copyHttpEvalJson(value), ["planId", "versionId", "version", "name", "fingerprint", ...(family !== "http-target-eval-v1" ? ["profile"] : [])]);
  const base = { planId: httpEvalUuid(s.planId), versionId: httpEvalUuid(s.versionId), version: httpEvalInteger(s.version, 1, 2147483647), name: httpEvalText(s.name, 4096), fingerprint: httpEvalDigest(s.fingerprint) };
  if (family === "http-target-eval-v1") return base;
  if (s.profile !== family) return httpEvalFail("http_eval_profile_invalid");
  return { ...base, profile: family };
}
export function httpEvalPlanStorageIds(workspaceId: string, planId: string, versionId: string) {
  workspaceId = httpEvalText(workspaceId); planId = httpEvalUuid(planId); versionId = httpEvalUuid(versionId);
  const key = httpEvalHash({ workspaceId, planId, versionId }); return { planId: `http_eval_plan_${httpEvalHash({ workspaceId, planId })}`, versionId: `http_eval_plan_version_${key}`, auditId: `audit_http_eval_plan_${key}` };
}
export function httpEvalPlanRequestFingerprint(workspaceId: string, request: unknown): string {
  const parsed = prepareHttpEvalPlanSaveRequest(request);
  return httpEvalHash({ schemaVersion: httpEvalProfileTags(httpEvalDraftFamily(parsed.draft)).saveFingerprint, workspaceId: httpEvalText(workspaceId), request: parsed });
}

export function httpEvalFieldKey(item: EvalItemVersion): "contains_expected" | "matches_expected" { return item.type === "exact_match" ? "matches_expected" : "contains_expected"; }
export function httpEvalEvaluator(item: EvalItemVersion): string { return item.type === "exact_match" ? "literal_exact_text_v1" : "case_insensitive_contains_v1"; }
export function httpEvalRationale(item: EvalItemVersion, passed: boolean): string {
  return item.type === "exact_match" ? passed ? "Output matches the configured text exactly." : "Output differs from the configured text."
    : passed ? "Configured text is present." : "Configured text is absent.";
}
function recordAllowance(content: HttpEvalPlanContent, workspaceId: string, parent: HttpEvalPlanHead | null): number {
  const tags = httpEvalProfileTags(content.schemaVersion);
  // Internal byte scaffold, never returned as domain data. Each field bounds the actual
  // serialized field; impossible combinations deliberately overbound failure/success cases.
  const fp = "f".repeat(64), time = "2000-01-01T00:00:00.000Z", uuid = "00000000-0000-4000-8000-000000000000", runId = `http_eval_run_${fp}`;
  const sampleIds = content.samples.map(s => s.rowId), itemIds = content.items.map(i => i.id), resultId = (rowId: string, itemId: string) => `http_eval_result_${httpEvalHash({ rowId, itemId })}`;
  const claim = (rowId: string) => ({ rowId, claimToken: uuid, claimedAt: time, requestFingerprint: fp });
  const plan = { schemaVersion: tags.planRecord, workspaceId, storage: httpEvalPlanStorageIds(workspaceId, content.draft.planId, content.draft.versionId), createdAt: time, head: parent, content, previewFingerprint: fp, requestFingerprint: fp, fingerprint: fp };
  const ledger = { schemaVersion: tags.ledger, workspaceId, publicRunId: uuid, runId, workflowId: `http_eval_workflow_${fp}`, planVersionId: plan.storage.versionId, planFingerprint: fp, requestFingerprint: fp, leaseToken: uuid, startedAt: time, deadlineAt: time, leaseExpiresAt: time, stopReason: "http_target_" + "x".repeat(100), status: "outcome_unknown", rows: sampleIds.map(rowId => ({ rowId, status: "outcome_unknown", claim: claim(rowId), eventId: `http_eval_event_${fp}`, eventFingerprint: fp })), fingerprint: fp };
  const events = sampleIds.map(rowId => ({ schemaVersion: tags.rowEvent, id: `http_eval_event_${fp}`, workspaceId, publicRunId: uuid, rowId, claim: claim(rowId), status: "outcome_unknown", completedAt: time,
    response: { schemaVersion: "http-json-target-response-v1", requestFingerprint: fp, output: "", usage: { inputTokens: 1000000000, outputTokens: 1000000000, totalTokens: 1000000000 }, costUsd: "x".repeat(32) }, rawResponseHash: fp, errorCode: "http_target_" + "x".repeat(100), fingerprint: fp }));
  const results = sampleIds.flatMap(rowId => content.items.map(item => ({ id: resultId(rowId, item.id), rowId, evalItemVersionId: item.id, originalOutput: { [httpEvalFieldKey(item)]: false }, fields: [{ key: httpEvalFieldKey(item), value: false, passed: false, decision: "hard_fail" }], conciseRationale: httpEvalRationale(item, true), evidenceRefs: [`http_eval_event_${fp}`], evaluatorVersion: item.fingerprint, provider: "local", model: httpEvalEvaluator(item), sourceOutputFingerprint: fp, fingerprint: fp })));
  const gates: unknown[] = [];
  function gate(level: string, scopeId: string, rows: string[], items: string[]) {
    gates.push({ id: `http_eval_gate_${fp}`, runId, level, scopeId, score: "x".repeat(32), passed: false, decision: "hard_fail", thresholdVersion: tags.thresholds + ":" + fp, formula: "x".repeat(160),
      reasons: ["coverage_incomplete", "threshold_failed", "critical_evaluator_failed"], failedCriticalComponents: items, sourceResultIds: rows.flatMap(rowId => items.map(itemId => resultId(rowId, itemId))).sort(), fingerprint: fp });
  }
  for (const rowId of sampleIds) { for (const itemId of itemIds) { gate("field", `${rowId}/${itemId}/${httpEvalFieldKey(content.items.find(item => item.id === itemId)!)}`, [rowId], [itemId]); gate("item_row", `${rowId}/${itemId}`, [rowId], [itemId]); } gate("row", rowId, [rowId], itemIds); }
  gate("dataset", content.dataset.version.id, sampleIds, itemIds);
  for (const set of content.evalSets) gate("eval_set", set.contract.id, sampleIds, set.members.map(m => m.evalItemVersionId));
  gate("target", content.target.fingerprint, sampleIds, itemIds); gate("criticality", "critical", sampleIds, itemIds); gate("run", runId, sampleIds, itemIds);
  // Replace each two-byte empty JSON string with the full 65536-byte output allowance
  // arithmetically, avoiding a multi-megabyte synthetic string allocation during readback.
  return httpEvalBytes(stableStringify({ schemaVersion: tags.runRecord, workspaceId, plan, ledger, events, execution: { schemaVersion: tags.execution, results, gates, fingerprint: fp }, fingerprint: fp })) + sampleIds.length * (HTTP_EVAL_LIMITS.responseBytes - 2);
}
export function resolveHttpEvalPlanPreview(input: ResolveHttpEvalPlanInput): HttpEvalPlanPreview {
  const workspaceId = httpEvalText(input.workspaceId), draft = prepareHttpEvalPlanDraft(input.draft), family = httpEvalDraftFamily(draft), parent = head(input.head, family), tags = httpEvalProfileTags(family);
  if (parent ? parent.planId !== draft.planId || draft.expectedVersionId !== parent.versionId || draft.version !== parent.version + 1 : draft.version !== 1 || draft.expectedVersionId !== null) return httpEvalFail("http_eval_plan_stale", 409);
  let dataset: HttpEvalPlanContent["dataset"], evalSets: HttpEvalPlanContent["evalSets"];
  try {
    dataset = parseProvidedOutputDatasetSnapshot(input.dataset);
    if (!Array.isArray(input.evalSets)) return httpEvalFail();
    if (draft.schemaVersion === "http-eval-plan-draft-v1") {
      if (input.evalSets.length !== draft.evalSetVersionIds.length) return httpEvalFail();
      const sources = input.evalSets.map(parseProvidedOutputEvalSetSource).sort((a, b) => a.contract.id < b.contract.id ? -1 : a.contract.id > b.contract.id ? 1 : 0);
      if (!httpEvalSame(sources.map(s => s.contract.id), draft.evalSetVersionIds)) return httpEvalFail();
      evalSets = sources;
    } else {
      if (input.evalSets.length !== draft.evalSetVersions.length) return httpEvalFail();
      const sources = input.evalSets.map(v => compositionSet(v, workspaceId)).sort((a, b) => refKey(a.ref) < refKey(b.ref) ? -1 : refKey(a.ref) > refKey(b.ref) ? 1 : 0);
      if (!httpEvalSame(sources.map(s => s.ref), draft.evalSetVersions)) return httpEvalFail();
      evalSets = sources;
    }
  } catch { return httpEvalFail("http_eval_sources_invalid"); }
  if (dataset.version.id !== draft.datasetVersionId) return httpEvalFail("http_eval_sources_invalid");
  const distinct = new Map<string, HttpEvalPlanContent["items"][number]>();
  for (const set of evalSets) for (const member of set.contract.itemVersions) {
    const item = member.item;
    const exact = family === "http-target-eval-v3" && item.type === "exact_match";
    if (exact) { try { parseCustomEvalItemContractV3(item, workspaceId); } catch { return httpEvalFail("http_eval_evaluator_unavailable"); } }
    if (!exact && (item.type !== "string_check" || typeof item.config.contains !== "string" || !item.config.contains.trim())
      || member.weight !== 1 || member.criticality !== "critical" || item.outputSchema.fields.length !== 1 || item.outputSchema.fields[0]?.key !== httpEvalFieldKey(item) || item.outputSchema.fields[0]?.type !== "boolean") return httpEvalFail("http_eval_evaluator_unavailable");
    const old = distinct.get(item.id); if (old && !httpEvalSame(old, item)) return httpEvalFail("http_eval_evaluator_conflict"); distinct.set(item.id, item);
  }
  const items = [...distinct.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0); if (!items.length || items.length > HTTP_EVAL_LIMITS.items) return httpEvalFail();
  const samples = dataset.rows.map(row => ({ rowId: "http_eval_row_" + httpEvalHash({ datasetVersionId: dataset.version.id, datasetRowId: row.id, fingerprint: httpEvalHash(row) }), datasetRowId: row.id, rowKey: row.rowKey, fingerprint: httpEvalHash(row) }));
  const base = { schemaVersion: tags.content, draft, dataset, datasetFingerprint: httpEvalHash(dataset), evalSets, items, samples,
    target: { ...draft.target, protocol: "http-json-target-v1" as const, fingerprint: httpEvalHash({ protocol: "http-json-target-v1", ...draft.target }) },
    policy: { evaluator: family === "http-target-eval-v3" ? "text_matching_v3" as const : "case_insensitive_contains_v1" as const, expectedOutputVisibility: "hidden" as const, maxTargetCalls: samples.length, maxJudgeCalls: 0 as const, codeVersion: tags.content } };
  const content = { ...base, fingerprint: httpEvalHash(base) } as HttpEvalPlanContent;
  const recordByteAllowance = recordAllowance(content, workspaceId, parent);
  if (recordByteAllowance > HTTP_EVAL_LIMITS.recordBytes) return httpEvalFail("http_eval_record_allowance_exceeded");
  const preview = { schemaVersion: tags.preview, workspaceId, draft, head: parent, content, recordByteAllowance,
    ...(draft.schemaVersion !== "http-eval-plan-draft-v1" ? { counts: { rowCount: samples.length, evalSetCount: evalSets.length, uniqueItemCount: items.length, resultPairs: samples.length * items.length, targetCalls: samples.length } } : {}) };
  return { ...preview, fingerprint: httpEvalHash(preview) } as HttpEvalPlanPreview;
}
export function parseHttpEvalPlanPreview(value: unknown): HttpEvalPlanPreview {
  try {
  const s = httpEvalObject(copyHttpEvalJson(value), ["schemaVersion", "workspaceId", "draft", "head", "content", "recordByteAllowance", "fingerprint"], ["counts"]), c = httpEvalObject(s.content, ["schemaVersion", "draft", "dataset", "datasetFingerprint", "evalSets", "items", "samples", "target", "policy", "fingerprint"]);
  const result = resolveHttpEvalPlanPreview({ workspaceId: httpEvalText(s.workspaceId), draft: s.draft, head: s.head as HttpEvalPlanHead | null, dataset: c.dataset, evalSets: c.evalSets as ResolveHttpEvalPlanInput["evalSets"] });
  if (!httpEvalSame(result, s)) return httpEvalFail("http_eval_plan_corrupt"); return result;
  } catch { return httpEvalFail("http_eval_plan_corrupt"); }
}
export function prepareHttpEvalPlanVersionRecord(input: PrepareHttpEvalPlanRecordInput): HttpEvalPlanVersionRecord {
  const request = prepareHttpEvalPlanSaveRequest(input.request), preview = resolveHttpEvalPlanPreview({ ...input, draft: request.draft });
  if (request.expectedPreviewFingerprint !== preview.fingerprint) return httpEvalFail("http_eval_preview_stale", 409);
  const base = { schemaVersion: httpEvalProfileTags(preview.content.schemaVersion).planRecord, workspaceId: preview.workspaceId, storage: httpEvalPlanStorageIds(preview.workspaceId, request.draft.planId, request.draft.versionId), createdAt: httpEvalTimestamp(input.createdAt), head: preview.head, content: preview.content, previewFingerprint: preview.fingerprint, requestFingerprint: httpEvalPlanRequestFingerprint(preview.workspaceId, request) };
  const result = { ...base, fingerprint: httpEvalHash(base) } as HttpEvalPlanVersionRecord; copyHttpEvalJson(result); return result;
}
export function parseHttpEvalPlanVersionRecord(value: unknown): HttpEvalPlanVersionRecord {
  try {
  const s = httpEvalObject(copyHttpEvalJson(value), ["schemaVersion", "workspaceId", "storage", "createdAt", "head", "content", "previewFingerprint", "requestFingerprint", "fingerprint"]), c = httpEvalObject(s.content, ["schemaVersion", "draft", "dataset", "datasetFingerprint", "evalSets", "items", "samples", "target", "policy", "fingerprint"]);
  const result = prepareHttpEvalPlanVersionRecord({ workspaceId: httpEvalText(s.workspaceId), request: { schemaVersion: httpEvalProfileTags(c.schemaVersion).save, draft: c.draft, expectedPreviewFingerprint: s.previewFingerprint }, dataset: c.dataset, evalSets: c.evalSets as ResolveHttpEvalPlanInput["evalSets"], head: s.head as HttpEvalPlanHead | null, createdAt: httpEvalTimestamp(s.createdAt) });
  if (!httpEvalSame(result, s)) return httpEvalFail("http_eval_plan_corrupt"); return result;
  } catch { return httpEvalFail("http_eval_plan_corrupt"); }
}
export function httpEvalPlanHeadFromRecord(value: unknown): AnyHttpEvalPlanHead {
  const r = parseHttpEvalPlanVersionRecord(value), d = r.content.draft, base = { planId: d.planId, versionId: d.versionId, version: d.version, name: d.name, fingerprint: r.fingerprint };
  return r.content.schemaVersion === "http-target-eval-v1" ? base : { ...base, profile: r.content.schemaVersion };
}

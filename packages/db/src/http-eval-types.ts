import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { DatasetJson, DatasetSnapshot } from "./dataset-snapshots";
import type { SavedCustomEvalVersion } from "./custom-evals";
import type { EvalCompositionItemRecord, EvalCompositionSetRecord, EvalCompositionMemberProof, EvalCompositionRestore } from "./eval-composition-types";
import { isDatabaseUnavailable } from "./service";

/** Structural trusted-core boundary; the database package has no runtime core dependency. */
export interface HttpEvalStoreDraftV1 {
  schemaVersion: "http-eval-plan-draft-v1";
  planId: string; versionId: string; version: number; expectedVersionId: string | null;
  name: string; datasetVersionId: string; evalSetVersionIds: string[];
  target: { targetId: string; targetVersion: string; endpoint: string; timeoutMs: number };
  limits: { concurrency: number; maxDurationSeconds: number };
}
export interface HttpEvalStoreSetRef { schemaVersion: "custom-eval-set-ref-v1" | "custom-eval-set-ref-v2"; setId: string; versionId: string; fingerprint: string }
export interface HttpEvalStoreDraftV2 extends Omit<HttpEvalStoreDraftV1,"schemaVersion"|"evalSetVersionIds"> {
  schemaVersion: "http-eval-plan-draft-v2"; evalSetVersions: HttpEvalStoreSetRef[];
}
export type HttpEvalStoreDraft = HttpEvalStoreDraftV1 | HttpEvalStoreDraftV2;
export type HttpEvalStoreFamily = "http-target-eval-v1" | "http-target-eval-v2";
export interface HttpEvalStoreCompositionReaders {
  restoreSet: EvalCompositionRestore<EvalCompositionSetRecord>;
  restoreItem: EvalCompositionRestore<EvalCompositionItemRecord>;
}
export interface HttpEvalStoreSaveRequest {
  schemaVersion: "http-eval-plan-save-v1" | "http-eval-plan-save-v2"; draft: HttpEvalStoreDraft; expectedPreviewFingerprint: string;
}
export interface HttpEvalStoreHead { planId: string; versionId: string; version: number; name: string; fingerprint: string; profile?: "http-target-eval-v2" }
export interface HttpEvalStorePlan {
  schemaVersion: "http-eval-plan-record-v1" | "http-eval-plan-record-v2"; workspaceId: string;
  storage: { planId: string; versionId: string; auditId: string };
  createdAt: string; head: HttpEvalStoreHead | null;
  content: {
    schemaVersion: HttpEvalStoreFamily; draft: HttpEvalStoreDraft; dataset: DatasetSnapshot;
    datasetFingerprint: string; evalSets: Array<{ contract: unknown; members: SavedCustomEvalVersion["members"] | EvalCompositionMemberProof[];
      ref?: HttpEvalStoreSetRef; sourceRecordFingerprint?: string | null }>;
    items: Array<{ id: string }>;
    samples: Array<{ rowId: string; datasetRowId: string; rowKey: string; fingerprint: string }>;
    target: HttpEvalStoreDraft["target"] & { protocol: "http-json-target-v1"; fingerprint: string };
    fingerprint: string;
  };
  previewFingerprint: string; requestFingerprint: string; fingerprint: string;
}
export interface HttpEvalStorePlanCallbacks<P extends HttpEvalStorePlan> {
  prepare(input: { workspaceId: string; request: unknown; dataset: unknown;
    evalSets: unknown[];
    head: HttpEvalStoreHead | null; createdAt: string }): P;
  parse(value: unknown): P;
  restoreSet?: HttpEvalStoreCompositionReaders["restoreSet"];
  restoreItem?: HttpEvalStoreCompositionReaders["restoreItem"];
}
export interface HttpEvalStoreStartRequest {
  schemaVersion: "http-eval-start-v1" | "http-eval-start-v2"; runId: string; planVersionId: string; expectedPlanFingerprint: string;
}
export interface HttpEvalStoreClaim { rowId: string; claimToken: string; claimedAt: string; requestFingerprint: string }
export type HttpEvalStoreRowStatus = "pending" | "claimed" | "succeeded" | "failed" | "outcome_unknown" | "not_sent";
export interface HttpEvalStoreLedger {
  schemaVersion: "http-eval-run-ledger-v1" | "http-eval-run-ledger-v2"; workspaceId: string; publicRunId: string;
  runId: string; workflowId: string; planVersionId: string; planFingerprint: string; requestFingerprint: string;
  leaseToken: string; startedAt: string; deadlineAt: string; leaseExpiresAt: string;
  stopReason: string | null;
  status: "running" | "completed" | "failed" | "interrupted" | "outcome_unknown";
  rows: Array<{ rowId: string; status: HttpEvalStoreRowStatus; claim: HttpEvalStoreClaim | null;
    eventId: string | null; eventFingerprint: string | null }>;
  fingerprint: string;
}
export interface HttpEvalStoreRowEvent {
  schemaVersion: "http-eval-row-event-v1" | "http-eval-row-event-v2"; id: string; workspaceId: string; publicRunId: string;
  rowId: string; claim: HttpEvalStoreClaim | null; status: "succeeded" | "failed" | "outcome_unknown" | "not_sent";
  completedAt: string;
  response: { schemaVersion: "http-json-target-response-v1"; requestFingerprint: string; output: DatasetJson;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }; costUsd?: number } | null;
  rawResponseHash: string | null; errorCode: string | null; fingerprint: string;
}
export interface HttpEvalStoreCall { endpoint: string; timeoutMs: number; body: string; requestFingerprint: string; idempotencyKey: string }
export interface HttpEvalStoreRun<P extends HttpEvalStorePlan = HttpEvalStorePlan> {
  schemaVersion: "http-eval-run-record-v1" | "http-eval-run-record-v2"; workspaceId: string; plan: P;
  ledger: HttpEvalStoreLedger; events: HttpEvalStoreRowEvent[];
  execution: { schemaVersion: "http-eval-execution-v1" | "http-eval-execution-v2"; results: unknown[]; gates: unknown[]; fingerprint: string };
  fingerprint: string;
}
export interface HttpEvalStoreRunCallbacks<P extends HttpEvalStorePlan, R extends HttpEvalStoreRun<P>> {
  parsePlan(value: unknown): P;
  create(input: { workspaceId: string; request: unknown; plan: unknown; startedAt: string; leaseToken: string }): HttpEvalStoreLedger;
  claim(input: { plan: unknown; ledger: unknown; rowId: string; leaseToken: string; claimToken: string; now: string }):
    { ledger: HttpEvalStoreLedger; claim: HttpEvalStoreClaim; request: HttpEvalStoreCall };
  finalize(input: { plan: unknown; ledger: unknown; rowId: string; claimToken: string; completedAt: string;
    responseText?: string; errorCode?: string; errorOutcome?: "not_sent" | "unknown" }):
    { ledger: HttpEvalStoreLedger; event: HttpEvalStoreRowEvent; results: unknown[] };
  recover(input: { plan: unknown; ledger: unknown; now: string }): { ledger: HttpEvalStoreLedger; events: HttpEvalStoreRowEvent[] };
  stop(input: { plan: unknown; ledger: unknown; now: string; leaseToken: string; reasonCode: string }): { ledger: HttpEvalStoreLedger; events: HttpEvalStoreRowEvent[] };
  build(input: { plan: unknown; ledger: unknown; events: HttpEvalStoreRowEvent[] }): R;
  parse(value: unknown): R;
}
export class HttpEvalStoreError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.name = "HttpEvalStoreError"; this.status = status; this.code = code; }
}
export const HTTP_RECORD_LIMIT = 16 * 1024 * 1024;
export function httpFail(status: number, code: string): never { throw new HttpEvalStoreError(status, code); }
export const httpConflict: () => never = () => httpFail(409, "http_eval_storage_conflict");
export function httpStable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(httpStable).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${httpStable(row[key])}`).join(",")}}`;
}
export const httpHash = (value: unknown) => createHash("sha256").update(httpStable(value)).digest("hex");
export function httpProfileVersion(value: { schemaVersion: string }): 1 | 2 {
  if (value.schemaVersion.endsWith("-v1")) return 1;
  if (value.schemaVersion.endsWith("-v2")) return 2;
  return httpConflict();
}
export function httpTag<T extends string>(base: T, version: 1 | 2): `${T}-v1` | `${T}-v2` { return `${base}-v${version}`; }
export const httpSame = (a: unknown, b: unknown) => httpStable(a) === httpStable(b);
export const httpWithoutFingerprint = (value: unknown) => Object.fromEntries(Object.entries(httpObject(value)).filter(([key]) => key !== "fingerprint"));
export function httpObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) httpConflict();
  return value as Record<string, unknown>;
}
export function httpText(value: unknown, maximum: number = 512): asserts value is string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > maximum || value.includes("\0")) httpFail(422, "http_eval_invalid");
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) httpFail(422, "http_eval_invalid");
    } else if (unit >= 0xdc00 && unit <= 0xdfff) httpFail(422, "http_eval_invalid");
  }
}
export function httpUuid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value)) httpFail(422, "http_eval_invalid");
}
export function httpFingerprint(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) httpFail(422, "http_eval_invalid");
}
export function httpIso(value: unknown): string {
  let text: unknown;
  try { text = value instanceof Date ? value.toISOString() : value; } catch { return httpConflict(); }
  if (typeof text !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(text)
    || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text) httpConflict();
  return text;
}
export function httpKeys(value: Record<string, unknown>, expected: string[]): void {
  if (!httpSame(Object.keys(value).sort(), [...expected].sort())) httpFail(422, "http_eval_invalid");
}
/** Validate descriptors before serialization; never invoke caller getters or toJSON. */
export function httpBounded(value: unknown, maximum: number = HTTP_RECORD_LIMIT): void {
  const path = new Set<object>(); let nodes = 0;
  const text = (value: string) => {
    if (Buffer.byteLength(value) > maximum || value.includes("\0")) httpFail(422, "http_eval_invalid");
    for (let i = 0; i < value.length; i++) {
      const unit = value.charCodeAt(i);
      if (unit >= 0xd800 && unit <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) httpFail(422, "http_eval_invalid"); }
      else if (unit >= 0xdc00 && unit <= 0xdfff) httpFail(422, "http_eval_invalid");
    }
  };
  const walk = (item: unknown, depth: number): void => {
    if (++nodes > 2_000_000 || depth > 64) httpFail(422, "http_eval_invalid");
    if (typeof item === "string") { text(item); return; }
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return;
    if (!item || typeof item !== "object" || path.has(item)) httpFail(422, "http_eval_invalid");
    const array = Array.isArray(item), proto = Object.getPrototypeOf(item);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) httpFail(422, "http_eval_invalid");
    const descriptors = Object.getOwnPropertyDescriptors(item), names = Reflect.ownKeys(descriptors);
    if (names.some(key => typeof key !== "string") || names.length > 200_001) httpFail(422, "http_eval_invalid");
    path.add(item);
    if (array && (names.length !== (item as unknown[]).length + 1 || descriptors.length?.value !== (item as unknown[]).length)) httpFail(422, "http_eval_invalid");
    for (const key of names as string[]) {
      if (array && key === "length") continue;
      const descriptor = descriptors[key]; text(key);
      if (!descriptor.enumerable || !("value" in descriptor)) httpFail(422, "http_eval_invalid");
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= (item as unknown[]).length)) httpFail(422, "http_eval_invalid");
      walk(descriptor.value, depth + 1);
    }
    path.delete(item);
  };
  try { walk(value, 0); if (Buffer.byteLength(httpStable(value)) > maximum) httpFail(422, "http_eval_invalid"); }
  catch (error) { if (error instanceof HttpEvalStoreError) throw error; httpFail(422, "http_eval_invalid"); }
}
export function httpParseRaw(raw: unknown, maximum: number = HTTP_RECORD_LIMIT): unknown {
  try { if (typeof raw !== "string" || Buffer.byteLength(raw) > 2 * maximum) httpConflict(); const value: unknown = JSON.parse(raw); httpBounded(value,maximum); return value; }
  catch { return httpConflict(); }
}
export async function httpOperation<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (isDatabaseUnavailable(error)) throw error;
    if (error && typeof error === "object" && "code" in error && ["23505", "23503", "40001", "40P01"].includes(String(error.code))) httpConflict();
    throw error;
  }
}
export async function httpWorkspace(client: PoolClient, workspaceId: string): Promise<void> {
  httpText(workspaceId);
  if (!(await client.query("select id from workspaces where id = $1 for update", [workspaceId])).rows.length) httpFail(404, "http_eval_not_found");
}
export async function httpClock(client: PoolClient): Promise<string> {
  return httpIso((await client.query<{ now: Date }>("select date_trunc('milliseconds', clock_timestamp()) as now")).rows[0]?.now);
}
export function httpPlanIds(workspaceId: string, planId: string, versionId: string) {
  const version = httpHash({ workspaceId, planId, versionId });
  return { planId: `http_eval_plan_${httpHash({ workspaceId, planId })}`, versionId: `http_eval_plan_version_${version}`, auditId: `audit_http_eval_plan_${version}` };
}
export function httpRunIds(workspaceId: string, runId: string) {
  const id = httpHash({ workspaceId, runId });
  return { runId: `http_eval_run_${id}`, workflowId: `http_eval_workflow_${id}`, auditId: `audit_http_eval_run_${id}`, reservationEventId: `http_eval_reserved_${id}` };
}
export const httpSampleId = (workspaceId: string, runId: string, rowId: string) => `http_eval_sample_${httpHash({ workspaceId, runId, rowId })}`;
export const httpEventId = (workspaceId: string, runId: string, rowId: string) => `http_eval_event_${httpHash({ workspaceId, runId, rowId })}`;
export const httpRunKey = (runId: string, version: 1 | 2 = 1) => `http-eval-run-v${version}:${runId}`;

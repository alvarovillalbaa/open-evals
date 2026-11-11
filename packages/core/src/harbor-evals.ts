import { randomUUID } from "node:crypto";
import { stableHash, stableStringify } from "./hash";
import { HarborTaskError, parseHarborTaskBundle, type HarborTaskBundle } from "./harbor-tasks";

export const HARBOR_RECORD_LIMIT = 7 * 1024 * 1024;
export interface HarborTaskDraft {
  taskId: string; versionId: string; version: number; expectedVersionId: string | null; name: string; bundle: HarborTaskBundle;
}
export interface HarborTaskVersion extends HarborTaskDraft {
  schemaVersion: "harbor-task-version-v1"; workspaceId: string; fingerprint: string;
}
export interface HarborAgent { name: string; model: string | null; kind: "reference" | "model" }
export interface HarborPlanDraft {
  planId: string; name: string; projectId: string;
  tasks: Array<{ taskId: string; versionId: string; fingerprint: string }>;
  agent: HarborAgent; reward: { key: string; minimum: number };
  taskTimeoutSeconds: number;
}
export interface HarborPlan {
  schemaVersion: "harbor-plan-v1"; workspaceId: string; draft: HarborPlanDraft; tasks: HarborTaskVersion[]; fingerprint: string;
}
export interface HarborResult {
  schemaVersion: "harbor-result-v1"; executionId: string; bundleFingerprint: string; runtime: "harbor/0.25.0";
  agent: HarborAgent; outcome: "completed" | "operational_error" | "unknown";
  nativeTrialId: string | null; nativeResultSha256: string | null; nativeChecksum: string | null;
  nativeAgent: { name: string; version: string; model: { name: string; provider: string | null } | null } | null;
  startedAt: string | null; finishedAt: string | null; nativeRewardValid: boolean;
  rewards: Record<string, number> | null; exceptionType: string | null; errorCode: string | null;
}
export interface HarborRunRow {
  versionId: string; executionId: string; status: "pending" | "claimed" | "reported" | "unknown" | "not_sent";
  claimId: string | null; claimedAt: string | null; result: HarborResult | null; qualityPassed: boolean | null;
}
export interface HarborRun {
  schemaVersion: "harbor-run-v1"; workspaceId: string; runId: string; planId: string; planFingerprint: string;
  projectId: string; createdAt: string; deadlineAt: string; status: "reserved" | "active" | "completed" | "unknown";
  rows: HarborRunRow[]; fingerprint: string;
}
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
const fail = (code: string): never => { throw new HarborTaskError(code); };
export function harborBoundedJson(value: unknown, maximum = HARBOR_RECORD_LIMIT): unknown {
  let nodes = 0, bytes = 0;
  const active = new Set<object>();
  const walk = (item: unknown, depth: number): unknown => {
    if (++nodes > 50000 || depth > 20) return fail("harbor_record_limit");
    if (typeof item === "string") { bytes += Buffer.byteLength(item) + 2; if (bytes > maximum) return fail("harbor_record_limit"); return item; }
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return item;
    if (!item || typeof item !== "object" || active.has(item)) return fail("harbor_invalid_record");
    active.add(item);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(item);
      if (Object.getOwnPropertySymbols(item).length || Object.keys(descriptors).length > 1024) return fail("harbor_invalid_record");
      if (Array.isArray(item)) {
        if (Object.keys(descriptors).length !== item.length + 1) return fail("harbor_invalid_record");
        return Array.from({ length: item.length }, (_, i) => {
          const entry = descriptors[String(i)];
          if (!entry?.enumerable || !("value" in entry)) return fail("harbor_invalid_record");
          return walk(entry.value, depth + 1);
        });
      }
      const result = Object.create(null) as Record<string, unknown>;
      for (const [key, entry] of Object.entries(descriptors)) {
        if (!entry.enumerable || !("value" in entry)) return fail("harbor_invalid_record");
        bytes += Buffer.byteLength(key) + 3;
        if (bytes > maximum) return fail("harbor_record_limit");
        result[key] = walk(entry.value, depth + 1);
      }
      return result;
    } finally { active.delete(item); }
  };
  const copy = walk(value, 0);
  if (Buffer.byteLength(stableStringify(copy)) > maximum) return fail("harbor_record_limit");
  return copy;
}
function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("harbor_invalid_record");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")) fail("harbor_invalid_record");
}
function str(value: unknown, maximum = 200): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > maximum
    || [...value].some(char => { const code = char.codePointAt(0)!; return code < 32 || code >= 0xd800 && code <= 0xdfff; })) return fail("harbor_invalid_text");
  return value;
}
export function harborUuid(value: unknown): string { const s = str(value, 36); if (!UUID.test(s)) return fail("harbor_invalid_id"); return s; }
function hex(value: unknown): string { const s = str(value, 64); if (!HEX.test(s)) return fail("harbor_invalid_fingerprint"); return s; }
function number(value: unknown, min: number, max: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) return fail("harbor_invalid_number");
  return value;
}
function clock(value: unknown): string {
  const s = str(value, 30);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== s) return fail("harbor_invalid_clock");
  return s;
}
function sealed<T extends object>(value: T): T & { fingerprint: string } { harborBoundedJson(value); return { ...value, fingerprint: stableHash(value, 64) }; }
function verify(value: Record<string, unknown>) { const { fingerprint, ...content } = value; if (hex(fingerprint) !== stableHash(content, 64)) fail("harbor_record_integrity"); }
export function parseHarborAgent(value: unknown): HarborAgent {
  const a = obj(value); keys(a, ["name", "model", "kind"]);
  const name = str(a.name, 48), reference = ["oracle", "nop"].includes(name);
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(name) || a.kind !== (reference ? "reference" : "model")) return fail("harbor_invalid_agent");
  if (reference && a.model !== null || !reference && (typeof a.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(a.model))) return fail("harbor_invalid_model");
  return { name, model: reference ? null : a.model as string, kind: reference ? "reference" : "model" };
}
export function prepareHarborTask(workspaceId: string, value: unknown): HarborTaskVersion {
  const d = obj(harborBoundedJson(value, 2 * 1024 * 1024));
  keys(d, ["taskId", "versionId", "version", "expectedVersionId", "name", "bundle"]);
  const taskId = harborUuid(d.taskId), versionId = harborUuid(d.versionId), version = number(d.version, 1, 10000, true);
  const expectedVersionId = d.expectedVersionId === null ? null : harborUuid(d.expectedVersionId);
  if ((version === 1) !== (expectedVersionId === null) || versionId === expectedVersionId) return fail("harbor_invalid_parent");
  return sealed({ schemaVersion: "harbor-task-version-v1" as const, workspaceId: str(workspaceId), taskId, versionId, version,
    expectedVersionId, name: str(d.name, 160), bundle: parseHarborTaskBundle(d.bundle) });
}
export function parseHarborTaskVersion(value: unknown): HarborTaskVersion {
  const row = obj(harborBoundedJson(value));
  keys(row, ["schemaVersion", "workspaceId", "taskId", "versionId", "version", "expectedVersionId", "name", "bundle", "fingerprint"]);
  if (row.schemaVersion !== "harbor-task-version-v1") return fail("harbor_invalid_record");
  const { schemaVersion: _schema, workspaceId, fingerprint: _fingerprint, ...draft } = row;
  const prepared = prepareHarborTask(str(workspaceId), draft);
  if (prepared.fingerprint !== row.fingerprint) return fail("harbor_record_integrity");
  return prepared;
}
export function parseHarborPlanDraft(value: unknown): HarborPlanDraft {
  const d = obj(harborBoundedJson(value, 65536)); keys(d, ["planId", "name", "projectId", "tasks", "agent", "reward", "taskTimeoutSeconds"]);
  if (!Array.isArray(d.tasks) || !d.tasks.length || d.tasks.length > 4) return fail("harbor_task_selection_limit");
  const tasks = d.tasks.map(value => { const t = obj(value); keys(t, ["taskId", "versionId", "fingerprint"]);
    return { taskId: harborUuid(t.taskId), versionId: harborUuid(t.versionId), fingerprint: hex(t.fingerprint) }; });
  if (new Set(tasks.map(t => t.versionId)).size !== tasks.length) return fail("harbor_duplicate_selection");
  const reward = obj(d.reward); keys(reward, ["key", "minimum"]);
  const key = str(reward.key, 64); if (!/^[A-Za-z0-9_.-]+$/.test(key)) return fail("harbor_invalid_reward");
  return { planId: harborUuid(d.planId), name: str(d.name, 160), projectId: str(d.projectId, 128), tasks,
    agent: parseHarborAgent(d.agent), reward: { key, minimum: number(reward.minimum, -1e9, 1e9) },
    taskTimeoutSeconds: number(d.taskTimeoutSeconds, 1, 900, true) };
}
export function prepareHarborPlan(workspaceId: string, value: unknown, snapshots: unknown[]): HarborPlan {
  const draft = parseHarborPlanDraft(value);
  if (snapshots.length !== draft.tasks.length) return fail("harbor_task_selection_mismatch");
  const tasks = snapshots.map(parseHarborTaskVersion);
  for (const [i, task] of tasks.entries()) {
    const selection = draft.tasks[i]!;
    if (task.workspaceId !== workspaceId || task.taskId !== selection.taskId || task.versionId !== selection.versionId || task.fingerprint !== selection.fingerprint) return fail("harbor_task_selection_mismatch");
  }
  return sealed({ schemaVersion: "harbor-plan-v1" as const, workspaceId: str(workspaceId), draft, tasks });
}
export function parseHarborPlan(value: unknown): HarborPlan {
  const p = obj(harborBoundedJson(value)); keys(p, ["schemaVersion", "workspaceId", "draft", "tasks", "fingerprint"]);
  if (p.schemaVersion !== "harbor-plan-v1" || !Array.isArray(p.tasks)) return fail("harbor_invalid_record");
  const plan = prepareHarborPlan(str(p.workspaceId), p.draft, p.tasks);
  if (plan.fingerprint !== p.fingerprint) return fail("harbor_record_integrity");
  return plan;
}
export function parseHarborResult(value: unknown, bundle: HarborTaskBundle, agent: HarborAgent, executionId: string): HarborResult {
  const r = obj(harborBoundedJson(value, 32768));
  keys(r, ["schemaVersion", "executionId", "bundleFingerprint", "runtime", "agent", "outcome", "nativeTrialId", "nativeResultSha256", "nativeChecksum", "nativeAgent", "startedAt", "finishedAt", "nativeRewardValid", "rewards", "exceptionType", "errorCode"]);
  if (r.schemaVersion !== "harbor-result-v1" || r.executionId !== executionId || r.bundleFingerprint !== bundle.fingerprint
    || r.runtime !== bundle.runtime || stableStringify(parseHarborAgent(r.agent)) !== stableStringify(agent)
    || !["completed", "operational_error", "unknown"].includes(String(r.outcome)) || typeof r.nativeRewardValid !== "boolean") return fail("harbor_result_identity_mismatch");
  for (const field of ["exceptionType", "errorCode"]) if (r[field] !== null && !/^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/.test(str(r[field], 120))) return fail("harbor_result_error_invalid");
  if (r.outcome === "unknown") {
    if ([r.nativeTrialId, r.nativeResultSha256, r.nativeChecksum, r.nativeAgent, r.startedAt, r.finishedAt, r.rewards].some(v => v !== null) || r.nativeRewardValid || r.exceptionType !== null || r.errorCode === null) return fail("harbor_unknown_result_invalid");
  } else {
    harborUuid(r.nativeTrialId); hex(r.nativeResultSha256);
    if (r.nativeChecksum !== bundle.nativeChecksum || clock(r.finishedAt) < clock(r.startedAt)) return fail("harbor_result_identity_mismatch");
    const actual = obj(r.nativeAgent); keys(actual, ["name", "version", "model"]);
    if (actual.name !== agent.name) return fail("harbor_result_identity_mismatch"); str(actual.version);
    if (agent.kind === "reference" && actual.model !== null || agent.kind === "model" && actual.model === null) return fail("harbor_result_model_missing");
    if (actual.model !== null) { const model = obj(actual.model); keys(model, ["name", "provider"]); str(model.name); if (model.provider !== null) str(model.provider); }
    if (r.rewards !== null) {
      const rewards = obj(r.rewards), names = Object.keys(rewards);
      if (!names.length || names.length > 32) return fail("harbor_invalid_rewards");
      for (const key of names) { if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) return fail("harbor_invalid_rewards"); number(rewards[key], -1e9, 1e9); }
    }
    if (r.outcome === "completed" && (r.exceptionType !== null || r.errorCode !== null || !r.nativeRewardValid || r.rewards === null)
      || r.outcome === "operational_error" && r.exceptionType === null && r.nativeRewardValid) return fail("harbor_invalid_outcome");
  }
  return JSON.parse(stableStringify(r)) as HarborResult;
}
export function createHarborRun(plan: HarborPlan, runId: string, now: string): HarborRun {
  plan = parseHarborPlan(plan); harborUuid(runId); clock(now);
  return sealed({ schemaVersion: "harbor-run-v1" as const, workspaceId: plan.workspaceId, runId, planId: plan.draft.planId,
    planFingerprint: plan.fingerprint, projectId: plan.draft.projectId, createdAt: now,
    deadlineAt: new Date(Date.parse(now) + (plan.draft.taskTimeoutSeconds + 30) * plan.tasks.length * 1000).toISOString(), status: "reserved" as const,
    rows: plan.tasks.map(task => ({ versionId: task.versionId, executionId: randomUUID(), status: "pending" as const,
      claimId: null, claimedAt: null, result: null, qualityPassed: null })) });
}
function runStatus(rows: HarborRunRow[]): HarborRun['status'] {
  return rows.every(r => r.status === "reported" || r.status === "unknown" || r.status === "not_sent")
    ? rows.some(r => r.status === "unknown") ? "unknown" : "completed"
    : rows.some(r => r.status !== "pending") ? "active" : "reserved";
}
export function parseHarborRun(value: unknown, plan: HarborPlan): HarborRun {
  const r = obj(harborBoundedJson(value, 262144));
  keys(r, ["schemaVersion", "workspaceId", "runId", "planId", "planFingerprint", "projectId", "createdAt", "deadlineAt", "status", "rows", "fingerprint"]);
  verify(r); harborUuid(r.runId);
  if (r.schemaVersion !== "harbor-run-v1" || r.workspaceId !== plan.workspaceId || r.planId !== plan.draft.planId
    || r.planFingerprint !== plan.fingerprint || r.projectId !== plan.draft.projectId || !Array.isArray(r.rows) || r.rows.length !== plan.tasks.length
    || clock(r.deadlineAt) !== new Date(Date.parse(clock(r.createdAt)) + (plan.draft.taskTimeoutSeconds + 30) * plan.tasks.length * 1000).toISOString()) return fail("harbor_run_identity_mismatch");
  const seen = new Set<string>();
  for (const [i, value] of r.rows.entries()) {
    const row = obj(value); keys(row, ["versionId", "executionId", "status", "claimId", "claimedAt", "result", "qualityPassed"]);
    const task = plan.tasks[i]!;
    if (row.versionId !== task.versionId || !["pending", "claimed", "reported", "unknown", "not_sent"].includes(String(row.status))) return fail("harbor_run_identity_mismatch");
    const id = harborUuid(row.executionId); if (seen.has(id)) return fail("harbor_run_identity_mismatch"); seen.add(id);
    if (row.claimId !== null) harborUuid(row.claimId);
    if (row.claimedAt !== null && (clock(row.claimedAt) < String(r.createdAt) || String(row.claimedAt) >= String(r.deadlineAt))) return fail("harbor_invalid_clock");
    if ((row.status === "pending" || row.status === "not_sent") && (row.claimId !== null || row.claimedAt !== null || row.result !== null)
      || ["claimed", "reported", "unknown"].includes(String(row.status)) && (row.claimId === null || row.claimedAt === null)
      || row.status === "claimed" && row.result !== null || row.status === "reported" && row.result === null) return fail("harbor_invalid_row_state");
    let passed: boolean | null = null;
    if (row.result !== null) {
      const result = parseHarborResult(row.result, task.bundle, plan.draft.agent, id);
      if (row.status !== (result.outcome === "unknown" ? "unknown" : "reported")) return fail("harbor_invalid_row_state");
      if (result.outcome === "completed") passed = result.rewards![plan.draft.reward.key] !== undefined && result.rewards![plan.draft.reward.key]! >= plan.draft.reward.minimum;
    }
    if (row.qualityPassed !== passed) return fail("harbor_invalid_quality_decision");
  }
  if (r.status !== runStatus(r.rows as unknown as HarborRunRow[])) return fail("harbor_invalid_run_status");
  return JSON.parse(stableStringify(r)) as HarborRun;
}
function revise(run: HarborRun): HarborRun { const { fingerprint: _old, ...content } = run; content.status = runStatus(content.rows); return sealed(content); }
export function claimHarborTask(run: HarborRun, plan: HarborPlan, versionId: string, claimId: string, now: string) {
  run = parseHarborRun(run, plan); harborUuid(claimId); clock(now);
  const row = run.rows.find(row => row.versionId === versionId); if (!row) return fail("harbor_task_not_selected");
  if (row.status !== "pending") {
    if (row.claimId === claimId) return { run, claimedNow: false };
    return fail("harbor_task_already_claimed");
  }
  if (now < run.createdAt || now >= run.deadlineAt) return fail("harbor_claim_deadline_reached");
  row.status = "claimed"; row.claimId = claimId; row.claimedAt = now;
  return { run: revise(run), claimedNow: true };
}
export function completeHarborTask(run: HarborRun, plan: HarborPlan, versionId: string, claimId: string, value: unknown) {
  run = parseHarborRun(run, plan); harborUuid(claimId);
  const index = run.rows.findIndex(row => row.versionId === versionId), row = run.rows[index];
  if (!row || row.claimId !== claimId) return fail("harbor_claim_mismatch");
  const result = parseHarborResult(value, plan.tasks[index]!.bundle, plan.draft.agent, row.executionId);
  if (row.result !== null) {
    if (stableStringify(row.result) === stableStringify(result)) return { run, replayed: true };
    return fail("harbor_completion_conflict");
  }
  if (row.status !== "claimed") return fail("harbor_completion_conflict");
  row.status = result.outcome === "unknown" ? "unknown" : "reported"; row.result = result;
  row.qualityPassed = result.outcome === "completed" ? result.rewards![plan.draft.reward.key] !== undefined && result.rewards![plan.draft.reward.key]! >= plan.draft.reward.minimum : null;
  return { run: revise(run), replayed: false };
}
export function recoverHarborRun(run: HarborRun, plan: HarborPlan) {
  run = parseHarborRun(run, plan);
  for (const row of run.rows) {
    if (row.status === "claimed") row.status = "unknown";
    else if (row.status === "pending") row.status = "not_sent";
  }
  return revise(run);
}

import { stableStringify, textHash } from "./hash";
import { HTTP_EVAL_LIMITS, httpEvalProfileTags, copyHttpEvalJson, parseHttpEvalJson, parseHttpEvalPlanVersionRecord, httpEvalBytes, httpEvalDigest, httpEvalFail, httpEvalHash, httpEvalInteger, httpEvalObject, httpEvalSame, httpEvalText, httpEvalTimestamp, httpEvalUuid } from "./http-eval-plans";
import type { GateResult, JsonValue } from "./types";
import type { HttpEvalLedgerRow, HttpEvalResult, HttpEvalCallBody, HttpEvalCallRequest, HttpEvalTargetResponse, CreateHttpEvalLedgerInput, ClaimHttpEvalRowInput, FinalizeHttpEvalRowInput, RecoverHttpEvalRunInput, StopHttpEvalRunInput } from "./http-eval-types";
import type { AnyHttpEvalStartRequest as HttpEvalStartRequest, AnyHttpEvalPlanVersionRecord as HttpEvalPlanVersionRecord, AnyHttpEvalRunLedger as HttpEvalRunLedger, AnyHttpEvalRowEvent as HttpEvalRowEvent, AnyHttpEvalExecution as HttpEvalExecution, AnyHttpEvalRunRecord as HttpEvalRunRecord, AnyHttpEvalFinalizedRow as HttpEvalFinalizedRow } from "./eval-composition-types";

const seal = <T extends object>(value: T): T & { fingerprint: string } => ({ ...value, fingerprint: httpEvalHash(value) });
const plus = (date: string, ms: number): string => new Date(Date.parse(date) + ms).toISOString();
const safeError = (value: unknown): string => typeof value === "string" && /^(?:http_eval|http_target)_[a-z0-9_]{1,100}$/.test(value) ? value : httpEvalFail("http_eval_error_code_invalid");
export function prepareHttpEvalStartRequest(value: unknown): HttpEvalStartRequest {
  const s = httpEvalObject(copyHttpEvalJson(value, HTTP_EVAL_LIMITS.requestBytes), ["schemaVersion", "runId", "planVersionId", "expectedPlanFingerprint"]);
  if (s.schemaVersion !== "http-eval-start-v1" && s.schemaVersion !== "http-eval-start-v2" || typeof s.planVersionId !== "string" || !/^http_eval_plan_version_[0-9a-f]{64}$/.test(s.planVersionId)) return httpEvalFail();
  return { schemaVersion: s.schemaVersion, runId: httpEvalUuid(s.runId), planVersionId: s.planVersionId, expectedPlanFingerprint: httpEvalDigest(s.expectedPlanFingerprint) };
}
export function httpEvalRunStorageIds(workspaceId: string, runId: string) {
  const key = httpEvalHash({ workspaceId: httpEvalText(workspaceId), runId: httpEvalUuid(runId) });
  return { runId: `http_eval_run_${key}`, workflowId: `http_eval_workflow_${key}`, auditId: `audit_http_eval_run_${key}`, reservationEventId: `http_eval_reserved_${key}` };
}
export function httpEvalSampleId(workspaceId: string, runId: string, rowId: string): string { return `http_eval_sample_${httpEvalHash({ workspaceId: httpEvalText(workspaceId), runId: httpEvalUuid(runId), rowId: httpEvalText(rowId) })}`; }
export function httpEvalRowEventId(workspaceId: string, runId: string, rowId: string): string { return `http_eval_event_${httpEvalHash({ workspaceId: httpEvalText(workspaceId), runId: httpEvalUuid(runId), rowId: httpEvalText(rowId) })}`; }
export function httpEvalResultId(workspaceId: string, runId: string, rowId: string, evalItemVersionId: string): string { return `http_eval_result_${httpEvalHash({ workspaceId: httpEvalText(workspaceId), runId: httpEvalUuid(runId), rowId: httpEvalText(rowId), evalItemVersionId: httpEvalText(evalItemVersionId) })}`; }
export function httpEvalGateId(workspaceId: string, runId: string, level: string, scopeId: string): string { return `http_eval_gate_${httpEvalHash({ workspaceId: httpEvalText(workspaceId), runId: httpEvalUuid(runId), level: httpEvalText(level), scopeId: httpEvalText(scopeId, 4096) })}`; }
export function httpEvalStartFingerprint(workspaceId: string, request: unknown): string {
  const parsed = prepareHttpEvalStartRequest(request), tags = httpEvalProfileTags(parsed.schemaVersion === "http-eval-start-v1" ? "http-target-eval-v1" : "http-target-eval-v2");
  return httpEvalHash({ schemaVersion: tags.startFingerprint, workspaceId: httpEvalText(workspaceId), request: parsed });
}
function runStatus(rows: HttpEvalLedgerRow[], stopReason: string | null): HttpEvalRunLedger["status"] {
  if (rows.some(r => r.status === "pending" || r.status === "claimed")) return "running";
  if (rows.some(r => r.status === "outcome_unknown")) return "outcome_unknown";
  if (rows.some(r => r.status === "not_sent")) return stopReason ? "failed" : "interrupted";
  return rows.some(r => r.status === "failed") ? "failed" : "completed";
}
function ledgerWith(ledger: HttpEvalRunLedger, rows: HttpEvalLedgerRow[], stopReason = ledger.stopReason): HttpEvalRunLedger {
  const { fingerprint: _, ...base } = ledger; return seal({ ...base, rows, stopReason, status: runStatus(rows, stopReason) });
}
export function createHttpEvalRunLedger(input: CreateHttpEvalLedgerInput): HttpEvalRunLedger {
  const plan = parseHttpEvalPlanVersionRecord(input.plan), request = prepareHttpEvalStartRequest(input.request), workspaceId = httpEvalText(input.workspaceId), startedAt = httpEvalTimestamp(input.startedAt);
  if (request.schemaVersion !== httpEvalProfileTags(plan.content.schemaVersion).start || workspaceId !== plan.workspaceId || request.planVersionId !== plan.storage.versionId || request.expectedPlanFingerprint !== plan.fingerprint) return httpEvalFail("http_eval_plan_conflict", 409);
  const ids = httpEvalRunStorageIds(workspaceId, request.runId), deadlineAt = plus(startedAt, plan.content.draft.limits.maxDurationSeconds * 1000);
  return seal({ schemaVersion: httpEvalProfileTags(plan.content.schemaVersion).ledger, workspaceId, publicRunId: request.runId, runId: ids.runId, workflowId: ids.workflowId,
    planVersionId: plan.storage.versionId, planFingerprint: plan.fingerprint, requestFingerprint: httpEvalStartFingerprint(workspaceId, request), leaseToken: httpEvalUuid(input.leaseToken), startedAt,
    deadlineAt, leaseExpiresAt: plus(deadlineAt, HTTP_EVAL_LIMITS.recoveryGraceMs), stopReason: null, status: "running" as const,
    rows: plan.content.samples.map(s => ({ rowId: s.rowId, status: "pending" as const, claim: null, eventId: null, eventFingerprint: null })) });
}
function callBody(plan: HttpEvalPlanVersionRecord, publicRunId: string, rowId: string): HttpEvalCallBody {
  const sample = plan.content.samples.find(s => s.rowId === rowId), row = sample && plan.content.dataset.rows.find(r => r.id === sample.datasetRowId);
  if (!row) return httpEvalFail("http_eval_row_unknown");
  const base = { schemaVersion: "http-json-target-request-v1" as const, runId: publicRunId, rowId, input: row.input,
    ...(row.context.present ? { context: row.context.value } : {}), ...(row.history.present ? { history: row.history.value } : {}) };
  return { ...base, requestFingerprint: httpEvalHash({ schemaVersion: "http-json-target-request-fingerprint-v1", workspaceId: plan.workspaceId, planFingerprint: plan.fingerprint, body: base }) };
}
export function parseHttpEvalRunLedger(value: unknown, planValue: unknown): HttpEvalRunLedger {
  try {
  const plan = parseHttpEvalPlanVersionRecord(planValue), s = httpEvalObject(copyHttpEvalJson(value), ["schemaVersion", "workspaceId", "publicRunId", "runId", "workflowId", "planVersionId", "planFingerprint", "requestFingerprint", "leaseToken", "startedAt", "deadlineAt", "leaseExpiresAt", "stopReason", "status", "rows", "fingerprint"]);
  const initial = createHttpEvalRunLedger({ workspaceId: httpEvalText(s.workspaceId), request: { schemaVersion: httpEvalProfileTags(plan.content.schemaVersion).start, runId: s.publicRunId, planVersionId: s.planVersionId, expectedPlanFingerprint: s.planFingerprint }, plan, startedAt: httpEvalTimestamp(s.startedAt), leaseToken: httpEvalUuid(s.leaseToken) });
  if (!Array.isArray(s.rows) || s.rows.length !== initial.rows.length) return httpEvalFail("http_eval_ledger_corrupt");
  const stopReason = s.stopReason === null ? null : safeError(s.stopReason);
  const tokens = new Set<string>();
  const rows: HttpEvalLedgerRow[] = s.rows.map((raw, index) => {
    const r = httpEvalObject(raw, ["rowId", "status", "claim", "eventId", "eventFingerprint"]); if (r.rowId !== initial.rows[index]!.rowId || typeof r.status !== "string" || !["pending", "claimed", "succeeded", "failed", "outcome_unknown", "not_sent"].includes(r.status)) return httpEvalFail("http_eval_ledger_corrupt");
    const status = r.status as HttpEvalLedgerRow["status"]; let claim: HttpEvalLedgerRow["claim"] = null;
    if (r.claim !== null) { const c = httpEvalObject(r.claim, ["rowId", "claimToken", "claimedAt", "requestFingerprint"]), claimedAt = httpEvalTimestamp(c.claimedAt), claimToken = httpEvalUuid(c.claimToken);
      if (c.rowId !== r.rowId || c.requestFingerprint !== callBody(plan, initial.publicRunId, r.rowId as string).requestFingerprint || Date.parse(claimedAt) < Date.parse(initial.startedAt) || Date.parse(claimedAt) >= Date.parse(initial.deadlineAt) || tokens.has(claimToken)) return httpEvalFail("http_eval_ledger_corrupt"); tokens.add(claimToken);
      claim = { rowId: r.rowId as string, claimToken, claimedAt, requestFingerprint: httpEvalDigest(c.requestFingerprint) };
    }
    const terminal = !["pending", "claimed"].includes(status);
    if (status === "pending" && (claim !== null || stopReason !== null) || status !== "pending" && status !== "not_sent" && claim === null
      || (terminal ? r.eventId !== httpEvalRowEventId(initial.workspaceId, initial.publicRunId, r.rowId as string) || typeof r.eventFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(r.eventFingerprint) : r.eventId !== null || r.eventFingerprint !== null)) return httpEvalFail("http_eval_ledger_corrupt");
    return { rowId: r.rowId as string, status, claim, eventId: terminal ? r.eventId as string : null, eventFingerprint: terminal ? r.eventFingerprint as string : null };
  });
  if (rows.filter(r => r.status === "claimed").length > plan.content.draft.limits.concurrency) return httpEvalFail("http_eval_ledger_corrupt");
  const result = ledgerWith(initial, rows, stopReason); if (!httpEvalSame(result, s)) return httpEvalFail("http_eval_ledger_corrupt"); return result;
  } catch { return httpEvalFail("http_eval_ledger_corrupt"); }
}
export function buildHttpEvalCallRequest(planValue: unknown, ledgerValue: unknown, rowId: string, now: string): HttpEvalCallRequest {
  const plan = parseHttpEvalPlanVersionRecord(planValue), ledger = parseHttpEvalRunLedger(ledgerValue, plan), body = callBody(plan, ledger.publicRunId, httpEvalText(rowId)), remaining = Date.parse(ledger.deadlineAt) - Date.parse(httpEvalTimestamp(now));
  if (remaining < 500 || Date.parse(now) < Date.parse(ledger.startedAt)) return httpEvalFail("http_eval_deadline_reached", 409);
  const serialized = stableStringify(body); if (httpEvalBytes(serialized) > HTTP_EVAL_LIMITS.callBytes) return httpEvalFail("http_eval_request_too_large");
  return { endpoint: plan.content.target.endpoint, timeoutMs: Math.min(plan.content.target.timeoutMs, remaining), body: serialized, requestFingerprint: body.requestFingerprint, idempotencyKey: body.requestFingerprint };
}
export function claimHttpEvalRow(input: ClaimHttpEvalRowInput) {
  const plan = parseHttpEvalPlanVersionRecord(input.plan), ledger = parseHttpEvalRunLedger(input.ledger, plan), rowId = httpEvalText(input.rowId), now = httpEvalTimestamp(input.now);
  if (httpEvalUuid(input.leaseToken) !== ledger.leaseToken || ledger.status !== "running" || ledger.stopReason !== null || !ledger.rows.some(r => r.rowId === rowId && r.status === "pending") || ledger.rows.filter(r => r.status === "claimed").length >= plan.content.draft.limits.concurrency) return httpEvalFail("http_eval_claim_conflict", 409);
  const request = buildHttpEvalCallRequest(plan, ledger, rowId, now), claimToken = httpEvalUuid(input.claimToken);
  if (ledger.rows.some(r => r.claim?.claimToken === claimToken)) return httpEvalFail("http_eval_claim_conflict", 409);
  const claim = { rowId, claimToken, claimedAt: now, requestFingerprint: request.requestFingerprint };
  const next = ledgerWith(ledger, ledger.rows.map(r => r.rowId === rowId ? { ...r, status: "claimed" as const, claim } : r));
  return { ledger: next, claim, request };
}
export function parseHttpEvalTargetResponse(responseText: string, requestFingerprint: string): HttpEvalTargetResponse {
  return structuredResponse(parseHttpEvalJson(responseText, HTTP_EVAL_LIMITS.responseBytes), requestFingerprint);
}
function structuredResponse(value: unknown, requestFingerprint: string): HttpEvalTargetResponse {
  const s = httpEvalObject(value, ["schemaVersion", "requestFingerprint", "output"], ["usage", "costUsd"]);
  if (s.schemaVersion !== "http-json-target-response-v1" || s.requestFingerprint !== httpEvalDigest(requestFingerprint) || s.output === null || typeof s.output === "string" && !s.output.trim() || httpEvalBytes(stableStringify(s.output)) > HTTP_EVAL_LIMITS.responseBytes) return httpEvalFail("http_eval_response_invalid");
  const result: HttpEvalTargetResponse = { schemaVersion: "http-json-target-response-v1", requestFingerprint, output: s.output as JsonValue };
  if (Object.hasOwn(s, "usage")) { const u = httpEvalObject(s.usage, [], ["inputTokens", "outputTokens", "totalTokens"]); if (!Object.keys(u).length) return httpEvalFail("http_eval_response_invalid");
    const usage: NonNullable<HttpEvalTargetResponse["usage"]> = {}; for (const k of ["inputTokens", "outputTokens", "totalTokens"] as const) if (Object.hasOwn(u, k)) usage[k] = httpEvalInteger(u[k], 0, 1000000000);
    if (usage.totalTokens !== undefined && usage.totalTokens < (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)) return httpEvalFail("http_eval_response_invalid"); result.usage = usage;
  }
  if (Object.hasOwn(s, "costUsd")) { if (typeof s.costUsd !== "number" || !Number.isFinite(s.costUsd) || s.costUsd < 0 || s.costUsd > 1000000) return httpEvalFail("http_eval_response_invalid"); result.costUsd = s.costUsd; }
  return result;
}
function rowResults(plan: HttpEvalPlanVersionRecord, publicRunId: string, event: HttpEvalRowEvent): HttpEvalResult[] {
  if (event.status !== "succeeded" || !event.response) return [];
  const actual = typeof event.response.output === "string" ? event.response.output : stableStringify(event.response.output);
  return plan.content.items.map(item => { const passed = actual.toLowerCase().includes((item.config.contains as string).toLowerCase());
    return seal({ id: httpEvalResultId(plan.workspaceId, publicRunId, event.rowId, item.id), rowId: event.rowId, evalItemVersionId: item.id,
      originalOutput: { contains_expected: passed }, fields: [{ key: "contains_expected", value: passed, passed, decision: passed ? "pass" as const : "hard_fail" as const }],
      conciseRationale: passed ? "Configured text is present." : "Configured text is absent.", evidenceRefs: [event.id], evaluatorVersion: item.fingerprint,
      provider: "local", model: "case_insensitive_contains_v1", sourceOutputFingerprint: httpEvalHash(event.response!.output) });
  });
}
function applyEvent(ledger: HttpEvalRunLedger, event: HttpEvalRowEvent): HttpEvalRunLedger {
  return ledgerWith(ledger, ledger.rows.map(r => r.rowId === event.rowId ? { ...r, status: event.status, eventId: event.id, eventFingerprint: event.fingerprint } : r));
}
export function finalizeHttpEvalRow(input: FinalizeHttpEvalRowInput): HttpEvalFinalizedRow {
  const plan = parseHttpEvalPlanVersionRecord(input.plan), ledger = parseHttpEvalRunLedger(input.ledger, plan), row = ledger.rows.find(r => r.rowId === input.rowId), completedAt = httpEvalTimestamp(input.completedAt);
  if (!row?.claim || row.claim.claimToken !== httpEvalUuid(input.claimToken) || Date.parse(completedAt) < Date.parse(row.claim.claimedAt)) return httpEvalFail("http_eval_finalize_conflict", 409);
  let status: HttpEvalRowEvent["status"], response: HttpEvalTargetResponse | null = null, rawResponseHash: string | null = null, errorCode: string | null = null;
  if (Object.hasOwn(input, "responseText") && !Object.hasOwn(input, "errorCode") && !Object.hasOwn(input, "errorOutcome")) {
    if (typeof input.responseText !== "string") return httpEvalFail();
    if (httpEvalBytes(input.responseText) <= HTTP_EVAL_LIMITS.responseBytes) rawResponseHash = textHash(input.responseText, 64);
    try { response = parseHttpEvalTargetResponse(input.responseText, row.claim.requestFingerprint); status = "succeeded"; } catch { status = "failed"; errorCode = "http_eval_response_invalid"; }
  } else if (!Object.hasOwn(input, "responseText") && Object.hasOwn(input, "errorCode") && (input.errorOutcome === "not_sent" || input.errorOutcome === "unknown")) {
    errorCode = safeError(input.errorCode); status = input.errorOutcome === "unknown" ? "outcome_unknown" : "not_sent";
  } else return httpEvalFail();
  const event: HttpEvalRowEvent = seal({ schemaVersion: httpEvalProfileTags(plan.content.schemaVersion).rowEvent, id: httpEvalRowEventId(ledger.workspaceId, ledger.publicRunId, row.rowId), workspaceId: ledger.workspaceId, publicRunId: ledger.publicRunId, rowId: row.rowId, claim: row.claim, status, completedAt, response, rawResponseHash, errorCode });
  if (row.status !== "claimed" && (row.eventId !== event.id || row.eventFingerprint !== event.fingerprint)) return httpEvalFail("http_eval_finalize_conflict", 409);
  return { ledger: applyEvent(ledger, event), event, results: rowResults(plan, ledger.publicRunId, event) };
}
function unsentEvent(ledger: HttpEvalRunLedger, row: HttpEvalLedgerRow, now: string, recovering: boolean, reason: string): HttpEvalRowEvent {
  return seal({ schemaVersion: httpEvalProfileTags(ledger.schemaVersion === "http-eval-run-ledger-v1" ? "http-target-eval-v1" : "http-target-eval-v2").rowEvent, id: httpEvalRowEventId(ledger.workspaceId, ledger.publicRunId, row.rowId), workspaceId: ledger.workspaceId, publicRunId: ledger.publicRunId, rowId: row.rowId, claim: row.claim,
    status: recovering && row.status === "claimed" ? "outcome_unknown" as const : "not_sent" as const, completedAt: now, response: null, rawResponseHash: null, errorCode: reason });
}
export function recoverHttpEvalRun(input: RecoverHttpEvalRunInput) {
  const plan = parseHttpEvalPlanVersionRecord(input.plan), ledger = parseHttpEvalRunLedger(input.ledger, plan), now = httpEvalTimestamp(input.now);
  if (Date.parse(now) < Date.parse(ledger.leaseExpiresAt)) return httpEvalFail("http_eval_recovery_too_early", 409);
  const events = ledger.rows.filter(r => r.status === "pending" || r.status === "claimed").map(r => unsentEvent(ledger, r, now, true, r.status === "claimed" ? "http_eval_recovered_unknown" : "http_eval_recovered_not_sent"));
  return { ledger: events.reduce(applyEvent, ledger), events };
}
export function stopHttpEvalRun(input: StopHttpEvalRunInput) {
  const plan = parseHttpEvalPlanVersionRecord(input.plan), ledger = parseHttpEvalRunLedger(input.ledger, plan), now = httpEvalTimestamp(input.now), reason = safeError(input.reasonCode);
  if (httpEvalUuid(input.leaseToken) !== ledger.leaseToken || Date.parse(now) < Date.parse(ledger.startedAt) || Date.parse(now) >= Date.parse(ledger.leaseExpiresAt)) return httpEvalFail("http_eval_stop_conflict", 409);
  if (ledger.stopReason !== null && ledger.stopReason !== reason) return httpEvalFail("http_eval_stop_conflict", 409);
  const events = ledger.rows.filter(r => r.status === "pending").map(r => unsentEvent(ledger, r, now, false, reason));
  const stopped = ledgerWith(ledger, ledger.rows, reason); return { ledger: events.reduce(applyEvent, stopped), events };
}
function checkedEvents(plan: HttpEvalPlanVersionRecord, ledger: HttpEvalRunLedger, values: unknown[]): HttpEvalRowEvent[] {
  if (!Array.isArray(values) || values.length > ledger.rows.length) return httpEvalFail("http_eval_events_corrupt"); const seen = new Set<string>();
  const events = values.map(value => {
    const s = httpEvalObject(copyHttpEvalJson(value), ["schemaVersion", "id", "workspaceId", "publicRunId", "rowId", "claim", "status", "completedAt", "response", "rawResponseHash", "errorCode", "fingerprint"]), row = ledger.rows.find(r => r.rowId === s.rowId);
    if (!row || seen.has(row.rowId) || row.eventId !== s.id || row.eventFingerprint !== s.fingerprint || row.status !== s.status || s.workspaceId !== ledger.workspaceId || s.publicRunId !== ledger.publicRunId || s.schemaVersion !== httpEvalProfileTags(plan.content.schemaVersion).rowEvent || !httpEvalSame(row.claim, s.claim) || Date.parse(httpEvalTimestamp(s.completedAt)) < Date.parse(row.claim?.claimedAt ?? ledger.startedAt)) return httpEvalFail("http_eval_events_corrupt");
    seen.add(row.rowId); const { fingerprint, ...base } = s; if (httpEvalHash(base) !== fingerprint) return httpEvalFail("http_eval_events_corrupt");
    if (s.rawResponseHash !== null) httpEvalDigest(s.rawResponseHash);
    if (s.status === "succeeded") { if (!row.claim || s.errorCode !== null || s.rawResponseHash === null || s.response === null) return httpEvalFail("http_eval_events_corrupt"); const response = structuredResponse(s.response, row.claim.requestFingerprint); if (!httpEvalSame(response, s.response)) return httpEvalFail("http_eval_events_corrupt"); }
    else { if (s.response !== null || s.errorCode === null) return httpEvalFail("http_eval_events_corrupt"); safeError(s.errorCode); }
    return s as unknown as HttpEvalRowEvent;
  });
  if (ledger.rows.some(r => r.eventId !== null && !seen.has(r.rowId))) return httpEvalFail("http_eval_events_corrupt");
  return events.sort((a, b) => ledger.rows.findIndex(r => r.rowId === a.rowId) - ledger.rows.findIndex(r => r.rowId === b.rowId));
}
export function buildHttpEvalExecution(input: { plan: unknown; ledger: unknown; events: unknown[] }): HttpEvalExecution {
  const plan = parseHttpEvalPlanVersionRecord(input.plan), ledger = parseHttpEvalRunLedger(input.ledger, plan), events = checkedEvents(plan, ledger, input.events), results = events.flatMap(e => rowResults(plan, ledger.publicRunId, e)), gates: GateResult[] = [];
  if (ledger.status === "running") return seal({ schemaVersion: httpEvalProfileTags(plan.content.schemaVersion).execution, results, gates });
  const resultByPair = new Map(results.map(r => [`${r.rowId}/${r.evalItemVersionId}`, r])), itemIds = plan.content.items.map(i => i.id), rowIds = plan.content.samples.map(r => r.rowId);
  function gate(level: GateResult["level"], scopeId: string, scopeRows: string[], scopeItems: string[], threshold: number, formula: string): GateResult {
    const selected = scopeRows.flatMap(rowId => scopeItems.map(itemId => resultByPair.get(`${rowId}/${itemId}`))), existing = selected.filter((r): r is HttpEvalResult => r !== undefined), complete = selected.length > 0 && existing.length === selected.length;
    const passedRows = scopeRows.filter(rowId => scopeItems.every(itemId => resultByPair.get(`${rowId}/${itemId}`)?.fields.every(f => f.passed === true))).length;
    const score = scopeRows.length ? passedRows * 100 / scopeRows.length : 0, failed = existing.filter(r => r.fields.some(f => f.decision === "hard_fail")).map(r => r.evalItemVersionId), critical = [...new Set(failed)].sort();
    const authoritative = plan.content.schemaVersion === "http-target-eval-v2" || level === "target" || level === "criticality" || level === "run";
    const passed = complete && score >= threshold && (!authoritative || critical.length === 0);
    const base = { id: httpEvalGateId(ledger.workspaceId, ledger.publicRunId, level, scopeId), runId: ledger.runId, level, scopeId, score, passed,
      decision: passed ? "pass" as const : critical.length || !complete ? "hard_fail" as const : "soft_fail" as const,
      thresholdVersion: httpEvalProfileTags(plan.content.schemaVersion).thresholds + ":" + httpEvalHash(plan.content.evalSets.map(s => ({ id: s.contract.id, gates: s.contract.gates, members: s.members }))),
      formula, reasons: [...(!complete ? ["coverage_incomplete"] : []), ...(score < threshold ? ["threshold_failed"] : []), ...(critical.length ? ["critical_evaluator_failed"] : [])], failedCriticalComponents: critical, sourceResultIds: existing.map(r => r.id).sort() };
    const result = seal(base); gates.push(result); return result;
  }
  for (const rowId of rowIds) {
    for (const itemId of itemIds) { gate("field", `${rowId}/${itemId}/contains_expected`, [rowId], [itemId], 100, "declared boolean contains_expected is true; missing is hard failure"); gate("item_row", `${rowId}/${itemId}`, [rowId], [itemId], 100, "all declared gating fields pass for this unique row and evaluator version"); }
    gate("row", rowId, [rowId], itemIds, Math.max(...plan.content.evalSets.map(s => s.contract.gates.rowThreshold)), "one row across all unique required evaluator versions; all critical members pass");
  }
  const datasetThreshold = Math.max(...plan.content.evalSets.map(s => s.contract.gates.datasetPassRateThreshold));
  gate("dataset", plan.content.dataset.version.id, rowIds, itemIds, datasetThreshold, "passing unique rows / frozen dataset rows * 100; complete coverage required");
  for (const set of plan.content.evalSets) gate("eval_set", set.contract.id, rowIds, set.members.map(m => m.evalItemVersionId), Math.max(set.contract.gates.datasetPassRateThreshold, set.contract.gates.evalSetThreshold), "passing unique rows for the frozen weighted critical membership / dataset rows * 100");
  gate("target", plan.content.target.fingerprint, rowIds, itemIds, datasetThreshold, "actual target responses satisfy dataset threshold with complete coverage and no critical failure");
  gate("criticality", "critical", rowIds, itemIds, 100, "every frozen critical row/evaluator pair passes");
  gate("run", ledger.runId, rowIds, itemIds, Math.max(datasetThreshold, ...plan.content.evalSets.map(s => s.contract.gates.runThreshold)), "complete target coverage, all critical pairs and configured run thresholds pass");
  return seal({ schemaVersion: httpEvalProfileTags(plan.content.schemaVersion).execution, results, gates });
}
export function buildHttpEvalRunRecord(input: { plan: unknown; ledger: unknown; events: unknown[] }): HttpEvalRunRecord {
  const plan = parseHttpEvalPlanVersionRecord(input.plan), ledger = parseHttpEvalRunLedger(input.ledger, plan), events = checkedEvents(plan, ledger, input.events), execution = buildHttpEvalExecution({ plan, ledger, events });
  const result = seal({ schemaVersion: httpEvalProfileTags(plan.content.schemaVersion).runRecord, workspaceId: plan.workspaceId, plan, ledger, events, execution }); copyHttpEvalJson(result); return result as HttpEvalRunRecord;
}
export function parseHttpEvalRunRecord(value: unknown): HttpEvalRunRecord {
  const s = httpEvalObject(copyHttpEvalJson(value), ["schemaVersion", "workspaceId", "plan", "ledger", "events", "execution", "fingerprint"]);
  if (!Array.isArray(s.events)) return httpEvalFail("http_eval_run_corrupt"); const result = buildHttpEvalRunRecord({ plan: s.plan, ledger: s.ledger, events: s.events });
  if (!httpEvalSame(result, s)) return httpEvalFail("http_eval_run_corrupt"); return result;
}

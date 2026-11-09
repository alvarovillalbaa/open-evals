import {
  buildHttpEvalRunRecord, claimHttpEvalRow, createHttpEvalRunLedger, finalizeHttpEvalRow,
  httpEvalPlanStorageIds, parseHttpEvalPlanVersionRecord, parseHttpEvalRunRecord,
  prepareHttpEvalStartRequest, recoverHttpEvalRun as recoverCoreRun, stopHttpEvalRun as stopCoreRun
} from "@open-evals/core";
import type { AnyHttpEvalRunRecord as HttpEvalRunRecord } from "@open-evals/core";
import { HttpTargetTransportError, invokePublicHttpTarget } from "@open-evals/adapters";
import {
  claimHttpEvalRunRow, finalizeHttpEvalRunRow, getHttpEvalRun, listHttpEvalRuns,
  recoverHttpEvalRun, reserveHttpEvalRun, stopHttpEvalRun
} from "@open-evals/db";
import type { RouteAuthContext } from "./auth";
import { httpTargetCanWrite, HttpTargetRequestError, loadHttpTarget, readHttpTargetPlanVersion } from "./http-target-plans";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const callbacks = {
  parsePlan: parseHttpEvalPlanVersionRecord, create: createHttpEvalRunLedger,
  claim: claimHttpEvalRow, finalize: finalizeHttpEvalRow, recover: recoverCoreRun,
  stop: stopCoreRun, build: buildHttpEvalRunRecord, parse: parseHttpEvalRunRecord
};

function checkedRecord(value: unknown, workspaceId: string, runId: string): HttpEvalRunRecord {
  const record = parseHttpEvalRunRecord(value);
  if (record.workspaceId !== workspaceId || record.ledger.publicRunId !== runId) throw new HttpTargetRequestError(500, "http_eval_run_identity_invalid");
  return record;
}

/** Only the committed reservation creator enters this coordinator. Never used on GET/replay. */
async function coordinate(record: HttpEvalRunRecord): Promise<HttpEvalRunRecord> {
  const { workspaceId, ledger } = record, runId = ledger.publicRunId;
  const deadline = Date.parse(ledger.deadlineAt), controller = new AbortController();
  const rows = record.plan.content.samples.map(sample => sample.rowId);
  let index = 0, stopped = false, fatal: unknown;
  let stopping: Promise<unknown> | undefined;
  const stop = (reason: string): Promise<unknown> => {
    stopped = true;
    stopping ??= stopHttpEvalRun(workspaceId, runId, { leaseToken: ledger.leaseToken, reasonCode: reason }, callbacks);
    return stopping;
  };
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
  async function worker() {
    while (!stopped) {
      if (index >= rows.length) return;
      if (Date.now() >= deadline) { await stop("http_eval_deadline_exceeded"); return; }
      const rowId = rows[index++];
      if (!rowId) return;
      // Claim performs and commits its transaction before exposing the outbound request.
      let claimed: Awaited<ReturnType<typeof claimHttpEvalRunRow>>;
      try { claimed = await claimHttpEvalRunRow(workspaceId, runId, { rowId, leaseToken: ledger.leaseToken }, callbacks); }
      catch (error) {
        if (stopped) return;
        if (error instanceof Error && error.message === "http_eval_deadline_reached") { await stop("http_eval_deadline_exceeded"); return; }
        throw error;
      }
      let responseText: string | undefined, errorCode: string | undefined, errorOutcome: "not_sent" | "unknown" | undefined;
      const remaining = deadline - Date.now();
      if (stopped || remaining <= 0 || controller.signal.aborted) {
        errorCode = "http_eval_deadline_exceeded"; errorOutcome = "not_sent";
      } else {
        try {
          const response = await invokePublicHttpTarget({ ...claimed.request, timeoutMs: Math.min(claimed.request.timeoutMs, remaining), signal: controller.signal });
          responseText = response.bodyText;
        } catch (error) {
          if (error instanceof HttpTargetTransportError && /^[a-z0-9_:.-]{1,120}$/.test(error.code)) {
            errorCode = error.code; errorOutcome = error.outcome;
          } else { errorCode = "http_target_transport_unknown"; errorOutcome = "unknown"; }
        }
      }
      // A response or safe transport outcome is committed atomically with scoring and sample state.
      await finalizeHttpEvalRunRow(workspaceId, runId, {
        rowId, claimToken: claimed.claim.claimToken,
        ...(responseText !== undefined ? { responseText } : { errorCode: errorCode!, errorOutcome: errorOutcome! })
      }, callbacks);
      if (Date.now() >= deadline && index < rows.length) { await stop("http_eval_deadline_exceeded"); return; }
    }
  }
  try {
    const workers = Array.from({ length: record.plan.content.draft.limits.concurrency }, async () => {
      try { await worker(); }
      catch (error) {
        fatal ??= error; stopped = true; controller.abort();
        // Refuse further claims even if the creator can still seal never-sent rows.
        try { await stop("http_eval_coordinator_interrupted"); } catch { /* Keep the reservation for explicit recovery. */ }
      }
    });
    await Promise.all(workers);
    if (fatal) throw new HttpTargetRequestError(500, "http_eval_execution_outcome_unknown");
    const latest = await getHttpEvalRun(workspaceId, runId, callbacks);
    if (!latest) throw new HttpTargetRequestError(500, "http_eval_execution_outcome_unknown");
    return checkedRecord(latest, workspaceId, runId);
  } finally { clearTimeout(timer); controller.abort(); }
}

export async function executeHttpTargetPlan(auth: RouteAuthContext, planId: string, versionId: string, value: unknown) {
  const request = prepareHttpEvalStartRequest(value);
  const pathVersion = httpEvalPlanStorageIds(auth.workspaceId, planId, versionId).versionId;
  if (request.planVersionId !== pathVersion) throw new HttpTargetRequestError(409, "http_eval_plan_path_conflict");
  const result = await reserveHttpEvalRun({ workspaceId: auth.workspaceId, actorId: auth.user.id }, request, callbacks);
  // Reservation is already durable. Any subsequent failure is an unknown client outcome.
  try {
    const record = checkedRecord(result.record, auth.workspaceId, request.runId);
    if (record.plan.storage.versionId !== pathVersion || record.plan.fingerprint !== request.expectedPlanFingerprint) throw new Error("identity");
    return { record: result.created ? await coordinate(record) : record, replayed: !result.created };
  } catch { throw new HttpTargetRequestError(500, "http_eval_execution_outcome_unknown"); }
}

export async function readHttpTargetRun(workspaceId: string, runId: string) {
  if (!UUID.test(runId)) return undefined;
  const record = await getHttpEvalRun(workspaceId, runId, callbacks);
  return record ? checkedRecord(record, workspaceId, runId) : undefined;
}

export async function recoverHttpTargetRun(auth: RouteAuthContext, runId: string, body: unknown) {
  if (!UUID.test(runId) || !body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).length !== 1 || !("schemaVersion" in body) || body.schemaVersion !== "http-eval-recover-v1") throw new HttpTargetRequestError(422, "http_eval_recovery_invalid");
  const record = await recoverHttpEvalRun({ workspaceId: auth.workspaceId, actorId: auth.user.id }, runId, callbacks);
  try { return checkedRecord(record, auth.workspaceId, runId); }
  catch { throw new HttpTargetRequestError(500, "http_eval_recovery_outcome_unknown"); }
}

export async function readHttpTargetPlanRuns(auth: RouteAuthContext, planId: string, versionId: string) {
  const record = await readHttpTargetPlanVersion(auth.workspaceId, planId, versionId);
  if (!record) return undefined;
  // History is explicitly plan-wide; individual entries retain their exact frozen version.
  return { record, history: await listHttpEvalRuns(auth.workspaceId, planId), canWrite: httpTargetCanWrite(auth) };
}

export function loadHttpTargetPlanRuns(planId: string, versionId: string) {
  return loadHttpTarget(async auth => ({ detail: await readHttpTargetPlanRuns(auth, planId, versionId) }));
}
export function loadHttpTargetRun(runId: string) {
  return loadHttpTarget(async auth => ({ record: await readHttpTargetRun(auth.workspaceId, runId), canWrite: httpTargetCanWrite(auth) }));
}

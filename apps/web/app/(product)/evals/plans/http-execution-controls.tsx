"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AnyHttpEvalPlanVersionRecord as HttpEvalPlanVersionRecord, AnyHttpEvalRunRecord as HttpEvalRunRecord, AnyHttpEvalStartRequest as HttpEvalStartRequest } from "@open-evals/core";
import { jsonObject, readHttpTargetResponse } from "@/lib/http-target-client";
import { buttonClass, primaryClass, RunEvidence } from "./http-target-view";

function runShape(value: unknown, plan: HttpEvalPlanVersionRecord, runId: string): value is HttpEvalRunRecord {
  const suffix = plan.content.schemaVersion === "http-target-eval-v2" ? "v2" : "v1";
  return jsonObject(value) && value.schemaVersion === `http-eval-run-record-${suffix}` && value.workspaceId === plan.workspaceId
    && jsonObject(value.plan) && value.plan.schemaVersion === plan.schemaVersion && value.plan.fingerprint === plan.fingerprint && jsonObject(value.ledger)
    && value.ledger.schemaVersion === `http-eval-run-ledger-${suffix}` && value.ledger.publicRunId === runId && value.ledger.planVersionId === plan.storage.versionId
    && value.ledger.planFingerprint === plan.fingerprint && Array.isArray(value.ledger.rows)
    && value.ledger.rows.length === plan.content.samples.length && typeof value.ledger.deadlineAt === "string"
    && typeof value.ledger.leaseExpiresAt === "string" && ["running", "completed", "failed", "interrupted", "outcome_unknown"].includes(String(value.ledger.status))
    && Array.isArray(value.events) && value.events.every(event => jsonObject(event) && event.schemaVersion === `http-eval-row-event-${suffix}`)
    && jsonObject(value.execution) && value.execution.schemaVersion === `http-eval-execution-${suffix}` && Array.isArray(value.execution.results) && Array.isArray(value.execution.gates);
}

export function HttpExecutionControls({ plan, canWrite, initialRecord }: {
  plan: HttpEvalPlanVersionRecord;
  canWrite: boolean;
  initialRecord?: HttpEvalRunRecord;
}) {
  const [record, setRecord] = useState(initialRecord);
  const [intent, setIntent] = useState<HttpEvalStartRequest>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState<"start" | "read" | "recover">();
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string }>();
  const active = useRef(true), busy = useRef(false), generation = useRef(0), unknown = useRef(false), ack = useRef(false);
  const pinned = useRef<{ request: HttpEvalStartRequest; body: string } | undefined>(undefined);
  const accepted = useRef<HttpEvalRunRecord | undefined>(initialRecord);

  useEffect(() => { active.current = true; return () => { active.current = false; generation.current++; }; }, []);
  const current = (token: number) => active.current && generation.current === token;
  const runId = intent?.runId ?? record?.ledger.publicRunId;
  function begin(action: "start" | "read" | "recover") { busy.current = true; setPending(action); setNotice(undefined); return ++generation.current; }
  function finish(token: number) { if (current(token)) { busy.current = false; setPending(undefined); } }
  function markUnknown(value: boolean) { unknown.current = value; setUncertain(value); }
  function accept(value: HttpEvalRunRecord) { accepted.current = value; setRecord(value); markUnknown(false); }

  async function execute() {
    if (!canWrite || busy.current || accepted.current || !pinned.current && !ack.current) return;
    const previouslyUnknown = unknown.current;
    const token = begin("start"); let started = false;
    try {
      const request: HttpEvalStartRequest = pinned.current?.request ?? {
        schemaVersion: plan.content.schemaVersion === "http-target-eval-v2" ? "http-eval-start-v2" : "http-eval-start-v1", runId: crypto.randomUUID(), planVersionId: plan.storage.versionId,
        expectedPlanFingerprint: plan.fingerprint
      };
      pinned.current ??= { request, body: JSON.stringify(request) }; setIntent(request);
      started = true;
      const response = await fetch(`/api/v1/http-target-plans/${plan.content.draft.planId}/versions/${plan.content.draft.versionId}/runs`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: pinned.current.body
      });
      const value = await readHttpTargetResponse(response);
      if (!current(token)) return;
      if (!response.ok) {
        if (!previouslyUnknown && [400, 401, 403, 404, 409, 413, 422].includes(response.status)) {
          markUnknown(false); pinned.current = undefined; setIntent(undefined); ack.current = false; setAcknowledged(false);
          setNotice({ error: true, text: "The execution request was rejected before a new execution was accepted. Check access and the exact saved plan, then explicitly review before trying again." });
        } else { markUnknown(true); setNotice({ error: true, text: "The execution outcome is unknown. Keep the same execution ID. Read its recorded state or retry this identical request; retry will not dispatch recorded work again." }); }
        return;
      }
      if (!jsonObject(value) || typeof value.replayed !== "boolean" || !runShape(value.record, plan, request.runId)) throw new Error("run_response_invalid");
      accept(value.record);
      setNotice({ error: false, text: value.replayed ? "Loaded the recorded execution. This identical request dispatched no new target work." : "Execution state recorded. Inspect actual outputs, coverage and gates below." });
    } catch {
      if (current(token)) { markUnknown(started); setNotice({ error: true, text: started ? "The execution outcome is unknown. Read the saved execution or retry the identical ID. A new execution could repeat remote effects." : "The execution intent could not be prepared. No target request was started by this action." }); }
    } finally { finish(token); }
  }

  async function read() {
    const id = pinned.current?.request.runId ?? accepted.current?.ledger.publicRunId;
    if (!id || busy.current) return;
    const token = begin("read");
    try {
      const response = await fetch(`/api/v1/http-target-plans/runs/${id}`, { credentials: "same-origin", cache: "no-store" });
      const value = await readHttpTargetResponse(response);
      if (!current(token)) return;
      if (!response.ok || !jsonObject(value) || !runShape(value.record, plan, id)) throw new Error("run_unavailable");
      accept(value.record); setNotice({ error: false, text: "Recorded state refreshed. Reading did not dispatch targets or recover unfinished claims." });
    } catch { if (current(token)) setNotice({ error: true, text: "The execution could not yet be read. An absent read does not cancel a reservation or remote call. Preserve this ID and retry reading." }); }
    finally { finish(token); }
  }

  async function recover() {
    const id = pinned.current?.request.runId ?? accepted.current?.ledger.publicRunId;
    if (!canWrite || !id || busy.current) return;
    const token = begin("recover");
    try {
      const response = await fetch(`/api/v1/http-target-plans/runs/${id}/recover`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ schemaVersion: "http-eval-recover-v1" }) });
      const value = await readHttpTargetResponse(response);
      if (!current(token)) return;
      if (!response.ok || !jsonObject(value) || !runShape(value.record, plan, id)) {
        setNotice({ error: true, text: response.status === 409 ? "Recovery is unavailable until the recorded lease and grace expire. No target was resent. Refresh recorded state before retrying recovery." : "Recovery could not be confirmed. Read the saved state before another recovery action; no target is dispatched by recovery." });
        return;
      }
      accept(value.record); setNotice({ error: false, text: "Expired execution recovered. Unfinished claimed calls are marked outcome unknown; never-claimed inputs are marked not sent. No target was resent." });
    } catch { if (current(token)) setNotice({ error: true, text: "The recovery outcome is unknown. Read recorded state before another action. Recovery never resends target calls." }); }
    finally { finish(token); }
  }

  function another() {
    if (busy.current || unknown.current || !accepted.current || accepted.current.ledger.status === "running") return;
    generation.current++; pinned.current = undefined; accepted.current = undefined; ack.current = false;
    setRecord(undefined); setIntent(undefined); setAcknowledged(false); setNotice({ error: false, text: "Preparing a different execution. It will have a new ID and may repeat remote effects; explicit acknowledgement and Start are required." });
  }

  return <section className="grid min-w-0 gap-4 border border-border bg-panel p-4" aria-labelledby="http-execute-heading" aria-busy={Boolean(pending)}>
    <h2 id="http-execute-heading" className="font-semibold">Explicitly execute this saved plan</h2>
    <p className="text-sm text-muted-foreground">Executing sends frozen inputs to {plan.content.target.endpoint}. Previewing, saving and reading make no calls. At most one dispatch is claimed per row; this does not guarantee exactly-once behavior at the remote endpoint.</p>
    {!record ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} disabled={!canWrite || Boolean(pending) || uncertain} onChange={event => { ack.current = event.target.checked; setAcknowledged(event.target.checked); }} />I authorize this execution. A different execution ID may repeat remote effects, even when an earlier outcome is unknown.</label> : null}
    {!canWrite ? <p className="text-sm text-muted-foreground">Workspace edit access is required to execute or recover. You can inspect saved results.</p> : null}
    <div className="flex flex-wrap gap-2">{!record ? <button type="button" className={primaryClass} onClick={execute} disabled={!canWrite || Boolean(pending) || !acknowledged}>{pending === "start" ? "Executing saved plan…" : uncertain ? "Retry identical execution request" : "Start a new explicit execution"}</button> : null}{runId ? <button type="button" className={buttonClass} onClick={read} disabled={Boolean(pending)}>{pending === "read" ? "Reading recorded state…" : "Read recorded state without dispatch"}</button> : null}{record?.ledger.status === "running" ? <button type="button" className={buttonClass} onClick={recover} disabled={!canWrite || Boolean(pending)}>{pending === "recover" ? "Recovering expired execution…" : "Recover after lease expiry without resending"}</button> : null}{record && record.ledger.status !== "running" ? <button type="button" className={buttonClass} onClick={another} disabled={!canWrite || Boolean(pending)}>Prepare a different execution</button> : null}</div>
    {runId ? <div className="grid min-w-0 gap-2"><p className="break-all font-mono text-xs">Execution / retry ID: {runId}</p><Link href={`/evals/plans/runs/${runId}`} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-4">Open this recorded execution in another tab</Link><p className="text-xs text-muted-foreground">Keep this ID if the response is lost. Leaving this page does not cancel work already accepted. Reload the plan's execution history to find recorded reservations.</p></div> : null}
    {notice ? <p role={notice.error ? "alert" : "status"} className={notice.error ? "text-sm text-danger" : "text-sm text-muted-foreground"}>{notice.text}</p> : null}
    {record ? <RunEvidence record={record} /> : null}
  </section>;
}

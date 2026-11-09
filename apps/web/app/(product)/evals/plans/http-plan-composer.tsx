"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { HttpEvalPlanDraft, HttpEvalPlanHead, HttpEvalPlanPreview, HttpEvalPlanSaveRequest, HttpEvalPlanVersionRecord } from "@open-evals/core";
import { jsonObject, readHttpTargetResponse } from "@/lib/http-target-client";
import type { ProvidedOutputSourcesView } from "@/lib/provided-output-types";
import { buttonClass, CompleteJson, inputClass, PlanSnapshot, primaryClass } from "./http-target-view";

const hash = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
type Pending = "preview" | "save" | "recover" | "head";

function sameDraft(value: unknown, draft: HttpEvalPlanDraft): value is HttpEvalPlanDraft {
  if (!jsonObject(value) || !jsonObject(value.target) || !jsonObject(value.limits) || !Array.isArray(value.evalSetVersionIds)) return false;
  return value.schemaVersion === draft.schemaVersion && value.planId === draft.planId && value.versionId === draft.versionId
    && value.version === draft.version && value.expectedVersionId === draft.expectedVersionId && value.name === draft.name
    && value.datasetVersionId === draft.datasetVersionId && value.evalSetVersionIds.length === draft.evalSetVersionIds.length
    && value.evalSetVersionIds.every((item, index) => item === draft.evalSetVersionIds[index])
    && value.target.targetId === draft.target.targetId && value.target.targetVersion === draft.target.targetVersion
    && value.target.endpoint === draft.target.endpoint && value.target.timeoutMs === draft.target.timeoutMs
    && value.limits.concurrency === draft.limits.concurrency && value.limits.maxDurationSeconds === draft.limits.maxDurationSeconds;
}

function previewShape(value: unknown, draft: HttpEvalPlanDraft): value is HttpEvalPlanPreview {
  return jsonObject(value) && value.schemaVersion === "http-eval-plan-preview-v1" && typeof value.workspaceId === "string"
    && typeof value.fingerprint === "string" && hash.test(value.fingerprint) && sameDraft(value.draft, draft)
    && jsonObject(value.content) && value.content.schemaVersion === "http-target-eval-v1" && sameDraft(value.content.draft, draft)
    && jsonObject(value.content.dataset) && Array.isArray(value.content.dataset.rows) && value.content.dataset.rows.length >= 1
    && value.content.dataset.rows.length <= 100 && Array.isArray(value.content.evalSets) && value.content.evalSets.length === draft.evalSetVersionIds.length
    && Array.isArray(value.content.items) && value.content.items.length >= 1 && value.content.items.length <= 32
    && typeof value.recordByteAllowance === "number" && value.recordByteAllowance > 0 && value.recordByteAllowance <= 16 * 1024 * 1024;
}

function recordShape(value: unknown, draft: HttpEvalPlanDraft, workspaceId?: string, previewFingerprint?: string): value is HttpEvalPlanVersionRecord {
  return jsonObject(value) && value.schemaVersion === "http-eval-plan-record-v1" && typeof value.workspaceId === "string"
    && (!workspaceId || value.workspaceId === workspaceId) && jsonObject(value.content) && sameDraft(value.content.draft, draft)
    && typeof value.fingerprint === "string" && hash.test(value.fingerprint) && typeof value.previewFingerprint === "string"
    && hash.test(value.previewFingerprint) && (!previewFingerprint || value.previewFingerprint === previewFingerprint)
    && typeof value.createdAt === "string" && jsonObject(value.storage);
}

function headRecordShape(value: unknown, head: HttpEvalPlanHead): value is HttpEvalPlanVersionRecord {
  if (!jsonObject(value) || value.schemaVersion !== "http-eval-plan-record-v1" || value.fingerprint !== head.fingerprint
    || !jsonObject(value.content) || !jsonObject(value.content.draft)) return false;
  const draft = value.content.draft;
  return draft.planId === head.planId && draft.versionId === head.versionId && draft.version === head.version
    && draft.name === head.name && jsonObject(draft.target) && jsonObject(draft.limits) && Array.isArray(draft.evalSetVersionIds);
}

function headShape(value: unknown): value is HttpEvalPlanHead {
  return jsonObject(value) && typeof value.planId === "string" && uuid.test(value.planId) && typeof value.versionId === "string"
    && uuid.test(value.versionId) && typeof value.version === "number" && Number.isInteger(value.version) && value.version >= 1
    && typeof value.name === "string" && typeof value.fingerprint === "string" && hash.test(value.fingerprint);
}

export function HttpPlanComposer({ canWrite, sources, initialHead = null, initialRecord }: {
  canWrite: boolean;
  sources: ProvidedOutputSourcesView;
  initialHead?: HttpEvalPlanHead | null;
  initialRecord?: HttpEvalPlanVersionRecord;
}) {
  const prefix = useId(), initial = initialRecord?.content.draft;
  const [head, setHead] = useState(initialHead);
  const [name, setName] = useState(initial?.name ?? "");
  const [datasetId, setDatasetId] = useState(initial?.datasetVersionId ?? "");
  const [setIds, setSetIds] = useState(initial?.evalSetVersionIds.join("\n") ?? "");
  const [targetId, setTargetId] = useState(initial?.target.targetId ?? "");
  const [targetVersion, setTargetVersion] = useState(initial?.target.targetVersion ?? "");
  const [endpoint, setEndpoint] = useState(initial?.target.endpoint ?? "");
  const [timeoutMs, setTimeoutMs] = useState(String(initial?.target.timeoutMs ?? 5000));
  const [concurrency, setConcurrency] = useState(String(initial?.limits.concurrency ?? 1));
  const [duration, setDuration] = useState(String(initial?.limits.maxDurationSeconds ?? 60));
  const [preview, setPreview] = useState<HttpEvalPlanPreview>();
  const [saved, setSaved] = useState<HttpEvalPlanVersionRecord>();
  const [pending, setPending] = useState<Pending>();
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [headReview, setHeadReview] = useState<HttpEvalPlanVersionRecord>();
  const [headOpened, setHeadOpened] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string }>();
  const active = useRef(true), generation = useRef(0), busy = useRef(false), unknown = useRef(false);
  const accepted = useRef(false), pinnedDraft = useRef<HttpEvalPlanDraft | undefined>(undefined), pinnedPreview = useRef<HttpEvalPlanPreview | undefined>(undefined);
  const pinnedRequest = useRef<{ request: HttpEvalPlanSaveRequest; body: string } | undefined>(undefined);
  const planIdentity = useRef(initialHead?.planId);
  const headRef = useRef<HttpEvalPlanHead | null>(initialHead), conflictRef = useRef(false), reviewedRef = useRef(false);

  useEffect(() => { active.current = true; return () => { active.current = false; generation.current++; }; }, []);
  const current = (token: number) => active.current && generation.current === token;
  function begin(action: Pending) { busy.current = true; setPending(action); setNotice(undefined); return ++generation.current; }
  function finish(token: number) { if (current(token)) { busy.current = false; setPending(undefined); } }
  function markUnknown(value: boolean) { unknown.current = value; setUncertain(value); }
  function invalidate() {
    generation.current++; pinnedDraft.current = undefined; pinnedPreview.current = undefined; pinnedRequest.current = undefined;
    setPreview(undefined); setNotice(undefined);
  }
  const locked = Boolean(pending) || uncertain || Boolean(saved);
  function edit(set: (value: string) => void, value: string) {
    if (busy.current || unknown.current || accepted.current) return;
    invalidate(); set(value);
  }
  function makeDraft(): HttpEvalPlanDraft {
    if (conflictRef.current && !reviewedRef.current) throw new Error("head_review_required");
    if (pinnedDraft.current) return pinnedDraft.current;
    const previous = headRef.current;
    const ids = setIds.split(/\s+/).filter(Boolean).sort();
    if (ids.length < 1 || ids.length > 8 || new Set(ids).size !== ids.length || ids.some(id => !uuid.test(id))) throw new Error("set_ids_invalid");
    if ([timeoutMs, concurrency, duration].some(value => !/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)))) throw new Error("integer_limits_required");
    const value: HttpEvalPlanDraft = {
      schemaVersion: "http-eval-plan-draft-v1", planId: previous?.planId ?? planIdentity.current ?? crypto.randomUUID(), versionId: crypto.randomUUID(),
      version: previous ? previous.version + 1 : 1, expectedVersionId: previous?.versionId ?? null,
      name: name.trim(), datasetVersionId: datasetId, evalSetVersionIds: ids,
      target: { targetId, targetVersion, endpoint: new URL(endpoint).href, timeoutMs: Number(timeoutMs) },
      limits: { concurrency: Number(concurrency), maxDurationSeconds: Number(duration) }
    };
    if (new TextEncoder().encode(JSON.stringify({ schemaVersion: "http-eval-plan-save-v1", draft: value, expectedPreviewFingerprint: "0".repeat(64) })).length > 2 * 1024 * 1024) throw new Error("request_limit");
    planIdentity.current = value.planId; pinnedDraft.current = value;
    return value;
  }
  async function previewPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || unknown.current || accepted.current || conflictRef.current && !reviewedRef.current) return;
    const token = begin("preview"); pinnedPreview.current = undefined; pinnedRequest.current = undefined; setPreview(undefined);
    try {
      const draft = makeDraft();
      const response = await fetch("/api/v1/http-target-plans/preview", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(draft) });
      const value = await readHttpTargetResponse(response);
      if (!current(token)) return;
      if (!response.ok || !jsonObject(value) || !previewShape(value.preview, draft)) {
        if (response.status === 409) { conflictRef.current = true; reviewedRef.current = false; setConflict(true); setReviewed(false); setHeadReview(undefined); }
        throw new Error("preview_rejected");
      }
      pinnedPreview.current = value.preview; setPreview(value.preview);
      setNotice({ error: false, text: "Complete preview ready. Preview made no target calls and saved nothing. Review the frozen sources and target, then explicitly save this version." });
    } catch {
      if (current(token)) setNotice({ error: true, text: "Preview is unavailable. Check the exact saved versions, supported evaluators, public HTTPS endpoint and limits. Your input is preserved; a changed head requires reload and review." });
    } finally { finish(token); }
  }
  function accept(record: HttpEvalPlanVersionRecord, replayed: boolean) {
    accepted.current = true; markUnknown(false); pinnedRequest.current = undefined;
    setSaved(record); setNotice({ error: false, text: replayed ? "Recovered the existing immutable plan version. No duplicate was saved and no target was called." : "Immutable plan version saved. Saving made no target calls; execution is a separate explicit action." });
  }
  async function save() {
    const plan = pinnedPreview.current;
    if (!canWrite || busy.current || accepted.current || !plan) return;
    const previouslyUnknown = unknown.current;
    const token = begin("save"); let started = false;
    try {
      const intent = pinnedRequest.current ?? (() => {
        const request: HttpEvalPlanSaveRequest = { schemaVersion: "http-eval-plan-save-v1", draft: plan.draft, expectedPreviewFingerprint: plan.fingerprint };
        return { request, body: JSON.stringify(request) };
      })();
      pinnedRequest.current = intent;
      if (new TextEncoder().encode(intent.body).length > 2 * 1024 * 1024) throw new Error("request_limit");
      started = true;
      const response = await fetch("/api/v1/http-target-plans", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: intent.body });
      const value = await readHttpTargetResponse(response);
      if (!current(token)) return;
      if (!response.ok) {
        if (!previouslyUnknown && [400, 401, 403, 404, 409, 413, 422].includes(response.status)) {
          markUnknown(false); pinnedRequest.current = undefined; pinnedPreview.current = undefined; pinnedDraft.current = undefined; setPreview(undefined);
          if (response.status === 409) { conflictRef.current = true; reviewedRef.current = false; setConflict(true); setReviewed(false); setHeadReview(undefined); }
          setNotice({ error: true, text: response.status === 409 ? "This save conflicts with stored state. Your text is preserved. Reload the current head and visibly review it before preparing a new intent." : "The save was rejected. Your input is preserved. Check access and limits, then preview again." });
        } else { markUnknown(true); setNotice({ error: true, text: "The save outcome is unknown. Keep this page open; retry the identical request or check the saved version. Editing stays locked." }); }
        return;
      }
      if (!jsonObject(value) || typeof value.replayed !== "boolean" || !recordShape(value.record, intent.request.draft, plan.workspaceId, plan.fingerprint)) throw new Error("saved_record_invalid");
      accept(value.record, value.replayed);
    } catch {
      if (current(token)) { markUnknown(started); setNotice({ error: true, text: started ? "The save outcome is unknown. Retry this unchanged request or check its exact saved version; editing stays locked." : "The request could not be prepared. Your input is preserved." }); }
    } finally { finish(token); }
  }
  async function recover() {
    const intent = pinnedRequest.current, plan = pinnedPreview.current;
    if (!intent || !plan || busy.current || accepted.current) return;
    const token = begin("recover");
    try {
      const response = await fetch(`/api/v1/http-target-plans/${intent.request.draft.planId}/versions/${intent.request.draft.versionId}`, { credentials: "same-origin", cache: "no-store" });
      const value = await readHttpTargetResponse(response);
      if (!current(token)) return;
      if (!response.ok || !jsonObject(value) || !recordShape(value.record, intent.request.draft, plan.workspaceId, plan.fingerprint)) throw new Error("saved_version_unavailable");
      accept(value.record, true);
    } catch { if (current(token)) setNotice({ error: true, text: "The version could not yet be recovered. An absent read does not cancel an in-flight save. Your identical retry remains available." }); }
    finally { finish(token); }
  }
  async function reloadHead() {
    const planId = headRef.current?.planId ?? planIdentity.current;
    if (!planId || busy.current || unknown.current || accepted.current) return;
    const token = begin("head"); reviewedRef.current = false; setReviewed(false); setHeadReview(undefined); setHeadOpened(false);
    try {
      const response = await fetch(`/api/v1/http-target-plans/${planId}`, { credentials: "same-origin", cache: "no-store" });
      const value = await readHttpTargetResponse(response);
      if (!current(token)) return;
      if (!response.ok || !jsonObject(value) || !jsonObject(value.detail) || !headShape(value.detail.head)
        || value.detail.head.planId !== planId || !headRecordShape(value.detail.record, value.detail.head)) throw new Error("head_unavailable");
      const next = value.detail.head, record = value.detail.record;
      if (record.content.draft.planId !== planId || record.content.draft.versionId !== next.versionId || record.content.draft.version !== next.version) throw new Error("head_identity_invalid");
      headRef.current = next; setHead(next); setHeadReview(record); pinnedDraft.current = undefined; pinnedPreview.current = undefined; pinnedRequest.current = undefined; setPreview(undefined);
      setNotice({ error: false, text: "Current saved head loaded. Your authored fields are preserved. Open its complete record and confirm review before preparing another version." });
    } catch { if (current(token)) setNotice({ error: true, text: "The current head could not be loaded. Your input remains preserved; another preview is blocked until review succeeds." }); }
    finally { finish(token); }
  }
  function createAnotherPlan() {
    if (initialHead || busy.current || unknown.current || !accepted.current) return;
    invalidate(); accepted.current = false; planIdentity.current = undefined; headRef.current = null;
    conflictRef.current = false; reviewedRef.current = false;
    setHead(null); setSaved(undefined); setConflict(false); setReviewed(false); setHeadOpened(false); setHeadReview(undefined);
    setName(""); setDatasetId(""); setSetIds(""); setTargetId(""); setTargetVersion(""); setEndpoint("");
    setTimeoutMs("5000"); setConcurrency("1"); setDuration("60");
  }

  return <div className="grid min-w-0 gap-5">
    <form onSubmit={previewPlan} className="grid min-w-0 gap-4 border border-border bg-panel p-4" aria-busy={Boolean(pending)}>
      <h2 className="font-semibold">{head ? `Prepare plan version ${head.version + 1}` : "Create an HTTP eval plan"}</h2>
      <p className="text-sm text-muted-foreground">Select exact saved inputs and 1–8 custom evaluator-set versions. This profile supports configured text-contains evaluators. Saving is separate from executing a target.</p>
      <div className="grid min-w-0 gap-1 text-sm font-medium"><label htmlFor={`${prefix}-name`}>Plan name</label><input id={`${prefix}-name`} className={inputClass} value={name} readOnly={locked} onChange={event => edit(setName, event.target.value)} required /></div>
      <label className="grid min-w-0 gap-1 text-sm font-medium">Recent saved dataset versions<select className={inputClass} value={sources.datasets.some(source => source.versionId === datasetId) ? datasetId : ""} disabled={locked} onChange={event => edit(setDatasetId, event.target.value)}><option value="">Choose a saved version or enter its exact ID below</option>{sources.datasets.map(source => <option key={source.versionId} value={source.versionId}>{source.name} · version {source.version}</option>)}</select></label>
      <div className="grid min-w-0 gap-1 text-sm font-medium"><label htmlFor={`${prefix}-dataset`}>Exact dataset version ID</label><input id={`${prefix}-dataset`} className={`${inputClass} font-mono text-xs`} value={datasetId} readOnly={locked} onChange={event => edit(setDatasetId, event.target.value)} required /></div>
      <p className="text-xs text-muted-foreground"><Link href="/evals/datasets" className="underline underline-offset-4">Inspect saved custom datasets</Link>. Keep the exact stored version ID.</p>
      <div className="grid min-w-0 gap-1 text-sm font-medium"><label htmlFor={`${prefix}-sets`}>Exact custom evaluator-set version IDs, one per line</label><textarea id={`${prefix}-sets`} className={`${inputClass} min-h-28 resize-y font-mono text-xs`} value={setIds} readOnly={locked} onChange={event => edit(setSetIds, event.target.value)} required /></div>
      <label className="grid min-w-0 gap-1 text-sm font-medium">Add a recent saved custom evaluator version<select className={inputClass} value="" disabled={locked} onChange={event => { if (event.target.value) edit(setSetIds, `${setIds}${setIds && !/\s$/.test(setIds) ? "\n" : ""}${event.target.value}`); }}><option value="">Choose a saved evaluator version to add</option>{sources.evalSets.map(source => <option key={source.versionId} value={source.versionId} disabled={setIds.split(/\s+/).includes(source.versionId)}>{source.name} · version {source.version}</option>)}</select></label>
      <p className="text-xs text-muted-foreground"><Link href="/evals/custom" className="underline underline-offset-4">Inspect saved custom evaluators</Link>. Every membership and threshold is pinned in the preview.</p>
      {sources.datasetsHasMore || sources.evalSetsHasMore ? <p className="text-xs text-muted-foreground">The selectors list the most recent 100 eligible versions. Earlier versions remain available through their exact saved IDs.</p> : null}
      <div className="grid min-w-0 gap-4 md:grid-cols-2">{([["target-id", "Target identity", targetId, setTargetId], ["target-version", "Declared target version", targetVersion, setTargetVersion]] as const).map(([id, label, value, setter]) => <div className="grid min-w-0 gap-1 text-sm font-medium" key={id}><label htmlFor={`${prefix}-${id}`}>{label}</label><input id={`${prefix}-${id}`} className={inputClass} value={value} readOnly={locked} onChange={event => edit(setter, event.target.value)} required /></div>)}</div>
      <div className="grid min-w-0 gap-1 text-sm font-medium"><label htmlFor={`${prefix}-endpoint`}>Public HTTPS endpoint</label><input id={`${prefix}-endpoint`} type="url" className={inputClass} value={endpoint} readOnly={locked} onChange={event => edit(setEndpoint, event.target.value)} required /><p className="text-xs font-normal text-muted-foreground">HTTP JSON target v1 with a public DNS hostname and default HTTPS port; no credentials, query, fragment, inline headers or redirects. Endpoint DNS and address safety are checked only during explicit execution.</p></div>
      <details className="min-w-0 text-sm"><summary className="cursor-pointer font-medium">HTTP target request and response protocol</summary><p className="mt-2 text-muted-foreground">The endpoint receives schemaVersion http-json-target-request-v1, requestFingerprint, runId, rowId and input, plus context/history only when present. It must return application/json with schemaVersion http-json-target-response-v1, the matching requestFingerprint and its actual output. Null and blank text are refused; JSON zero and false are preserved. Target-reported usage and cost are optional.</p></details>
      <div className="grid min-w-0 gap-4 md:grid-cols-3">{([["timeout", "Per-call timeout (ms)", timeoutMs, setTimeoutMs, 500, 10000], ["concurrency", "Concurrent calls", concurrency, setConcurrency, 1, 4], ["duration", "Run duration (seconds)", duration, setDuration, 5, 120]] as const).map(([id, label, value, setter, min, max]) => <div className="grid min-w-0 gap-1 text-sm font-medium" key={id}><label htmlFor={`${prefix}-${id}`}>{label}</label><input id={`${prefix}-${id}`} type="number" step="1" min={min} max={max} className={inputClass} value={value} readOnly={locked} onChange={event => edit(setter, event.target.value)} required /></div>)}</div>
      <div><button className={buttonClass} type="submit" disabled={locked || conflict && !reviewed}>{pending === "preview" ? "Preparing complete preview…" : "Preview plan without calling target"}</button></div>
    </form>
    {conflict ? <section className="grid min-w-0 gap-3 border border-border bg-muted p-4"><h2 className="font-semibold">Review the current saved head</h2><div><button type="button" className={buttonClass} disabled={locked} onClick={reloadHead}>{pending === "head" ? "Loading current head…" : "Reload current head"}</button></div>{headReview ? <><details onToggle={event => { if (event.currentTarget.open) setHeadOpened(true); }}><summary className="cursor-pointer text-sm font-medium">Inspect complete current head before another intent</summary><pre tabIndex={0} aria-label="Complete current saved plan head" className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words bg-muted p-3 text-xs">{JSON.stringify(headReview, null, 2)}</pre></details><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={locked || !headOpened} onChange={event => { reviewedRef.current = event.target.checked; setReviewed(event.target.checked); invalidate(); }} />I reviewed the current head and want to prepare a new version using my preserved fields.</label></> : null}</section> : null}
    {preview ? <section className="grid min-w-0 gap-3 border border-border bg-panel p-4"><h2 className="font-semibold">Complete plan preview</h2><PlanSnapshot content={preview.content} /><p className="text-xs text-muted-foreground">Worst-case complete record allowance: {preview.recordByteAllowance} bytes.</p><CompleteJson label="Inspect complete preview and save fingerprint" value={preview} />{!canWrite ? <p className="text-sm text-muted-foreground">Your session can preview. Workspace edit access is required to save or execute.</p> : null}<div className="flex flex-wrap gap-2"><button className={primaryClass} type="button" disabled={!canWrite || Boolean(pending) || Boolean(saved)} onClick={save}>{pending === "save" ? "Saving immutable plan…" : uncertain ? "Retry identical plan save" : "Save immutable plan without executing"}</button>{uncertain ? <button className={buttonClass} type="button" disabled={Boolean(pending)} onClick={recover}>Check exact saved plan version</button> : null}</div></section> : null}
    {notice ? <p role={notice.error ? "alert" : "status"} className={notice.error ? "text-sm text-danger" : "text-sm text-muted-foreground"}>{notice.text}</p> : null}
    {saved ? <div className="flex flex-wrap items-center gap-3 text-sm"><Link className="font-medium underline underline-offset-4" href={`/evals/plans/${saved.content.draft.planId}/versions/${saved.content.draft.versionId}`}>Open saved plan and execution controls</Link>{!initialHead ? <button className={buttonClass} type="button" onClick={createAnotherPlan}>Create another plan</button> : null}</div> : null}
  </div>;
}

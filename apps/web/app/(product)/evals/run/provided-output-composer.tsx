"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ProvidedOutputRunDraft, ProvidedOutputRunPlan, ProvidedOutputRunRecord, ProvidedOutputRunRequest } from "@open-evals/core";
import type { ProvidedOutputHistoryView, ProvidedOutputInputsView, ProvidedOutputSourcesView } from "@/lib/provided-output-types";

const inputClass = "w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60 read-only:bg-muted";
const buttonClass = "inline-flex min-h-9 items-center justify-center rounded-md border border-border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";
const primaryClass = `${buttonClass} bg-foreground text-background`;
const hash = /^[a-f0-9]{64}$/;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024 + 4096;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonField(value: unknown) {
  return object(value) && typeof value.present === "boolean" && Object.hasOwn(value, "value");
}

function inputsShape(value: unknown, datasetVersionId: string, evalSetVersionId: string): value is ProvidedOutputInputsView {
  if (!object(value) || !object(value.dataset) || !object(value.dataset.dataset) || !object(value.dataset.version)
    || value.dataset.version.id !== datasetVersionId || typeof value.dataset.dataset.name !== "string"
    || !Array.isArray(value.dataset.rows) || !value.dataset.rows.length || value.dataset.rows.length > 100
    || !object(value.evalSet) || !object(value.evalSet.contract) || value.evalSet.contract.id !== evalSetVersionId
    || value.evalSet.contract.schemaVersion !== "custom-eval-set-v1" || typeof value.evalSet.contract.name !== "string"
    || !Array.isArray(value.evalSet.contract.itemVersions) || !value.evalSet.contract.itemVersions.length
    || !Array.isArray(value.evalSet.members) || !object(value.evalSet.contract.gates)) return false;
  const ids = new Set<string>();
  return value.dataset.rows.every(row => {
    if (!object(row) || typeof row.id !== "string" || typeof row.rowKey !== "string" || ids.has(row.id)
      || !Object.hasOwn(row, "input") || !jsonField(row.expectedOutput) || !jsonField(row.context)
      || !jsonField(row.history) || !jsonField(row.traceFixture) || !object(row.metadata)) return false;
    ids.add(row.id);
    return true;
  });
}

function sameDraft(value: unknown, draft: ProvidedOutputRunDraft) {
  if (!object(value) || value.schemaVersion !== draft.schemaVersion || value.runId !== draft.runId
    || value.datasetVersionId !== draft.datasetVersionId || value.evalSetVersionId !== draft.evalSetVersionId
    || !Array.isArray(value.outputs) || value.outputs.length !== draft.outputs.length) return false;
  const expected = new Map(draft.outputs.map(row => [row.rowId, row.output]));
  const seen = new Set<string>();
  return value.outputs.every(row => {
    if (!object(row) || typeof row.rowId !== "string" || seen.has(row.rowId) || !expected.has(row.rowId)
      || row.output !== expected.get(row.rowId)) return false;
    seen.add(row.rowId);
    return true;
  });
}

function planShape(value: unknown, draft: ProvidedOutputRunDraft): value is ProvidedOutputRunPlan {
  return object(value) && value.schemaVersion === "provided-output-run-v1" && value.publicRunId === draft.runId
    && typeof value.workspaceId === "string" && typeof value.fingerprint === "string" && hash.test(value.fingerprint)
    && sameDraft(value.draft, draft) && inputsShape({ dataset: value.dataset, evalSet: value.evalSet }, draft.datasetVersionId, draft.evalSetVersionId)
    && object(value.sampleManifest) && Array.isArray(value.sampleManifest.rows) && value.sampleManifest.rows.length === draft.outputs.length
    && object(value.policy) && value.policy.maxTargetCalls === 0 && value.policy.maxJudgeCalls === 0
    && value.policy.expectedOutputVisibility === "visible";
}

function recordShape(value: unknown, request: ProvidedOutputRunRequest, workspaceId: string): value is ProvidedOutputRunRecord {
  return object(value) && value.schemaVersion === "provided-output-run-record-v1" && value.workspaceId === workspaceId
    && typeof value.fingerprint === "string" && hash.test(value.fingerprint) && planShape(value.plan, request.draft)
    && value.plan.workspaceId === workspaceId && value.plan.fingerprint === request.expectedPlanFingerprint
    && object(value.execution) && value.execution.schemaVersion === "provided-output-execution-v1"
    && value.execution.planFingerprint === request.expectedPlanFingerprint
    && Array.isArray(value.execution.results) && Array.isArray(value.execution.gates);
}

async function readJson(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("response_too_large");
  }
  if (!response.body) throw new Error("response_body_missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("response_too_large");
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    reader.releaseLock();
  }
}

function display(value: unknown) {
  return JSON.stringify(value, null, 2);
}

type Pending = "sources" | "preview" | "run" | "recover";

export function ProvidedOutputComposer({ sources, history, canWrite }: {
  sources: ProvidedOutputSourcesView;
  history: ProvidedOutputHistoryView;
  canWrite: boolean;
}) {
  const [datasetVersionId, setDatasetVersionId] = useState("");
  const [evalSetVersionId, setEvalSetVersionId] = useState("");
  const [inputs, setInputs] = useState<ProvidedOutputInputsView>();
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ProvidedOutputRunPlan>();
  const [receipt, setReceipt] = useState<ProvidedOutputRunRecord>();
  const [pending, setPending] = useState<Pending>();
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string }>();
  const draft = useRef<ProvidedOutputRunDraft | undefined>(undefined);
  const request = useRef<ProvidedOutputRunRequest | undefined>(undefined);
  const pinnedPreview = useRef<ProvidedOutputRunPlan | undefined>(undefined);
  const active = useRef(true);
  const generation = useRef(0);
  const busy = useRef(false);
  const unknownOutcome = useRef(false);

  useEffect(() => {
    active.current = true;
    busy.current = false;
    return () => { active.current = false; generation.current += 1; };
  }, []);

  const current = (token: number) => active.current && generation.current === token;
  const locked = Boolean(pending) || uncertain;
  function begin(action: Pending) {
    busy.current = true;
    setPending(action);
    setNotice(undefined);
    return ++generation.current;
  }
  function finish(token: number) {
    if (current(token)) { busy.current = false; setPending(undefined); }
  }
  function markUncertain(value: boolean) {
    unknownOutcome.current = value;
    setUncertain(value);
  }
  function invalidate() {
    generation.current += 1;
    draft.current = undefined;
    request.current = undefined;
    pinnedPreview.current = undefined;
    setPreview(undefined);
    setReceipt(undefined);
    setNotice(undefined);
  }
  function editSource(kind: "dataset" | "evalSet", value: string) {
    if (busy.current || unknownOutcome.current) return;
    invalidate();
    setInputs(undefined);
    setOutputs({});
    if (kind === "dataset") setDatasetVersionId(value); else setEvalSetVersionId(value);
  }
  function editOutput(rowId: string, value: string) {
    if (busy.current || unknownOutcome.current) return;
    invalidate();
    setOutputs(previous => ({ ...previous, [rowId]: value }));
  }

  async function loadSources() {
    if (busy.current || unknownOutcome.current) return;
    if (!datasetVersionId || !evalSetVersionId) {
      setNotice({ kind: "error", text: "Choose or enter both saved version IDs." });
      return;
    }
    invalidate();
    const token = begin("sources");
    try {
      const query = new URLSearchParams({ datasetVersionId, evalSetVersionId });
      const response = await fetch(`/api/v1/provided-output-runs/sources?${query}`, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      const value = await readJson(response);
      if (!current(token)) return;
      if (!response.ok || !object(value) || !inputsShape(value.inputs, datasetVersionId, evalSetVersionId)) throw new Error("sources_unavailable");
      const loaded = value.inputs;
      setInputs(loaded);
      setOutputs(previous => Object.fromEntries(loaded.dataset.rows.map(row => [row.id, Object.hasOwn(previous, row.id) ? previous[row.id] ?? "" : ""])));
      setNotice({ kind: "info", text: `Loaded all ${loaded.dataset.rows.length} rows and the exact saved evaluator version. Enter actual outputs; empty text is allowed.` });
    } catch {
      if (current(token)) setNotice({ kind: "error", text: "These saved versions could not be loaded. Check both IDs and your workspace session. Oversized or invalid sources are refused; no subset is selected." });
    } finally { finish(token); }
  }

  function makeDraft(): ProvidedOutputRunDraft {
    if (!inputs) throw new Error("sources_not_loaded");
    const rows = inputs.dataset.rows.map(row => ({ rowId: row.id, output: Object.hasOwn(outputs, row.id) ? outputs[row.id] ?? "" : "" }));
    const encoder = new TextEncoder();
    if (rows.some(row => encoder.encode(row.output).length > 65536)
      || rows.reduce((total, row) => total + encoder.encode(row.output).length, 0) > 1048576) throw new Error("output_limit");
    const value: ProvidedOutputRunDraft = draft.current ?? {
      schemaVersion: "provided-output-run-draft-v1", runId: crypto.randomUUID(), datasetVersionId, evalSetVersionId, outputs: rows
    };
    const eventualRequest = { schemaVersion: "provided-output-run-request-v1", draft: value, expectedPlanFingerprint: "0".repeat(64) };
    if (encoder.encode(JSON.stringify(eventualRequest)).length > 2097152) throw new Error("request_limit");
    draft.current = value;
    return value;
  }

  async function previewRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || unknownOutcome.current) return;
    const token = begin("preview");
    pinnedPreview.current = undefined;
    request.current = undefined;
    setPreview(undefined);
    setReceipt(undefined);
    try {
      const intent = makeDraft();
      const response = await fetch("/api/v1/provided-output-runs/preview", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(intent)
      });
      const value = await readJson(response);
      if (!current(token)) return;
      if (!response.ok || !object(value) || !planShape(value.plan, intent)) throw new Error("preview_unavailable");
      setInputs({ dataset: value.plan.dataset, evalSet: value.plan.evalSet });
      pinnedPreview.current = value.plan;
      setPreview(value.plan);
      setNotice({ kind: "info", text: "Preview ready. Review the pinned inputs, evaluator and outputs before explicitly running the deterministic checks. Nothing has been saved or executed by preview." });
    } catch {
      if (current(token)) setNotice({ kind: "error", text: "Preview could not be prepared. Load valid saved versions and keep each output within 64 KiB, all outputs within 1 MiB and the JSON request within 2 MiB. Your text is preserved." });
    } finally { finish(token); }
  }

  function acceptRecord(record: ProvidedOutputRunRecord, replayed: boolean) {
    setReceipt(record);
    markUncertain(false);
    request.current = undefined;
    pinnedPreview.current = undefined;
    setNotice({ kind: "info", text: replayed ? "Recovered the existing immutable run. No duplicate run was created." : "Deterministic scoring is recorded. Open the immutable result to inspect every gate and supplied value." });
  }

  async function run() {
    const pinned = pinnedPreview.current;
    if (!canWrite || busy.current || receipt || !pinned) return;
    const token = begin("run");
    let started = false;
    try {
      const intent = request.current ?? {
        schemaVersion: "provided-output-run-request-v1" as const, draft: pinned.draft, expectedPlanFingerprint: pinned.fingerprint
      };
      request.current = intent;
      const body = JSON.stringify(intent);
      if (new TextEncoder().encode(body).length > 2097152) throw new Error("request_limit");
      started = true;
      const response = await fetch("/api/v1/provided-output-runs", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body
      });
      const value = await readJson(response);
      if (!current(token)) return;
      if (!response.ok) {
        if ([400, 401, 403, 404, 409, 413, 422].includes(response.status)) {
          request.current = undefined;
          pinnedPreview.current = undefined;
          markUncertain(false);
          setPreview(undefined);
          draft.current = undefined;
          setNotice({ kind: "error", text: response.status === 409 ? "The preview changed or this run ID conflicts with stored data. Your outputs are preserved. Reload the selected versions, review them, then preview a new intent." : "The run was rejected. Check your workspace edit access and source/output limits, then prepare a new preview. Your text is preserved." });
        } else {
          markUncertain(true);
          setNotice({ kind: "error", text: "The run outcome is unknown. Keep this page open and retry the unchanged request or check its saved run ID." });
        }
        return;
      }
      if (!object(value) || typeof value.replayed !== "boolean" || !recordShape(value.record, intent, pinned.workspaceId)) throw new Error("run_response_invalid");
      acceptRecord(value.record, value.replayed);
    } catch {
      if (current(token)) {
        markUncertain(started);
        setNotice({ kind: "error", text: started ? "The run outcome is unknown. Retry this unchanged request or check the saved run. Editing stays locked to avoid creating another intent." : "The run request could not be prepared. Your outputs are preserved; make a new preview." });
      }
    } finally { finish(token); }
  }

  async function recover() {
    const intent = request.current;
    const pinned = pinnedPreview.current;
    if (!intent || !pinned || busy.current) return;
    const token = begin("recover");
    try {
      const response = await fetch(`/api/v1/provided-output-runs/${encodeURIComponent(intent.draft.runId)}`, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      const value = await readJson(response);
      if (!current(token)) return;
      if (!response.ok || !object(value) || !recordShape(value.record, intent, pinned.workspaceId)) throw new Error("run_not_recovered");
      acceptRecord(value.record, true);
    } catch {
      if (current(token)) setNotice({ kind: "error", text: "The run could not yet be recovered. An absent read does not cancel an in-flight save. Your unchanged retry and outputs are preserved." });
    } finally { finish(token); }
  }

  return (
    <div className="grid min-w-0 gap-5">
      <form onSubmit={previewRun} className="grid min-w-0 gap-5" aria-busy={Boolean(pending)}>
        <section className="grid min-w-0 gap-4 border border-border bg-panel p-4" aria-labelledby="provided-source-heading">
          <div><h2 id="provided-source-heading" className="font-semibold">1. Select saved versions</h2><p className="mt-1 text-sm text-muted-foreground">Choose from the most recent 100 eligible versions, or enter exact IDs, including older versions. This mode uses every row; it never silently samples.</p></div>
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <div className="grid min-w-0 content-start gap-3">
              <label className="grid min-w-0 gap-1 text-sm font-medium">Recent dataset versions<select className={inputClass} disabled={locked} value={sources.datasets.some(item => item.versionId === datasetVersionId) ? datasetVersionId : ""} onChange={event => editSource("dataset", event.target.value)}><option value="">Choose a version or enter its ID below</option>{sources.datasets.map(item => <option key={item.versionId} value={item.versionId}>{item.name} · version {item.version} · {item.versionId}</option>)}</select></label>
              {!sources.datasets.length ? <p className="text-sm text-muted-foreground">No dataset versions are listed in this workspace. This form does not create or seed datasets.</p> : null}
              <label className="grid min-w-0 gap-1 text-sm font-medium">Dataset version ID<input className={`${inputClass} font-mono text-xs`} value={datasetVersionId} maxLength={512} readOnly={locked} onChange={event => editSource("dataset", event.target.value)} /></label>
              {sources.datasetsHasMore ? <p className="text-xs text-muted-foreground">Earlier dataset versions remain available by exact ID.</p> : null}
            </div>
            <div className="grid min-w-0 content-start gap-3">
              <label className="grid min-w-0 gap-1 text-sm font-medium">Recent custom Eval Set versions<select className={inputClass} disabled={locked} value={sources.evalSets.some(item => item.versionId === evalSetVersionId) ? evalSetVersionId : ""} onChange={event => editSource("evalSet", event.target.value)}><option value="">Choose a version or enter its ID below</option>{sources.evalSets.map(item => <option key={item.versionId} value={item.versionId}>{item.name} · version {item.version} · {item.versionId}</option>)}</select></label>
              {!sources.evalSets.length ? <p className="text-sm text-muted-foreground">No custom evaluator versions are listed. <Link className="underline underline-offset-4" href="/evals/custom">Create a custom Eval Set</Link>.</p> : null}
              <label className="grid min-w-0 gap-1 text-sm font-medium">Custom Eval Set version ID<input className={`${inputClass} font-mono text-xs`} value={evalSetVersionId} maxLength={36} readOnly={locked} onChange={event => editSource("evalSet", event.target.value)} /></label>
              {sources.evalSetsHasMore ? <p className="text-xs text-muted-foreground">Earlier custom versions remain available by exact ID.</p> : null}
            </div>
          </div>
          <div><button className={buttonClass} type="button" onClick={loadSources} disabled={locked || !datasetVersionId || !evalSetVersionId}>{pending === "sources" ? "Loading versions…" : "Load selected versions"}</button></div>
        </section>
        {inputs ? <section className="grid min-w-0 gap-4 border border-border bg-panel p-4" aria-labelledby="provided-output-heading">
          <div><h2 id="provided-output-heading" className="font-semibold">2. Supply actual outputs</h2><p className="mt-1 text-sm text-muted-foreground">{inputs.dataset.dataset.name} · {inputs.dataset.rows.length} complete rows. Outputs are associated with stored row IDs. Reference answers are visible for inspection and are never copied into actual outputs.</p><p className="mt-1 text-xs text-muted-foreground">Each output: up to 64 KiB UTF-8; all output text: up to 1 MiB. Empty actual text is valid and can fail the check.</p></div>
          <ol className="grid min-w-0 gap-4">{inputs.dataset.rows.map(row => <li key={row.id} className="grid min-w-0 gap-3 border border-border p-3">
            <div><h3 className="break-words text-sm font-semibold">{row.rowKey}</h3><p className="mt-1 break-all font-mono text-xs text-muted-foreground">Stored row ID: {row.id}</p></div>
            <details><summary className="cursor-pointer text-sm font-medium">Inspect complete saved input and references</summary><div className="mt-2 grid min-w-0 gap-2 text-xs"><p>Input</p><pre tabIndex={0} aria-label={`Saved input for ${row.rowKey}`} className="max-h-64 overflow-auto whitespace-pre-wrap break-words bg-muted p-3">{display(row.input)}</pre><p>Expected output {row.expectedOutput.present ? "(supplied reference)" : "(not supplied)"}</p>{row.expectedOutput.present ? <pre tabIndex={0} className="max-h-64 overflow-auto whitespace-pre-wrap break-words bg-muted p-3">{display(row.expectedOutput.value)}</pre> : null}<pre tabIndex={0} aria-label={`Saved context and metadata for ${row.rowKey}`} className="max-h-64 overflow-auto whitespace-pre-wrap break-words bg-muted p-3">{display({ context: row.context, history: row.history, traceFixture: row.traceFixture, metadata: row.metadata, reviewStatus: row.reviewStatus })}</pre></div></details>
            <label className="grid min-w-0 gap-1 text-sm font-medium">Actual output for {row.rowKey}<textarea className={`${inputClass} min-h-28 resize-y font-mono`} maxLength={65536} value={Object.hasOwn(outputs, row.id) ? outputs[row.id] ?? "" : ""} readOnly={locked} onChange={event => editOutput(row.id, event.target.value)} /></label>
          </li>)}</ol>
          <div><button className={buttonClass} type="submit" disabled={locked}>{pending === "preview" ? "Preparing preview…" : "Preview pinned run"}</button></div>
        </section> : null}
      </form>
      {preview ? <section className="grid min-w-0 gap-3 border border-border bg-panel p-4" aria-labelledby="provided-preview-heading">
        <h2 id="provided-preview-heading" className="font-semibold">3. Review and explicitly run</h2>
        <p className="text-sm">{preview.dataset.rows.length} rows × {preview.evalSet.members.length} pinned evaluator members. {preview.evalSet.contract.name}. No target, model or judge is called.</p>
        <p className="text-sm text-muted-foreground">Every critical check must pass for the Eval Set/run gate. The dataset pass-rate gate is recorded separately. Preview has not saved a plan or scored these outputs.</p>
        <dl className="grid min-w-0 gap-2 text-xs"><div><dt className="font-medium">Public run / retry ID</dt><dd className="break-all font-mono">{preview.publicRunId}</dd></div><div><dt className="font-medium">Pinned plan fingerprint</dt><dd className="break-all font-mono">{preview.fingerprint}</dd></div></dl>
        <details><summary className="cursor-pointer text-sm font-medium">Inspect complete pinned preview</summary><pre tabIndex={0} aria-label="Complete pinned preview" className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words bg-muted p-3 text-xs">{display(preview)}</pre></details>
        {!canWrite ? <p className="text-sm text-muted-foreground">Your session can preview. Workspace edit access is required to run and save results.</p> : null}
        <div className="flex flex-wrap gap-2"><button className={primaryClass} type="button" disabled={!canWrite || Boolean(pending) || Boolean(receipt)} onClick={run}>{pending === "run" ? "Recording run…" : uncertain ? "Retry unchanged run" : "Run deterministic checks"}</button>{uncertain ? <button className={buttonClass} type="button" disabled={Boolean(pending)} onClick={recover}>{pending === "recover" ? "Checking saved run…" : "Check saved run"}</button> : null}</div>
      </section> : null}
      {notice ? <p role={notice.kind === "error" ? "alert" : "status"} className={notice.kind === "error" ? "text-sm text-danger" : "text-sm text-muted-foreground"}>{notice.text}</p> : null}
      {receipt ? <p className="text-sm"><Link className="font-medium underline underline-offset-4" href={`/evals/run/${receipt.plan.publicRunId}`}>Open immutable run</Link></p> : null}
      <section className="grid min-w-0 gap-3" aria-labelledby="provided-history-heading"><h2 id="provided-history-heading" className="font-semibold">Recent supplied-output runs</h2>{history.runs.length ? <ol className="grid min-w-0 gap-2">{history.runs.map(item => <li key={item.runId} className="grid min-w-0 gap-1 border border-border bg-panel p-3 text-sm"><Link className="break-all font-mono underline underline-offset-4" href={`/evals/run/${item.runId}`}>{item.runId}</Link><p>{item.rowCount} rows · {item.passed ? "Run gate passed" : "Run gate failed"}</p><time className="text-xs text-muted-foreground" dateTime={item.createdAt}>{item.createdAt}</time><p className="break-all font-mono text-xs text-muted-foreground">{item.planFingerprint}</p></li>)}</ol> : <p className="text-sm text-muted-foreground">No supplied-output runs are recorded in this workspace.</p>}{history.hasMore ? <p className="text-xs text-muted-foreground">Showing the most recent 20 runs. Earlier immutable runs remain accessible by their public run IDs.</p> : null}</section>
    </div>
  );
}

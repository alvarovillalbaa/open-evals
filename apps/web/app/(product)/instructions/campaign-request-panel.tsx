"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CampaignPreparationInput, CampaignRequestDTO, PreparedPromptCampaignRequest, PromptVersion } from "@open-evals/core";
import { AuthoringRequestError, authoringRequest } from "./instruction-authoring-client";

const operations = ["delete_one_instruction", "split_instruction", "rewrite_one_instruction", "strictness_tighten", "strictness_relax", "order_test"] as const;
const limitNames = ["providerCalls", "targetCalls", "judgeCalls", "releaseChanges"] as const;
const inputClass = "min-h-10 min-w-0 w-full rounded-md border border-border bg-panel px-3 py-2 text-base disabled:opacity-60";
const buttonClass = "inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-panel px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const primaryClass = "inline-flex min-h-10 items-center justify-center rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50";
const digest = (value: unknown, length = 64): value is string => typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const exactKeys = (value: unknown, names: readonly string[]): value is Record<string, unknown> => record(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const sameOperations = (value: unknown) => Array.isArray(value) && value.length === operations.length && operations.every((operation, index) => value[index] === operation);
const zeroLimits = (value: unknown) => exactKeys(value, limitNames) && limitNames.every(name => value[name] === 0);
const sameInput = (left: CampaignPreparationInput, right: CampaignPreparationInput) => left.requestId === right.requestId && left.baselineVersionId === right.baselineVersionId && left.componentId === right.componentId && left.objective === right.objective;

function validObjective(value: unknown): value is string {
  if (typeof value !== "string" || !value.length || value.length > 2048 || value.includes("\0")) return false;
  const bytes = new TextEncoder().encode(value);
  return bytes.length <= 2048 && new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) === value;
}

function previewMatches(value: unknown, input: CampaignPreparationInput, definitionId: string, version: PromptVersion): value is PreparedPromptCampaignRequest {
  if (!exactKeys(value, ["input", "approvalId", "requestFingerprint", "payloadHash", "payloadPreview"])
    || !exactKeys(value.input, ["requestId", "baselineVersionId", "componentId", "objective"])
    || !sameInput(value.input as unknown as CampaignPreparationInput, input)
    || value.approvalId !== `campaign_request_${input.requestId}` || !digest(value.requestFingerprint) || !digest(value.payloadHash)) return false;
  const payload = value.payloadPreview;
  return exactKeys(payload, ["schemaVersion", "workspaceId", "actorId", "definitionId", "requestId", "baselineVersionId", "componentId", "objective", "baselineSemanticFingerprint", "baselineContentHash", "requestedOperations", "limits", "candidateStatus", "evidenceLevel", "requestFingerprint"])
    && payload.schemaVersion === "prompt-ablation-request-v1" && text(payload.workspaceId) && text(payload.actorId)
    && payload.definitionId === definitionId && sameInput(payload as unknown as CampaignPreparationInput, input)
    && payload.baselineContentHash === version.contentHash && digest(payload.baselineContentHash, 24) && digest(payload.baselineSemanticFingerprint)
    && payload.requestFingerprint === value.requestFingerprint && sameOperations(payload.requestedOperations) && zeroLimits(payload.limits)
    && payload.candidateStatus === "draft" && payload.evidenceLevel === "hypothesis only";
}

function storedRequest(value: unknown, definitionId: string, version: PromptVersion): value is CampaignRequestDTO {
  if (!exactKeys(value, ["id", "requestId", "definitionId", "baselineVersionId", "componentId", "objective", "payloadHash", "requestFingerprint", "baselineContentHash", "baselineSemanticFingerprint", "requestedOperations", "limits", "status", "createdAt", "baselineVerified"])) return false;
  return uuid(value.requestId) && value.id === `campaign_request_${value.requestId}` && value.definitionId === definitionId && value.baselineVersionId === version.id
    && text(value.componentId) && validObjective(value.objective) && digest(value.payloadHash) && digest(value.requestFingerprint)
    && digest(value.baselineContentHash, 24) && digest(value.baselineSemanticFingerprint) && sameOperations(value.requestedOperations) && zeroLimits(value.limits)
    && typeof value.baselineVerified === "boolean" && (!value.baselineVerified || value.baselineContentHash === version.contentHash)
    && typeof value.status === "string" && ["pending", "approved", "rejected", "expired"].includes(value.status)
    && typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt));
}

function matchesAttempt(value: CampaignRequestDTO, attempt: PreparedPromptCampaignRequest) {
  return sameInput(value, attempt.input) && value.id === attempt.approvalId && value.payloadHash === attempt.payloadHash
    && value.requestFingerprint === attempt.requestFingerprint && value.baselineContentHash === attempt.payloadPreview.baselineContentHash
    && value.baselineSemanticFingerprint === attempt.payloadPreview.baselineSemanticFingerprint;
}

function requestError(failure: unknown): string {
  if (failure instanceof AuthoringRequestError) {
    if (failure.status === 401) return "Sign in, then retry or check this same request ID. A client interruption does not undo a stored request.";
    if (failure.status === 403) return "Your current access does not permit this request. Its local input and identity are retained.";
    if (failure.status === 404) return "This definition or saved baseline is unavailable in your current workspace.";
    if (failure.status === 409) return "The reviewed request conflicts with stored identity or baseline source. Keep the request ID and check storage.";
    if (failure.status === 503) return "Storage is unavailable. Keep the request ID and retry the same submission or check storage when it returns.";
    if (failure.status !== undefined) return `The request was rejected (${failure.message}).`;
  }
  if (failure instanceof Error && failure.name !== "TypeError" && !(failure instanceof AuthoringRequestError)) return failure.message;
  return "The response could not be confirmed. Keep this request ID; retry the same submission or check the stored request.";
}

type Props = { definitionId: string; version: PromptVersion; canWrite: boolean; onWorkChange?: (hasWork: boolean) => void };
type Owner = { controller: AbortController; revision: number; kind: "preview" | "save" | "check" };

export function CampaignRequestPanel(props: Props) {
  // Immutable source identity owns every local input and response, including equal rendered hashes.
  return <CampaignRequestContext key={JSON.stringify([props.definitionId, props.version])} {...props} />;
}

function CampaignRequestContext({ definitionId, version, canWrite, onWorkChange }: Props) {
  const mutable = version.components.filter(component => !component.locked);
  const [componentId, setComponentId] = useState(mutable[0]?.id ?? "");
  const [objective, setObjective] = useState("");
  const [requestId, setRequestId] = useState("");
  const [reviewed, setReviewed] = useState<PreparedPromptCampaignRequest | null>(null);
  const [attempt, setAttempt] = useState<PreparedPromptCampaignRequest | null>(null);
  const [saved, setSaved] = useState<CampaignRequestDTO | null>(null);
  const [busy, setBusy] = useState<Owner["kind"] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState<CampaignRequestDTO[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const mounted = useRef(false);
  const revision = useRef(0);
  const ownerRef = useRef<Owner | null>(null);
  const historyOwner = useRef<AbortController | null>(null);
  const attemptRef = useRef<PreparedPromptCampaignRequest | null>(null);
  const savedRef = useRef<CampaignRequestDTO | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const apiPath = `/api/v1/instructions/${encodeURIComponent(definitionId)}/campaign-requests`;
  const hasWork = Boolean(requestId) && !saved;

  useEffect(() => {
    mounted.current = true;
    void loadHistory();
    return () => {
      mounted.current = false;
      revision.current += 1;
      ownerRef.current?.controller.abort();
      historyOwner.current?.abort();
      onWorkChange?.(false);
    };
  }, []);

  useEffect(() => { onWorkChange?.(hasWork); }, [hasWork, onWorkChange]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function owns(owner: Owner) { return mounted.current && ownerRef.current === owner && revision.current === owner.revision; }
  function begin(kind: Owner["kind"]) {
    ownerRef.current?.controller.abort();
    const owner = { controller: new AbortController(), revision: revision.current, kind };
    ownerRef.current = owner;
    setBusy(kind); setError(""); setNotice("");
    return owner;
  }
  function finish(owner: Owner) { if (owns(owner)) { ownerRef.current = null; setBusy(null); } }

  function edit(nextComponent: string, nextObjective: string) {
    if (!canWrite || attemptRef.current) return;
    try {
      const id = crypto.randomUUID();
      revision.current += 1;
      ownerRef.current?.controller.abort(); ownerRef.current = null;
      setBusy(null); setReviewed(null); setError(""); setNotice("");
      setRequestId(id); setComponentId(nextComponent); setObjective(nextObjective);
    } catch { setError("This browser could not create a request ID. Your existing input is retained."); }
  }

  function reset() {
    if (attemptRef.current && !savedRef.current) return;
    revision.current += 1;
    ownerRef.current?.controller.abort(); ownerRef.current = null;
    attemptRef.current = null; savedRef.current = null;
    setBusy(null); setAttempt(null); setSaved(null); setReviewed(null); setRequestId("");
    setComponentId(mutable[0]?.id ?? ""); setObjective(""); setError(""); setNotice("");
  }

  async function preview() {
    if (!canWrite || attemptRef.current || ownerRef.current || !validObjective(objective) || !mutable.some(component => component.id === componentId)) return;
    let input: CampaignPreparationInput;
    try {
      input = { requestId: requestId || crypto.randomUUID(), baselineVersionId: version.id, componentId, objective };
      setRequestId(input.requestId);
    } catch { setError("This browser could not create a request ID. Your input is retained."); return; }
    const owner = begin("preview"); setReviewed(null);
    try {
      const result = await authoringRequest<unknown>(`${apiPath}/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }, owner.controller.signal);
      if (!owns(owner)) return;
      if (!previewMatches(result, input, definitionId, version)) throw new Error("The preview did not match this saved baseline and request. Review again before submitting.");
      setReviewed(result); setNotice("Review the six requested hypotheses and zero-call limits before saving a pending request.");
    } catch (failure) { if (owns(owner)) setError(requestError(failure)); }
    finally { finish(owner); }
  }

  function acknowledge(value: CampaignRequestDTO) {
    savedRef.current = value; setSaved(value);
    setNotice(value.status === "pending" ? "Request prepared; approval not granted; no campaign started." : `Stored request recovered with decision status ${value.status}. This interface did not decide or start a campaign.`);
  }

  async function save() {
    if (!canWrite || ownerRef.current || savedRef.current) return;
    const current = attemptRef.current ?? reviewed;
    if (!current) return;
    attemptRef.current = current; setAttempt(current);
    const owner = begin("save");
    try {
      const result = await authoringRequest<unknown>(apiPath, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...current.input, previewFingerprint: current.payloadHash }) }, owner.controller.signal);
      if (!owns(owner)) return;
      if (!exactKeys(result, ["request", "replayed"]) || typeof result.replayed !== "boolean" || !storedRequest(result.request, definitionId, version) || !matchesAttempt(result.request, current)) {
        throw new Error("The submission response did not match the reviewed request. Keep its ID and check storage; the outcome is unknown.");
      }
      acknowledge(result.request);
    } catch (failure) { if (owns(owner)) setError(requestError(failure)); }
    finally { finish(owner); }
  }

  async function checkStored() {
    const current = attemptRef.current;
    if (!current || ownerRef.current) return;
    const owner = begin("check");
    try {
      const result = await authoringRequest<unknown>(`${apiPath}?baselineVersionId=${encodeURIComponent(version.id)}&requestId=${encodeURIComponent(current.input.requestId)}`, { method: "GET" }, owner.controller.signal);
      if (!owns(owner)) return;
      if (!validCollection(result, definitionId, version) || result.requests.length > 1 || result.hasMore || result.requests.some(item => !matchesAttempt(item, current))) {
        throw new Error("Storage returned a different or invalid request. Keep the original input and request ID.");
      }
      if (result.requests[0]) acknowledge(result.requests[0]);
      else setNotice("No matching request was found at this check. The earlier outcome may still be unknown; keep this ID and retry the same submission.");
    } catch (failure) { if (owns(owner)) setError(requestError(failure)); }
    finally { finish(owner); }
  }

  async function loadHistory() {
    historyOwner.current?.abort();
    const controller = new AbortController(); historyOwner.current = controller;
    setHistoryBusy(true); setHistoryError("");
    try {
      const result = await authoringRequest<unknown>(`${apiPath}?baselineVersionId=${encodeURIComponent(version.id)}`, { method: "GET" }, controller.signal);
      if (!mounted.current || historyOwner.current !== controller || controller.signal.aborted) return;
      if (!validCollection(result, definitionId, version)) throw new Error("The request history did not match this saved baseline.");
      setHistory(result.requests); setHasMore(result.hasMore);
    } catch (failure) {
      if (mounted.current && historyOwner.current === controller && !controller.signal.aborted) setHistoryError(requestError(failure));
    } finally {
      if (mounted.current && historyOwner.current === controller) { historyOwner.current = null; setHistoryBusy(false); }
    }
  }

  const visiblePreview = attempt ?? reviewed;
  return <section aria-label="Campaign preparation requests" className="grid min-w-0 gap-4 border border-border bg-panel p-4">
    <div><h2 className="font-semibold">Request a deterministic hypothesis review</h2><p className="mt-2 text-sm text-muted-foreground">Prepare a pending request for six existing ablation operations against this saved version. Hypotheses have no evaluation evidence. Saving does not grant approval or start a campaign.</p></div>
    <div ref={errorRef} tabIndex={-1} role={error ? "alert" : undefined} className={error ? "rounded-md border border-danger p-3 text-sm text-danger" : "sr-only"}>{error}{error ? <p className="mt-2"><Link href="/login" target="_blank" rel="noreferrer" className="underline">Sign in in another tab if needed</Link></p> : null}</div>
    <p role="status" aria-live="polite" className={busy || notice ? "text-sm text-muted-foreground" : "sr-only"}>{busy === "preview" ? "Preparing review…" : busy === "save" ? "Saving this pending request…" : busy === "check" ? "Checking this exact stored request…" : notice}</p>
    {canWrite ? <>
      {mutable.length ? <fieldset disabled={Boolean(attempt)} className="grid min-w-0 gap-3 disabled:opacity-70"><legend className="sr-only">Preparation request input</legend>
        <label className="grid min-w-0 gap-1 text-sm"><span>Mutable component</span><select className={inputClass} value={componentId} onChange={event => edit(event.target.value, objective)}>{mutable.map(component => <option key={component.id} value={component.id}>{component.id} · {component.kind}</option>)}</select></label>
        <label className="grid min-w-0 gap-1 text-sm"><span>Objective</span><textarea className={`${inputClass} min-h-28`} maxLength={2048} value={objective} onChange={event => edit(componentId, event.target.value)} aria-describedby="campaign-objective-help" /></label>
        <p id="campaign-objective-help" className="text-xs text-muted-foreground">1–2,048 UTF-8 bytes. Every edit requires a new preview and request identity. {new TextEncoder().encode(objective).length}/2,048 bytes.</p>
      </fieldset> : <p className="text-sm text-muted-foreground">This saved version has no mutable components. Locked components cannot be requested for ablation.</p>}
      {requestId ? <Fingerprint label="Request ID · retain this for recovery" value={requestId} /> : null}
      {!attempt ? <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={Boolean(busy) || !validObjective(objective) || !mutable.length} onClick={() => void preview()}>Preview request</button><button type="button" className={buttonClass} disabled={!requestId} onClick={reset}>Discard unsubmitted request</button></div> : null}
    </> : <p className="text-sm text-muted-foreground">Read-only access. You can reload request history; an authorized editor can prepare a request.</p>}
    {visiblePreview ? <section aria-label="Reviewed preparation request" className="grid min-w-0 gap-3 rounded-md border border-border bg-muted p-3">
      <h3 className="text-sm font-semibold">Requested operations · hypotheses only</h3><RequestedOperations />
      <p className="text-xs">Requested limits: 0 provider calls, 0 target calls, 0 judge calls and 0 release changes. No candidates or results are generated here.</p>
      <Fingerprint label="Approval request identity" value={visiblePreview.approvalId} /><Fingerprint label="Reviewed payload hash" value={visiblePreview.payloadHash} /><Fingerprint label="Baseline content hash" value={visiblePreview.payloadPreview.baselineContentHash} /><Fingerprint label="Baseline semantic fingerprint" value={visiblePreview.payloadPreview.baselineSemanticFingerprint} />
      <details className="min-w-0"><summary className="cursor-pointer text-sm font-medium">Full requested payload</summary><pre tabIndex={0} className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{JSON.stringify(visiblePreview.payloadPreview, null, 2)}</pre></details>
      {!attempt && canWrite ? <button type="button" className={`${primaryClass} w-fit`} disabled={Boolean(busy)} onClick={() => void save()}>Save pending request</button> : null}
      {attempt && !saved ? <><p className="text-sm">This submission is frozen. A client interruption does not undo a write. Keep the same ID and reviewed payload until storage confirms the outcome.</p><div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={Boolean(busy)} onClick={() => void checkStored()}>Check stored request</button>{canWrite ? <button type="button" className={primaryClass} disabled={Boolean(busy)} onClick={() => void save()}>Retry same submission</button> : null}</div></> : null}
      {saved ? <><RequestRecord request={saved} /><button type="button" className={`${buttonClass} w-fit`} disabled={Boolean(busy)} onClick={reset}>Prepare another request</button></> : null}
    </section> : null}
    <section aria-label="Stored preparation request history" className="grid min-w-0 gap-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Stored requests for this saved version</h3><button type="button" className={buttonClass} disabled={historyBusy} onClick={() => void loadHistory()}>Reload requests</button></div>
      <p role="status" aria-live="polite" className={historyBusy ? "text-sm text-muted-foreground" : "sr-only"}>{historyBusy ? "Loading stored preparation requests…" : ""}</p>
      {historyError ? <p role="alert" className="text-sm text-danger">{historyError} {history ? "The previously loaded list remains below; reload to refresh it." : "Reload to try again."}</p> : null}
      {history?.length ? <ul className="grid min-w-0 gap-3">{history.map(item => <li key={item.id} className="min-w-0 rounded-md border border-border p-3"><RequestRecord request={item} /></li>)}</ul> : history && !historyBusy ? <p className="text-sm text-muted-foreground">No stored preparation requests for this saved version.</p> : null}
      {hasMore ? <p className="text-xs text-muted-foreground">Showing the latest 20 requests for this baseline. Older records are not included in this view.</p> : null}
    </section>
    <p className="text-xs text-muted-foreground">Campaign execution, approval decisions, evaluations and release changes remain separate unfinished work. Global navigation can discard unsubmitted local input; submitted requests are recoverable from stored history.</p>
  </section>;
}

function validCollection(value: unknown, definitionId: string, version: PromptVersion): value is { requests: CampaignRequestDTO[]; hasMore: boolean } {
  return exactKeys(value, ["requests", "hasMore"]) && typeof value.hasMore === "boolean" && Array.isArray(value.requests) && value.requests.length <= 20
    && value.requests.every(item => storedRequest(item, definitionId, version)) && new Set(value.requests.map(item => item.id)).size === value.requests.length;
}
function Fingerprint({ label, value }: { label: string; value: string }) {
  return <dl className="min-w-0"><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1 break-all font-mono text-xs">{value}</dd></dl>;
}
function RequestedOperations() {
  return <ul className="grid min-w-0 gap-1 text-xs sm:grid-cols-2">{operations.map(operation => <li key={operation} className="break-words font-mono">{operation}</li>)}</ul>;
}
function RequestRecord({ request }: { request: CampaignRequestDTO }) {
  return <div className="grid min-w-0 gap-2 text-sm"><div className="flex flex-wrap justify-between gap-2"><span>Decision status: {request.status}</span><time dateTime={request.createdAt} className="text-xs text-muted-foreground">{request.createdAt}</time></div><Fingerprint label="Stored request ID" value={request.requestId} /><p className="break-words">Component: <span className="font-mono text-xs">{request.componentId}</span></p><p className="whitespace-pre-wrap break-words">{request.objective}</p><p className="text-xs text-muted-foreground">{request.baselineVerified ? "Saved baseline verified by the server. This record is a request, not evidence of candidate quality or execution." : "The stored baseline cannot currently be verified. Retain this historical request metadata; do not treat it as executable approval."}</p><details className="min-w-0"><summary className="cursor-pointer text-xs font-medium">Stored request fingerprints and requested operations</summary><div className="mt-2 grid min-w-0 gap-2"><Fingerprint label="Payload hash" value={request.payloadHash} /><Fingerprint label="Request fingerprint" value={request.requestFingerprint} /><Fingerprint label="Baseline content hash" value={request.baselineContentHash} /><Fingerprint label="Baseline semantic fingerprint" value={request.baselineSemanticFingerprint} /><RequestedOperations /><p className="text-xs">Requested limits: provider 0 · target 0 · judge 0 · release changes 0.</p></div></details></div>;
}

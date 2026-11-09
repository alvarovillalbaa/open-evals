"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CustomEvalSetDraft } from "@open-evals/core";
import type { CustomEvalDetailView, CustomEvalSaveView, CustomEvalVersionView } from "@/lib/custom-eval-types";

const inputClass = "w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm read-only:bg-muted";
const buttonClass = "inline-flex min-h-9 items-center justify-center rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function versionShape(value: unknown, setId: string): value is CustomEvalVersionView {
  if (!record(value) || typeof value.id !== "string" || !uuid.test(value.id) || !Number.isInteger(value.version)
    || Number(value.version) < 1 || typeof value.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.fingerprint)
    || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || !record(value.contract)) return false;
  const contract = value.contract;
  if (contract.schemaVersion !== "custom-eval-set-v1" || contract.id !== value.id || contract.setId !== setId
    || contract.fingerprint !== value.fingerprint || typeof contract.name !== "string" || !record(contract.authoring)
    || contract.authoring.version !== value.version || !Array.isArray(contract.itemVersions) || contract.itemVersions.length !== 1
    || !record(contract.gates) || typeof contract.gates.datasetPassRateThreshold !== "number"
    || !Number.isFinite(contract.gates.datasetPassRateThreshold) || contract.gates.datasetPassRateThreshold < 0 || contract.gates.datasetPassRateThreshold > 100) return false;
  const membership: unknown = contract.itemVersions[0];
  return record(membership) && record(membership.item) && membership.item.type === "string_check"
    && record(membership.item.config) && typeof membership.item.config.contains === "string";
}

function detailShape(value: unknown, setId: string): value is CustomEvalDetailView {
  return record(value) && value.id === setId && typeof value.name === "string" && typeof value.hasMore === "boolean"
    && Array.isArray(value.versions) && value.versions.length > 0 && value.versions.length <= 20
    && value.versions.every(version => versionShape(version, setId));
}

function saveShape(value: unknown, intent: CustomEvalSetDraft): value is CustomEvalSaveView {
  if (!record(value) || value.id !== intent.setId || typeof value.name !== "string" || typeof value.replayed !== "boolean"
    || !versionShape(value.version, intent.setId) || !detailShape(value.evalSet, intent.setId)) return false;
  const contract = value.version.contract;
  return value.version.id === intent.versionId && value.version.version === intent.version
    && contract.name === intent.name.trim() && contract.authoring.expectedVersionId === intent.expectedVersionId
    && contract.gates.datasetPassRateThreshold === intent.datasetPassRateThreshold
    && contract.itemVersions[0]?.item.config["contains"] === intent.contains
    && value.evalSet.versions[0].version >= value.version.version;
}

function configuredText(version: CustomEvalVersionView): string {
  const value = version.contract.itemVersions[0]?.item.config["contains"];
  if (typeof value !== "string") throw new Error("custom_eval_contract_invalid");
  return value;
}

export function CustomEvalEditor({ initialDetail, canWrite }: { initialDetail?: CustomEvalDetailView; canWrite: boolean }) {
  const [detail, setDetail] = useState(initialDetail);
  const [name, setName] = useState(initialDetail?.versions[0]?.contract.name ?? "");
  const [contains, setContains] = useState(initialDetail?.versions[0] ? configuredText(initialDetail.versions[0]) : "");
  const [threshold, setThreshold] = useState(String(initialDetail?.versions[0]?.contract.gates.datasetPassRateThreshold ?? 100));
  const [pending, setPending] = useState<"save" | "reload" | undefined>();
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string }>();
  const [receipt, setReceipt] = useState<CustomEvalVersionView>();
  const intent = useRef<CustomEvalSetDraft | undefined>(undefined);
  const active = useRef(true);
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; generation.current += 1; };
  }, []);

  const head = detail?.versions[0];
  const locked = !canWrite || Boolean(pending) || uncertain || conflict;
  const changed = !head || name.trim() !== head.contract.name || contains !== configuredText(head)
    || Number(threshold) !== head.contract.gates.datasetPassRateThreshold;
  const current = (token: number) => active.current && generation.current === token;

  function edit(update: () => void) {
    if (busy.current || locked) return;
    update();
    intent.current = undefined;
    setReceipt(undefined);
    setNotice(undefined);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || busy.current || conflict || (!changed && !intent.current)) return;
    const passRate = Number(threshold);
    if (!name.trim() || [...name.trim()].length > 120 || new TextEncoder().encode(name.trim()).length > 480
      || !contains.trim() || new TextEncoder().encode(contains).length > 4096
      || !threshold.trim() || !Number.isFinite(passRate) || passRate < 0 || passRate > 100) {
      setNotice({ kind: "error", text: "Enter a name, up to 4,096 bytes of nonblank text, and a pass rate from 0 to 100." });
      return;
    }
    busy.current = true;
    const token = ++generation.current;
    setPending("save");
    setNotice(undefined);
    let requestStarted = false;
    try {
      const request = intent.current ?? {
        schemaVersion: "custom-eval-set-draft-v1" as const,
        setId: detail?.id ?? crypto.randomUUID(),
        versionId: crypto.randomUUID(),
        version: (head?.version ?? 0) + 1,
        expectedVersionId: head?.id ?? null,
        name,
        contains,
        datasetPassRateThreshold: passRate
      };
      intent.current = request;
      const body = JSON.stringify(request);
      requestStarted = true;
      const response = await fetch("/api/v1/eval-sets", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body
      });
      const value: unknown = await response.json();
      if (!current(token)) return;
      if (!response.ok) {
        if (response.status === 409) {
          setConflict(true);
          setUncertain(false);
          setNotice({ kind: "error", text: "The saved version changed or this request conflicts with an existing save. Load the latest version, review your draft, then save again." });
        } else if ([400, 401, 403, 413, 422].includes(response.status)) {
          intent.current = undefined;
          setUncertain(false);
          setNotice({ kind: "error", text: response.status === 401 || response.status === 403 ? "Your workspace session cannot save this evaluator. Sign in with edit access, then try again." : "The evaluator was rejected. Check the name, text and pass rule before trying again." });
        } else {
          setUncertain(true);
          setNotice({ kind: "error", text: "The save outcome is unknown. Retry this unchanged request, or load saved versions to check whether it completed." });
        }
        return;
      }
      if (!saveShape(value, request)) throw new Error("custom_eval_response_invalid");
      setDetail(value.evalSet);
      setReceipt(value.version);
      setUncertain(false);
      setConflict(false);
      intent.current = undefined;
      setNotice({ kind: "info", text: `${value.replayed ? "Recovered" : "Saved"} version ${value.version.version}. Latest saved version: ${value.evalSet.versions[0].version}.` });
    } catch {
      if (current(token)) {
        setUncertain(requestStarted);
        setNotice({ kind: "error", text: requestStarted ? "The save outcome is unknown. Retry this unchanged request, or load saved versions to check whether it completed." : "The save request could not be prepared. Your draft is preserved; try again in a supported browser." });
      }
    } finally {
      if (current(token)) { busy.current = false; setPending(undefined); }
    }
  }

  async function reloadLatest() {
    const setId = detail?.id ?? intent.current?.setId;
    if (!setId || busy.current) return;
    busy.current = true;
    const token = ++generation.current;
    setPending("reload");
    try {
      const response = await fetch(`/api/v1/eval-sets/${encodeURIComponent(setId)}`, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      const value: unknown = await response.json();
      if (!current(token)) return;
      if (!response.ok || !record(value) || !detailShape(value.evalSet, setId)
        || value.evalSet.versions[0].version < (head?.version ?? 0)) throw new Error("custom_eval_reload_unavailable");
      const savedIntent = value.evalSet.versions.find(version => version.id === intent.current?.versionId);
      setDetail(value.evalSet);
      setReceipt(savedIntent);
      intent.current = undefined;
      setUncertain(false);
      setConflict(false);
      setNotice({ kind: "info", text: `Loaded latest version ${value.evalSet.versions[0].version}. Your draft is unchanged; review it before saving another version.` });
    } catch {
      if (current(token)) setNotice({ kind: "error", text: "Saved versions could not be loaded. Your draft and retry request are preserved. Try again when the workspace is available." });
    } finally {
      if (current(token)) { busy.current = false; setPending(undefined); }
    }
  }

  return (
    <div className="grid min-w-0 content-start gap-5">
      <section className="min-w-0 border border-border bg-panel p-4">
        <h2 className="font-semibold">{detail ? "Edit next version" : "Create an Eval Set"}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">A case passes when its output contains your text, ignoring letter case. This check is critical: a failed case blocks the current Eval Set and run. The dataset pass-rate gate is recorded separately. Saving does not run the evaluator.</p>
        {!canWrite ? <p className="mt-3 text-sm text-muted-foreground">This workspace session has view access. Edit access is required to save a version.</p> : null}
        <form className="mt-5 grid min-w-0 gap-4" onSubmit={save} aria-busy={Boolean(pending)}>
          <label className="grid min-w-0 gap-1 text-sm font-medium">Name<input className={inputClass} value={name} maxLength={240} required readOnly={locked} onChange={event => edit(() => setName(event.target.value))} /></label>
          <label className="grid min-w-0 gap-1 text-sm font-medium">Text the output must contain<textarea className={`${inputClass} min-h-32 resize-y font-mono`} value={contains} required readOnly={locked} onChange={event => edit(() => setContains(event.target.value))} aria-describedby="contains-help" /></label>
          <p id="contains-help" className="-mt-2 text-xs text-muted-foreground">Text is saved exactly as entered. Up to 4,096 UTF-8 bytes; whitespace alone is not a check.</p>
          <label className="grid max-w-xs gap-1 text-sm font-medium">Dataset pass-rate gate (%)<input className={inputClass} type="number" min={0} max={100} step="any" required value={threshold} readOnly={locked} onChange={event => edit(() => setThreshold(event.target.value))} /></label>
          <div className="flex flex-wrap gap-2">
            <button className={buttonClass} type="submit" disabled={!canWrite || Boolean(pending) || conflict || (!changed && !intent.current)}>{pending === "save" ? "Saving…" : uncertain ? "Retry unchanged save" : detail ? "Save new version" : "Save Eval Set"}</button>
            {detail || intent.current ? <button className="min-h-9 rounded-md border border-border px-3 py-2 text-sm font-medium disabled:opacity-50" type="button" onClick={reloadLatest} disabled={Boolean(pending)}>{pending === "reload" ? "Loading…" : "Load latest saved version"}</button> : null}
          </div>
          {notice ? <p role={notice.kind === "error" ? "alert" : "status"} className={notice.kind === "error" ? "text-sm text-danger" : "text-sm text-muted-foreground"}>{notice.text}</p> : null}
          {receipt ? <p className="text-sm">Version {receipt.version} saved. <a className="underline underline-offset-4" href={`/evals/custom/${encodeURIComponent(receipt.contract.setId)}`}>Open saved Eval Set</a></p> : null}
        </form>
      </section>
      {detail ? <section className="grid min-w-0 gap-3" aria-labelledby="custom-eval-history">
        <div><h2 id="custom-eval-history" className="font-semibold">Saved versions</h2><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{detail.id}</p></div>
        <ol className="grid min-w-0 gap-3">{detail.versions.map(version => <li key={version.id} className="min-w-0 border border-border bg-panel p-4">
          <div className="flex flex-wrap justify-between gap-2"><h3 className="break-words text-sm font-medium">Version {version.version}: {version.contract.name}</h3><time className="text-xs text-muted-foreground" dateTime={version.createdAt}>{version.createdAt}</time></div>
          <p className="mt-2 text-sm text-muted-foreground">Dataset pass-rate gate: {version.contract.gates.datasetPassRateThreshold}%. Text check: critical.</p>
          <pre className="mt-3 whitespace-pre-wrap break-words border border-border bg-muted p-3 font-mono text-xs">{configuredText(version)}</pre>
          <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium">Inspect immutable version identity</summary><dl className="mt-2 grid min-w-0 gap-2"><div><dt>Version ID</dt><dd className="break-all font-mono">{version.id}</dd></div><div><dt>Fingerprint</dt><dd className="break-all font-mono">{version.fingerprint}</dd></div></dl></details>
        </li>)}</ol>
        {detail.hasMore ? <p className="text-xs text-muted-foreground">Showing the latest 20 versions. Earlier versions remain saved.</p> : null}
      </section> : null}
    </div>
  );
}

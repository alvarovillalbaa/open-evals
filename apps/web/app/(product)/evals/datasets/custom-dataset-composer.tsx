"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { CustomDatasetDraft, CustomDatasetFormat, CustomDatasetHead, CustomDatasetPreview, CustomDatasetReviewStatus, CustomDatasetSaveRequest, CustomDatasetVersionRecord } from "@open-evals/core";
import type { CustomDatasetDetailView } from "@/lib/custom-dataset-types";

const inputClass = "w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60 read-only:bg-muted";
const buttonClass = "inline-flex min-h-9 items-center justify-center rounded-md border border-border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";
const primaryClass = `${buttonClass} bg-foreground text-background`;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024 + 4096;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`;
}

function headShape(value: unknown): value is CustomDatasetHead {
  return object(value) && typeof value.datasetId === "string" && typeof value.publicDatasetId === "string" && UUID.test(value.publicDatasetId)
    && typeof value.name === "string" && value.kind === "custom-dataset-v1" && typeof value.versionId === "string"
    && typeof value.publicVersionId === "string" && UUID.test(value.publicVersionId) && Number.isInteger(value.version)
    && Number(value.version) >= 1 && typeof value.contentFingerprint === "string" && HASH.test(value.contentFingerprint);
}

function rowsShape(value: unknown): boolean {
  if (!Array.isArray(value) || !value.length || value.length > 100) return false;
  const ids = new Set<string>(), keys = new Set<string>();
  return value.every(row => {
    if (!object(row) || typeof row.id !== "string" || typeof row.rowKey !== "string" || ids.has(row.id) || keys.has(row.rowKey)
      || !Object.hasOwn(row, "input") || !object(row.metadata) || !["synthetic", "reviewed", "golden"].includes(String(row.reviewStatus))) return false;
    for (const key of ["expectedOutput", "context", "history", "traceFixture"]) {
      const field = row[key];
      if (!object(field) || typeof field.present !== "boolean" || !Object.hasOwn(field, "value") || !field.present && field.value !== null) return false;
    }
    ids.add(row.id); keys.add(row.rowKey);
    return true;
  });
}

function previewShape(value: unknown, intent: CustomDatasetDraft, digest: string, head: CustomDatasetHead | null): value is CustomDatasetPreview {
  if (!object(value) || value.schemaVersion !== "custom-dataset-preview-v1" || typeof value.workspaceId !== "string"
    || typeof value.fingerprint !== "string" || !HASH.test(value.fingerprint) || !object(value.intent) || !object(value.content)
    || !object(value.content.dataset) || !object(value.content.version) || !rowsShape(value.content.rows)
    || value.createdAtByteAllowance !== 24 || !Number.isInteger(value.canonicalSnapshotBytes)
    || Number(value.canonicalSnapshotBytes) < 1 || Number(value.canonicalSnapshotBytes) > 1048576) return false;
  const savedIntent = value.intent;
  return savedIntent.schemaVersion === "custom-dataset-intent-v1" && savedIntent.workspaceId === value.workspaceId
    && savedIntent.datasetId === intent.datasetId && savedIntent.versionId === intent.versionId && savedIntent.version === intent.version
    && savedIntent.expectedVersionId === intent.expectedVersionId && savedIntent.name === intent.name && savedIntent.format === intent.format
    && savedIntent.defaultReviewStatus === intent.defaultReviewStatus && savedIntent.sourceDigest === digest
    && typeof savedIntent.fingerprint === "string" && HASH.test(savedIntent.fingerprint)
    && value.content.schemaVersion === "custom-dataset-version-v1" && value.content.workspaceId === value.workspaceId
    && value.content.dataset.publicId === intent.datasetId && value.content.dataset.name === intent.name && value.content.dataset.kind === "custom-dataset-v1"
    && value.content.version.publicId === intent.versionId && value.content.version.version === intent.version
    && value.content.version.previousPublicVersionId === intent.expectedVersionId
    && typeof value.content.fingerprint === "string" && HASH.test(value.content.fingerprint)
    && savedIntent.contentFingerprint === value.content.fingerprint && canonical(value.head) === canonical(head);
}

function recordShape(value: unknown): value is CustomDatasetVersionRecord {
  return object(value) && value.schemaVersion === "custom-dataset-record-v1" && typeof value.workspaceId === "string"
    && typeof value.fingerprint === "string" && HASH.test(value.fingerprint) && object(value.content)
    && value.content.schemaVersion === "custom-dataset-version-v1" && value.content.workspaceId === value.workspaceId
    && object(value.content.dataset) && typeof value.content.dataset.publicId === "string" && UUID.test(value.content.dataset.publicId)
    && value.content.dataset.kind === "custom-dataset-v1" && typeof value.content.dataset.name === "string" && typeof value.content.dataset.id === "string"
    && object(value.content.version) && typeof value.content.version.publicId === "string" && UUID.test(value.content.version.publicId)
    && typeof value.content.version.id === "string" && Number.isInteger(value.content.version.version) && Number(value.content.version.version) >= 1
    && typeof value.content.fingerprint === "string" && HASH.test(value.content.fingerprint) && rowsShape(value.content.rows)
    && object(value.snapshot) && object(value.snapshot.dataset) && object(value.snapshot.version)
    && value.snapshot.dataset.id === value.content.dataset.id && value.snapshot.dataset.name === value.content.dataset.name && value.snapshot.dataset.kind === "custom-dataset-v1"
    && value.snapshot.version.id === value.content.version.id && value.snapshot.version.version === value.content.version.version
    && value.snapshot.version.datasetId === value.content.dataset.id && value.snapshot.version.fingerprint === value.content.fingerprint
    && typeof value.snapshot.version.createdAt === "string" && Number.isFinite(Date.parse(value.snapshot.version.createdAt))
    && canonical(value.snapshot.rows) === canonical(value.content.rows) && object(value.manifest)
    && value.manifest.schemaVersion === "custom-dataset-manifest-v1" && value.manifest.workspaceId === value.workspaceId
    && value.manifest.datasetId === value.content.dataset.id && value.manifest.versionId === value.content.version.id
    && value.manifest.createdAt === value.snapshot.version.createdAt && object(value.manifest.intent);
}

function matchesRequest(value: unknown, request: CustomDatasetSaveRequest, preview: CustomDatasetPreview): value is CustomDatasetVersionRecord {
  return recordShape(value) && value.workspaceId === preview.workspaceId
    && value.content.dataset.publicId === request.draft.datasetId && value.content.version.publicId === request.draft.versionId
    && canonical(value.content) === canonical(preview.content) && canonical(value.manifest.intent) === canonical(preview.intent)
    && canonical(value.manifest.head) === canonical(preview.head) && value.manifest.previewFingerprint === request.expectedPreviewFingerprint;
}

function detailShape(value: unknown, datasetId: string): value is CustomDatasetDetailView {
  return object(value) && object(value.dataset) && value.dataset.id === datasetId && typeof value.dataset.name === "string"
    && Array.isArray(value.dataset.versions) && value.dataset.versions.length >= 1 && value.dataset.versions.length <= 20
    && headShape(value.head) && value.head.publicDatasetId === datasetId && value.head.name === value.dataset.name
    && recordShape(value.record) && value.record.content.dataset.publicId === datasetId
    && value.record.content.version.publicId === value.head.publicVersionId && value.record.content.fingerprint === value.head.contentFingerprint;
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
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel().catch(() => undefined); throw new Error("response_too_large"); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { reader.releaseLock(); }
}

async function sourceDigest(source: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
}

function sourceFromRecord(record: CustomDatasetVersionRecord) {
  return JSON.stringify(record.content.rows.map(row => {
    const value: Record<string, unknown> = { rowKey: row.rowKey, input: row.input };
    for (const key of ["expectedOutput", "context", "history", "traceFixture"] as const) if (row[key].present) value[key] = row[key].value;
    value.metadata = row.metadata;
    value.reviewStatus = row.reviewStatus;
    return value;
  }), null, 2);
}

function validationMessage(value: unknown, fallback: string) {
  if (!object(value)) return fallback;
  const messages: Record<string, string> = {
    custom_dataset_source_invalid: "The source is not valid for the selected JSON or JSONL format.",
    custom_dataset_source_rows_required: "JSON source must be an array of complete row objects.",
    custom_dataset_row_count: "The dataset must contain 1–100 complete rows. No rows are sampled or dropped.",
    custom_dataset_row_invalid: "Each row needs rowKey and input, with only the supported optional fields. Supply actual responses separately in scoring.",
    custom_dataset_source_precision: "A number would change when saved. Use an exact supported value or quote it as text.",
    custom_dataset_source_duplicate_key: "An object contains the same key more than once.",
    custom_dataset_row_key_duplicate: "Every row needs a unique rowKey.",
    custom_dataset_review_status_required: "Choose a default review declaration or declare reviewStatus on every row.",
    custom_dataset_snapshot_invalid: "The complete dataset must contain 1–100 valid rows and fit within 1 MiB, including saved metadata.",
    custom_dataset_name_immutable: "This dataset's saved name is fixed. Append a version with the same name."
  };
  const message = typeof value.error === "string" ? messages[value.error] ?? fallback : fallback;
  const row = Number.isInteger(value.rowIndex) && Number(value.rowIndex) >= 0 && Number(value.rowIndex) <= 2097152 ? ` Row ${Number(value.rowIndex) + 1}.` : "";
  const line = Number.isInteger(value.line) && Number(value.line) >= 1 && Number(value.line) <= 2097153 ? ` Line ${value.line}${Number.isInteger(value.column) && Number(value.column) >= 1 && Number(value.column) <= 2097153 ? `, column ${value.column}` : ""}.` : "";
  return message + row + line;
}

type Pending = "file" | "preview" | "save" | "recover" | "head";
type ReviewChoice = CustomDatasetReviewStatus | "per-row" | "";

export function CustomDatasetComposer({ canWrite, initial }: { canWrite: boolean; initial?: CustomDatasetDetailView }) {
  const id = useId();
  const [name, setName] = useState(initial?.dataset.name ?? "");
  const [format, setFormat] = useState<CustomDatasetFormat>("json");
  const [review, setReview] = useState<ReviewChoice>(initial ? "per-row" : "");
  const [sourceText, setSourceText] = useState(initial ? sourceFromRecord(initial.record) : "");
  const [fileName, setFileName] = useState<string>();
  const [head, setHead] = useState<CustomDatasetHead | null>(initial?.head ?? null);
  const [reviewRecord, setReviewRecord] = useState<CustomDatasetVersionRecord | undefined>(initial?.record);
  const [preview, setPreview] = useState<CustomDatasetPreview>();
  const [receipt, setReceipt] = useState<CustomDatasetVersionRecord>();
  const [pending, setPending] = useState<Pending>();
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [headLoaded, setHeadLoaded] = useState(false);
  const [headReviewed, setHeadReviewed] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string }>();
  const publicDatasetId = useRef<string | undefined>(initial?.dataset.id);
  const draft = useRef<CustomDatasetDraft | undefined>(undefined);
  const pinnedPreview = useRef<CustomDatasetPreview | undefined>(undefined);
  const request = useRef<CustomDatasetSaveRequest | undefined>(undefined);
  const requestBody = useRef<string | undefined>(undefined);
  const accepted = useRef<CustomDatasetVersionRecord | undefined>(undefined);
  const active = useRef(true), generation = useRef(0), busy = useRef(false), unknownOutcome = useRef(false);

  useEffect(() => {
    active.current = true;
    busy.current = false;
    return () => { active.current = false; generation.current += 1; };
  }, []);

  const current = (token: number) => active.current && generation.current === token;
  const locked = Boolean(pending) || uncertain || Boolean(receipt);
  function begin(action: Pending) { busy.current = true; setPending(action); setNotice(undefined); return ++generation.current; }
  function finish(token: number) { if (current(token)) { busy.current = false; setPending(undefined); } }
  function markUncertain(value: boolean) { unknownOutcome.current = value; setUncertain(value); }
  function clearIntent() {
    draft.current = undefined; pinnedPreview.current = undefined; request.current = undefined; requestBody.current = undefined;
    setPreview(undefined); setNotice(undefined);
  }
  function invalidate() { generation.current += 1; clearIntent(); }
  function editable() { return !busy.current && !unknownOutcome.current && !accepted.current; }
  function edit(action: () => void) { if (!editable()) return; invalidate(); action(); }

  async function loadFile(file: File) {
    if (!editable()) return;
    invalidate();
    const token = begin("file");
    try {
      if (file.size > MAX_REQUEST_BYTES) throw new Error("file_too_large");
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength > MAX_REQUEST_BYTES) throw new Error("file_too_large");
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      if (!current(token)) return;
      setSourceText(text); setFileName(file.name);
      setNotice({ kind: "info", text: "File loaded without truncation. Check the selected format and review declaration, then preview all rows before saving." });
    } catch {
      if (current(token)) setNotice({ kind: "error", text: "The file could not be loaded as strict UTF-8 within 2 MiB. Your previous text is preserved. The complete escaped request and saved dataset have additional limits." });
    } finally { finish(token); }
  }

  function makeDraft(): CustomDatasetDraft {
    if (conflict && (!headLoaded || !headReviewed)) throw new Error("head_review_required");
    const encoder = new TextEncoder();
    if (!name.trim() || encoder.encode(name).length > 4096 || !review || !sourceText.length || encoder.encode(sourceText).length > MAX_REQUEST_BYTES) throw new Error("draft_invalid");
    if (draft.current) return draft.current;
    publicDatasetId.current ??= crypto.randomUUID();
    const value: CustomDatasetDraft = {
      schemaVersion: "custom-dataset-draft-v1", datasetId: publicDatasetId.current, versionId: crypto.randomUUID(),
      version: head ? head.version + 1 : 1, expectedVersionId: head?.publicVersionId ?? null, name, format,
      defaultReviewStatus: review === "per-row" ? null : review, sourceText
    };
    const eventual = { schemaVersion: "custom-dataset-save-v1", draft: value, expectedPreviewFingerprint: "0".repeat(64) };
    if (encoder.encode(JSON.stringify(eventual)).length > MAX_REQUEST_BYTES) throw new Error("request_too_large");
    draft.current = value;
    return value;
  }

  async function previewVersion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable()) return;
    const token = begin("preview");
    pinnedPreview.current = undefined; request.current = undefined; requestBody.current = undefined; setPreview(undefined);
    try {
      const intent = makeDraft();
      const digest = await sourceDigest(intent.sourceText);
      if (!current(token)) return;
      const response = await fetch("/api/v1/custom-datasets/preview", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(intent) });
      const value = await readJson(response);
      if (!current(token)) return;
      if (response.status === 409) {
        draft.current = undefined; setConflict(true); setHeadLoaded(false); setHeadReviewed(false);
        setNotice({ kind: "error", text: "The saved head changed or this identity conflicts with stored data. Your source text is preserved. Reload and review the current head before a new preview." });
        return;
      }
      if (!response.ok) { setNotice({ kind: "error", text: validationMessage(value, "Preview was refused. Check your workspace session, row format and limits. No version was saved; your text is preserved.") }); return; }
      if (!object(value) || !previewShape(value.preview, intent, digest, head)) throw new Error("preview_response_invalid");
      pinnedPreview.current = value.preview; setPreview(value.preview); setConflict(false);
      setNotice({ kind: "info", text: "Complete preview ready. Review every accepted row, reference and declaration. Preview has not saved a dataset or run an evaluation." });
    } catch {
      if (current(token)) setNotice({ kind: "error", text: conflict && !headReviewed ? "Reload and review the current saved head first. Your text is preserved." : "Preview could not be prepared. Enter a name, choose review declarations and supply JSON/JSONL. The escaped request must fit within 2 MiB; all 1–100 saved rows must fit within 1 MiB. Your text is preserved." });
    } finally { finish(token); }
  }

  function accept(record: CustomDatasetVersionRecord, replayed: boolean) {
    accepted.current = record; setReceipt(record); markUncertain(false);
    pinnedPreview.current = undefined; request.current = undefined; requestBody.current = undefined;
    setNotice({ kind: "info", text: replayed ? "Recovered the existing immutable version. No duplicate dataset version was created." : "The immutable dataset version is saved. Open its exact saved values, reload its history, or select it for supplied-output scoring." });
  }

  async function save() {
    const pinned = pinnedPreview.current, intent = draft.current;
    if (!canWrite || busy.current || accepted.current || !pinned || !intent) return;
    const token = begin("save");
    let started = false;
    try {
      request.current ??= { schemaVersion: "custom-dataset-save-v1", draft: intent, expectedPreviewFingerprint: pinned.fingerprint };
      requestBody.current ??= JSON.stringify(request.current);
      if (new TextEncoder().encode(requestBody.current).length > MAX_REQUEST_BYTES) throw new Error("request_too_large");
      started = true;
      const response = await fetch("/api/v1/custom-datasets", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: requestBody.current });
      const value = await readJson(response);
      if (!current(token)) return;
      if (!response.ok) {
        if ([400, 401, 403, 404, 409, 413, 422].includes(response.status)) {
          clearIntent(); markUncertain(false);
          if (response.status === 409) { setConflict(true); setHeadLoaded(false); setHeadReviewed(false); }
          setNotice({ kind: "error", text: response.status === 409 ? "The saved head changed or this version identity conflicts with stored data. Your source text is preserved. Reload and review the current head, then preview a new version intent." : validationMessage(value, "Saving was refused. Check your session, edit access and source limits, then prepare a new preview. Your text is preserved.") });
        } else {
          markUncertain(true);
          setNotice({ kind: "error", text: "The save outcome is unknown. Keep this page open and retry the unchanged request or check the saved version. Editing is locked to preserve the intent." });
        }
        return;
      }
      if (!object(value) || typeof value.replayed !== "boolean" || !matchesRequest(value.record, request.current, pinned)) throw new Error("save_response_invalid");
      accept(value.record, value.replayed);
    } catch {
      if (current(token)) {
        markUncertain(started);
        setNotice({ kind: "error", text: started ? "The save outcome is unknown. Retry the unchanged request or check the saved version. Your exact IDs, source text and request are retained." : "The save request could not be prepared. Your source text is preserved; prepare a new preview." });
      }
    } finally { finish(token); }
  }

  async function recover() {
    const intent = request.current, pinned = pinnedPreview.current;
    if (!intent || !pinned || busy.current || accepted.current) return;
    const token = begin("recover");
    try {
      const response = await fetch(`/api/v1/custom-datasets/${intent.draft.datasetId}/versions/${intent.draft.versionId}`, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      const value = await readJson(response);
      if (!current(token)) return;
      if (!response.ok || !object(value) || !matchesRequest(value.record, intent, pinned)) throw new Error("version_not_recovered");
      accept(value.record, true);
    } catch {
      if (current(token)) setNotice({ kind: "error", text: "The version could not yet be recovered. An absent read does not cancel an in-flight save. Your unchanged retry and source text remain locked and preserved." });
    } finally { finish(token); }
  }

  async function reloadHead() {
    const datasetId = publicDatasetId.current;
    if (!editable() || !datasetId) return;
    invalidate();
    const token = begin("head");
    setHeadLoaded(false); setHeadReviewed(false);
    try {
      const response = await fetch(`/api/v1/custom-datasets/${datasetId}`, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      const value = await readJson(response);
      if (!current(token)) return;
      if (!response.ok || !detailShape(value, datasetId) || value.head.name !== name) throw new Error("head_unavailable");
      setHead(value.head); setReviewRecord(value.record); setHeadLoaded(true);
      setNotice({ kind: "info", text: "Current head loaded. Your source text is preserved. Inspect the saved version below and confirm review before preparing another preview." });
    } catch {
      if (current(token)) setNotice({ kind: "error", text: "The current saved head could not be loaded. Your source is preserved. Retry the read; a new dataset can also use a fresh identity without adopting stored data." });
    } finally { finish(token); }
  }

  function startFresh(keepText: boolean) {
    if (initial || busy.current || unknownOutcome.current) return;
    accepted.current = undefined; setReceipt(undefined); invalidate(); publicDatasetId.current = undefined;
    setHead(null); setReviewRecord(undefined); setConflict(false); setHeadLoaded(false); setHeadReviewed(false);
    if (!keepText) { setName(""); setSourceText(""); setFileName(undefined); setReview(""); setFormat("json"); }
  }

  return <div className="grid min-w-0 gap-5">
    <form className="grid min-w-0 gap-4 border border-border bg-panel p-4" onSubmit={previewVersion} aria-busy={Boolean(pending)}>
      <div><h2 className="font-semibold">{initial ? "Append an immutable version" : "Create a custom dataset"}</h2><p className="mt-1 text-sm text-muted-foreground">Upload or paste examples. Preview all accepted rows, then explicitly save. Nothing is evaluated or saved by loading a file.</p></div>
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <div className="grid min-w-0 gap-1"><label className="text-sm font-medium" htmlFor={`${id}-name`}>Dataset name</label><input id={`${id}-name`} className={inputClass} value={name} readOnly={locked || Boolean(head)} onChange={event => edit(() => setName(event.target.value))} />{head ? <p className="text-xs text-muted-foreground">The saved name is fixed. Next version: {head.version + 1}, based on version {head.version}.</p> : null}</div>
        <div className="grid min-w-0 gap-1"><label className="text-sm font-medium" htmlFor={`${id}-format`}>Source format</label><select id={`${id}-format`} className={inputClass} value={format} disabled={locked} onChange={event => edit(() => setFormat(event.target.value as CustomDatasetFormat))}><option value="json">JSON array of row objects</option><option value="jsonl">JSONL, one row object per line</option></select></div>
      </div>
      <div className="grid min-w-0 gap-1"><label className="text-sm font-medium" htmlFor={`${id}-review`}>Review declarations</label><select id={`${id}-review`} className={inputClass} value={review} disabled={locked} onChange={event => edit(() => setReview(event.target.value as ReviewChoice))}><option value="">Choose a default or require declarations on every row</option><option value="per-row">Use reviewStatus declared on every row</option><option value="synthetic">Default: synthetic</option><option value="reviewed">Default: reviewed</option><option value="golden">Default: golden</option></select><p className="text-xs text-muted-foreground">These are uploader declarations, not independent quality checks. A row's explicit reviewStatus overrides the chosen default. No row is silently marked golden.</p></div>
      <div className="grid min-w-0 gap-1"><label className="text-sm font-medium" htmlFor={`${id}-file`}>Upload JSON or JSONL</label><input id={`${id}-file`} type="file" accept=".json,.jsonl,application/json,application/x-ndjson,text/plain" className={`${inputClass} file:mr-3`} disabled={locked} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void loadFile(file); }} />{fileName ? <p className="break-words text-xs text-muted-foreground">Loaded: {fileName}</p> : null}</div>
      <div className="grid min-w-0 gap-1"><label className="text-sm font-medium" htmlFor={`${id}-source`}>Dataset source text</label><textarea id={`${id}-source`} className={`${inputClass} min-h-72 resize-y font-mono text-xs`} value={sourceText} readOnly={locked} spellCheck={false} onChange={event => edit(() => { setSourceText(event.target.value); setFileName(undefined); })} /><p className="text-xs text-muted-foreground">Each row needs rowKey and input. Optional: expectedOutput, context, history, traceFixture, metadata and reviewStatus. Expected output is a reference, never an actual response. Omitted references differ from JSON null.</p></div>
      <details className="min-w-0"><summary className="cursor-pointer text-sm font-medium">View the accepted row format and limits</summary><pre tabIndex={0} className="mt-2 overflow-auto whitespace-pre-wrap break-words bg-muted p-3 text-xs">{JSON.stringify([{ rowKey: "example-1", input: { prompt: "An authored example" }, expectedOutput: "A reference answer", metadata: { language: "en" }, reviewStatus: "synthetic" }], null, 2)}</pre><p className="mt-2 text-xs leading-5 text-muted-foreground">Use 1–100 complete rows with unique keys. The complete saved snapshot must fit within 1 MiB, including identities and metadata; the escaped request must fit within 2 MiB. Duplicate object keys, lossy numbers, invalid Unicode, unknown fields and interior blank JSONL lines are refused. Files and rows are never truncated or sampled.</p></details>
      <div><button type="submit" className={buttonClass} disabled={locked || conflict && (!headLoaded || !headReviewed)}>{pending === "preview" ? "Preparing preview…" : "Preview complete dataset"}</button></div>
    </form>
    {conflict ? <section className="grid min-w-0 gap-3 border border-border bg-panel p-4" aria-labelledby={`${id}-conflict`}><h2 id={`${id}-conflict`} className="font-semibold">Review the current saved head</h2><p className="text-sm text-muted-foreground">Your source text stays intact. Reload the current head, inspect its complete saved values and confirm review before creating a new version intent.</p><div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={locked} onClick={reloadHead}>{pending === "head" ? "Loading current head…" : "Reload current head"}</button>{!initial ? <button type="button" className={buttonClass} disabled={locked} onClick={() => startFresh(true)}>Use a fresh dataset identity with this text</button> : null}</div>{headLoaded && reviewRecord ? <><p className="text-sm">Current saved version: {reviewRecord.content.version.version}</p><details><summary className="cursor-pointer text-sm font-medium">Inspect current immutable version</summary><pre tabIndex={0} aria-label="Current saved dataset version" className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words bg-muted p-3 text-xs">{JSON.stringify(reviewRecord, null, 2)}</pre></details><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={headReviewed} disabled={locked} onChange={event => { if (editable()) setHeadReviewed(event.target.checked); }} />I reviewed the current saved version and want to append my preserved input.</label></> : null}</section> : null}
    {preview ? <section className="grid min-w-0 gap-3 border border-border bg-panel p-4" aria-labelledby={`${id}-preview`}><h2 id={`${id}-preview`} className="font-semibold">Review and explicitly save</h2><p className="text-sm">{preview.content.dataset.name} · version {preview.content.version.version} · all {preview.content.rows.length} rows · complete snapshot budget {preview.canonicalSnapshotBytes.toLocaleString()} bytes.</p><p className="text-sm text-muted-foreground">The preview includes every accepted input, reference, metadata value and review declaration. A creation timestamp will be assigned only when saved. No dataset, evaluator or evaluation run has been created by preview.</p><dl className="grid min-w-0 gap-2 text-xs"><div><dt className="font-medium">Public dataset ID</dt><dd className="break-all font-mono">{preview.intent.datasetId}</dd></div><div><dt className="font-medium">Public version / retry ID</dt><dd className="break-all font-mono">{preview.intent.versionId}</dd></div><div><dt className="font-medium">Preview fingerprint</dt><dd className="break-all font-mono">{preview.fingerprint}</dd></div></dl><details><summary className="cursor-pointer text-sm font-medium">Inspect complete dataset preview</summary><pre tabIndex={0} aria-label="Complete dataset preview" className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words bg-muted p-3 text-xs">{JSON.stringify(preview, null, 2)}</pre></details>{!canWrite ? <p className="text-sm text-muted-foreground">Your session can preview. Workspace edit access is required to save.</p> : null}<div className="flex flex-wrap gap-2"><button type="button" className={primaryClass} disabled={!canWrite || Boolean(pending) || Boolean(receipt)} onClick={save}>{pending === "save" ? "Saving version…" : uncertain ? "Retry unchanged save" : "Save immutable version"}</button>{uncertain ? <button type="button" className={buttonClass} disabled={Boolean(pending)} onClick={recover}>{pending === "recover" ? "Checking saved version…" : "Check saved version"}</button> : null}</div></section> : null}
    {notice ? <p role={notice.kind === "error" ? "alert" : "status"} className={notice.kind === "error" ? "text-sm text-danger" : "text-sm text-muted-foreground"}>{notice.text}</p> : null}
    {receipt ? <section className="grid min-w-0 gap-3 border border-border bg-panel p-4" aria-labelledby={`${id}-saved`}><h2 id={`${id}-saved`} className="font-semibold">Saved immutable version {receipt.content.version.version}</h2><p className="text-sm">{receipt.content.dataset.name} · {receipt.content.rows.length} complete rows.</p><div className="flex flex-wrap gap-3 text-sm"><Link className="underline underline-offset-4" href={`/evals/datasets/${receipt.content.dataset.publicId}/versions/${receipt.content.version.publicId}`}>Open exact saved version</Link><a className="underline underline-offset-4" href={`/evals/datasets/${receipt.content.dataset.publicId}`}>Reload saved dataset and history</a><Link className="underline underline-offset-4" href={`/evals/run?datasetVersionId=${encodeURIComponent(receipt.snapshot.version.id)}`}>Score this saved version</Link></div>{!initial ? <div><button type="button" className={buttonClass} onClick={() => startFresh(false)} disabled={Boolean(pending)}>Create another dataset</button></div> : null}</section> : null}
  </div>;
}

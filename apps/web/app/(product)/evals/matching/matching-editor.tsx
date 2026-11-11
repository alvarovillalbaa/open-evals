"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { CustomEvalItemRefV3 } from "@open-evals/core";
import { jsonObject, readHttpTargetResponse } from "@/lib/http-target-client";
import { matchingApi, matchingId, matchingPath, type MatchingDraft, type MatchingHead, type MatchingKind, type MatchingPreview, type MatchingRecord, type MatchingResource, type MatchingLibraryItem, matchingItemPath } from "@/lib/eval-matching-types";
import { buttonClass, CompleteJson, inputClass, primaryClass } from "../plans/http-target-view";

type ItemChoice = CustomEvalItemRefV3 & { name: string; version: number };
const digest = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(",")}]` : jsonObject(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}` : JSON.stringify(value);
function recordShape(value: unknown, kind: MatchingKind, workspaceId: string, draft?: MatchingDraft, previewFingerprint?: string): value is MatchingRecord {
  if (!jsonObject(value) || value.schemaVersion !== `custom-eval-${kind}-record-v3` || value.workspaceId !== workspaceId
    || !jsonObject(value.draft) || value.draft.schemaVersion !== `custom-eval-${kind}-draft-v3`
    || !jsonObject(value.contract) || !digest(value.contract.fingerprint) || !digest(value.fingerprint)
    || !digest(value.previewFingerprint) || !digest(value.requestFingerprint) || !jsonObject(value.storage)
    || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) return false;
  return (!draft || stable(value.draft) === stable(draft)) && (!previewFingerprint || value.previewFingerprint === previewFingerprint)
    && (kind !== "set" || Array.isArray(value.members));
}
function headOf(record: MatchingRecord): MatchingHead {
  const common = { profile: "eval-matching-v3" as const, versionId: record.draft.versionId, version: record.draft.version, name: record.draft.name, contractFingerprint: record.contract.fingerprint, recordFingerprint: record.fingerprint };
  return record.schemaVersion === "custom-eval-item-record-v3" ? { ...common, itemId: record.draft.itemId } : { ...common, setId: record.draft.setId };
}
function choices(items: MatchingLibraryItem[]): ItemChoice[] {
  return items.map(item => ({ schemaVersion: "profile" in item.head ? "custom-eval-item-ref-v3" as const : "custom-eval-item-ref-v2" as const, itemId: item.itemId, versionId: item.head.versionId, fingerprint: item.head.contractFingerprint, name: item.head.name, version: item.head.version }));
}

export function MatchingWorkbench({ workspaceId, canWrite, items, initialMember }: { workspaceId: string; canWrite: boolean; items: MatchingLibraryItem[]; initialMember?: ItemChoice }) {
  const [available, setAvailable] = useState(() => {
    const values = choices(items);
    return initialMember && !values.some(value => value.schemaVersion === initialMember.schemaVersion && value.itemId === initialMember.itemId && value.versionId === initialMember.versionId) ? [...values, initialMember] : values;
  });
  function saved(record: MatchingRecord) {
    if (record.schemaVersion !== "custom-eval-item-record-v3") return;
    const choice = { schemaVersion: "custom-eval-item-ref-v3" as const, itemId: record.draft.itemId, versionId: record.draft.versionId, fingerprint: record.contract.fingerprint, name: record.draft.name, version: record.draft.version };
    setAvailable(previous => previous.some(value => value.schemaVersion === choice.schemaVersion && value.itemId === choice.itemId && value.versionId === choice.versionId) ? previous : [...previous, choice]);
  }
  return <div className="grid min-w-0 gap-6 xl:grid-cols-2"><MatchingEditor kind="item" workspaceId={workspaceId} canWrite={canWrite} onSaved={saved} /><MatchingEditor kind="set" workspaceId={workspaceId} canWrite={canWrite} itemChoices={available} initialMembers={initialMember ? [{ schemaVersion: initialMember.schemaVersion, itemId: initialMember.itemId, versionId: initialMember.versionId, fingerprint: initialMember.fingerprint }] : undefined} /></div>;
}

export function MatchingEditor({ kind, workspaceId, canWrite, initialResource, itemChoices = [], initialMembers, onSaved }: {
  kind: MatchingKind; workspaceId: string; canWrite: boolean; initialResource?: MatchingResource;
  itemChoices?: ItemChoice[]; initialMembers?: CustomEvalItemRefV3[]; onSaved?: (record: MatchingRecord) => void;
}) {
  const prefix = useId(), initial = initialResource?.record;
  const [head, setHead] = useState<MatchingHead | null>(initialResource?.detail.head ?? null);
  const [name, setName] = useState(initial?.draft.name ?? "");
  const [expected, setExpected] = useState(initial?.draft.schemaVersion === "custom-eval-item-draft-v3" ? initial.draft.expected : "");
  const [membersText, setMembersText] = useState(JSON.stringify(initial?.draft.schemaVersion === "custom-eval-set-draft-v3" ? initial.draft.members : initialMembers ?? [], null, 2));
  const [threshold, setThreshold] = useState(String(initial?.draft.schemaVersion === "custom-eval-set-draft-v3" ? initial.draft.datasetPassRateThreshold : 100));
  const [preview, setPreview] = useState<MatchingPreview>();
  const [saved, setSaved] = useState<MatchingRecord>();
  const [pending, setPending] = useState<"preview" | "save" | "recover" | "head">();
  const [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false);
  const [reviewRecord, setReviewRecord] = useState<MatchingRecord>(), [opened, setOpened] = useState(false), [reviewed, setReviewed] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string }>();
  const active = useRef(true), busy = useRef(false), generation = useRef(0), unknown = useRef(false), conflictRef = useRef(false), reviewedRef = useRef(false);
  const identity = useRef(initial ? matchingId(initial.draft) : undefined), headRef = useRef(head);
  const pinned = useRef<{ request: { schemaVersion: "custom-eval-item-save-v3" | "custom-eval-set-save-v3"; draft: MatchingDraft; expectedPreviewFingerprint: string }; body: string } | undefined>(undefined);
  const accepted = useRef<MatchingRecord | undefined>(undefined);
  useEffect(() => { active.current = true; return () => { active.current = false; generation.current++; }; }, []);
  const current = (token: number) => active.current && token === generation.current;
  const locked = !canWrite || Boolean(pending) || uncertain || Boolean(saved);
  function invalidate() { setPreview(undefined); pinned.current = undefined; setNotice(undefined); }
  function edit(update: () => void) { if (busy.current || unknown.current || accepted.current) return; update(); invalidate(); }
  function begin(action: NonNullable<typeof pending>) { busy.current = true; setPending(action); setNotice(undefined); return ++generation.current; }
  function finish(token: number) { if (current(token)) { busy.current = false; setPending(undefined); } }
  function markUnknown(value: boolean) { unknown.current = value; setUncertain(value); }
  function draft(): MatchingDraft {
    const previous = headRef.current;
    const common = { versionId: crypto.randomUUID(), version: (previous?.version ?? 0) + 1, expectedVersionId: previous?.versionId ?? null, name: name.trim() };
    const id = identity.current ?? crypto.randomUUID(); identity.current = id;
    if (kind === "item") return { schemaVersion: "custom-eval-item-draft-v3", itemId: id, ...common, expected };
    if (!threshold.trim() || !Number.isFinite(Number(threshold))) throw new Error("threshold_invalid");
    return { schemaVersion: "custom-eval-set-draft-v3", setId: id, ...common, members: JSON.parse(membersText) as CustomEvalItemRefV3[], datasetPassRateThreshold: Number(threshold) };
  }
  async function prepare() {
    if (busy.current || unknown.current || accepted.current || conflictRef.current && !reviewedRef.current) return;
    const token = begin("preview"); setPreview(undefined); pinned.current = undefined;
    try {
      const next = draft();
      const response = await fetch(`${matchingApi(kind)}/preview`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(next) });
      const value = await readHttpTargetResponse(response);
      if (!current(token)) return;
      if (response.status === 409) { conflictRef.current = true; reviewedRef.current = false; setConflict(true); setReviewed(false); setOpened(false); setReviewRecord(undefined); }
      if (!response.ok || !jsonObject(value) || !jsonObject(value.preview) || value.preview.schemaVersion !== `custom-eval-${kind}-preview-v3`
        || value.preview.workspaceId !== workspaceId || !digest(value.preview.fingerprint) || stable(value.preview.draft) !== stable(next)
        || !jsonObject(value.preview.contract) || typeof value.preview.recordByteAllowance !== "number") throw new Error("preview_invalid");
      const result = value.preview as unknown as MatchingPreview;
      setPreview(result);
      setNotice({ error: false, text: "Complete preview ready. Nothing was saved or executed. Inspect the complete frozen check or memberships, then explicitly save." });
    } catch { if (current(token)) setNotice({ error: true, text: "Preview is unavailable. Check exact saved item versions, name, text and pass rule. Your authored fields are preserved." }); }
    finally { finish(token); }
  }
  function accept(record: MatchingRecord, replayed: boolean) {
    accepted.current = record; setSaved(record); markUnknown(false); onSaved?.(record);
    conflictRef.current = false; reviewedRef.current = false; setConflict(false); setReviewed(false); setOpened(false); setReviewRecord(undefined);
    setNotice({ error: false, text: replayed ? "Recovered the exact existing version. No duplicate was saved and nothing was executed." : "Immutable version saved. Earlier versions remain unchanged; saving did not run any check or target." });
  }
  async function save() {
    if (!canWrite || busy.current || accepted.current || !preview) return;
    const previouslyUnknown = unknown.current, token = begin("save"); let started = false;
    try {
      if (!pinned.current) {
        const request = { schemaVersion: kind === "item" ? "custom-eval-item-save-v3" as const : "custom-eval-set-save-v3" as const, draft: preview.draft, expectedPreviewFingerprint: preview.fingerprint };
        pinned.current = { request, body: JSON.stringify(request) };
      }
      const intent = pinned.current; started = true;
      const response = await fetch(matchingApi(kind), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: intent.body });
      const value = await readHttpTargetResponse(response);
      if (!current(token)) return;
      if (!response.ok) {
        if (!previouslyUnknown && [400, 401, 403, 404, 409, 413, 422].includes(response.status)) {
          pinned.current = undefined; setPreview(undefined); markUnknown(false);
          if (response.status === 409) { conflictRef.current = true; reviewedRef.current = false; setConflict(true); setReviewed(false); setOpened(false); setReviewRecord(undefined); }
          setNotice({ error: true, text: response.status === 409 ? "This save conflicts with stored state. Your text and member references are preserved. Reload and visibly review the current head before preparing another intent." : "The save was rejected before a new version was accepted. Your authored fields are preserved; check access and preview again." });
        } else { markUnknown(true); setNotice({ error: true, text: "The save outcome is unknown. Retry the identical request or check the exact version. Editing remains locked." }); }
        return;
      }
      if (!jsonObject(value) || typeof value.replayed !== "boolean" || !recordShape(value.record, kind, workspaceId, intent.request.draft, intent.request.expectedPreviewFingerprint)) throw new Error("save_response_invalid");
      accept(value.record, value.replayed);
    } catch { if (current(token)) { markUnknown(started); setNotice({ error: true, text: started ? "The save outcome is unknown. Keep this identical request and check its exact saved version; an absent read does not cancel a save." : "The save intent could not be prepared. Your authored fields are preserved." }); } }
    finally { finish(token); }
  }
  async function recover() {
    const intent = pinned.current;
    if (!intent || busy.current) return;
    const token = begin("recover");
    try {
      const response = await fetch(`${matchingApi(kind)}/${matchingId(intent.request.draft)}/versions/${intent.request.draft.versionId}`, { credentials: "same-origin", cache: "no-store" });
      const value = await readHttpTargetResponse(response);
      if (!current(token)) return;
      if (!response.ok || !jsonObject(value) || !recordShape(value.record, kind, workspaceId, intent.request.draft, intent.request.expectedPreviewFingerprint)) throw new Error("exact_version_unavailable");
      accept(value.record, true);
    } catch { if (current(token)) setNotice({ error: true, text: "The exact version could not yet be confirmed. An absent read does not cancel an in-flight save. Preserve this identical retry request." }); }
    finally { finish(token); }
  }
  async function reloadHead() {
    if (!identity.current || busy.current || unknown.current) return;
    const token = begin("head");
    try {
      const response = await fetch(`${matchingApi(kind)}/${identity.current}`, { credentials: "same-origin", cache: "no-store" });
      const value = await readHttpTargetResponse(response);
      if (!current(token)) return;
      if (!response.ok || !jsonObject(value) || !jsonObject(value.detail) || !jsonObject(value.detail.head)
        || !recordShape(value.record, kind, workspaceId) || matchingId(value.record.draft) !== identity.current
        || value.detail.head.versionId !== value.record.draft.versionId || value.detail.head.recordFingerprint !== value.record.fingerprint
        || value.record.draft.version < (headRef.current?.version ?? 0)) throw new Error("head_invalid");
      const next = headOf(value.record); headRef.current = next; setHead(next); setReviewRecord(value.record); setOpened(false); setReviewed(false); reviewedRef.current = false;
      setNotice({ error: false, text: "Current head loaded. Your authored fields are unchanged. Open its complete record and confirm review before preparing a new version." });
    } catch { if (current(token)) setNotice({ error: true, text: "The current head could not be loaded. Your authored fields remain preserved; a new preview stays blocked until review succeeds." }); }
    finally { finish(token); }
  }
  function another() {
    if (busy.current || unknown.current || !accepted.current) return;
    generation.current++; const next = headOf(accepted.current); headRef.current = next; setHead(next);
    accepted.current = undefined; setSaved(undefined); pinned.current = undefined; setPreview(undefined); setNotice(undefined);
  }
  function newAggregate() {
    if (initialResource || busy.current || unknown.current || !accepted.current) return;
    generation.current++; accepted.current = undefined; identity.current = undefined; headRef.current = null;
    setHead(null); setSaved(undefined); setPreview(undefined); pinned.current = undefined; setName(""); setExpected(""); setMembersText("[]"); setThreshold("100"); setNotice(undefined);
  }
  function selectItem(value: string) {
    const chosen = itemChoices.find(item => `${item.schemaVersion}/${item.itemId}/${item.versionId}` === value);
    if (!chosen) return;
    try {
      const refs: unknown = JSON.parse(membersText);
      if (!Array.isArray(refs) || refs.length >= 32) throw new Error("members_invalid");
      if (refs.some(ref => jsonObject(ref) && ref.schemaVersion === chosen.schemaVersion && ref.itemId === chosen.itemId && ref.versionId === chosen.versionId)) {
        setNotice({ error: true, text: "That exact item version is already selected. Another saved version of the same item can be added separately." }); return;
      }
      edit(() => setMembersText(JSON.stringify([...refs, { schemaVersion: chosen.schemaVersion, itemId: chosen.itemId, versionId: chosen.versionId, fingerprint: chosen.fingerprint }], null, 2)));
    } catch { setNotice({ error: true, text: "Preserved the membership text. Correct its JSON array before adding a saved version." }); }
  }
  let selected: CustomEvalItemRefV3[] | undefined;
  try { const value: unknown = JSON.parse(membersText); if (Array.isArray(value) && value.every(ref => jsonObject(ref) && (ref.schemaVersion === "custom-eval-item-ref-v2" || ref.schemaVersion === "custom-eval-item-ref-v3") && typeof ref.itemId === "string" && typeof ref.versionId === "string" && digest(ref.fingerprint))) selected = value as CustomEvalItemRefV3[]; } catch {}
  function move(index: number, destination?: number) {
    if (!selected) return;
    const next = [...selected], [member] = next.splice(index, 1);
    if (destination !== undefined && member) next.splice(destination, 0, member);
    edit(() => setMembersText(JSON.stringify(next, null, 2)));
  }
  return <section className="grid min-w-0 content-start gap-4 border border-border bg-panel p-4" aria-label={kind === "item" ? "Reusable Eval Item editor" : "Composed Eval Set editor"} aria-busy={Boolean(pending)}>
    <h2 className="font-semibold">{head ? `Prepare ${kind} version ${head.version + 1}` : kind === "item" ? "Create a reusable Eval Item" : "Compose an Eval Set"}</h2>
    <p className="text-sm text-muted-foreground">{kind === "item" ? "A critical, weight-1 exact check compares literal strings. Case, whitespace and Unicode sequences must match. Save it once and reuse its exact version across sets." : "Select 1–32 saved contains or exact item versions in order. Every member is critical and weight 1. Shared item versions are checked once per row while each set keeps its own membership."} Preview and save make no target calls.</p>
    <div className="grid gap-1 text-sm"><label htmlFor={`${prefix}-name`}>{kind === "item" ? "Item name" : "Set name"}</label><input id={`${prefix}-name`} className={inputClass} value={name} readOnly={locked} onChange={event => edit(() => setName(event.target.value))} /></div>
    {kind === "item" ? <div className="grid gap-1 text-sm"><label htmlFor={`${prefix}-expected`}>Exact text the output must equal</label><textarea id={`${prefix}-expected`} className={`${inputClass} min-h-28 font-mono`} value={expected} readOnly={locked} onChange={event => edit(() => setExpected(event.target.value))} /><p className="text-xs text-muted-foreground">Saved exactly as entered, up to 4,096 UTF-8 bytes. Whitespace alone is not a check.</p></div> : <>
      <div className="grid gap-1 text-sm"><label htmlFor={`${prefix}-add-item`}>Add an exact saved item version</label><select id={`${prefix}-add-item`} className={inputClass} disabled={locked} value="" onChange={event => selectItem(event.target.value)}><option value="">Choose a saved version</option>{itemChoices.map(item => <option key={`${item.schemaVersion}/${item.itemId}/${item.versionId}`} value={`${item.schemaVersion}/${item.itemId}/${item.versionId}`} disabled={selected?.some(ref => ref.schemaVersion === item.schemaVersion && ref.itemId === item.itemId && ref.versionId === item.versionId)}>{item.name} · {item.schemaVersion === "custom-eval-item-ref-v3" ? "exact" : "contains"} · version {item.version}</option>)}</select></div>
      <ol className="grid min-w-0 gap-2" aria-label="Ordered saved item membership">{selected?.map((ref, index) => <li className="grid min-w-0 gap-2 border border-border p-3" key={`${ref.schemaVersion}/${ref.itemId}/${ref.versionId}/${index}`}><Link className="break-words text-sm underline" href={matchingItemPath(ref)}>{index + 1}. {itemChoices.find(item => item.schemaVersion === ref.schemaVersion && item.itemId === ref.itemId && item.versionId === ref.versionId)?.name ?? "Saved item version"}</Link><p className="break-all font-mono text-xs">{ref.versionId}</p><div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={locked || index === 0} onClick={() => move(index, index - 1)}>Move member {index + 1} up</button><button type="button" className={buttonClass} disabled={locked || index === selected!.length - 1} onClick={() => move(index, index + 1)}>Move member {index + 1} down</button><button type="button" className={buttonClass} disabled={locked} onClick={() => move(index)}>Remove member {index + 1}</button></div></li>)}</ol>
      <details className="min-w-0 text-sm"><summary className="cursor-pointer">Use exact earlier versions or inspect membership references</summary><p className="mt-2 text-xs text-muted-foreground">Array order is membership order. Earlier versions remain available by exact public item/version IDs and contract fingerprint; inspect an item history for these values. Invalid text stays preserved until corrected.</p><div className="mt-2 grid gap-1"><label htmlFor={`${prefix}-members`}>Exact saved item versions (ordered JSON)</label><textarea id={`${prefix}-members`} className={`${inputClass} min-h-48 font-mono text-xs`} value={membersText} readOnly={locked} onChange={event => edit(() => setMembersText(event.target.value))} /></div></details>
      <div className="grid max-w-xs gap-1 text-sm"><label htmlFor={`${prefix}-threshold`}>Dataset pass-rate gate (%)</label><input id={`${prefix}-threshold`} className={inputClass} type="number" min={0} max={100} step="any" value={threshold} readOnly={locked} onChange={event => edit(() => setThreshold(event.target.value))} /></div>
      <p className="text-xs text-muted-foreground">A required critical failure blocks this set and its dataset scope even when the pass-rate threshold is 0%. Shared checks retain their critical membership in every selected set.</p>
    </>}
    {!canWrite ? <p className="text-sm text-muted-foreground">Your session can inspect and preview. Workspace edit access is required to author or save.</p> : null}
    <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={Boolean(pending) || uncertain || Boolean(saved) || conflict && !reviewed} onClick={prepare}>{pending === "preview" ? "Preparing complete preview…" : `Preview ${kind} without saving`}</button></div>
    {conflict ? <section className="grid gap-3 border border-border bg-muted p-3" aria-label="Review current matching head"><h3 className="font-medium">Review current saved head</h3><button type="button" className={buttonClass} disabled={Boolean(pending) || uncertain || Boolean(saved)} onClick={reloadHead}>Reload current head</button>{reviewRecord ? <><details onToggle={event => { if (event.currentTarget.open) setOpened(true); }}><summary className="cursor-pointer text-sm">Inspect complete current head before another intent</summary><pre tabIndex={0} aria-label="Complete current matching head" className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(reviewRecord, null, 2)}</pre></details><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={Boolean(pending) || !opened} onChange={event => { setReviewed(event.target.checked); reviewedRef.current = event.target.checked; invalidate(); }} />I reviewed the current head and want a new version using my preserved fields.</label></> : null}</section> : null}
    {preview ? <section className="grid gap-3 border border-border p-3" aria-label="Complete matching preview"><h3 className="font-medium">Complete {kind} preview</h3><p className="text-sm">{preview.contract.name} · {preview.schemaVersion === "custom-eval-set-preview-v3" ? `${preview.members.length} ordered members` : "one reusable critical check"}</p><p className="text-xs text-muted-foreground">Complete record allowance: {preview.recordByteAllowance} bytes.</p><CompleteJson label={`Inspect complete ${kind} preview and fingerprints`} value={preview} /><div className="flex flex-wrap gap-2"><button type="button" className={primaryClass} disabled={!canWrite || Boolean(pending) || Boolean(saved)} onClick={save}>{pending === "save" ? "Saving immutable version…" : uncertain ? `Retry identical ${kind} save` : `Save immutable ${kind} version`}</button>{uncertain ? <button type="button" className={buttonClass} disabled={Boolean(pending)} onClick={recover}>Check exact saved version</button> : null}</div></section> : null}
    {notice ? <p role={notice.error ? "alert" : "status"} className={notice.error ? "text-sm text-danger" : "text-sm text-muted-foreground"}>{notice.text}</p> : null}
    {saved ? <div className="grid gap-3 text-sm"><Link className="underline underline-offset-4" href={matchingPath(kind, matchingId(saved.draft), saved.draft.versionId)}>Open exact saved {kind} version</Link><CompleteJson label={`Inspect complete saved ${kind} record`} value={saved} /><div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={another}>Prepare another version</button>{!initialResource ? <button type="button" className={buttonClass} onClick={newAggregate}>Create another {kind}</button> : null}</div></div> : null}
  </section>;
}

export function MatchingResourceEditor({ resource, kind, workspaceId, canWrite, items }: { resource: MatchingResource; kind: MatchingKind; workspaceId: string; canWrite: boolean; items: MatchingLibraryItem[] }) {
  return <MatchingEditor key={`${kind}/${matchingId(resource.record.draft)}`} kind={kind} workspaceId={workspaceId} canWrite={canWrite} initialResource={resource} itemChoices={choices(items)} />;
}

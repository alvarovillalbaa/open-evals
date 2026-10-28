"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, GitBranch, Loader2, LockKeyhole, Plus, Trash2 } from "lucide-react";
import type { InstructionDetailDTO, PromptDraftInput, PromptDraftPreview, PromptVersion, StoredVersionDTO } from "@open-evals/core";
import {
  AuthoringRequestError, authoringError, authoringRequest, componentChanges, draftFromVersion,
  draftInput, newAuthoringId, previewMatchesDraft, storedVersionMatches,
  type BindingRow, type ComponentRow, type EditorDraft
} from "./instruction-authoring-client";

const inputClass = "min-h-10 min-w-0 w-full rounded-md border border-border bg-panel px-3 py-2 text-base disabled:opacity-60";
const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border bg-panel px-3 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const primaryClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50";
type RequestOwner = { controller: AbortController; kind: "load" | "preview" | "save"; revision: number };
type Reviewed = { result: PromptDraftPreview; input: PromptDraftInput; revision: number };
type SaveAttempt = { input: PromptDraftInput; preview: PromptDraftPreview };

export function InstructionEditor({ initialDetail }: { initialDetail: InstructionDetailDTO }) {
  const [detail, setDetail] = useState(initialDetail);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [reviewed, setReviewed] = useState<Reviewed | null>(null);
  const [busy, setBusy] = useState<RequestOwner["kind"] | null>(null);
  const [saveAttempt, setSaveAttempt] = useState<SaveAttempt | null>(null);
  const [savedToReload, setSavedToReload] = useState<string | null>(null);
  const [canResumeEditing, setCanResumeEditing] = useState(false);
  const [error, setError] = useState("");
  const [signInRequired, setSignInRequired] = useState(false);
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const request = useRef<RequestOwner | null>(null);
  const revision = useRef(0);
  const rowNumber = useRef(0);
  const attemptRef = useRef<SaveAttempt | null>(null);
  const acknowledgedSave = useRef<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const selected = detail.selectedVersion;
  const frozen = Boolean(saveAttempt || savedToReload) || busy === "save";
  const apiPath = `/api/v1/instructions/${encodeURIComponent(detail.definition.id)}`;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current += 1;
      request.current?.controller.abort();
      request.current = null;
    };
  }, []);

  useEffect(() => {
    if (!draft) return;
    function warnUnsaved(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    window.addEventListener("beforeunload", warnUnsaved);
    return () => window.removeEventListener("beforeunload", warnUnsaved);
  }, [draft]);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function owns(owner: RequestOwner) {
    return mounted.current && request.current === owner && revision.current === owner.revision;
  }

  function beginRequest(kind: RequestOwner["kind"]): RequestOwner {
    request.current?.controller.abort();
    const owner = { controller: new AbortController(), kind, revision: revision.current };
    request.current = owner;
    setBusy(kind);
    setError("");
    setNotice("");
    return owner;
  }

  function finish(owner: RequestOwner) {
    if (owns(owner)) { request.current = null; setBusy(null); }
  }

  function fail(failure: unknown, owner?: RequestOwner) {
    if (owner && !owns(owner)) return;
    setError(authoringError(failure));
    setSignInRequired(failure instanceof AuthoringRequestError && failure.status === 401);
  }

  function changeDraft(change: (current: EditorDraft) => EditorDraft) {
    if (attemptRef.current || frozen) return;
    revision.current += 1;
    request.current?.controller.abort();
    request.current = null;
    setBusy(null);
    setReviewed(null);
    setError("");
    setNotice("");
    setDraft(current => current ? change(current) : current);
  }

  function startDraft(base?: PromptVersion) {
    if (!detail.canWrite || draft || busy || attemptRef.current) return;
    try {
      const next = draftFromVersion(newAuthoringId("prompt"), base);
      revision.current += 1;
      setDraft(next);
      setReviewed(null);
      setNotice("Unsaved draft created. Compile a preview before saving.");
      setError("");
    } catch (failure) { fail(failure); }
  }

  function discardDraft() {
    if (frozen || attemptRef.current) return;
    revision.current += 1;
    request.current?.controller.abort();
    request.current = null;
    setBusy(null);
    setDraft(null);
    setReviewed(null);
    setError("");
    setNotice("Unsaved draft discarded.");
  }

  async function loadVersion(versionId: string, afterSave = false) {
    if (request.current?.kind === "save" || (!afterSave && (draft || attemptRef.current))) return;
    const owner = beginRequest("load");
    try {
      const loaded = await authoringRequest<InstructionDetailDTO>(`${apiPath}?versionId=${encodeURIComponent(versionId)}`, { method: "GET" }, owner.controller.signal);
      if (!owns(owner)) return;
      if (loaded.definition.id !== detail.definition.id || loaded.selectedVersion?.id !== versionId) throw new Error("The loaded version did not match the requested saved record.");
      if (afterSave && (!attemptRef.current || !storedVersionMatches(attemptRef.current.preview.version, loaded.selectedVersion))) {
        throw new Error("The saved source snapshot does not match the reviewed draft. Keep this attempt ID and reload before continuing.");
      }
      setDetail(loaded);
      if (afterSave) {
        attemptRef.current = null;
        acknowledgedSave.current = null;
        setSaveAttempt(null);
        setSavedToReload(null);
        setCanResumeEditing(false);
        setDraft(null);
        setReviewed(null);
        setNotice("Saved version loaded from storage. This authoring action did not change serving releases.");
      }
      window.history.replaceState(null, "", `/instructions/${encodeURIComponent(loaded.definition.id)}?versionId=${encodeURIComponent(versionId)}`);
    } catch (failure) { fail(failure, owner); }
    finally { finish(owner); }
  }

  async function previewDraft() {
    if (!draft || frozen || attemptRef.current || !detail.canWrite) return;
    let input: PromptDraftInput;
    try { input = draftInput(draft); }
    catch (failure) { setReviewed(null); fail(failure); return; }
    const owner = beginRequest("preview");
    setReviewed(null);
    try {
      const result = await authoringRequest<PromptDraftPreview>(`${apiPath}/preview`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input)
      }, owner.controller.signal);
      if (!owns(owner)) return;
      if (!previewMatchesDraft(input, detail.definition.id, result)) {
        throw new Error("The preview response was invalid. Compile this draft again before saving.");
      }
      setReviewed({ input, result, revision: owner.revision });
      setNotice("Preview compiled. Review the rendered text and changes before saving.");
    } catch (failure) { fail(failure, owner); }
    finally { finish(owner); }
  }

  async function saveDraft() {
    if (request.current?.kind === "save" || acknowledgedSave.current || !detail.canWrite) return;
    let attempt = attemptRef.current;
    if (!attempt) {
      if (!draft || !reviewed || reviewed.revision !== revision.current) return;
      attempt = { input: reviewed.input, preview: reviewed.result };
      attemptRef.current = attempt;
      setSaveAttempt(attempt);
    }
    const owner = beginRequest("save");
    setCanResumeEditing(false);
    try {
      const result = await authoringRequest<{ version: StoredVersionDTO; replayed: boolean }>(`${apiPath}/versions`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...attempt.input, previewFingerprint: attempt.preview.previewFingerprint })
      }, owner.controller.signal);
      if (!owns(owner)) return;
      if (!storedVersionMatches(attempt.preview.version, result.version)) throw new Error("The save response did not match the reviewed source snapshot. Check the saved version using this attempt ID.");
      acknowledgedSave.current = attempt.input.versionId;
      setSavedToReload(attempt.input.versionId);
      finish(owner);
      await loadVersion(attempt.input.versionId, true);
    } catch (failure) {
      if (!owns(owner)) return;
      setCanResumeEditing(failure instanceof AuthoringRequestError && failure.status !== undefined && [400, 401, 403, 404, 409, 422].includes(failure.status));
      fail(failure, owner);
    } finally { finish(owner); }
  }

  function resumeEditing() {
    if (!canResumeEditing || busy || acknowledgedSave.current) return;
    attemptRef.current = null;
    setSaveAttempt(null);
    setCanResumeEditing(false);
    setReviewed(null);
    setError("");
    setNotice("Draft retained. Compile a new preview before saving again.");
    revision.current += 1;
  }

  function updateComponent(key: string, patch: Partial<ComponentRow>) {
    changeDraft(current => ({ ...current, components: current.components.map(row => row.key === key ? { ...row, ...patch } : row) }));
  }

  function updateBinding(key: string, patch: Partial<BindingRow>) {
    changeDraft(current => ({ ...current, bindings: current.bindings.map(row => row.key === key ? { ...row, ...patch } : row) }));
  }

  function moveComponent(key: string, direction: -1 | 1) {
    changeDraft(current => {
      const index = current.components.findIndex(row => row.key === key);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.components.length) return current;
      const components = [...current.components];
      [components[index], components[target]] = [components[target], components[index]];
      return { ...current, components };
    });
  }

  function addComponent() {
    if (!draft) return;
    let number = rowNumber.current++;
    while (draft.components.some(row => row.id === `component_${number + 1}`)) number = rowNumber.current++;
    changeDraft(current => ({ ...current, components: [...current.components, { key: `added-component-${number}`, id: `component_${number + 1}`, kind: "instruction", locked: false, format: "content", text: "" }] }));
  }

  const protectedRows = new Set(draft?.base?.components.flatMap((component, index) => component.locked ? [`component-${index}`] : []));

  return (
    <div className="grid min-w-0 gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/instructions" className="min-h-10 py-2 text-sm underline" onClick={event => { if (draft && !window.confirm("Leave this page and discard the unsaved draft? A pending save may already have completed.")) event.preventDefault(); }}>All instructions</Link>
        <span className="text-sm text-muted-foreground">{detail.canWrite ? "Editor access" : "Read-only access"}</span>
      </div>
      <div ref={errorRef} tabIndex={-1} role={error ? "alert" : undefined} className={error ? "rounded-md border border-danger bg-panel p-3 text-sm text-danger" : "sr-only"}>
        {error}{error && signInRequired ? <p className="mt-2"><Link href="/login" target="_blank" rel="noreferrer" className="underline">Sign in in another tab</Link></p> : null}
      </div>
      <p role="status" aria-live="polite" className={notice || busy ? "text-sm text-muted-foreground" : "sr-only"}>{busy === "load" ? "Loading the saved version…" : busy === "preview" ? "Compiling preview…" : busy === "save" ? "Saving the reviewed draft…" : notice}</p>

      <section aria-labelledby="versions-heading" className="min-w-0 border border-border bg-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="versions-heading" className="font-semibold">Saved versions</h2>
          <button type="button" disabled={Boolean(draft) || Boolean(busy) || !selected} className={buttonClass} onClick={() => { if (selected) void loadVersion(selected.id); }}>Reload version</button>
        </div>
        {detail.versions.length ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {detail.versions.map(version => (
              <button type="button" key={version.id} aria-pressed={selected?.id === version.id} disabled={Boolean(draft) || Boolean(busy)} onClick={() => void loadVersion(version.id)} className={`grid min-w-0 gap-1 rounded-md border p-3 text-left disabled:opacity-60 ${selected?.id === version.id ? "border-accent bg-accent-soft" : "border-border hover:bg-muted"}`}>
                <span className="break-all font-mono text-xs">{version.id}</span>
                <span className="text-sm">{version.status} · {version.authoring}</span>
                <time dateTime={version.createdAt} className="text-xs text-muted-foreground">{version.createdAt.replace("T", " ").replace(/\.\d+Z$/, " UTC")}</time>
              </button>
            ))}
          </div>
        ) : <p className="mt-3 text-sm text-muted-foreground">No versions saved. Compose the first draft for this definition.</p>}
        {draft ? <p className="mt-3 text-xs text-muted-foreground">Finish or discard the current draft before changing saved versions.</p> : null}
      </section>

      {!draft && selected ? (
        <section className="grid min-w-0 gap-4 border border-border bg-panel p-4" aria-label="Saved version review">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-semibold">Saved version · {selected.status}</h2><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{selected.id}</p></div>
            {detail.canWrite && selected.version ? <button type="button" className={primaryClass} disabled={Boolean(busy)} onClick={() => startDraft(selected.version)}><GitBranch className="size-4" aria-hidden="true" />Compose version</button> : null}
          </div>
          {selected.version ? <VersionReview version={selected.version} /> : <><p className="text-sm text-muted-foreground">{selected.readOnlyReason === "invalid_authored_version" ? "This stored version failed authoring validation. Its original text and hash are shown, and it cannot be used as a base." : "This historical record has no verified authoring source. Its original text and hash remain read-only."}</p><HashValue label="Original content hash" value={selected.contentHash} /><HashValue label="Parent versions" value={selected.parentVersionIds.join(", ") || "none"} /><PromptText title="Stored compiled text" text={selected.compiledText} /></>}
          <p className="text-xs text-muted-foreground">Saved snapshots are immutable. Authoring does not promote releases or start experiments.</p>
        </section>
      ) : !draft && detail.canWrite && !detail.versions.length ? (
        <section className="grid justify-items-start gap-3 border border-dashed border-border bg-panel p-5"><h2 className="font-semibold">Compose the first version</h2><p className="text-sm text-muted-foreground">Start with a literal instruction or enable typed bindings and operation blocks.</p><button type="button" className={primaryClass} onClick={() => startDraft()}><Plus className="size-4" aria-hidden="true" />Compose first version</button></section>
      ) : null}

      {draft ? (
        <section className="grid min-w-0 gap-5 border border-border bg-panel p-4" aria-labelledby="draft-heading">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><h2 id="draft-heading" className="font-semibold">Compose an immutable draft</h2><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{draft.versionId}</p><p className="mt-1 break-all text-xs text-muted-foreground">Parent: {draft.base?.id ?? "none · first version"}</p></div>
            <button type="button" disabled={frozen} className={buttonClass} onClick={discardDraft}>Discard draft</button>
          </div>
          {frozen ? <div className="grid gap-3 rounded-md border border-border bg-muted p-3 text-sm"><p>{savedToReload ? "Save was acknowledged. Reload the persisted version to finish; a second save will not be sent." : "This save attempt is frozen. Retry the same identity or check storage before continuing."}</p><div className="flex flex-wrap gap-2"><button type="button" disabled={Boolean(busy)} className={buttonClass} onClick={() => void loadVersion(savedToReload ?? draft.versionId, true)}>{savedToReload ? "Retry loading saved version" : "Check saved version"}</button>{!savedToReload ? <button type="button" disabled={Boolean(busy)} className={primaryClass} onClick={() => void saveDraft()}>Retry same save</button> : null}{canResumeEditing ? <button type="button" disabled={Boolean(busy)} className={buttonClass} onClick={resumeEditing}>Return to editing</button> : null}</div></div> : null}
          <fieldset disabled={frozen || !detail.canWrite} className="grid min-w-0 gap-5 disabled:opacity-70">
            <legend className="sr-only">Draft source</legend>
            <label className="flex items-start gap-2 text-sm"><input style={{ fontSize: "1rem" }} type="checkbox" checked={draft.composition} onChange={event => { const composition = event.target.checked; changeDraft(current => ({ ...current, composition })); }} className="mt-1 size-4" /><span>Enable composition<span className="mt-1 block text-xs text-muted-foreground">Resolve typed bindings, named blocks, conditions and loops. With composition off, text stays literal.</span></span></label>
            <div className="grid min-w-0 gap-3">
              <h3 className="text-sm font-semibold">Ordered components</h3>
              {draft.components.map((row, index) => {
                const protectedComponent = protectedRows.has(row.key);
                return <fieldset key={row.key} className="grid min-w-0 gap-3 rounded-md border border-border p-3">
                  <legend className="px-1 text-sm font-medium">Component {index + 1}{protectedComponent ? " · locked in parent" : ""}</legend>
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                    <label className="grid min-w-0 gap-1 text-sm"><span>Component ID</span><input style={{ fontSize: "1rem" }} required maxLength={128} className={inputClass} value={row.id} disabled={protectedComponent} onChange={event => updateComponent(row.key, { id: event.target.value })} /></label>
                    <label className="grid min-w-0 gap-1 text-sm"><span>Kind</span><input style={{ fontSize: "1rem" }} required maxLength={128} className={inputClass} value={row.kind} disabled={protectedComponent} onChange={event => updateComponent(row.key, { kind: event.target.value })} placeholder="role, safety, tool_rules…" /></label>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex min-h-10 items-center gap-2 text-sm"><input style={{ fontSize: "1rem" }} type="checkbox" checked={row.locked} disabled={protectedComponent} onChange={event => updateComponent(row.key, { locked: event.target.checked })} className="size-4" /><LockKeyhole className="size-4" aria-hidden="true" />Lock rendered text</label>
                    <label className="flex min-w-0 items-center gap-2 text-sm"><span>Source</span><select style={{ fontSize: "1rem" }} className={inputClass} value={row.format} disabled={protectedComponent} onChange={event => updateComponent(row.key, { format: event.target.value as ComponentRow["format"] })}><option value="content">Text</option><option value="operations">Operations JSON</option></select></label>
                  </div>
                  <label className="grid min-w-0 gap-1 text-sm"><span>{row.format === "content" ? (draft.composition ? "Template text" : "Literal text") : "Operation array (JSON)"}</span><textarea style={{ fontSize: "1rem", fontFamily: "var(--font-geist-mono)" }} className={`${inputClass} min-h-36 font-mono text-sm`} spellCheck={false} value={row.text} disabled={protectedComponent} onChange={event => updateComponent(row.key, { text: event.target.value })} /></label>
                  {protectedComponent ? <p className="text-xs text-muted-foreground">The server also checks that binding changes preserve this component’s rendered text and locked order.</p> : null}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={buttonClass} disabled={protectedComponent || index === 0} aria-label={`Move component ${index + 1} up`} onClick={() => moveComponent(row.key, -1)}><ArrowUp className="size-4" aria-hidden="true" />Up</button>
                    <button type="button" className={buttonClass} disabled={protectedComponent || index === draft.components.length - 1} aria-label={`Move component ${index + 1} down`} onClick={() => moveComponent(row.key, 1)}><ArrowDown className="size-4" aria-hidden="true" />Down</button>
                    <button type="button" className={buttonClass} disabled={protectedComponent} aria-label={`Remove component ${index + 1}`} onClick={() => changeDraft(current => ({ ...current, components: current.components.filter(component => component.key !== row.key) }))}><Trash2 className="size-4" aria-hidden="true" />Remove</button>
                  </div>
                </fieldset>;
              })}
              <button type="button" className={`${buttonClass} w-fit`} onClick={addComponent}><Plus className="size-4" aria-hidden="true" />Add component</button>
            </div>

            {draft.composition ? <>
              <div className="grid min-w-0 gap-3"><h3 className="text-sm font-semibold">Typed bindings</h3><p className="text-xs text-muted-foreground">Use {"{{name}}"} for scalar values and {"{{json:name}}"} for JSON. Values are explicit authoring inputs, not values pulled from a trace or environment.</p>
                {draft.bindings.map((row, index) => <fieldset key={row.key} className="grid min-w-0 gap-3 rounded-md border border-border p-3"><legend className="px-1 text-sm">Binding {index + 1}</legend><div className="grid min-w-0 gap-3 sm:grid-cols-2"><label className="grid min-w-0 gap-1 text-sm"><span>Name</span><input style={{ fontSize: "1rem" }} className={inputClass} value={row.name} maxLength={128} onChange={event => updateBinding(row.key, { name: event.target.value })} /></label><label className="grid min-w-0 gap-1 text-sm"><span>Type</span><select style={{ fontSize: "1rem" }} className={inputClass} value={row.type} onChange={event => { const type = event.target.value as BindingRow["type"]; updateBinding(row.key, { type, value: type === "boolean" ? "false" : type === "number" ? "0" : type === "json" ? "null" : "" }); }}><option value="string">String</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="json">JSON</option></select></label></div><label className="grid min-w-0 gap-1 text-sm"><span>Value</span>{row.type === "boolean" ? <select style={{ fontSize: "1rem" }} className={inputClass} value={row.value} onChange={event => updateBinding(row.key, { value: event.target.value })}><option value="false">false</option><option value="true">true</option></select> : <textarea style={{ fontSize: "1rem", fontFamily: "var(--font-geist-mono)" }} className={`${inputClass} min-h-20 font-mono text-sm`} spellCheck={false} value={row.value} onChange={event => updateBinding(row.key, { value: event.target.value })} />}</label><button type="button" className={`${buttonClass} w-fit`} aria-label={`Remove binding ${index + 1}`} onClick={() => changeDraft(current => ({ ...current, bindings: current.bindings.filter(binding => binding.key !== row.key) }))}>Remove binding</button></fieldset>)}
                <button type="button" className={`${buttonClass} w-fit`} onClick={() => { const number = rowNumber.current++; changeDraft(current => ({ ...current, bindings: [...current.bindings, { key: `added-binding-${number}`, name: "", type: "string", value: "" }] })); }}><Plus className="size-4" aria-hidden="true" />Add binding</button>
              </div>
              <label className="grid min-w-0 gap-1 text-sm"><span className="font-semibold">Named block library (JSON object)</span><textarea style={{ fontSize: "1rem", fontFamily: "var(--font-geist-mono)" }} className={`${inputClass} min-h-44 font-mono text-sm`} spellCheck={false} value={draft.blocks} onChange={event => { const blocks = event.target.value; changeDraft(current => ({ ...current, blocks })); }} aria-describedby="blocks-help" /></label>
              <p id="blocks-help" className="text-xs text-muted-foreground">Each key names an operation array. Includes use root bindings; loop item aliases stay inside the loop. The server validates unused blocks and both condition branches.</p>
              <details className="rounded-md border border-border p-3 text-sm"><summary className="cursor-pointer font-medium">Composition syntax</summary><pre className="mt-3 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{'Text: {"op":"text","template":"Hello {{name}}"}\nInclude: {"op":"include","name":"intro"}\nCondition: {"op":"if","variable":"formal","then":[{"op":"text","template":"Welcome."}],"else":[]}\nLoop: {"op":"each","variable":"items","as":"item","indexAs":"index","body":[{"op":"text","template":"{{index}}: {{item}}"}],"separator":"\\n"}\nLibrary: {"intro":[{"op":"text","template":"Hello {{name}}"}]}\nEscape a placeholder opening with \\{{name}}. No expressions or property traversal.'}</pre></details>
            </> : null}
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={frozen || busy === "preview" || !detail.canWrite} className={buttonClass} onClick={() => void previewDraft()}>{busy === "preview" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}Compile preview</button>
            <button type="button" disabled={frozen || Boolean(busy) || !reviewed || !detail.canWrite} className={primaryClass} onClick={() => void saveDraft()}>Save reviewed draft</button>
          </div>
          {!reviewed ? <p className="text-xs text-muted-foreground">Every source edit invalidates the preview. Saving requires a successful preview of the current draft.</p> : null}
          {reviewed ? <section className="grid min-w-0 gap-4 border-t border-border pt-4" aria-label="Compiled draft review"><h3 className="font-semibold">Review compiled draft</h3><VersionReview version={reviewed.result.version} base={draft.base} /><HashValue label="Reviewed preview fingerprint" value={reviewed.result.previewFingerprint} /></section> : null}
        </section>
      ) : null}
    </div>
  );
}

function HashValue({ label, value }: { label: string; value: string }) {
  return <dl className="min-w-0"><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1 break-all font-mono text-xs">{value}</dd></dl>;
}

function PromptText({ title, text }: { title: string; text: string }) {
  return <section className="min-w-0"><h4 className="mb-2 text-sm font-medium">{title}</h4><pre tabIndex={0} className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-3 font-mono text-xs">{text || "(empty rendered text)"}</pre></section>;
}

function VersionReview({ version, base }: { version: PromptVersion; base?: PromptVersion }) {
  const changes = componentChanges(base?.components ?? [], version.components);
  return <>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2"><HashValue label="Content hash · rendered text" value={version.contentHash} /><HashValue label="Source hash · authoring program" value={version.compositionSnapshot?.sourceHash ?? "Literal source · no separate composition hash"} /><HashValue label="Parent versions" value={version.parentVersionIds.join(", ") || "none"} /><HashValue label="Version ID" value={version.id} /></div>
    {base ? <><h4 className="text-sm font-medium">Component changes against {base.id}</h4><ul className="grid gap-1 text-xs">{changes.map(change => <li key={change.id} className="flex flex-wrap gap-2"><span className="break-all font-mono">{change.id}</span><span>{change.change}{change.locked ? " · locked" : ""}</span></li>)}</ul>{base.contentHash === version.contentHash ? <p className="text-xs text-muted-foreground">Rendered text is unchanged. Review the source separately; authoring changes can leave the rendered hash unchanged.</p> : null}</> : null}
    <div className={`grid min-w-0 gap-4 ${base ? "xl:grid-cols-2" : ""}`}>{base ? <PromptText title="Parent compiled text" text={base.compiledText} /> : null}<PromptText title={base ? "Draft compiled text" : "Compiled text"} text={version.compiledText} /></div>
    <details className="min-w-0 rounded-md border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Full source snapshot</summary><pre tabIndex={0} className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{JSON.stringify(version.compositionSnapshot ?? { components: version.components }, null, 2)}</pre></details>
  </>;
}

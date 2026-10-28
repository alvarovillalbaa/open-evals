import type {
  JsonValue, PromptBinding, PromptBlock, PromptComponent, PromptComponentSource,
  PromptDraftInput, PromptDraftPreview, PromptVersion, StoredVersionDTO
} from "@open-evals/core";

export type ComponentRow = {
  key: string;
  id: string;
  kind: string;
  locked: boolean;
  format: "content" | "operations";
  text: string;
};

export type BindingRow = { key: string; name: string; type: PromptBinding["type"]; value: string };

export type EditorDraft = {
  versionId: string;
  base?: PromptVersion;
  composition: boolean;
  components: ComponentRow[];
  bindings: BindingRow[];
  blocks: string;
};

export class AuthoringRequestError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

export async function authoringRequest<T>(url: string, init: RequestInit, signal: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    const body: unknown = await response.json().catch(() => null);
    if (controller.signal.aborted) throw new Error("instruction_request_aborted");
    if (!response.ok) {
      const code = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "instruction_request_failed";
      throw new AuthoringRequestError(code, response.status);
    }
    if (!body || typeof body !== "object") throw new AuthoringRequestError("instruction_response_invalid");
    return body as T;
  } catch (error) {
    if (timedOut && !signal.aborted) throw new AuthoringRequestError("The request timed out. Its outcome may be unknown; retry the same attempt.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

export function newAuthoringId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function draftFromVersion(versionId: string, base?: PromptVersion): EditorDraft {
  const snapshot = base?.compositionSnapshot;
  const source: readonly PromptComponentSource[] = snapshot?.components ?? base?.components ?? [{ id: "instruction", kind: "role", locked: false, content: "" }];
  return {
    versionId,
    ...(base ? { base } : {}),
    composition: Boolean(snapshot),
    components: source.map((component, index) => ({
      key: `component-${index}`,
      id: component.id,
      kind: component.kind,
      locked: component.locked,
      format: component.operations !== undefined ? "operations" : "content",
      text: component.operations !== undefined ? JSON.stringify(component.operations, null, 2) : component.content
    })),
    bindings: Object.entries(snapshot?.bindings ?? {}).map(([name, binding], index) => ({
      key: `binding-${index}`, name, type: binding.type,
      value: binding.type === "string" ? binding.value : JSON.stringify(binding.value, null, 2)
    })),
    blocks: JSON.stringify(snapshot?.blocks ?? {}, null, 2)
  };
}

export function draftInput(draft: EditorDraft): PromptDraftInput {
  const components: PromptComponentSource[] = draft.components.map((row, index) => {
    const identity = { id: row.id, kind: row.kind, locked: row.locked };
    if (row.format === "content") return { ...identity, content: row.text };
    if (!draft.composition) throw new Error(`Component ${index + 1}: enable composition to use operation blocks.`);
    const operations: unknown = parseJson(row.text, `Component ${index + 1} operations`);
    if (!Array.isArray(operations)) throw new Error(`Component ${index + 1} operations must be a JSON array.`);
    return { ...identity, operations: operations as PromptBlock[] };
  });
  const input = { versionId: draft.versionId, ...(draft.base ? { baseVersionId: draft.base.id } : {}), components };
  if (!draft.composition) return input;
  const bindings: Record<string, PromptBinding> = Object.create(null);
  const names = new Set<string>();
  for (const row of draft.bindings) {
    if (!row.name.trim()) throw new Error("Every binding needs a name.");
    if (names.has(row.name)) throw new Error(`Duplicate binding name: ${row.name}`);
    names.add(row.name);
    if (row.type === "string") bindings[row.name] = { type: "string", value: row.value };
    else if (row.type === "number") {
      const value = Number(row.value);
      if (!row.value.trim() || !Number.isFinite(value)) throw new Error(`Binding ${row.name} needs a finite number.`);
      bindings[row.name] = { type: "number", value };
    } else if (row.type === "boolean") {
      if (row.value !== "true" && row.value !== "false") throw new Error(`Binding ${row.name} needs true or false.`);
      bindings[row.name] = { type: "boolean", value: row.value === "true" };
    } else bindings[row.name] = { type: "json", value: parseJson(row.value, `Binding ${row.name}`) as JsonValue };
  }
  const blocks: unknown = parseJson(draft.blocks, "Block library");
  if (!blocks || typeof blocks !== "object" || Array.isArray(blocks)) throw new Error("The block library must be a JSON object of named operation arrays.");
  return { ...input, composition: { schemaVersion: "prompt-composition-v1", bindings, blocks: blocks as Record<string, PromptBlock[]> } };
}

function parseJson(text: string, label: string): unknown {
  try { return JSON.parse(text); }
  catch { throw new Error(`${label}: enter valid JSON.`); }
}

export function componentChanges(base: readonly PromptComponent[], next: readonly PromptComponent[]) {
  const before = new Map(base.map((component, index) => [component.id, { component, index }]));
  const after = new Map(next.map((component, index) => [component.id, { component, index }]));
  return [...next.map((component, index) => {
    const prior = before.get(component.id);
    const changed = prior && (prior.component.content !== component.content || prior.component.kind !== component.kind || prior.component.locked !== component.locked);
    const moved = prior && prior.index !== index;
    return { id: component.id, change: !prior ? "added" : changed ? (moved ? "changed and moved" : "changed") : moved ? "moved" : "unchanged", locked: component.locked };
  }), ...base.filter(component => !after.has(component.id)).map(component => ({ id: component.id, change: "removed", locked: component.locked }))];
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("instruction_response_invalid");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left) === canonicalJson(right); }
  catch { return false; }
}

function versionSemantics(version: PromptVersion) {
  return {
    id: version.id, definitionId: version.definitionId, parentVersionIds: version.parentVersionIds,
    components: version.components, compiledText: version.compiledText, contentHash: version.contentHash,
    ...(version.compositionSnapshot !== undefined ? { compositionSnapshot: version.compositionSnapshot } : {})
  };
}

/** Compare the whole immutable snapshot; rendered hashes do not identify unused source or lock flags. */
export function storedVersionMatches(expected: PromptVersion, actual: StoredVersionDTO | null | undefined): boolean {
  if (!actual?.version) return false;
  return actual.id === expected.id && actual.compiledText === expected.compiledText && actual.contentHash === expected.contentHash
    && sameJson(actual.parentVersionIds, expected.parentVersionIds)
    && actual.authoring === (expected.compositionSnapshot ? "composition" : "literal")
    && sameJson(versionSemantics(expected), versionSemantics(actual.version));
}

export function previewMatchesDraft(input: PromptDraftInput, definitionId: string, preview: PromptDraftPreview): boolean {
  const version = preview?.version;
  if (!version || version.id !== input.versionId || version.definitionId !== definitionId || version.status !== "draft"
    || typeof version.compiledText !== "string" || !/^[a-f0-9]{24}$/.test(version.contentHash)
    || !/^[a-f0-9]{64}$/.test(preview.previewFingerprint) || !/^[a-f0-9]{64}$/.test(preview.requestFingerprint)
    || !sameJson(version.parentVersionIds, input.baseVersionId ? [input.baseVersionId] : [])) return false;
  if (!input.composition) return version.compositionSnapshot === undefined && sameJson(version.components, input.components);
  const snapshot = version.compositionSnapshot;
  return Boolean(snapshot && /^[a-f0-9]{24}$/.test(snapshot.sourceHash)
    && sameJson({ schemaVersion: snapshot.schemaVersion, components: snapshot.components, bindings: snapshot.bindings, blocks: snapshot.blocks }, {
      schemaVersion: input.composition.schemaVersion, components: input.components,
      bindings: input.composition.bindings, blocks: input.composition.blocks ?? {}
    }) && Array.isArray(version.components) && version.components.length === input.components.length
    && version.components.every((component, index) => component.id === input.components[index].id
      && component.kind === input.components[index].kind && component.locked === input.components[index].locked && typeof component.content === "string"));
}

export function authoringError(error: unknown): string {
  if (error instanceof AuthoringRequestError) {
    if (error.status === undefined) return error.message === "instruction_response_invalid" ? "The server response was incomplete. Retry this same attempt or check the saved version." : error.message;
    if (error.status === 401) return "Your session is unavailable. Sign in, then retry with this draft.";
    if (error.status === 403) return "You do not have permission to author this instruction. Your draft is still here.";
    if (error.status === 404) return "The requested definition or version is unavailable in this workspace.";
    if (error.status === 409) return `The saved identity or reviewed source conflicts with this request (${error.message}). Reload the saved version or review again.`;
    if (error.status === 503) return "Storage is unavailable. Keep this draft and retry the same attempt when it returns.";
    return `The request was rejected (${error.message}).`;
  }
  if (error instanceof Error && error.name !== "TypeError") return error.message;
  return "The request did not complete. Your draft and attempt ID are preserved for retry.";
}

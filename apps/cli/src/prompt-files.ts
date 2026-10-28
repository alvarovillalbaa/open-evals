import { constants } from "node:fs";
import { link, open, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import {
  stableStringify, validatePromptDraftInput,
  type InstructionDetailDTO, type PromptDraftInput, type PromptDraftPreview
} from "@open-evals/core";
import {
  normalizePromptEndpoint, parsePromptDefinitionDetail, parsePromptDraftPreview,
  type CreatePromptDefinitionInput
} from "@open-evals/sdk";

const INPUT_LIMIT = 2 * 1024 * 1024;
const ARTIFACT_LIMIT = 32 * 1024 * 1024;
const FILE_CODES = new Set([
  "prompt_file_read_failed", "prompt_file_too_large", "prompt_file_json_invalid", "prompt_file_invalid",
  "prompt_review_endpoint_mismatch", "prompt_file_write_failed", "prompt_file_exists"
]);

export class PromptFileError extends Error {
  readonly code: string;
  constructor(code: string) {
    const safe = FILE_CODES.has(code) ? code : "prompt_file_invalid";
    super(safe);
    this.name = "PromptFileError";
    this.code = safe;
  }
}

export interface PromptReviewFile {
  readonly schemaVersion: "open-evals-prompt-review-v1";
  readonly endpoint: string;
  readonly definitionId: string;
  readonly input: PromptDraftInput;
  readonly preview: PromptDraftPreview;
}

export async function readPromptDefinitionFile(path: string): Promise<CreatePromptDefinitionInput> {
  return readDefinition(await readJson(path, INPUT_LIMIT));
}

function readDefinition(value: unknown): CreatePromptDefinitionInput {
  return validated(() => {
    const input = record(value, ["id", "stableKey", "targetId"]);
    return Object.freeze({ id: definitionPathIdentity(input.id), stableKey: identity(input.stableKey),
      ...(Object.hasOwn(input, "targetId") ? { targetId: identity(input.targetId) } : {}) });
  });
}

export async function readPromptDraftFile(path: string): Promise<PromptDraftInput> {
  const value = await readJson(path, INPUT_LIMIT);
  return validated(() => validatePromptDraftInput(value));
}

export function makePromptReviewFile(endpoint: string, definitionId: string, input: PromptDraftInput, preview: PromptDraftPreview): PromptReviewFile {
  return validated(() => {
    const normalizedEndpoint = normalizePromptEndpoint(endpoint);
    const id = definitionPathIdentity(definitionId);
    const draft = validatePromptDraftInput(input);
    const checked = parsePromptDraftPreview(preview, id, draft);
    return Object.freeze({ schemaVersion: "open-evals-prompt-review-v1", endpoint: normalizedEndpoint,
      definitionId: id, input: draft, preview: checked });
  });
}

export async function readPromptReviewFile(path: string, expectedEndpoint: string): Promise<PromptReviewFile> {
  const value = await readJson(path, ARTIFACT_LIMIT);
  return validated(() => {
    const input = record(value, ["schemaVersion", "endpoint", "definitionId", "input", "preview"]);
    if (input.schemaVersion !== "open-evals-prompt-review-v1" || typeof input.endpoint !== "string") invalid();
    const endpoint = normalizePromptEndpoint(input.endpoint);
    if (endpoint !== normalizePromptEndpoint(expectedEndpoint)) throw new PromptFileError("prompt_review_endpoint_mismatch");
    return makePromptReviewFile(endpoint, identity(input.definitionId), input.input as PromptDraftInput, input.preview as PromptDraftPreview);
  });
}

export async function readPromptDetailFile(path: string): Promise<InstructionDetailDTO> {
  const value = await readJson(path, ARTIFACT_LIMIT);
  return validated(() => parsePromptDefinitionDetail(value));
}

/** Publish a complete private file atomically, without replacing any existing path. */
export async function writePromptJsonFile(path: string, value: unknown): Promise<"created" | "unchanged"> {
  let bytes: Buffer;
  try {
    const json = JSON.stringify(value, null, 2);
    if (json === undefined) invalid();
    bytes = Buffer.from(`${json}\n`, "utf8");
    if (bytes.length > ARTIFACT_LIMIT) throw new PromptFileError("prompt_file_too_large");
  } catch (error) { if (error instanceof PromptFileError) throw error; throw new PromptFileError("prompt_file_invalid"); }
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let ownedTemporary = false;
  try {
    const handle = await open(temporary, "wx", 0o600);
    ownedTemporary = true;
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
    try { await link(temporary, path); return "created"; }
    catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const existing = await readBytes(path, ARTIFACT_LIMIT);
      if (existing.equals(bytes)) return "unchanged";
      throw new PromptFileError("prompt_file_exists");
    }
  } catch (error) {
    if (error instanceof PromptFileError) throw error;
    throw new PromptFileError("prompt_file_write_failed");
  } finally { if (ownedTemporary) await unlink(temporary).catch(() => undefined); }
}

export interface PromptValueChange<T = unknown> { readonly before: T; readonly after: T }
export interface PromptOrderedChange {
  readonly id: string;
  readonly beforeIndex: number | null;
  readonly afterIndex: number | null;
  readonly before: unknown;
  readonly after: unknown;
}
export interface PromptNamedChange { readonly name: string; readonly before: unknown; readonly after: unknown }
export interface PromptDiffResult {
  readonly left: { readonly definitionId: string; readonly versionId: string | null };
  readonly right: { readonly definitionId: string; readonly versionId: string | null };
  readonly hasDifferences: boolean;
  readonly metadataChanges: Readonly<Record<string, PromptValueChange>>;
  readonly compiledTextChanged: boolean;
  readonly contentHashChanged: boolean;
  readonly sourceComparison: "verified" | "unavailable_legacy";
  readonly sourceChanged: boolean | null;
  readonly componentChanges: readonly PromptOrderedChange[] | null;
  readonly sourceChanges: {
    readonly modeChanged: boolean;
    readonly components: readonly PromptOrderedChange[];
    readonly bindings: readonly PromptNamedChange[];
    readonly blocks: readonly PromptNamedChange[];
  } | null;
}

/** Compare actual selected version data, including source that does not affect rendered text. */
export function diffPromptDetails(left: InstructionDetailDTO, right: InstructionDetailDTO): PromptDiffResult {
  const a = validated(() => parsePromptDefinitionDetail(left));
  const b = validated(() => parsePromptDefinitionDetail(right));
  const av = a.selectedVersion, bv = b.selectedVersion;
  const metadataChanges: Record<string, PromptValueChange> = {};
  const metadata = (detail: InstructionDetailDTO) => ({
    definition: detail.definition, versionId: detail.selectedVersion?.id ?? null,
    parentVersionIds: detail.selectedVersion?.parentVersionIds ?? null,
    status: detail.selectedVersion?.status ?? null, createdAt: detail.selectedVersion?.createdAt ?? null,
    authoring: detail.selectedVersion?.authoring ?? null, readOnlyReason: detail.selectedVersion?.readOnlyReason ?? null
  });
  const am = metadata(a), bm = metadata(b);
  for (const key of Object.keys(am) as (keyof typeof am)[]) {
    if (!same(am[key], bm[key])) metadataChanges[key] = { before: am[key], after: bm[key] };
  }
  const compiledTextChanged = (av?.compiledText ?? null) !== (bv?.compiledText ?? null);
  const contentHashChanged = (av?.contentHash ?? null) !== (bv?.contentHash ?? null);
  const verified = Boolean(av?.version && bv?.version);
  const componentChanges = verified ? orderedChanges(av!.version!.components, bv!.version!.components) : null;
  const as = av?.version?.compositionSnapshot, bs = bv?.version?.compositionSnapshot;
  const sourceChanges = verified ? {
    modeChanged: Boolean(as) !== Boolean(bs),
    components: orderedChanges(as?.components ?? av!.version!.components, bs?.components ?? bv!.version!.components),
    bindings: namedChanges(as?.bindings ?? {}, bs?.bindings ?? {}),
    blocks: namedChanges(as?.blocks ?? {}, bs?.blocks ?? {})
  } : null;
  const sourceChanged = sourceChanges === null ? null : sourceChanges.modeChanged || sourceChanges.components.length > 0
    || sourceChanges.bindings.length > 0 || sourceChanges.blocks.length > 0;
  return {
    left: { definitionId: a.definition.id, versionId: av?.id ?? null },
    right: { definitionId: b.definition.id, versionId: bv?.id ?? null },
    hasDifferences: Object.keys(metadataChanges).length > 0 || compiledTextChanged || contentHashChanged
      || Boolean(componentChanges?.length) || sourceChanged === true,
    metadataChanges, compiledTextChanged, contentHashChanged,
    sourceComparison: verified ? "verified" : "unavailable_legacy", sourceChanged, componentChanges, sourceChanges
  };
}

function orderedChanges(left: readonly { readonly id: string }[], right: readonly { readonly id: string }[]): PromptOrderedChange[] {
  const a = new Map(left.map((value, index) => [value.id, { value, index }]));
  const b = new Map(right.map((value, index) => [value.id, { value, index }]));
  return [...new Set([...a.keys(), ...b.keys()])].flatMap(id => {
    const before = a.get(id), after = b.get(id);
    return before?.index === after?.index && same(before?.value ?? null, after?.value ?? null) ? [] : [{
      id, beforeIndex: before?.index ?? null, afterIndex: after?.index ?? null,
      before: before?.value ?? null, after: after?.value ?? null
    }];
  });
}

function namedChanges(left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>): PromptNamedChange[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().flatMap(name => {
    const before = Object.hasOwn(left, name) ? left[name] : null;
    const after = Object.hasOwn(right, name) ? right[name] : null;
    return same(before, after) ? [] : [{ name, before, after }];
  });
}

function same(left: unknown, right: unknown): boolean { return stableStringify(left) === stableStringify(right); }

async function readJson(path: string, maximum: number): Promise<unknown> {
  const bytes = await readBytes(path, maximum);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new PromptFileError("prompt_file_json_invalid"); }
}

async function readBytes(path: string, maximum: number): Promise<Buffer> {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new PromptFileError("prompt_file_read_failed");
      if (info.size > maximum) throw new PromptFileError("prompt_file_too_large");
      const chunks: Buffer[] = [];
      let size = 0;
      while (true) {
        const chunk = Buffer.alloc(Math.min(64 * 1024, maximum + 1 - size));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
        if (bytesRead === 0) break;
        size += bytesRead;
        if (size > maximum) throw new PromptFileError("prompt_file_too_large");
        chunks.push(chunk.subarray(0, bytesRead));
      }
      return Buffer.concat(chunks, size);
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof PromptFileError) throw error;
    throw new PromptFileError("prompt_file_read_failed");
  }
}

function identity(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 128 || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value) || ["__proto__", "prototype", "constructor"].includes(value)) invalid();
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid();
    } else if (unit >= 0xdc00 && unit <= 0xdfff) invalid();
  }
  return value;
}

function definitionPathIdentity(value: unknown): string {
  const id = identity(value);
  if (id === "." || id === "..") invalid();
  return id;
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid();
  return value as Record<string, unknown>;
}
function errorCode(error: unknown): unknown { return error && typeof error === "object" && "code" in error ? error.code : undefined; }
function invalid(): never { throw new PromptFileError("prompt_file_invalid"); }
function validated<T>(operation: () => T): T {
  try { return operation(); }
  catch (error) { if (error instanceof PromptFileError) throw error; return invalid(); }
}

import type {
  PromptComponent, PromptComponentSource, PromptComposition, PromptCompositionSnapshot, PromptVersion
} from "./types";
import { stableHash, stableStringify } from "./hash";
import { compilePromptVersion } from "./prompt";
import {
  freezePromptValue, inspectPromptVersion, promptArray, promptField, promptIdentity, promptRecord
} from "./prompt-composition";

const STORAGE_SCHEMA = "prompt-version-storage-v1";
const own = (value: object, key: PropertyKey) => Object.hasOwn(value, key);
const encoder = new TextEncoder();

function assertStorageStrings(value: unknown): void {
  const pending: unknown[] = [value];
  let nodes = 0, bytes = 0;
  const check = (text: string) => {
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code === 0) throw new TypeError("prompt_storage:unpersistable_unicode");
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(++index);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError("prompt_storage:unpersistable_unicode");
      } else if (code >= 0xdc00 && code <= 0xdfff) throw new TypeError("prompt_storage:unpersistable_unicode");
    }
    bytes += encoder.encode(text).length;
    if (bytes > 4 * 1_048_576) throw new RangeError("prompt_storage:string_byte_budget");
  };
  while (pending.length) {
    if (++nodes > 250_000) throw new RangeError("prompt_storage:node_budget");
    const current = pending.pop();
    if (typeof current === "string") check(current);
    else if (current && typeof current === "object") {
      for (const [key, child] of Object.entries(current)) { check(key); pending.push(child); }
    }
  }
}

export interface PromptDraftInput {
  readonly versionId: string;
  readonly baseVersionId?: string;
  readonly components: readonly PromptComponentSource[];
  readonly composition?: PromptComposition;
}

export interface PromptAuthoringContext {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly definitionId: string;
}

export interface PromptDraftPreview {
  readonly version: PromptVersion;
  readonly requestFingerprint: string;
  readonly previewFingerprint: string;
}

export type PromptVersionSource =
  | { readonly mode: "literal"; readonly components: readonly PromptComponent[] }
  | { readonly mode: "composition"; readonly snapshot: PromptCompositionSnapshot };

export interface PromptVersionStorageEnvelope {
  readonly schemaVersion: "prompt-version-storage-v1";
  readonly materializedComponents: readonly PromptComponent[];
  readonly source: PromptVersionSource;
  readonly sourceFingerprint: string;
  readonly write: {
    readonly actorId: string;
    readonly requestFingerprint: string;
    readonly previewFingerprint: string;
  };
}

/** Database adapters translate their definition column to definitionId. */
export interface PromptVersionRow {
  readonly id: string;
  readonly definitionId: string;
  readonly compiledText: string;
  readonly components: unknown;
  readonly parentVersionIds: readonly string[];
  readonly contentHash: string;
  readonly status: string;
  readonly createdAt: Date | string;
}

export interface VersionSummary {
  readonly id: string;
  readonly status: string;
  readonly createdAt: string;
  readonly parentVersionIds: readonly string[];
  readonly contentHash: string;
  readonly authoring: "composition" | "literal" | "legacy";
}

export interface StoredVersionDTO extends VersionSummary {
  readonly compiledText: string;
  readonly version?: PromptVersion;
  readonly readOnlyReason?: string;
}

export interface InstructionDetailDTO {
  readonly definition: { readonly id: string; readonly stableKey: string; readonly targetId?: string };
  readonly versions: readonly VersionSummary[];
  readonly selectedVersion: StoredVersionDTO | null;
  readonly canWrite: boolean;
}

function contextFrom(value: PromptAuthoringContext): PromptAuthoringContext {
  const context = promptRecord(value, "authoring_context", ["workspaceId", "actorId", "definitionId"]);
  const owner = {
    workspaceId: promptIdentity(promptField(context, "workspaceId", "authoring_context"), "workspace_id"),
    actorId: promptIdentity(promptField(context, "actorId", "authoring_context"), "actor_id"),
    definitionId: promptIdentity(promptField(context, "definitionId", "authoring_context"), "definition_id")
  };
  assertStorageStrings(owner);
  return freezePromptValue(owner);
}

function fullFingerprint(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new TypeError(`${label}:sha256_required`);
  return value;
}

function sourceFromVersion(version: PromptVersion): PromptVersionSource {
  return version.compositionSnapshot
    ? { mode: "composition", snapshot: version.compositionSnapshot }
    : { mode: "literal", components: version.components };
}

function compileSource(source: PromptVersionSource, args: {
  id: string; definitionId: string; parentVersionIds?: readonly string[]; status?: PromptVersion["status"];
  baseVersion?: PromptVersion;
}): PromptVersion {
  return compilePromptVersion({
    ...args,
    components: source.mode === "literal" ? source.components : source.snapshot.components,
    ...(source.mode === "composition" ? { composition: {
      schemaVersion: source.snapshot.schemaVersion, bindings: source.snapshot.bindings, blocks: source.snapshot.blocks
    } } : {})
  });
}

function canonicalVersion(value: PromptVersion): PromptVersion {
  inspectPromptVersion(value);
  const restored = compileSource(sourceFromVersion(value), {
    id: value.id, definitionId: value.definitionId, parentVersionIds: value.parentVersionIds, status: value.status
  });
  assertStorageStrings(restored);
  if (stableStringify(restored) !== stableStringify(value)) throw new TypeError("prompt_version:noncanonical_source");
  return restored;
}

function draftFromVersion(version: PromptVersion): PromptDraftInput {
  if (version.parentVersionIds.length > 1) throw new TypeError("prompt_draft:single_base_required");
  return freezePromptValue({
    versionId: version.id,
    ...(version.parentVersionIds.length ? { baseVersionId: version.parentVersionIds[0] } : {}),
    components: version.compositionSnapshot?.components ?? version.components,
    ...(version.compositionSnapshot ? { composition: {
      schemaVersion: version.compositionSnapshot.schemaVersion,
      bindings: version.compositionSnapshot.bindings,
      blocks: version.compositionSnapshot.blocks
    } } : {})
  });
}

/** Reconstructs the persisted request intent for a context-bound immutable ID replay. */
export function promptDraftInputFromVersion(version: PromptVersion): PromptDraftInput {
  return draftFromVersion(canonicalVersion(version));
}

/** Validates and detaches source through the compiler, including unused bindings and libraries. */
export function validatePromptDraftInput(value: unknown): PromptDraftInput {
  const input = promptRecord(value, "prompt_draft", ["versionId", "baseVersionId", "components", "composition"]);
  const versionId = promptIdentity(promptField(input, "versionId", "prompt_draft"), "prompt_id");
  const baseVersionId = own(input, "baseVersionId") ? promptIdentity(input.baseVersionId, "base_version_id") : undefined;
  if (own(input, "composition") && input.composition === undefined) throw new TypeError("composition:plain_record_required");
  const version = compilePromptVersion({
    id: versionId, definitionId: "authoring-validation",
    components: promptField(input, "components", "prompt_draft") as readonly PromptComponentSource[],
    parentVersionIds: baseVersionId === undefined ? [] : [baseVersionId],
    ...(own(input, "composition") ? { composition: input.composition as PromptComposition } : {})
  });
  assertStorageStrings(version);
  return draftFromVersion(version);
}

function requestFingerprint(input: PromptDraftInput, context: PromptAuthoringContext): string {
  return stableHash({ schemaVersion: "prompt-draft-request-v1", context, input }, 64);
}

/** This path deliberately needs no base lookup, so immutable ID retries can be checked first. */
export function fingerprintPromptDraftRequest(input: unknown, context: PromptAuthoringContext): string {
  return requestFingerprint(validatePromptDraftInput(input), contextFrom(context));
}

function semanticValue(version: PromptVersion) {
  return {
    id: version.id, definitionId: version.definitionId,
    parentVersionIds: version.parentVersionIds, compiledText: version.compiledText,
    contentHash: version.contentHash, components: version.components, source: sourceFromVersion(version)
  };
}

/** Lifecycle transitions do not change the immutable base being reviewed. */
export function promptVersionSemanticFingerprint(version: PromptVersion): string {
  return stableHash(semanticValue(canonicalVersion(version)), 64);
}

export function preparePromptDraft(input: unknown, context: PromptAuthoringContext, base?: PromptVersion): PromptDraftPreview {
  const draft = validatePromptDraftInput(input), owner = contextFrom(context);
  if (draft.baseVersionId === undefined && base !== undefined) throw new TypeError("prompt_draft:unexpected_base");
  if (draft.baseVersionId !== undefined && base === undefined) throw new TypeError("prompt_draft:base_required");
  const canonicalBase = base === undefined ? undefined : canonicalVersion(base);
  if (canonicalBase && canonicalBase.id !== draft.baseVersionId) throw new TypeError("prompt_draft:base_identity_mismatch");
  const version = compilePromptVersion({
    id: draft.versionId, definitionId: owner.definitionId, components: draft.components,
    parentVersionIds: canonicalBase ? [canonicalBase.id] : [], status: "draft",
    ...(draft.composition ? { composition: draft.composition } : {}),
    ...(canonicalBase ? { baseVersion: canonicalBase } : {})
  });
  const fingerprint = requestFingerprint(draft, owner);
  return freezePromptValue({
    version, requestFingerprint: fingerprint,
    previewFingerprint: stableHash({
      schemaVersion: "prompt-draft-preview-v1", requestFingerprint: fingerprint,
      baseSemanticFingerprint: canonicalBase ? promptVersionSemanticFingerprint(canonicalBase) : null,
      version: semanticValue(version)
    }, 64)
  });
}

/** Encodes a trusted, freshly prepared preview; authorization remains the caller's responsibility. */
export function encodePromptVersionStorage(preview: PromptDraftPreview, context: PromptAuthoringContext): PromptVersionStorageEnvelope {
  const value = promptRecord(preview, "prompt_preview", ["version", "requestFingerprint", "previewFingerprint"]);
  const owner = contextFrom(context);
  const version = canonicalVersion(promptField(value, "version", "prompt_preview") as PromptVersion);
  if (version.definitionId !== owner.definitionId || version.status !== "draft") throw new TypeError("prompt_preview:invalid_draft_owner");
  const fingerprint = fullFingerprint(promptField(value, "requestFingerprint", "prompt_preview"), "request_fingerprint");
  const reviewed = fullFingerprint(promptField(value, "previewFingerprint", "prompt_preview"), "preview_fingerprint");
  if (fingerprint !== requestFingerprint(draftFromVersion(version), owner)) throw new TypeError("prompt_preview:request_mismatch");
  const source = sourceFromVersion(version);
  return freezePromptValue({
    schemaVersion: STORAGE_SCHEMA, materializedComponents: version.components, source,
    sourceFingerprint: stableHash(source, 64),
    write: { actorId: owner.actorId, requestFingerprint: fingerprint, previewFingerprint: reviewed }
  });
}

/** Row-independent validation. Row correspondence is additionally required before replay or use as a base. */
export function inspectPromptVersionStorage(value: unknown): PromptVersionStorageEnvelope {
  const envelope = promptRecord(value, "prompt_storage", ["schemaVersion", "materializedComponents", "source", "sourceFingerprint", "write"]);
  if (promptField(envelope, "schemaVersion", "prompt_storage") !== STORAGE_SCHEMA) throw new TypeError("prompt_storage:unsupported_schema_version");
  const rawSource = promptRecord(promptField(envelope, "source", "prompt_storage"), "prompt_source", ["mode", "components", "snapshot"]);
  const mode = promptField(rawSource, "mode", "prompt_source");
  let version: PromptVersion;
  if (mode === "literal") {
    promptRecord(rawSource, "prompt_source", ["mode", "components"]);
    version = compilePromptVersion({
      id: "storage-validation", definitionId: "storage-validation",
      components: promptField(rawSource, "components", "prompt_source") as readonly PromptComponentSource[]
    });
  } else if (mode === "composition") {
    promptRecord(rawSource, "prompt_source", ["mode", "snapshot"]);
    const snapshot = promptRecord(promptField(rawSource, "snapshot", "prompt_source"), "composition_snapshot", ["schemaVersion", "components", "bindings", "blocks", "sourceHash"]);
    version = compilePromptVersion({
      id: "storage-validation", definitionId: "storage-validation",
      components: promptField(snapshot, "components", "composition_snapshot") as readonly PromptComponentSource[],
      composition: {
        schemaVersion: promptField(snapshot, "schemaVersion", "composition_snapshot") as PromptComposition["schemaVersion"],
        bindings: promptField(snapshot, "bindings", "composition_snapshot") as PromptComposition["bindings"],
        blocks: promptField(snapshot, "blocks", "composition_snapshot") as PromptComposition["blocks"]
      }
    });
    if (promptField(snapshot, "sourceHash", "composition_snapshot") !== version.compositionSnapshot!.sourceHash
      || stableStringify(snapshot) !== stableStringify(version.compositionSnapshot)) throw new TypeError("prompt_storage:composition_snapshot_mismatch");
  } else throw new TypeError("prompt_source:unknown_mode");
  assertStorageStrings(version);
  const materialized = promptField(envelope, "materializedComponents", "prompt_storage");
  inspectPromptVersion({ ...version, components: materialized as readonly PromptComponent[] });
  if (stableStringify(materialized) !== stableStringify(version.components)) throw new TypeError("prompt_storage:materialized_components_mismatch");
  const source = sourceFromVersion(version);
  const sourceFingerprint = fullFingerprint(promptField(envelope, "sourceFingerprint", "prompt_storage"), "source_fingerprint");
  if (sourceFingerprint !== stableHash(source, 64)) throw new TypeError("prompt_storage:source_fingerprint_mismatch");
  const write = promptRecord(promptField(envelope, "write", "prompt_storage"), "prompt_write", ["actorId", "requestFingerprint", "previewFingerprint"]);
  const storage: PromptVersionStorageEnvelope = {
    schemaVersion: STORAGE_SCHEMA, materializedComponents: version.components, source, sourceFingerprint,
    write: {
      actorId: promptIdentity(promptField(write, "actorId", "prompt_write"), "actor_id"),
      requestFingerprint: fullFingerprint(promptField(write, "requestFingerprint", "prompt_write"), "request_fingerprint"),
      previewFingerprint: fullFingerprint(promptField(write, "previewFingerprint", "prompt_write"), "preview_fingerprint")
    }
  };
  assertStorageStrings(storage);
  return freezePromptValue(storage);
}

function isAuthoredStorage(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const schema = Object.getOwnPropertyDescriptor(value, "schemaVersion");
  return Boolean(schema && (!own(schema, "value") || (typeof schema.value === "string" && schema.value.startsWith("prompt-version-storage"))))
    || ["materializedComponents", "sourceFingerprint", "write"].some(key => own(value, key));
}

function isoTimestamp(value: Date | string): string {
  const time = value instanceof Date ? Date.prototype.getTime.call(value)
    : typeof value === "string" && value.length <= 64 ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) throw new TypeError("prompt_version_row:invalid_timestamp");
  return new Date(time).toISOString();
}

export function decodePromptVersionRow(row: PromptVersionRow): StoredVersionDTO {
  const value = promptRecord(row, "prompt_version_row", ["id", "definitionId", "compiledText", "components", "parentVersionIds", "contentHash", "status", "createdAt"]);
  const id = promptIdentity(promptField(value, "id", "prompt_version_row"), "prompt_id");
  const definitionId = promptIdentity(promptField(value, "definitionId", "prompt_version_row"), "definition_id");
  const parentVersionIds = promptArray(promptField(value, "parentVersionIds", "prompt_version_row"), "parents").map(parent => promptIdentity(parent, "parent_id"));
  const compiledText = promptField(value, "compiledText", "prompt_version_row");
  const contentHash = promptField(value, "contentHash", "prompt_version_row"), status = promptField(value, "status", "prompt_version_row");
  if (typeof compiledText !== "string" || typeof contentHash !== "string" || typeof status !== "string") throw new TypeError("prompt_version_row:string_required");
  const summary = { id, status, createdAt: isoTimestamp(promptField(value, "createdAt", "prompt_version_row") as Date | string), parentVersionIds, contentHash };
  const payload = promptField(value, "components", "prompt_version_row");
  if (!isAuthoredStorage(payload)) return freezePromptValue({ ...summary, compiledText, authoring: "legacy", readOnlyReason: "legacy_prompt_version" });
  try {
    if (parentVersionIds.length > 1) throw new TypeError("prompt_storage:single_base_required");
    const storage = inspectPromptVersionStorage(payload);
    const version = compileSource(storage.source, { id, definitionId, parentVersionIds, status: status as PromptVersion["status"] });
    assertStorageStrings(version);
    if (version.compiledText !== compiledText || version.contentHash !== contentHash
      || stableStringify(version.components) !== stableStringify(storage.materializedComponents)) throw new TypeError("prompt_storage:row_mismatch");
    return freezePromptValue({ ...summary, compiledText, authoring: storage.source.mode, version });
  } catch {
    return freezePromptValue({ ...summary, compiledText, authoring: "legacy", readOnlyReason: "invalid_authored_version" });
  }
}

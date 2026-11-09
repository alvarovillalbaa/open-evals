import { stableHash, stableStringify, textHash } from "./hash";
import { parseProvidedOutputDatasetSnapshot } from "./provided-output-runs";
import type { JsonValue } from "./types";
import type { ProvidedOutputDatasetRow, ProvidedOutputDatasetSnapshot } from "./provided-output-types";
import type {
  CustomDatasetDraft, CustomDatasetFormat, CustomDatasetHead, CustomDatasetIntent,
  CustomDatasetManifest, CustomDatasetPreview, CustomDatasetReviewStatus, CustomDatasetSaveRequest,
  CustomDatasetStorageIds, CustomDatasetVersionContent, CustomDatasetVersionRecord,
  PrepareCustomDatasetVersionRecordInput, ResolveCustomDatasetPreviewInput, RestoreCustomDatasetVersionRecordInput
} from "./custom-dataset-types";
export type * from "./custom-dataset-types";

export const CUSTOM_DATASET_LIMITS = Object.freeze({
  rows: 100, sourceBytes: 2_097_152, requestBytes: 2_097_152, snapshotBytes: 1_048_576,
  recordBytes: 8_388_608, manifestBytes: 131_072, identifierBytes: 512, nameBytes: 4096,
  rowKeyBytes: 4096, jsonDepth: 32, jsonNodes: 150_000, envelopeDepth: 40, envelopeNodes: 500_000
});

interface SourceLocation { rowIndex?: number; line?: number; column?: number }
export class CustomDatasetError extends Error {
  readonly code: string;
  readonly status: 422 | 409;
  readonly rowIndex?: number;
  readonly line?: number;
  readonly column?: number;
  constructor(code = "custom_dataset_invalid", status: 422 | 409 = 422, location: SourceLocation = {}) {
    super(code);
    this.name = "CustomDatasetError";
    this.code = code;
    this.status = status;
    this.rowIndex = location.rowIndex;
    this.line = location.line;
    this.column = location.column;
  }
}

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
const KIND = "custom-dataset-v1" as const;
const INTERNAL_TIMESTAMP = "2000-01-01T00:00:00.000Z";
const encoder = new TextEncoder();
const byteLength = (value: string) => encoder.encode(value).byteLength;
const hash = (value: unknown) => stableHash(value, 64);
const same = (left: unknown, right: unknown) => stableStringify(left) === stableStringify(right);
const invalid = (code = "custom_dataset_invalid", location?: SourceLocation): never => { throw new CustomDatasetError(code, 422, location); };
const conflict = (code = "custom_dataset_storage_conflict"): never => { throw new CustomDatasetError(code, 409); };

function validUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit === 0 || unit >= 0xdc00 && unit <= 0xdfff) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    }
  }
  return true;
}

function text(value: unknown, maximum = CUSTOM_DATASET_LIMITS.identifierBytes, nonblank = true): string {
  return typeof value === "string" && validUnicode(value) && byteLength(value) <= maximum && (!nonblank || value.trim().length > 0)
    ? value : invalid();
}
function uuid(value: unknown): string { return typeof value === "string" && UUID.test(value) ? value : invalid(); }
function digest(value: unknown): string { return typeof value === "string" && HEX.test(value) ? value : invalid(); }
function versionNumber(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 2_147_483_647 ? value : invalid();
}
function reviewStatus(value: unknown): CustomDatasetReviewStatus {
  return value === "synthetic" || value === "reviewed" || value === "golden" ? value : invalid();
}
function sourceFormat(value: unknown): CustomDatasetFormat { return value === "json" || value === "jsonl" ? value : invalid(); }
function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const result = value as Record<string, unknown>;
  if (keys && (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key)))) return invalid();
  return result;
}
function timestamp(value: unknown): string {
  const result = text(value, 24);
  if (result.length !== 24 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result)
    || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) return invalid();
  return result;
}

/** Inspect data descriptors before hashing; caller getters, toJSON and sparse/exotic containers are refused. */
function copyJson(value: unknown): JsonValue {
  const ancestors = new Set<object>();
  let nodes = 0, strings = 0;
  function copy(item: unknown, depth: number): JsonValue {
    if (++nodes > CUSTOM_DATASET_LIMITS.envelopeNodes || depth > CUSTOM_DATASET_LIMITS.envelopeDepth) return invalid();
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") return Number.isFinite(item) ? (item === 0 ? 0 : item) : invalid();
    if (typeof item === "string") {
      if (!validUnicode(item) || (strings += byteLength(item)) > 16_777_216) return invalid();
      return item;
    }
    if (!item || typeof item !== "object" || ancestors.has(item)) return invalid();
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return invalid();
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const keys = Reflect.ownKeys(descriptors).filter(key => !(array && key === "length"));
    if (keys.length > 100_000 || keys.some(key => typeof key !== "string")
      || array && (descriptors.length?.value !== keys.length || keys.some((key, index) => key !== String(index)))) return invalid();
    const result: JsonValue[] | Record<string, JsonValue> = array ? [] : Object.create(null);
    ancestors.add(item);
    try {
      for (const key of keys) {
        const descriptor = descriptors[key as string];
        if (!descriptor?.enumerable || !("value" in descriptor) || !validUnicode(key as string)) return invalid();
        Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
      }
    } finally { ancestors.delete(item); }
    return result;
  }
  try {
    const result = copy(value, 0);
    if (byteLength(stableStringify(result)) > CUSTOM_DATASET_LIMITS.recordBytes) return invalid();
    return result;
  } catch (error) {
    if (error instanceof CustomDatasetError) throw error;
    return invalid();
  }
}

interface Decimal { negative: boolean; coefficient: string; exponent: bigint }
function decimal(token: string): Decimal {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match) return invalid("custom_dataset_source_invalid");
  let coefficient = `${match[2]}${match[3] ?? ""}`.replace(/^0+/, "");
  // Zero needs no exponent allocation, including a long exponent supplied in the source.
  if (!coefficient) return { negative: false, coefficient: "0", exponent: 0n };
  const trailing = coefficient.length - coefficient.replace(/0+$/, "").length;
  coefficient = coefficient.slice(0, coefficient.length - trailing);
  const signedExponent = match[4] ?? "0";
  const exponentDigits = signedExponent.replace(/^[+-]/, "").replace(/^0+/, "") || "0";
  // A <=2 MiB nonzero mantissa cannot offset an exponent with >8 significant digits.
  if (exponentDigits.length > 8) return invalid("custom_dataset_source_precision");
  const exponent = BigInt(`${signedExponent.startsWith("-") ? "-" : ""}${exponentDigits}`)
    - BigInt(match[3]?.length ?? 0) + BigInt(trailing);
  return { negative: match[1] === "-", coefficient, exponent };
}

class StrictJsonParser {
  private readonly source: string;
  private readonly budget: { nodes: number };
  private readonly baseLine: number;
  private at = 0;
  private locationAt = 0;
  private locationLine: number;
  private locationStart = 0;
  private rowIndex?: number;
  readonly rows: SourceLocation[] = [];
  constructor(source: string, budget: { nodes: number }, baseLine = 1, rowIndex?: number) {
    this.source = source;
    this.budget = budget;
    this.baseLine = baseLine;
    this.locationLine = baseLine;
    this.rowIndex = rowIndex;
  }
  private location(at = this.at): SourceLocation {
    const forward = at >= this.locationAt;
    let line = forward ? this.locationLine : this.baseLine, start = forward ? this.locationStart : 0;
    for (let index = forward ? this.locationAt : 0; index < at; index++) if (this.source[index] === "\n") { line++; start = index + 1; }
    if (forward) { this.locationAt = at; this.locationLine = line; this.locationStart = start; }
    return { ...(this.rowIndex === undefined ? {} : { rowIndex: this.rowIndex }), line, column: at - start + 1 };
  }
  private fail(code = "custom_dataset_source_invalid", at = this.at): never { return invalid(code, this.location(at)); }
  private whitespace() { while (/[\x20\t\r\n]/.test(this.source[this.at] ?? "") && this.at < this.source.length) this.at++; }
  private string(): string {
    const start = this.at++;
    for (;;) {
      const character = this.source[this.at++];
      if (character === undefined) return this.fail();
      if (character === "\\") { if (this.at >= this.source.length) return this.fail(); this.at++; }
      else if (character === '"') break;
    }
    let value: unknown;
    try { value = JSON.parse(this.source.slice(start, this.at)); }
    catch { return this.fail("custom_dataset_source_invalid", start); }
    if (typeof value !== "string" || !validUnicode(value)) return this.fail("custom_dataset_source_invalid", start);
    return value;
  }
  private number(): number {
    const start = this.at;
    if (this.source[this.at] === "-") this.at++;
    if (this.source[this.at] === "0") this.at++;
    else {
      if (!/[1-9]/.test(this.source[this.at] ?? "")) return this.fail();
      while (/[0-9]/.test(this.source[this.at] ?? "")) this.at++;
    }
    if (this.source[this.at] === ".") {
      this.at++;
      if (!/[0-9]/.test(this.source[this.at] ?? "")) return this.fail();
      while (/[0-9]/.test(this.source[this.at] ?? "")) this.at++;
    }
    if (this.source[this.at] === "e" || this.source[this.at] === "E") {
      this.at++;
      if (this.source[this.at] === "+" || this.source[this.at] === "-") this.at++;
      if (!/[0-9]/.test(this.source[this.at] ?? "")) return this.fail();
      while (/[0-9]/.test(this.source[this.at] ?? "")) this.at++;
    }
    const token = this.source.slice(start, this.at), value = Number(token);
    const coefficient = token.split(/[eE]/, 1)[0]!.replace(/[-.0]/g, "");
    if (!Number.isFinite(value) || value === 0 && coefficient.length > 0) return this.fail("custom_dataset_source_precision", start);
    let original: Decimal, serialized: Decimal;
    try { original = decimal(token); serialized = decimal(JSON.stringify(value)); }
    catch { return this.fail("custom_dataset_source_precision", start); }
    if (original.negative !== serialized.negative || original.coefficient !== serialized.coefficient || original.exponent !== serialized.exponent) {
      return this.fail("custom_dataset_source_precision", start);
    }
    return value === 0 ? 0 : value;
  }
  private value(depth: number): JsonValue {
    this.whitespace();
    if (++this.budget.nodes > CUSTOM_DATASET_LIMITS.jsonNodes || depth > CUSTOM_DATASET_LIMITS.jsonDepth) return this.fail("custom_dataset_source_limit");
    const character = this.source[this.at];
    if (character === '"') return this.string();
    if (character === "-" || character && /[0-9]/.test(character)) return this.number();
    for (const [literal, value] of [["true", true], ["false", false], ["null", null]] as const) {
      if (this.source.startsWith(literal, this.at)) { this.at += literal.length; return value; }
    }
    if (character === "[") {
      this.at++;
      const result: JsonValue[] = [];
      this.whitespace();
      if (this.source[this.at] === "]") { this.at++; return result; }
      for (;;) {
        this.whitespace();
        if (depth === 0 && this.baseLine === 1 && (this.rowIndex === undefined || this.rows.length > 0)
          && result.length >= CUSTOM_DATASET_LIMITS.rows) {
          this.rowIndex = result.length;
          return this.fail("custom_dataset_row_count");
        }
        if (depth === 0 && this.rowIndex === undefined) {
          this.rowIndex = result.length;
          this.rows.push(this.location());
        } else if (depth === 0 && this.baseLine === 1 && this.rows.length > 0) {
          this.rowIndex = result.length;
          this.rows.push(this.location());
        }
        result.push(this.value(depth + 1));
        this.whitespace();
        if (this.source[this.at] === "]") { this.at++; return result; }
        if (this.source[this.at++] !== ",") return this.fail();
      }
    }
    if (character === "{") {
      this.at++;
      const result: Record<string, JsonValue> = Object.create(null);
      this.whitespace();
      if (this.source[this.at] === "}") { this.at++; return result; }
      for (;;) {
        this.whitespace();
        const keyAt = this.at;
        if (this.source[this.at] !== '"') return this.fail();
        const key = this.string();
        if (Object.hasOwn(result, key)) return this.fail("custom_dataset_source_duplicate_key", keyAt);
        this.whitespace();
        if (this.source[this.at++] !== ":") return this.fail();
        Object.defineProperty(result, key, { value: this.value(depth + 1), enumerable: true, writable: true, configurable: true });
        this.whitespace();
        if (this.source[this.at] === "}") { this.at++; return result; }
        if (this.source[this.at++] !== ",") return this.fail();
      }
    }
    return this.fail();
  }
  parse(): JsonValue {
    const value = this.value(0);
    this.whitespace();
    if (this.at !== this.source.length) return this.fail();
    return value;
  }
}

export function prepareCustomDatasetDraft(value: unknown): CustomDatasetDraft {
  const source = object(copyJson(value), ["schemaVersion", "datasetId", "versionId", "version", "expectedVersionId", "name", "format", "defaultReviewStatus", "sourceText"]);
  if (source.schemaVersion !== "custom-dataset-draft-v1") return invalid();
  const version = versionNumber(source.version), expectedVersionId = source.expectedVersionId === null ? null : uuid(source.expectedVersionId);
  const versionId = uuid(source.versionId);
  if (version === 1 ? expectedVersionId !== null : expectedVersionId === null || expectedVersionId === versionId) return invalid();
  const result: CustomDatasetDraft = {
    schemaVersion: "custom-dataset-draft-v1", datasetId: uuid(source.datasetId), versionId, version, expectedVersionId,
    name: text(source.name, CUSTOM_DATASET_LIMITS.nameBytes), format: sourceFormat(source.format),
    defaultReviewStatus: source.defaultReviewStatus === null ? null : reviewStatus(source.defaultReviewStatus),
    sourceText: text(source.sourceText, CUSTOM_DATASET_LIMITS.sourceBytes)
  };
  if (byteLength(stableStringify(result)) > CUSTOM_DATASET_LIMITS.requestBytes) return invalid("custom_dataset_request_too_large");
  return result;
}

export function prepareCustomDatasetSaveRequest(value: unknown): CustomDatasetSaveRequest {
  const source = object(copyJson(value), ["schemaVersion", "draft", "expectedPreviewFingerprint"]);
  if (source.schemaVersion !== "custom-dataset-save-v1") return invalid();
  const result: CustomDatasetSaveRequest = { schemaVersion: "custom-dataset-save-v1", draft: prepareCustomDatasetDraft(source.draft), expectedPreviewFingerprint: digest(source.expectedPreviewFingerprint) };
  if (byteLength(stableStringify(result)) > CUSTOM_DATASET_LIMITS.requestBytes) return invalid("custom_dataset_request_too_large");
  return result;
}

export function customDatasetStorageIds(workspaceId: string, publicDatasetId: string, publicVersionId: string): CustomDatasetStorageIds {
  const scope = text(workspaceId), datasetId = uuid(publicDatasetId), versionId = uuid(publicVersionId);
  const identity = hash({ workspaceId: scope, datasetId, versionId });
  return { datasetId: `custom_dataset_${hash({ workspaceId: scope, datasetId })}`,
    versionId: `custom_dataset_version_${identity}`, auditId: `audit_custom_dataset_version_${identity}` };
}
export function customDatasetRowId(workspaceId: string, publicDatasetId: string, publicVersionId: string, rowKey: string): string {
  return `custom_dataset_row_${hash({ workspaceId: text(workspaceId), datasetId: uuid(publicDatasetId), versionId: uuid(publicVersionId), rowKey: text(rowKey, CUSTOM_DATASET_LIMITS.rowKeyBytes) })}`;
}

function compareUtf8(left: string, right: string): number {
  const a = encoder.encode(left), b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
  return a.length - b.length;
}

function parsedRows(workspaceId: string, draft: CustomDatasetDraft): ProvidedOutputDatasetRow[] {
  const budget = { nodes: 0 };
  let values: JsonValue[], locations: SourceLocation[];
  if (draft.format === "json") {
    const parser = new StrictJsonParser(draft.sourceText, budget), parsed = parser.parse();
    if (!Array.isArray(parsed)) return invalid("custom_dataset_source_rows_required", { line: 1, column: 1 });
    values = parsed; locations = parser.rows;
  } else {
    const source = draft.sourceText.endsWith("\n") ? draft.sourceText.slice(0, -1) : draft.sourceText;
    let lineCount = 1;
    for (const character of source) if (character === "\n" && ++lineCount > CUSTOM_DATASET_LIMITS.rows) {
      return invalid("custom_dataset_row_count", { rowIndex: 100, line: 101, column: 1 });
    }
    const lines = source.split("\n");
    values = []; locations = [];
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) return invalid("custom_dataset_source_invalid", { rowIndex: index, line: index + 1, column: 1 });
      values.push(new StrictJsonParser(line, budget, index + 1, index).parse());
      locations.push({ rowIndex: index, line: index + 1, column: 1 });
    }
  }
  if (!values.length || values.length > CUSTOM_DATASET_LIMITS.rows) return invalid("custom_dataset_row_count");
  const seen = new Set<string>();
  return values.map((value, index) => {
    const location = { ...locations[index], rowIndex: index };
    try {
      const row = object(value), allowed = ["rowKey", "input", "expectedOutput", "context", "history", "traceFixture", "metadata", "reviewStatus"];
      if (!Object.hasOwn(row, "rowKey") || !Object.hasOwn(row, "input") || Object.keys(row).some(key => !allowed.includes(key))) return invalid("custom_dataset_row_invalid", location);
      const rowKey = text(row.rowKey, CUSTOM_DATASET_LIMITS.rowKeyBytes);
      if (seen.has(rowKey)) return invalid("custom_dataset_row_key_duplicate", location);
      seen.add(rowKey);
      const status = Object.hasOwn(row, "reviewStatus") ? reviewStatus(row.reviewStatus) : draft.defaultReviewStatus;
      if (status === null) return invalid("custom_dataset_review_status_required", location);
      const field = (key: string) => ({ present: Object.hasOwn(row, key), value: Object.hasOwn(row, key) ? row[key] as JsonValue : null });
      return { id: customDatasetRowId(workspaceId, draft.datasetId, draft.versionId, rowKey), rowKey, input: row.input as JsonValue,
        expectedOutput: field("expectedOutput"), context: field("context"), history: field("history"), traceFixture: field("traceFixture"),
        metadata: Object.hasOwn(row, "metadata") ? object(row.metadata) as Record<string, JsonValue> : Object.create(null), reviewStatus: status };
    } catch (error) {
      if (error instanceof CustomDatasetError && error.rowIndex !== undefined) throw error;
      return invalid(error instanceof CustomDatasetError ? error.code : "custom_dataset_row_invalid", location);
    }
  }).sort((left, right) => compareUtf8(left.rowKey, right.rowKey) || compareUtf8(left.id, right.id));
}

type ContentIdentity = Pick<CustomDatasetDraft, "datasetId" | "versionId" | "version" | "expectedVersionId" | "name">;

function savedSnapshot(content: CustomDatasetVersionContent, createdAt: string): ProvidedOutputDatasetSnapshot {
  try {
    return parseProvidedOutputDatasetSnapshot({
      dataset: { id: content.dataset.id, name: content.dataset.name, kind: KIND },
      version: { id: content.version.id, datasetId: content.dataset.id, version: content.version.version,
        fingerprint: content.fingerprint, createdAt: timestamp(createdAt) }, rows: content.rows
    });
  } catch { return invalid("custom_dataset_snapshot_invalid"); }
}

function contentFromRows(workspaceId: string, identity: ContentIdentity, rows: ProvidedOutputDatasetRow[]): CustomDatasetVersionContent {
  const ids = customDatasetStorageIds(workspaceId, identity.datasetId, identity.versionId);
  const previousVersionId = identity.expectedVersionId === null ? null : customDatasetStorageIds(workspaceId, identity.datasetId, identity.expectedVersionId).versionId;
  const base: Omit<CustomDatasetVersionContent, "fingerprint"> = {
    schemaVersion: "custom-dataset-version-v1", workspaceId,
    dataset: { id: ids.datasetId, publicId: identity.datasetId, name: identity.name, kind: KIND },
    version: { id: ids.versionId, publicId: identity.versionId, version: identity.version, previousVersionId,
      previousPublicVersionId: identity.expectedVersionId }, rows
  };
  const content = { ...base, fingerprint: hash(base) };
  // The actual consumer validates the complete snapshot, including all wrapper overhead and aggregate nodes/depth.
  const snapshot = savedSnapshot(content, INTERNAL_TIMESTAMP);
  if (!same(snapshot.rows, rows) || rows.some(row => row.id !== customDatasetRowId(workspaceId, identity.datasetId, identity.versionId, row.rowKey))) return invalid();
  return content;
}

function parseContent(value: unknown): CustomDatasetVersionContent {
  const source = object(value, ["schemaVersion", "workspaceId", "dataset", "version", "rows", "fingerprint"]);
  const dataset = object(source.dataset, ["id", "publicId", "name", "kind"]);
  const version = object(source.version, ["id", "publicId", "version", "previousVersionId", "previousPublicVersionId"]);
  if (source.schemaVersion !== "custom-dataset-version-v1" || dataset.kind !== KIND || !Array.isArray(source.rows)) return invalid();
  const identity: ContentIdentity = { datasetId: uuid(dataset.publicId), versionId: uuid(version.publicId),
    version: versionNumber(version.version), expectedVersionId: version.previousPublicVersionId === null ? null : uuid(version.previousPublicVersionId),
    name: text(dataset.name, CUSTOM_DATASET_LIMITS.nameBytes) };
  if (identity.version === 1 ? identity.expectedVersionId !== null : identity.expectedVersionId === null || identity.expectedVersionId === identity.versionId) return invalid();
  const content = contentFromRows(text(source.workspaceId), identity, source.rows as ProvidedOutputDatasetRow[]);
  if (!same(content, source)) return invalid();
  return content;
}

function parseHead(value: unknown, workspaceId: string, publicDatasetId: string): CustomDatasetHead | null {
  if (value === null) return null;
  const source = object(value, ["datasetId", "publicDatasetId", "name", "kind", "versionId", "publicVersionId", "version", "contentFingerprint"]);
  const datasetId = uuid(source.publicDatasetId), publicVersionId = uuid(source.publicVersionId);
  const ids = customDatasetStorageIds(workspaceId, datasetId, publicVersionId);
  if (datasetId !== publicDatasetId || source.datasetId !== ids.datasetId || source.versionId !== ids.versionId || source.kind !== KIND) return invalid();
  return { datasetId: ids.datasetId, publicDatasetId: datasetId, name: text(source.name, CUSTOM_DATASET_LIMITS.nameBytes), kind: KIND,
    versionId: ids.versionId, publicVersionId, version: versionNumber(source.version), contentFingerprint: digest(source.contentFingerprint) };
}

function intentFromDraft(workspaceId: string, draft: CustomDatasetDraft, contentFingerprint: string): CustomDatasetIntent {
  const base: Omit<CustomDatasetIntent, "fingerprint"> = {
    schemaVersion: "custom-dataset-intent-v1", workspaceId, datasetId: draft.datasetId, versionId: draft.versionId,
    version: draft.version, expectedVersionId: draft.expectedVersionId, name: draft.name, format: draft.format,
    defaultReviewStatus: draft.defaultReviewStatus, sourceDigest: textHash(draft.sourceText, 64), contentFingerprint
  };
  return { ...base, fingerprint: hash(base) };
}

function parseIntent(value: unknown): CustomDatasetIntent {
  const source = object(value, ["schemaVersion", "workspaceId", "datasetId", "versionId", "version", "expectedVersionId", "name", "format", "defaultReviewStatus", "sourceDigest", "contentFingerprint", "fingerprint"]);
  if (source.schemaVersion !== "custom-dataset-intent-v1") return invalid();
  const base: Omit<CustomDatasetIntent, "fingerprint"> = {
    schemaVersion: "custom-dataset-intent-v1", workspaceId: text(source.workspaceId), datasetId: uuid(source.datasetId), versionId: uuid(source.versionId),
    version: versionNumber(source.version), expectedVersionId: source.expectedVersionId === null ? null : uuid(source.expectedVersionId),
    name: text(source.name, CUSTOM_DATASET_LIMITS.nameBytes), format: sourceFormat(source.format),
    defaultReviewStatus: source.defaultReviewStatus === null ? null : reviewStatus(source.defaultReviewStatus),
    sourceDigest: digest(source.sourceDigest), contentFingerprint: digest(source.contentFingerprint)
  };
  if (base.version === 1 ? base.expectedVersionId !== null : base.expectedVersionId === null || base.expectedVersionId === base.versionId) return invalid();
  const intent = { ...base, fingerprint: hash(base) };
  if (!same(intent, source)) return invalid();
  return intent;
}

function previewFromContent(content: CustomDatasetVersionContent, intent: CustomDatasetIntent, head: CustomDatasetHead | null): CustomDatasetPreview {
  if (intent.workspaceId !== content.workspaceId || intent.datasetId !== content.dataset.publicId || intent.versionId !== content.version.publicId
    || intent.version !== content.version.version || intent.expectedVersionId !== content.version.previousPublicVersionId
    || intent.name !== content.dataset.name || intent.contentFingerprint !== content.fingerprint) return invalid();
  if (head === null) {
    if (intent.version !== 1 || intent.expectedVersionId !== null) return conflict("custom_dataset_version_conflict");
  } else {
    if (head.name !== intent.name) return conflict("custom_dataset_name_immutable");
    if (head.datasetId !== content.dataset.id || head.publicDatasetId !== intent.datasetId || intent.expectedVersionId !== head.publicVersionId
      || intent.version !== head.version + 1 || head.versionId !== content.version.previousVersionId) return conflict("custom_dataset_version_conflict");
  }
  const base: Omit<CustomDatasetPreview, "fingerprint"> = {
    schemaVersion: "custom-dataset-preview-v1", workspaceId: content.workspaceId, intent, head, content,
    canonicalSnapshotBytes: byteLength(stableStringify(savedSnapshot(content, INTERNAL_TIMESTAMP))), createdAtByteAllowance: 24
  };
  return { ...base, fingerprint: hash(base) };
}

export function resolveCustomDatasetPreview(input: ResolveCustomDatasetPreviewInput): CustomDatasetPreview {
  const source = object(copyJson(input), ["workspaceId", "draft", "head"]), workspaceId = text(source.workspaceId);
  const draft = prepareCustomDatasetDraft(source.draft);
  const content = contentFromRows(workspaceId, draft, parsedRows(workspaceId, draft));
  const intent = intentFromDraft(workspaceId, draft, content.fingerprint);
  const preview = previewFromContent(content, intent, parseHead(source.head, workspaceId, draft.datasetId));
  if (byteLength(stableStringify(preview)) > CUSTOM_DATASET_LIMITS.recordBytes) return invalid();
  return preview;
}

export function parseCustomDatasetPreview(value: unknown): CustomDatasetPreview {
  const source = object(copyJson(value), ["schemaVersion", "workspaceId", "intent", "head", "content", "canonicalSnapshotBytes", "createdAtByteAllowance", "fingerprint"]);
  if (source.schemaVersion !== "custom-dataset-preview-v1") return invalid();
  const content = parseContent(source.content), intent = parseIntent(source.intent);
  const preview = previewFromContent(content, intent, parseHead(source.head, content.workspaceId, content.dataset.publicId));
  if (!same(preview, source)) return invalid();
  return preview;
}

function requestFingerprint(workspaceId: string, intent: CustomDatasetIntent, expectedPreviewFingerprint: string): string {
  return hash({ schemaVersion: "custom-dataset-request-fingerprint-v1", workspaceId, intent, expectedPreviewFingerprint });
}

export function customDatasetRequestFingerprint(workspaceId: string, value: unknown): string {
  const request = prepareCustomDatasetSaveRequest(value), scope = text(workspaceId);
  const content = contentFromRows(scope, request.draft, parsedRows(scope, request.draft));
  return requestFingerprint(scope, intentFromDraft(scope, request.draft, content.fingerprint), request.expectedPreviewFingerprint);
}

function manifestFromPreview(preview: CustomDatasetPreview, createdAt: string): CustomDatasetManifest {
  return {
    schemaVersion: "custom-dataset-manifest-v1", workspaceId: preview.workspaceId,
    datasetId: preview.content.dataset.id, versionId: preview.content.version.id, createdAt,
    intent: preview.intent, head: preview.head, rowCount: preview.content.rows.length,
    contentFingerprint: preview.content.fingerprint, previewFingerprint: preview.fingerprint,
    requestFingerprint: requestFingerprint(preview.workspaceId, preview.intent, preview.fingerprint)
  };
}

export function prepareCustomDatasetVersionRecord(input: PrepareCustomDatasetVersionRecordInput): CustomDatasetVersionRecord {
  const source = object(copyJson(input), ["workspaceId", "request", "head", "createdAt"]), workspaceId = text(source.workspaceId);
  const request = prepareCustomDatasetSaveRequest(source.request);
  const draft = request.draft, head = parseHead(source.head, workspaceId, draft.datasetId);
  const preview = resolveCustomDatasetPreview({ workspaceId, draft, head });
  if (request.expectedPreviewFingerprint !== preview.fingerprint) return conflict("custom_dataset_preview_changed");
  const createdAt = timestamp(source.createdAt), snapshot = savedSnapshot(preview.content, createdAt);
  const manifest = manifestFromPreview(preview, createdAt);
  const base: Omit<CustomDatasetVersionRecord, "fingerprint"> = { schemaVersion: "custom-dataset-record-v1", workspaceId, content: preview.content, snapshot, manifest };
  const record = { ...base, fingerprint: hash(base) };
  if (byteLength(stableStringify(manifest)) > CUSTOM_DATASET_LIMITS.manifestBytes || byteLength(stableStringify(record)) > CUSTOM_DATASET_LIMITS.recordBytes) return invalid();
  return record;
}

function parseManifest(value: unknown): CustomDatasetManifest {
  const source = object(value, ["schemaVersion", "workspaceId", "datasetId", "versionId", "createdAt", "intent", "head", "rowCount", "contentFingerprint", "previewFingerprint", "requestFingerprint"]);
  if (source.schemaVersion !== "custom-dataset-manifest-v1" || byteLength(stableStringify(source)) > CUSTOM_DATASET_LIMITS.manifestBytes) return invalid();
  const workspaceId = text(source.workspaceId), intent = parseIntent(source.intent);
  const ids = customDatasetStorageIds(workspaceId, intent.datasetId, intent.versionId);
  if (intent.workspaceId !== workspaceId || source.datasetId !== ids.datasetId || source.versionId !== ids.versionId
    || !Number.isInteger(source.rowCount) || Number(source.rowCount) < 1 || Number(source.rowCount) > CUSTOM_DATASET_LIMITS.rows) return invalid();
  const manifest: CustomDatasetManifest = {
    schemaVersion: "custom-dataset-manifest-v1", workspaceId, datasetId: ids.datasetId, versionId: ids.versionId,
    createdAt: timestamp(source.createdAt), intent, head: parseHead(source.head, workspaceId, intent.datasetId), rowCount: Number(source.rowCount),
    contentFingerprint: digest(source.contentFingerprint), previewFingerprint: digest(source.previewFingerprint), requestFingerprint: digest(source.requestFingerprint)
  };
  if (!same(source, manifest)) return invalid();
  return manifest;
}

export function restoreCustomDatasetVersionRecord(input: RestoreCustomDatasetVersionRecordInput): CustomDatasetVersionRecord {
  try {
    const source = object(copyJson(input), ["workspaceId", "snapshot", "manifest"]), workspaceId = text(source.workspaceId);
    const snapshot = parseProvidedOutputDatasetSnapshot(source.snapshot), manifest = parseManifest(source.manifest), intent = manifest.intent;
    if (!same(snapshot, source.snapshot) || manifest.workspaceId !== workspaceId || snapshot.dataset.kind !== KIND
      || snapshot.dataset.id !== manifest.datasetId || snapshot.version.id !== manifest.versionId || snapshot.version.createdAt !== manifest.createdAt
      || snapshot.dataset.name !== intent.name || snapshot.version.version !== intent.version || snapshot.rows.length !== manifest.rowCount) return conflict();
    const content = contentFromRows(workspaceId, intent, snapshot.rows);
    if (content.fingerprint !== manifest.contentFingerprint || intent.contentFingerprint !== content.fingerprint
      || snapshot.version.fingerprint !== content.fingerprint) return conflict();
    const preview = previewFromContent(content, intent, manifest.head);
    if (!same(manifestFromPreview(preview, manifest.createdAt), manifest)) return conflict();
    const base: Omit<CustomDatasetVersionRecord, "fingerprint"> = { schemaVersion: "custom-dataset-record-v1", workspaceId, content, snapshot, manifest };
    return { ...base, fingerprint: hash(base) };
  } catch { return conflict(); }
}

export function parseCustomDatasetVersionRecord(value: unknown): CustomDatasetVersionRecord {
  try {
    const source = object(copyJson(value), ["schemaVersion", "workspaceId", "content", "snapshot", "manifest", "fingerprint"]);
    if (source.schemaVersion !== "custom-dataset-record-v1") return conflict();
    const record = restoreCustomDatasetVersionRecord({ workspaceId: text(source.workspaceId), snapshot: source.snapshot, manifest: source.manifest });
    if (!same(record, source)) return conflict();
    return record;
  } catch { return conflict(); }
}

export function customDatasetHeadFromRecord(value: unknown): CustomDatasetHead {
  const record = parseCustomDatasetVersionRecord(value), content = record.content;
  return { datasetId: content.dataset.id, publicDatasetId: content.dataset.publicId, name: content.dataset.name, kind: KIND,
    versionId: content.version.id, publicVersionId: content.version.publicId, version: content.version.version, contentFingerprint: content.fingerprint };
}

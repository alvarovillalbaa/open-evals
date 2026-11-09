import { stableHash, stableStringify } from "./hash";
import type * as T from "./eval-composition-types";
export type * from "./eval-composition-types";

export const EVAL_COMPOSITION_LIMITS = Object.freeze({ requestBytes: 2097152, recordBytes: 1048576, previewBytes: 2097152, members: 32, history: 20 });
export class EvalCompositionError extends Error {
  readonly status: 409 | 422;
  readonly code: string;
  constructor(status: 409 | 422, code: string) { super(code); this.name = "EvalCompositionError"; this.status = status; this.code = code; }
}
const fail = (code = "eval_composition_invalid", status: 409 | 422 = 422): never => { throw new EvalCompositionError(status, code); };
const hash = (value: unknown): string => stableHash(value, 64);
const bytes = (value: unknown): number => new TextEncoder().encode(stableStringify(value)).byteLength;
const equal = (a: unknown, b: unknown): boolean => stableStringify(a) === stableStringify(b);
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
function validText(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0 || c >= 0xdc00 && c <= 0xdfff) return false;
    if (c >= 0xd800 && c <= 0xdbff) { const d = value.charCodeAt(++i); if (!(d >= 0xdc00 && d <= 0xdfff)) return false; }
  }
  return true;
}
function snapshot(value: unknown, maximum: number = EVAL_COMPOSITION_LIMITS.requestBytes): unknown {
  let nodes = 0;
  const ancestors = new Set<object>();
  function copy(v: unknown, depth: number): unknown {
    if (++nodes > 50000 || depth > 32) return fail();
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") return Number.isFinite(v) ? v : fail();
    if (typeof v === "string") return validText(v) && new TextEncoder().encode(v).byteLength <= maximum ? v : fail();
    if (!v || typeof v !== "object" || ancestors.has(v)) return fail();
    const array = Array.isArray(v), prototype = Object.getPrototypeOf(v);
    if (array ? prototype !== Array.prototype : prototype !== null && prototype !== Object.prototype) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(descriptors).filter(k => !(array && k === "length"));
    if (keys.length > 10000 || keys.some(k => typeof k !== "string") || array && (descriptors.length?.value !== keys.length || keys.some((k, i) => k !== String(i)))) return fail();
    const out: Record<string, unknown> | unknown[] = array ? [] : Object.create(null);
    ancestors.add(v);
    for (const key of keys) {
      const d = descriptors[key as string]; if (!d || !d.enumerable || !("value" in d)) return fail();
      Object.defineProperty(out, key, { value: copy(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(v); return out;
  }
  try {
    const out = copy(value, 0); if (bytes(out) > maximum) return fail("eval_composition_budget"); return out;
  } catch (error) { if (error instanceof EvalCompositionError) throw error; return fail(); }
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || !equal(Object.keys(value).sort(), [...keys].sort())) return fail();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum = 512): string {
  if (typeof value !== "string" || !validText(value) || !value.trim() || new TextEncoder().encode(value).byteLength > maximum) return fail(); return value;
}
function uuid(value: unknown): string { if (typeof value !== "string" || !UUID.test(value)) return fail(); return value; }
function digest(value: unknown): string { if (typeof value !== "string" || !DIGEST.test(value)) return fail(); return value; }
function integer(value: unknown, minimum: number, maximum: number): number { if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) return fail(); return value; }
function name(value: unknown): string { const result = text(value, 480).trim(); if (Array.from(result).length > 120) return fail(); return result; }
function time(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return fail();
  try { if (new Date(value).toISOString() !== value) return fail(); } catch { return fail(); } return value;
}
function versionFields(s: Record<string, unknown>) {
  const versionId = uuid(s.versionId), version = integer(s.version, 1, 2147483647), expectedVersionId = s.expectedVersionId === null ? null : uuid(s.expectedVersionId);
  if (version === 1 ? expectedVersionId !== null : expectedVersionId === null || expectedVersionId === versionId) return fail();
  return { versionId, version, expectedVersionId };
}
export function prepareCustomEvalItemDraftV2(value: unknown): T.CustomEvalItemDraftV2 {
  const s = object(snapshot(value), ["schemaVersion", "itemId", "versionId", "version", "expectedVersionId", "name", "contains"]);
  if (s.schemaVersion !== "custom-eval-item-draft-v2") return fail();
  return { schemaVersion: "custom-eval-item-draft-v2", itemId: uuid(s.itemId), ...versionFields(s), name: name(s.name), contains: text(s.contains, 4096) };
}
export function prepareCustomEvalSetDraftV2(value: unknown): T.CustomEvalSetDraftV2 {
  const s = object(snapshot(value), ["schemaVersion", "setId", "versionId", "version", "expectedVersionId", "name", "members", "datasetPassRateThreshold"]);
  if (s.schemaVersion !== "custom-eval-set-draft-v2" || !Array.isArray(s.members) || !s.members.length || s.members.length > EVAL_COMPOSITION_LIMITS.members) return fail();
  const members = s.members.map(v => { const m = object(v, ["itemId", "versionId", "fingerprint"]); return { itemId: uuid(m.itemId), versionId: uuid(m.versionId), fingerprint: digest(m.fingerprint) }; });
  if (new Set(members.map(m => m.itemId + "/" + m.versionId)).size !== members.length) return fail();
  const threshold = s.datasetPassRateThreshold;
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 100) return fail();
  return { schemaVersion: "custom-eval-set-draft-v2", setId: uuid(s.setId), ...versionFields(s), name: name(s.name), members, datasetPassRateThreshold: threshold === 0 ? 0 : threshold };
}
export function prepareCustomEvalItemSaveRequestV2(value: unknown): T.CustomEvalItemSaveRequestV2 {
  const s = object(snapshot(value), ["schemaVersion", "draft", "expectedPreviewFingerprint"]); if (s.schemaVersion !== "custom-eval-item-save-v2") return fail();
  return { schemaVersion: "custom-eval-item-save-v2", draft: prepareCustomEvalItemDraftV2(s.draft), expectedPreviewFingerprint: digest(s.expectedPreviewFingerprint) };
}
export function prepareCustomEvalSetSaveRequestV2(value: unknown): T.CustomEvalSetSaveRequestV2 {
  const s = object(snapshot(value), ["schemaVersion", "draft", "expectedPreviewFingerprint"]); if (s.schemaVersion !== "custom-eval-set-save-v2") return fail();
  return { schemaVersion: "custom-eval-set-save-v2", draft: prepareCustomEvalSetDraftV2(s.draft), expectedPreviewFingerprint: digest(s.expectedPreviewFingerprint) };
}
function identity(kind: "item" | "set", workspaceId: string, id: string, versionId: string) {
  workspaceId = text(workspaceId); id = uuid(id); versionId = uuid(versionId);
  return { aggregate: hash({ schemaVersion: "custom-eval-" + kind + "-identity-v2", workspaceId, id }), version: hash({ schemaVersion: "custom-eval-" + kind + "-version-identity-v2", workspaceId, id, versionId }) };
}
export function customEvalItemStorageIdsV2(workspaceId: string, itemId: string, versionId: string): T.CustomEvalItemStorageIdsV2 {
  const k = identity("item", workspaceId, itemId, versionId); return { itemId: "custom_eval_item_v2_" + k.aggregate, versionId: "custom_eval_item_version_v2_" + k.version, auditId: "audit_custom_eval_item_v2_" + k.version };
}
export function customEvalSetStorageIdsV2(workspaceId: string, setId: string, versionId: string): T.CustomEvalSetStorageIdsV2 {
  const k = identity("set", workspaceId, setId, versionId); return { setId: "custom_eval_set_v2_" + k.aggregate, versionId: "custom_eval_set_version_v2_" + k.version, auditId: "audit_custom_eval_set_v2_" + k.version };
}
export function customEvalItemRequestFingerprintV2(workspaceId: string, value: unknown): string { return hash({ schemaVersion: "custom-eval-item-save-fingerprint-v2", workspaceId: text(workspaceId), request: prepareCustomEvalItemSaveRequestV2(value) }); }
export function customEvalSetRequestFingerprintV2(workspaceId: string, value: unknown): string { return hash({ schemaVersion: "custom-eval-set-save-fingerprint-v2", workspaceId: text(workspaceId), request: prepareCustomEvalSetSaveRequestV2(value) }); }
function head(kind: "item", value: unknown): T.CustomEvalItemHeadV2 | null;
function head(kind: "set", value: unknown): T.CustomEvalSetHeadV2 | null;
function head(kind: "item" | "set", value: unknown): T.CustomEvalItemHeadV2 | T.CustomEvalSetHeadV2 | null {
  if (value === null) return null;
  const key = kind + "Id", s = object(snapshot(value), [key, "versionId", "version", "name", "contractFingerprint", "recordFingerprint"]);
  const common = { versionId: uuid(s.versionId), version: integer(s.version, 1, 2147483647), name: name(s.name), contractFingerprint: digest(s.contractFingerprint), recordFingerprint: digest(s.recordFingerprint) };
  return kind === "item" ? { itemId: uuid(s[key]), ...common } : { setId: uuid(s[key]), ...common };
}
function checkHead(id: string, draft: { versionId: string; version: number; expectedVersionId: string | null }, parent: T.CustomEvalItemHeadV2 | T.CustomEvalSetHeadV2 | null): void {
  if (parent ? ("itemId" in parent ? parent.itemId : parent.setId) !== id || draft.expectedVersionId !== parent.versionId || draft.version !== parent.version + 1 : draft.version !== 1 || draft.expectedVersionId !== null) return fail("eval_composition_stale", 409);
}
function itemContract(workspaceId: string, draft: T.CustomEvalItemDraftV2): T.CustomEvalItemContractV2 {
  const ids = customEvalItemStorageIdsV2(workspaceId, draft.itemId, draft.versionId);
  const base = { schemaVersion: "custom-eval-item-v2" as const, workspaceId, id: ids.versionId, itemId: ids.itemId, name: draft.name,
    type: "string_check" as const, evaluationUnits: ["llm_call"], outputSchema: { fields: [{ key: "contains_expected", displayName: "Contains configured text", type: "boolean" as const, criticality: "critical" as const, gating: true }] },
    criticality: "critical" as const, config: { contains: draft.contains }, version: draft.version,
    authoring: { itemId: draft.itemId, versionId: draft.versionId, expectedVersionId: draft.expectedVersionId, version: draft.version, draftFingerprint: hash({ schemaVersion: "custom-eval-item-draft-fingerprint-v2", workspaceId, draft }) } };
  return { ...base, fingerprint: hash(base) };
}
export function parseCustomEvalItemContractV2(value: unknown, expectedWorkspaceId?: string): T.CustomEvalItemContractV2 {
  const s = object(snapshot(value), ["schemaVersion", "workspaceId", "id", "itemId", "name", "type", "evaluationUnits", "outputSchema", "criticality", "config", "version", "authoring", "fingerprint"]);
  const a = object(s.authoring, ["itemId", "versionId", "expectedVersionId", "version", "draftFingerprint"]), c = object(s.config, ["contains"]), workspaceId = text(s.workspaceId);
  if (s.schemaVersion !== "custom-eval-item-v2" || expectedWorkspaceId !== undefined && workspaceId !== expectedWorkspaceId) return fail();
  const draft = prepareCustomEvalItemDraftV2({ schemaVersion: "custom-eval-item-draft-v2", itemId: a.itemId, versionId: a.versionId, version: a.version, expectedVersionId: a.expectedVersionId, name: s.name, contains: c.contains });
  const out = itemContract(workspaceId, draft); if (!equal(out, s)) return fail(); return out;
}
function setContract(workspaceId: string, draft: T.CustomEvalSetDraftV2, items: T.CustomEvalItemContractV2[], provenance: string[]): T.CustomEvalSetContractV2 {
  if (items.length !== draft.members.length || provenance.length !== items.length) return fail("eval_composition_sources_invalid");
  const ids = customEvalSetStorageIdsV2(workspaceId, draft.setId, draft.versionId);
  const memberProofs = items.map((item, i): T.CustomEvalSetMemberProofV2 => {
    const ref = draft.members[i];
    if (item.workspaceId !== workspaceId || item.authoring.itemId !== ref.itemId || item.authoring.versionId !== ref.versionId || item.fingerprint !== ref.fingerprint) return fail("eval_composition_sources_invalid");
    return { evalSetVersionId: ids.versionId, evalItemVersionId: item.id, position: i, weight: 1, criticality: "critical", itemFingerprint: item.fingerprint,
      publicItemId: ref.itemId, publicItemVersionId: ref.versionId, itemRecordFingerprint: digest(provenance[i]) };
  });
  if (new Set(items.map(i => i.id)).size !== items.length) return fail("eval_composition_sources_invalid");
  const base = { schemaVersion: "custom-eval-set-v2" as const, workspaceId, id: ids.versionId, setId: ids.setId, name: draft.name,
    itemVersions: items.map(item => ({ item, weight: 1 as const, criticality: "critical" as const })), memberProofs,
    gates: { rowThreshold: 100, datasetPassRateThreshold: draft.datasetPassRateThreshold, evalSetThreshold: draft.datasetPassRateThreshold, runThreshold: draft.datasetPassRateThreshold },
    authoring: { setId: draft.setId, versionId: draft.versionId, expectedVersionId: draft.expectedVersionId, version: draft.version, draftFingerprint: hash({ schemaVersion: "custom-eval-set-draft-fingerprint-v2", workspaceId, draft }) } };
  return { ...base, fingerprint: hash(base) };
}
export function parseCustomEvalSetContractV2(value: unknown, expectedWorkspaceId?: string): T.CustomEvalSetContractV2 {
  const s = object(snapshot(value), ["schemaVersion", "workspaceId", "id", "setId", "name", "itemVersions", "memberProofs", "gates", "authoring", "fingerprint"]), workspaceId = text(s.workspaceId);
  if (s.schemaVersion !== "custom-eval-set-v2" || expectedWorkspaceId !== undefined && workspaceId !== expectedWorkspaceId || !Array.isArray(s.itemVersions) || !Array.isArray(s.memberProofs) || s.itemVersions.length !== s.memberProofs.length || !s.itemVersions.length || s.itemVersions.length > 32) return fail();
  const a = object(s.authoring, ["setId", "versionId", "expectedVersionId", "version", "draftFingerprint"]), g = object(s.gates, ["rowThreshold", "datasetPassRateThreshold", "evalSetThreshold", "runThreshold"]);
  const items = s.itemVersions.map(v => { const m = object(v, ["item", "weight", "criticality"]); if (m.weight !== 1 || m.criticality !== "critical") return fail(); return parseCustomEvalItemContractV2(m.item, workspaceId); });
  const provenance = s.memberProofs.map(v => { const p = object(v, ["evalSetVersionId", "evalItemVersionId", "position", "weight", "criticality", "itemFingerprint", "publicItemId", "publicItemVersionId", "itemRecordFingerprint"]); return digest(p.itemRecordFingerprint); });
  const draft = prepareCustomEvalSetDraftV2({ schemaVersion: "custom-eval-set-draft-v2", setId: a.setId, versionId: a.versionId, version: a.version, expectedVersionId: a.expectedVersionId, name: s.name,
    members: items.map(item => ({ itemId: item.authoring.itemId, versionId: item.authoring.versionId, fingerprint: item.fingerprint })), datasetPassRateThreshold: g.datasetPassRateThreshold });
  const out = setContract(workspaceId, draft, items, provenance); if (!equal(out, s)) return fail(); return out;
}
const recordKeys = ["schemaVersion", "workspaceId", "storage", "createdAt", "draft", "head", "contract", "previewFingerprint", "requestFingerprint", "fingerprint"];
function itemRecordBase(preview: T.CustomEvalItemPreviewV2, createdAt: string, requestFingerprint: string) {
  return { schemaVersion: "custom-eval-item-record-v2" as const, workspaceId: preview.workspaceId, storage: customEvalItemStorageIdsV2(preview.workspaceId, preview.draft.itemId, preview.draft.versionId), createdAt,
    draft: preview.draft, head: preview.head, contract: preview.contract, previewFingerprint: preview.fingerprint, requestFingerprint };
}
function setRecordBase(preview: T.CustomEvalSetPreviewV2, createdAt: string, requestFingerprint: string) {
  return { schemaVersion: "custom-eval-set-record-v2" as const, workspaceId: preview.workspaceId, storage: customEvalSetStorageIdsV2(preview.workspaceId, preview.draft.setId, preview.draft.versionId), createdAt,
    draft: preview.draft, head: preview.head, contract: preview.contract, members: preview.members, previewFingerprint: preview.fingerprint, requestFingerprint };
}
export function resolveCustomEvalItemPreviewV2(input: T.ResolveCustomEvalItemPreviewV2Input): T.CustomEvalItemPreviewV2 {
  const workspaceId = text(input.workspaceId), draft = prepareCustomEvalItemDraftV2(input.draft), parent = head("item", input.head); checkHead(draft.itemId, draft, parent);
  const base = { schemaVersion: "custom-eval-item-preview-v2" as const, workspaceId, draft, head: parent, contract: itemContract(workspaceId, draft), recordByteAllowance: 0 };
  const temporary = { ...base, fingerprint: "f".repeat(64) }, record = itemRecordBase(temporary, " ".repeat(24), "f".repeat(64));
  base.recordByteAllowance = bytes({ ...record, fingerprint: "f".repeat(64) }); if (base.recordByteAllowance > EVAL_COMPOSITION_LIMITS.recordBytes) return fail("eval_composition_budget");
  const out = { ...base, fingerprint: hash(base) }; if (bytes(out) > EVAL_COMPOSITION_LIMITS.previewBytes) return fail("eval_composition_budget"); return out;
}
function setPreview(workspaceId: string, draft: T.CustomEvalSetDraftV2, parent: T.CustomEvalSetHeadV2 | null, items: T.CustomEvalItemContractV2[], provenance: string[]): T.CustomEvalSetPreviewV2 {
  checkHead(draft.setId, draft, parent); const contract = setContract(workspaceId, draft, items, provenance);
  const base = { schemaVersion: "custom-eval-set-preview-v2" as const, workspaceId, draft, head: parent, contract, members: contract.memberProofs, recordByteAllowance: 0 };
  const temporary = { ...base, fingerprint: "f".repeat(64) }, record = setRecordBase(temporary, " ".repeat(24), "f".repeat(64));
  base.recordByteAllowance = bytes({ ...record, fingerprint: "f".repeat(64) }); if (base.recordByteAllowance > EVAL_COMPOSITION_LIMITS.recordBytes) return fail("eval_composition_budget");
  const out = { ...base, fingerprint: hash(base) }; if (bytes(out) > EVAL_COMPOSITION_LIMITS.previewBytes) return fail("eval_composition_budget"); return out;
}
export function resolveCustomEvalSetPreviewV2(input: T.ResolveCustomEvalSetPreviewV2Input): T.CustomEvalSetPreviewV2 {
  const workspaceId = text(input.workspaceId), draft = prepareCustomEvalSetDraftV2(input.draft), parent = head("set", input.head);
  try {
    const sources = snapshot(input.items);
    if (!Array.isArray(sources) || sources.length !== draft.members.length) return fail("eval_composition_sources_invalid");
    const records = sources.map(v => restoreCustomEvalItemVersionRecordV2(v, workspaceId));
    const byId = new Map(records.map(r => [r.draft.itemId + "/" + r.draft.versionId, r])); if (byId.size !== records.length) return fail("eval_composition_sources_invalid");
    const selected = draft.members.map(m => { const r = byId.get(m.itemId + "/" + m.versionId); if (!r || r.contract.fingerprint !== m.fingerprint) return fail("eval_composition_sources_invalid"); return r; });
    return setPreview(workspaceId, draft, parent, selected.map(r => r.contract), selected.map(r => r.fingerprint));
  } catch (error) { if (error instanceof EvalCompositionError && ["eval_composition_stale", "eval_composition_budget"].includes(error.code)) throw error; return fail("eval_composition_sources_invalid"); }
}
export function prepareCustomEvalItemVersionRecordV2(input: T.PrepareCustomEvalItemRecordV2Input): T.CustomEvalItemVersionRecordV2 {
  const request = prepareCustomEvalItemSaveRequestV2(input.request), preview = resolveCustomEvalItemPreviewV2({ workspaceId: input.workspaceId, draft: request.draft, head: input.head });
  if (preview.fingerprint !== request.expectedPreviewFingerprint) return fail("eval_composition_preview_changed", 409);
  const base = itemRecordBase(preview, time(input.createdAt), customEvalItemRequestFingerprintV2(input.workspaceId, request)), out = { ...base, fingerprint: hash(base) };
  if (bytes(out) > EVAL_COMPOSITION_LIMITS.recordBytes || bytes(out) !== preview.recordByteAllowance) return fail("eval_composition_budget"); return out;
}
export function prepareCustomEvalSetVersionRecordV2(input: T.PrepareCustomEvalSetRecordV2Input): T.CustomEvalSetVersionRecordV2 {
  const request = prepareCustomEvalSetSaveRequestV2(input.request), preview = resolveCustomEvalSetPreviewV2({ workspaceId: input.workspaceId, draft: request.draft, head: input.head, items: input.items });
  if (preview.fingerprint !== request.expectedPreviewFingerprint) return fail("eval_composition_preview_changed", 409);
  const base = setRecordBase(preview, time(input.createdAt), customEvalSetRequestFingerprintV2(input.workspaceId, request)), out = { ...base, fingerprint: hash(base) };
  if (bytes(out) > EVAL_COMPOSITION_LIMITS.recordBytes || bytes(out) !== preview.recordByteAllowance) return fail("eval_composition_budget"); return out;
}
export function restoreCustomEvalItemVersionRecordV2(value: unknown, expectedWorkspaceId?: string): T.CustomEvalItemVersionRecordV2 {
  try {
    const s = object(snapshot(value, EVAL_COMPOSITION_LIMITS.recordBytes), recordKeys), workspaceId = text(s.workspaceId);
    if (s.schemaVersion !== "custom-eval-item-record-v2" || expectedWorkspaceId !== undefined && expectedWorkspaceId !== workspaceId) return fail();
    const out = prepareCustomEvalItemVersionRecordV2({ workspaceId, request: { schemaVersion: "custom-eval-item-save-v2", draft: s.draft, expectedPreviewFingerprint: s.previewFingerprint }, head: s.head, createdAt: time(s.createdAt) });
    if (!equal(out, s)) return fail(); return out;
  } catch { return fail("eval_composition_record_invalid", 409); }
}
export function restoreCustomEvalSetVersionRecordV2(value: unknown, expectedWorkspaceId?: string): T.CustomEvalSetVersionRecordV2 {
  try {
    const s = object(snapshot(value, EVAL_COMPOSITION_LIMITS.recordBytes), [...recordKeys, "members"]), workspaceId = text(s.workspaceId);
    if (s.schemaVersion !== "custom-eval-set-record-v2" || expectedWorkspaceId !== undefined && expectedWorkspaceId !== workspaceId) return fail();
    const draft = prepareCustomEvalSetDraftV2(s.draft), contract = parseCustomEvalSetContractV2(s.contract, workspaceId), parent = head("set", s.head);
    const preview = setPreview(workspaceId, draft, parent, contract.itemVersions.map(m => m.item), contract.memberProofs.map(m => m.itemRecordFingerprint));
    if (preview.fingerprint !== s.previewFingerprint || !equal(preview.members, s.members)) return fail();
    const request: T.CustomEvalSetSaveRequestV2 = { schemaVersion: "custom-eval-set-save-v2", draft, expectedPreviewFingerprint: preview.fingerprint };
    const base = setRecordBase(preview, time(s.createdAt), customEvalSetRequestFingerprintV2(workspaceId, request)), out = { ...base, fingerprint: hash(base) };
    if (!equal(out, s) || bytes(out) !== preview.recordByteAllowance) return fail(); return out;
  } catch { return fail("eval_composition_record_invalid", 409); }
}
export function customEvalItemHeadV2(value: unknown): T.CustomEvalItemHeadV2 {
  const r = restoreCustomEvalItemVersionRecordV2(value); return { itemId: r.draft.itemId, versionId: r.draft.versionId, version: r.draft.version, name: r.draft.name, contractFingerprint: r.contract.fingerprint, recordFingerprint: r.fingerprint };
}
export function customEvalSetHeadV2(value: unknown): T.CustomEvalSetHeadV2 {
  const r = restoreCustomEvalSetVersionRecordV2(value); return { setId: r.draft.setId, versionId: r.draft.versionId, version: r.draft.version, name: r.draft.name, contractFingerprint: r.contract.fingerprint, recordFingerprint: r.fingerprint };
}

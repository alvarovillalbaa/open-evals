import {
  EVAL_COMPOSITION_LIMITS, EvalCompositionError, fail, hash, bytes, equal, snapshot,
  object, text, uuid, digest, integer, name, time, versionFields
} from "./eval-authoring-values";
import { parseCustomEvalItemContractV2, restoreCustomEvalItemVersionRecordV2 } from "./eval-composition";
import type * as T from "./eval-matching-types";
export type * from "./eval-matching-types";

export const EVAL_MATCHING_LIMITS = EVAL_COMPOSITION_LIMITS;

/** Exact text is a literal string comparison: no case folding, normalization or coercion. */
export function exactTextMatches(actual: unknown, expected: unknown): boolean {
  const wanted = text(expected, 4096);
  return typeof actual === "string" && actual === wanted;
}

export function prepareCustomEvalItemDraftV3(value: unknown): T.CustomEvalItemDraftV3 {
  const s = object(snapshot(value), ["schemaVersion", "itemId", "versionId", "version", "expectedVersionId", "name", "expected"]);
  if (s.schemaVersion !== "custom-eval-item-draft-v3") return fail();
  return { schemaVersion: "custom-eval-item-draft-v3", itemId: uuid(s.itemId), ...versionFields(s), name: name(s.name), expected: text(s.expected, 4096) };
}
export function prepareCustomEvalItemRefV3(value: unknown): T.CustomEvalItemRefV3 {
  const s = object(snapshot(value), ["schemaVersion", "itemId", "versionId", "fingerprint"]);
  if (s.schemaVersion !== "custom-eval-item-ref-v2" && s.schemaVersion !== "custom-eval-item-ref-v3") return fail();
  return { schemaVersion: s.schemaVersion, itemId: uuid(s.itemId), versionId: uuid(s.versionId), fingerprint: digest(s.fingerprint) };
}
const refKey = (ref: T.CustomEvalItemRefV3): string => ref.schemaVersion + "/" + ref.itemId + "/" + ref.versionId;
export function prepareCustomEvalSetDraftV3(value: unknown): T.CustomEvalSetDraftV3 {
  const s = object(snapshot(value), ["schemaVersion", "setId", "versionId", "version", "expectedVersionId", "name", "members", "datasetPassRateThreshold"]);
  if (s.schemaVersion !== "custom-eval-set-draft-v3" || !Array.isArray(s.members) || !s.members.length || s.members.length > EVAL_MATCHING_LIMITS.members) return fail();
  const members = s.members.map(prepareCustomEvalItemRefV3);
  if (new Set(members.map(refKey)).size !== members.length) return fail();
  const threshold = s.datasetPassRateThreshold;
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 100) return fail();
  return { schemaVersion: "custom-eval-set-draft-v3", setId: uuid(s.setId), ...versionFields(s), name: name(s.name), members, datasetPassRateThreshold: threshold === 0 ? 0 : threshold };
}
export function prepareCustomEvalItemSaveRequestV3(value: unknown): T.CustomEvalItemSaveRequestV3 {
  const s = object(snapshot(value), ["schemaVersion", "draft", "expectedPreviewFingerprint"]);
  if (s.schemaVersion !== "custom-eval-item-save-v3") return fail();
  return { schemaVersion: s.schemaVersion, draft: prepareCustomEvalItemDraftV3(s.draft), expectedPreviewFingerprint: digest(s.expectedPreviewFingerprint) };
}
export function prepareCustomEvalSetSaveRequestV3(value: unknown): T.CustomEvalSetSaveRequestV3 {
  const s = object(snapshot(value), ["schemaVersion", "draft", "expectedPreviewFingerprint"]);
  if (s.schemaVersion !== "custom-eval-set-save-v3") return fail();
  return { schemaVersion: s.schemaVersion, draft: prepareCustomEvalSetDraftV3(s.draft), expectedPreviewFingerprint: digest(s.expectedPreviewFingerprint) };
}
function identity(kind: "item" | "set", workspaceId: string, id: string, versionId: string) {
  workspaceId = text(workspaceId); id = uuid(id); versionId = uuid(versionId);
  return { aggregate: hash({ schemaVersion: "custom-eval-" + kind + "-identity-v3", workspaceId, id }),
    version: hash({ schemaVersion: "custom-eval-" + kind + "-version-identity-v3", workspaceId, id, versionId }) };
}
export function customEvalItemStorageIdsV3(workspaceId: string, itemId: string, versionId: string): T.CustomEvalItemStorageIdsV3 {
  const k = identity("item", workspaceId, itemId, versionId);
  return { itemId: "custom_eval_item_v3_" + k.aggregate, versionId: "custom_eval_item_version_v3_" + k.version, auditId: "audit_custom_eval_item_v3_" + k.version };
}
export function customEvalSetStorageIdsV3(workspaceId: string, setId: string, versionId: string): T.CustomEvalSetStorageIdsV3 {
  const k = identity("set", workspaceId, setId, versionId);
  return { setId: "custom_eval_set_v3_" + k.aggregate, versionId: "custom_eval_set_version_v3_" + k.version, auditId: "audit_custom_eval_set_v3_" + k.version };
}
export function customEvalItemRequestFingerprintV3(workspaceId: string, value: unknown): string {
  return hash({ schemaVersion: "custom-eval-item-save-fingerprint-v3", workspaceId: text(workspaceId), request: prepareCustomEvalItemSaveRequestV3(value) });
}
export function customEvalSetRequestFingerprintV3(workspaceId: string, value: unknown): string {
  return hash({ schemaVersion: "custom-eval-set-save-fingerprint-v3", workspaceId: text(workspaceId), request: prepareCustomEvalSetSaveRequestV3(value) });
}
function head(kind: "item", value: unknown): T.CustomEvalItemHeadV3 | null;
function head(kind: "set", value: unknown): T.CustomEvalSetHeadV3 | null;
function head(kind: "item" | "set", value: unknown): T.CustomEvalItemHeadV3 | T.CustomEvalSetHeadV3 | null {
  if (value === null) return null;
  const key = kind + "Id", s = object(snapshot(value), ["profile", key, "versionId", "version", "name", "contractFingerprint", "recordFingerprint"]);
  if (s.profile !== "eval-matching-v3") return fail();
  const common = { profile: "eval-matching-v3" as const, versionId: uuid(s.versionId), version: integer(s.version, 1, 2147483647),
    name: name(s.name), contractFingerprint: digest(s.contractFingerprint), recordFingerprint: digest(s.recordFingerprint) };
  return kind === "item" ? { itemId: uuid(s[key]), ...common } : { setId: uuid(s[key]), ...common };
}
function checkHead(id: string, draft: { versionId: string; version: number; expectedVersionId: string | null }, parent: T.CustomEvalItemHeadV3 | T.CustomEvalSetHeadV3 | null): void {
  if (parent ? ("itemId" in parent ? parent.itemId : parent.setId) !== id || draft.expectedVersionId !== parent.versionId || draft.version !== parent.version + 1
    : draft.version !== 1 || draft.expectedVersionId !== null) return fail("eval_composition_stale", 409);
}
function itemContract(workspaceId: string, draft: T.CustomEvalItemDraftV3): T.CustomEvalItemContractV3 {
  const ids = customEvalItemStorageIdsV3(workspaceId, draft.itemId, draft.versionId);
  const base = { schemaVersion: "custom-eval-item-v3" as const, workspaceId, id: ids.versionId, itemId: ids.itemId, name: draft.name,
    type: "exact_match" as const, evaluationUnits: ["llm_call"],
    outputSchema: { fields: [{ key: "matches_expected", displayName: "Matches exact text", type: "boolean" as const, criticality: "critical" as const, gating: true }] },
    criticality: "critical" as const, config: { expected: draft.expected }, version: draft.version,
    authoring: { itemId: draft.itemId, versionId: draft.versionId, expectedVersionId: draft.expectedVersionId, version: draft.version,
      draftFingerprint: hash({ schemaVersion: "custom-eval-item-draft-fingerprint-v3", workspaceId, draft }) } };
  return { ...base, fingerprint: hash(base) };
}
export function parseCustomEvalItemContractV3(value: unknown, expectedWorkspaceId?: string): T.CustomEvalItemContractV3 {
  const s = object(snapshot(value), ["schemaVersion", "workspaceId", "id", "itemId", "name", "type", "evaluationUnits", "outputSchema", "criticality", "config", "version", "authoring", "fingerprint"]);
  const a = object(s.authoring, ["itemId", "versionId", "expectedVersionId", "version", "draftFingerprint"]), c = object(s.config, ["expected"]), workspaceId = text(s.workspaceId);
  if (s.schemaVersion !== "custom-eval-item-v3" || expectedWorkspaceId !== undefined && workspaceId !== expectedWorkspaceId) return fail();
  const draft = prepareCustomEvalItemDraftV3({ schemaVersion: "custom-eval-item-draft-v3", itemId: a.itemId, versionId: a.versionId,
    version: a.version, expectedVersionId: a.expectedVersionId, name: s.name, expected: c.expected });
  const out = itemContract(workspaceId, draft);
  if (!equal(out, s)) return fail();
  return out;
}
export function parseMatchingEvalItemContract(value: unknown, expectedWorkspaceId?: string): T.MatchingEvalItemContract {
  const copied = snapshot(value);
  if (!copied || typeof copied !== "object" || Array.isArray(copied)) return fail();
  const schema = (copied as Record<string, unknown>).schemaVersion;
  if (schema === "custom-eval-item-v2") return parseCustomEvalItemContractV2(copied, expectedWorkspaceId);
  if (schema === "custom-eval-item-v3") return parseCustomEvalItemContractV3(copied, expectedWorkspaceId);
  return fail();
}
function itemRef(item: T.MatchingEvalItemContract): T.CustomEvalItemRefV3 {
  return { schemaVersion: item.schemaVersion === "custom-eval-item-v2" ? "custom-eval-item-ref-v2" : "custom-eval-item-ref-v3",
    itemId: item.authoring.itemId, versionId: item.authoring.versionId, fingerprint: item.fingerprint };
}
function setContract(workspaceId: string, draft: T.CustomEvalSetDraftV3, items: T.MatchingEvalItemContract[], provenance: string[]): T.CustomEvalSetContractV3 {
  if (items.length !== draft.members.length || provenance.length !== items.length) return fail("eval_composition_sources_invalid");
  const ids = customEvalSetStorageIdsV3(workspaceId, draft.setId, draft.versionId);
  const memberProofs = items.map((item, i): T.CustomEvalSetMemberProofV3 => {
    if (item.workspaceId !== workspaceId || !equal(itemRef(item), draft.members[i])) return fail("eval_composition_sources_invalid");
    return { evalSetVersionId: ids.versionId, evalItemVersionId: item.id, position: i, weight: 1, criticality: "critical", itemFingerprint: item.fingerprint,
      publicItemId: item.authoring.itemId, publicItemVersionId: item.authoring.versionId, itemRecordFingerprint: digest(provenance[i]), itemSchemaVersion: item.schemaVersion };
  });
  if (new Set(items.map(item => item.id)).size !== items.length) return fail("eval_composition_sources_invalid");
  const base = { schemaVersion: "custom-eval-set-v3" as const, workspaceId, id: ids.versionId, setId: ids.setId, name: draft.name,
    itemVersions: items.map(item => ({ item, weight: 1 as const, criticality: "critical" as const })), memberProofs,
    gates: { rowThreshold: 100, datasetPassRateThreshold: draft.datasetPassRateThreshold, evalSetThreshold: draft.datasetPassRateThreshold, runThreshold: draft.datasetPassRateThreshold },
    authoring: { setId: draft.setId, versionId: draft.versionId, expectedVersionId: draft.expectedVersionId, version: draft.version,
      draftFingerprint: hash({ schemaVersion: "custom-eval-set-draft-fingerprint-v3", workspaceId, draft }) } };
  return { ...base, fingerprint: hash(base) };
}
export function parseCustomEvalSetContractV3(value: unknown, expectedWorkspaceId?: string): T.CustomEvalSetContractV3 {
  const s = object(snapshot(value), ["schemaVersion", "workspaceId", "id", "setId", "name", "itemVersions", "memberProofs", "gates", "authoring", "fingerprint"]), workspaceId = text(s.workspaceId);
  if (s.schemaVersion !== "custom-eval-set-v3" || expectedWorkspaceId !== undefined && workspaceId !== expectedWorkspaceId || !Array.isArray(s.itemVersions) || !Array.isArray(s.memberProofs)
    || s.itemVersions.length !== s.memberProofs.length || !s.itemVersions.length || s.itemVersions.length > EVAL_MATCHING_LIMITS.members) return fail();
  const a = object(s.authoring, ["setId", "versionId", "expectedVersionId", "version", "draftFingerprint"]), g = object(s.gates, ["rowThreshold", "datasetPassRateThreshold", "evalSetThreshold", "runThreshold"]);
  const items = s.itemVersions.map(value => { const member = object(value, ["item", "weight", "criticality"]);
    if (member.weight !== 1 || member.criticality !== "critical") return fail();
    return parseMatchingEvalItemContract(member.item, workspaceId); });
  const provenance = s.memberProofs.map(value => {
    const p = object(value, ["evalSetVersionId", "evalItemVersionId", "position", "weight", "criticality", "itemFingerprint", "publicItemId", "publicItemVersionId", "itemRecordFingerprint", "itemSchemaVersion"]);
    return digest(p.itemRecordFingerprint);
  });
  const draft = prepareCustomEvalSetDraftV3({ schemaVersion: "custom-eval-set-draft-v3", setId: a.setId, versionId: a.versionId,
    version: a.version, expectedVersionId: a.expectedVersionId, name: s.name, members: items.map(itemRef), datasetPassRateThreshold: g.datasetPassRateThreshold });
  const out = setContract(workspaceId, draft, items, provenance);
  if (!equal(out, s)) return fail();
  return out;
}
const recordKeys = ["schemaVersion", "workspaceId", "storage", "createdAt", "draft", "head", "contract", "previewFingerprint", "requestFingerprint", "fingerprint"];
function itemRecordBase(preview: T.CustomEvalItemPreviewV3, createdAt: string, requestFingerprint: string) {
  return { schemaVersion: "custom-eval-item-record-v3" as const, workspaceId: preview.workspaceId,
    storage: customEvalItemStorageIdsV3(preview.workspaceId, preview.draft.itemId, preview.draft.versionId), createdAt,
    draft: preview.draft, head: preview.head, contract: preview.contract, previewFingerprint: preview.fingerprint, requestFingerprint };
}
function setRecordBase(preview: T.CustomEvalSetPreviewV3, createdAt: string, requestFingerprint: string) {
  return { schemaVersion: "custom-eval-set-record-v3" as const, workspaceId: preview.workspaceId,
    storage: customEvalSetStorageIdsV3(preview.workspaceId, preview.draft.setId, preview.draft.versionId), createdAt,
    draft: preview.draft, head: preview.head, contract: preview.contract, members: preview.members, previewFingerprint: preview.fingerprint, requestFingerprint };
}
export function resolveCustomEvalItemPreviewV3(input: T.ResolveCustomEvalItemPreviewV3Input): T.CustomEvalItemPreviewV3 {
  const workspaceId = text(input.workspaceId), draft = prepareCustomEvalItemDraftV3(input.draft), parent = head("item", input.head);
  checkHead(draft.itemId, draft, parent);
  const base = { schemaVersion: "custom-eval-item-preview-v3" as const, workspaceId, draft, head: parent, contract: itemContract(workspaceId, draft), recordByteAllowance: 0 };
  const temporary = { ...base, fingerprint: "f".repeat(64) }, record = itemRecordBase(temporary, " ".repeat(24), "f".repeat(64));
  base.recordByteAllowance = bytes({ ...record, fingerprint: "f".repeat(64) });
  if (base.recordByteAllowance > EVAL_MATCHING_LIMITS.recordBytes) return fail("eval_composition_budget");
  const out = { ...base, fingerprint: hash(base) };
  if (bytes(out) > EVAL_MATCHING_LIMITS.previewBytes) return fail("eval_composition_budget");
  return out;
}
function setPreview(workspaceId: string, draft: T.CustomEvalSetDraftV3, parent: T.CustomEvalSetHeadV3 | null, items: T.MatchingEvalItemContract[], provenance: string[]): T.CustomEvalSetPreviewV3 {
  checkHead(draft.setId, draft, parent);
  const contract = setContract(workspaceId, draft, items, provenance);
  const base = { schemaVersion: "custom-eval-set-preview-v3" as const, workspaceId, draft, head: parent, contract, members: contract.memberProofs, recordByteAllowance: 0 };
  const temporary = { ...base, fingerprint: "f".repeat(64) }, record = setRecordBase(temporary, " ".repeat(24), "f".repeat(64));
  base.recordByteAllowance = bytes({ ...record, fingerprint: "f".repeat(64) });
  if (base.recordByteAllowance > EVAL_MATCHING_LIMITS.recordBytes) return fail("eval_composition_budget");
  const out = { ...base, fingerprint: hash(base) };
  if (bytes(out) > EVAL_MATCHING_LIMITS.previewBytes) return fail("eval_composition_budget");
  return out;
}
function itemRecord(value: unknown, workspaceId: string): T.MatchingEvalItemRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("eval_composition_sources_invalid");
  const schema = (value as Record<string, unknown>).schemaVersion;
  if (schema === "custom-eval-item-record-v2") return restoreCustomEvalItemVersionRecordV2(value, workspaceId);
  if (schema === "custom-eval-item-record-v3") return restoreCustomEvalItemVersionRecordV3(value, workspaceId);
  return fail("eval_composition_sources_invalid");
}
export function restoreMatchingEvalItemVersionRecord(value: unknown, expectedWorkspaceId?: string): T.MatchingEvalItemRecord {
  const copied = snapshot(value);
  if (!copied || typeof copied !== "object" || Array.isArray(copied)) return fail();
  const workspaceId = text(expectedWorkspaceId ?? (copied as Record<string, unknown>).workspaceId);
  return itemRecord(copied, workspaceId);
}
export function resolveCustomEvalSetPreviewV3(input: T.ResolveCustomEvalSetPreviewV3Input): T.CustomEvalSetPreviewV3 {
  const workspaceId = text(input.workspaceId), draft = prepareCustomEvalSetDraftV3(input.draft), parent = head("set", input.head);
  try {
    const sources = snapshot(input.items);
    if (!Array.isArray(sources) || sources.length !== draft.members.length) return fail("eval_composition_sources_invalid");
    const records = sources.map(value => itemRecord(value, workspaceId));
    const byId = new Map(records.map(record => [refKey(itemRef(record.contract)), record]));
    if (byId.size !== records.length) return fail("eval_composition_sources_invalid");
    const selected = draft.members.map(ref => {
      const record = byId.get(refKey(ref));
      if (!record || record.contract.fingerprint !== ref.fingerprint) return fail("eval_composition_sources_invalid");
      return record;
    });
    return setPreview(workspaceId, draft, parent, selected.map(record => record.contract), selected.map(record => record.fingerprint));
  } catch (error) {
    if (error instanceof EvalCompositionError && ["eval_composition_stale", "eval_composition_budget"].includes(error.code)) throw error;
    return fail("eval_composition_sources_invalid");
  }
}
export function prepareCustomEvalItemVersionRecordV3(input: T.PrepareCustomEvalItemRecordV3Input): T.CustomEvalItemVersionRecordV3 {
  const request = prepareCustomEvalItemSaveRequestV3(input.request), preview = resolveCustomEvalItemPreviewV3({ workspaceId: input.workspaceId, draft: request.draft, head: input.head });
  if (preview.fingerprint !== request.expectedPreviewFingerprint) return fail("eval_composition_preview_changed", 409);
  const base = itemRecordBase(preview, time(input.createdAt), customEvalItemRequestFingerprintV3(input.workspaceId, request)), out = { ...base, fingerprint: hash(base) };
  if (bytes(out) > EVAL_MATCHING_LIMITS.recordBytes || bytes(out) !== preview.recordByteAllowance) return fail("eval_composition_budget");
  return out;
}
export function prepareCustomEvalSetVersionRecordV3(input: T.PrepareCustomEvalSetRecordV3Input): T.CustomEvalSetVersionRecordV3 {
  const request = prepareCustomEvalSetSaveRequestV3(input.request), preview = resolveCustomEvalSetPreviewV3({ workspaceId: input.workspaceId, draft: request.draft, head: input.head, items: input.items });
  if (preview.fingerprint !== request.expectedPreviewFingerprint) return fail("eval_composition_preview_changed", 409);
  const base = setRecordBase(preview, time(input.createdAt), customEvalSetRequestFingerprintV3(input.workspaceId, request)), out = { ...base, fingerprint: hash(base) };
  if (bytes(out) > EVAL_MATCHING_LIMITS.recordBytes || bytes(out) !== preview.recordByteAllowance) return fail("eval_composition_budget");
  return out;
}
export function restoreCustomEvalItemVersionRecordV3(value: unknown, expectedWorkspaceId?: string): T.CustomEvalItemVersionRecordV3 {
  try {
    const s = object(snapshot(value, EVAL_MATCHING_LIMITS.recordBytes), recordKeys), workspaceId = text(s.workspaceId);
    if (s.schemaVersion !== "custom-eval-item-record-v3" || expectedWorkspaceId !== undefined && expectedWorkspaceId !== workspaceId) return fail();
    const out = prepareCustomEvalItemVersionRecordV3({ workspaceId, request: { schemaVersion: "custom-eval-item-save-v3", draft: s.draft, expectedPreviewFingerprint: s.previewFingerprint }, head: s.head, createdAt: time(s.createdAt) });
    if (!equal(out, s)) return fail();
    return out;
  } catch { return fail("eval_composition_record_invalid", 409); }
}
export function restoreCustomEvalSetVersionRecordV3(value: unknown, expectedWorkspaceId?: string): T.CustomEvalSetVersionRecordV3 {
  try {
    const s = object(snapshot(value, EVAL_MATCHING_LIMITS.recordBytes), [...recordKeys, "members"]), workspaceId = text(s.workspaceId);
    if (s.schemaVersion !== "custom-eval-set-record-v3" || expectedWorkspaceId !== undefined && expectedWorkspaceId !== workspaceId) return fail();
    const draft = prepareCustomEvalSetDraftV3(s.draft), contract = parseCustomEvalSetContractV3(s.contract, workspaceId), parent = head("set", s.head);
    const preview = setPreview(workspaceId, draft, parent, contract.itemVersions.map(member => member.item), contract.memberProofs.map(member => member.itemRecordFingerprint));
    if (preview.fingerprint !== s.previewFingerprint || !equal(preview.members, s.members)) return fail();
    const request: T.CustomEvalSetSaveRequestV3 = { schemaVersion: "custom-eval-set-save-v3", draft, expectedPreviewFingerprint: preview.fingerprint };
    const base = setRecordBase(preview, time(s.createdAt), customEvalSetRequestFingerprintV3(workspaceId, request)), out = { ...base, fingerprint: hash(base) };
    if (!equal(out, s) || bytes(out) !== preview.recordByteAllowance) return fail();
    return out;
  } catch { return fail("eval_composition_record_invalid", 409); }
}
export function customEvalItemHeadV3(value: unknown): T.CustomEvalItemHeadV3 {
  const record = restoreCustomEvalItemVersionRecordV3(value);
  return { profile: "eval-matching-v3", itemId: record.draft.itemId, versionId: record.draft.versionId, version: record.draft.version,
    name: record.draft.name, contractFingerprint: record.contract.fingerprint, recordFingerprint: record.fingerprint };
}
export function customEvalSetHeadV3(value: unknown): T.CustomEvalSetHeadV3 {
  const record = restoreCustomEvalSetVersionRecordV3(value);
  return { profile: "eval-matching-v3", setId: record.draft.setId, versionId: record.draft.versionId, version: record.draft.version,
    name: record.draft.name, contractFingerprint: record.contract.fingerprint, recordFingerprint: record.fingerprint };
}

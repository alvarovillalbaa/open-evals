import type { EvalItemVersion, EvalSetVersion } from "./types";
import { stableHash, stableStringify } from "./hash";

export interface CustomEvalSetDraft {
  schemaVersion: "custom-eval-set-draft-v1";
  setId: string;
  versionId: string;
  version: number;
  expectedVersionId: string | null;
  name: string;
  contains: string;
  datasetPassRateThreshold: number;
}

export interface CustomEvalSetContract extends EvalSetVersion {
  schemaVersion: "custom-eval-set-v1";
  authoring: { requestFingerprint: string; expectedVersionId: string | null; version: number };
}

export interface PreparedCustomEvalSet {
  draft: CustomEvalSetDraft;
  requestFingerprint: string;
  contract: CustomEvalSetContract;
}

type CustomEvalSetErrorCode = "custom_eval_set_draft_invalid" | "custom_eval_set_contract_invalid";

export class CustomEvalSetError extends Error {
  readonly status = 422;
  readonly code: CustomEvalSetErrorCode;

  constructor(code: CustomEvalSetErrorCode = "custom_eval_set_draft_invalid") {
    const safeCode = code === "custom_eval_set_contract_invalid" ? code : "custom_eval_set_draft_invalid";
    super(safeCode);
    this.name = "CustomEvalSetError";
    this.code = safeCode;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DRAFT_KEYS = ["schemaVersion", "setId", "versionId", "version", "expectedVersionId", "name", "contains", "datasetPassRateThreshold"];
const invalidDraft = (): never => { throw new CustomEvalSetError(); };
const invalidContract = (): never => { throw new CustomEvalSetError("custom_eval_set_contract_invalid"); };

function validText(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0 || code >= 0xdc00 && code <= 0xdfff) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    }
  }
  return true;
}

function draftRecord(value: unknown): Record<string, unknown> {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalidDraft();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalidDraft();
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.length !== DRAFT_KEYS.length || keys.some(key => typeof key !== "string" || !DRAFT_KEYS.includes(key))) return invalidDraft();
    const result: Record<string, unknown> = Object.create(null);
    for (const key of DRAFT_KEYS) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return invalidDraft();
      result[key] = descriptor.value;
    }
    return result;
  } catch { return invalidDraft(); }
}

export function prepareCustomEvalSet(value: unknown): PreparedCustomEvalSet {
  const source = draftRecord(value);
  if (source.schemaVersion !== "custom-eval-set-draft-v1"
    || typeof source.setId !== "string" || !UUID.test(source.setId)
    || typeof source.versionId !== "string" || !UUID.test(source.versionId)
    || typeof source.version !== "number" || !Number.isInteger(source.version) || source.version < 1 || source.version > 1000000
    || source.expectedVersionId !== null && (typeof source.expectedVersionId !== "string" || !UUID.test(source.expectedVersionId))
    || source.version === 1 && source.expectedVersionId !== null
    || source.version > 1 && source.expectedVersionId === null
    || source.versionId === source.expectedVersionId
    || typeof source.name !== "string" || !validText(source.name)
    || typeof source.contains !== "string" || !validText(source.contains)
    || typeof source.datasetPassRateThreshold !== "number" || !Number.isFinite(source.datasetPassRateThreshold)
    || source.datasetPassRateThreshold < 0 || source.datasetPassRateThreshold > 100) return invalidDraft();
  const name = source.name.trim(), contains = source.contains;
  const encoder = new TextEncoder();
  if (!name || Array.from(name).length > 120 || encoder.encode(name).byteLength > 480
    || !contains.trim() || encoder.encode(contains).byteLength > 4096) return invalidDraft();
  const draft: CustomEvalSetDraft = {
    schemaVersion: "custom-eval-set-draft-v1", setId: source.setId, versionId: source.versionId,
    version: source.version, expectedVersionId: source.expectedVersionId, name, contains,
    datasetPassRateThreshold: source.datasetPassRateThreshold === 0 ? 0 : source.datasetPassRateThreshold
  };
  const requestFingerprint = stableHash(draft, 64);
  const itemBase: Omit<EvalItemVersion, "fingerprint"> = {
    id: `custom_item_version_${draft.versionId}`, itemId: `custom_item_${draft.setId}`, name,
    type: "string_check", evaluationUnits: ["llm_call"],
    outputSchema: { fields: [{ key: "contains_expected", displayName: "Contains configured text", type: "boolean", criticality: "critical", gating: true }] },
    criticality: "critical", config: { contains }, version: draft.version
  };
  const item: EvalItemVersion = { ...itemBase, fingerprint: stableHash(itemBase, 64) };
  const contractBase: Omit<CustomEvalSetContract, "fingerprint"> = {
    schemaVersion: "custom-eval-set-v1", id: draft.versionId, setId: draft.setId, name,
    itemVersions: [{ item, weight: 1, criticality: "critical" }],
    gates: { rowThreshold: 100, datasetPassRateThreshold: draft.datasetPassRateThreshold, evalSetThreshold: draft.datasetPassRateThreshold, runThreshold: draft.datasetPassRateThreshold },
    authoring: { requestFingerprint, expectedVersionId: draft.expectedVersionId, version: draft.version }
  };
  return { draft, requestFingerprint, contract: { ...contractBase, fingerprint: stableHash(contractBase, 64) } };
}

function contractSnapshot(value: unknown): unknown {
  let nodes = 0;
  const ancestors = new Set<object>();
  function copy(item: unknown, depth: number): unknown {
    if (++nodes > 256 || depth > 12) return invalidContract();
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") return Number.isFinite(item) ? item : invalidContract();
    if (typeof item === "string") return validText(item) && new TextEncoder().encode(item).byteLength <= 4096 ? item : invalidContract();
    if (!item || typeof item !== "object" || ancestors.has(item)) return invalidContract();
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return invalidContract();
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const keys = Reflect.ownKeys(descriptors).filter(key => !(array && key === "length"));
    if (keys.length > 64 || keys.some(key => typeof key !== "string")
      || array && (descriptors.length?.value !== keys.length || keys.some((key, index) => key !== String(index)))) return invalidContract();
    const result: Record<string, unknown> | unknown[] = array ? [] : Object.create(null);
    ancestors.add(item);
    try {
      for (const key of keys) {
        const descriptor = descriptors[key as string];
        if (!descriptor?.enumerable || !("value" in descriptor)) return invalidContract();
        Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true, configurable: true, writable: true });
      }
    } finally { ancestors.delete(item); }
    return result;
  }
  return copy(value, 0);
}

function contractRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalidContract();
  return value as Record<string, unknown>;
}

export function parseCustomEvalSetContract(value: unknown): CustomEvalSetContract {
  try {
    const snapshot = contractSnapshot(value), contract = contractRecord(snapshot);
    if (contract.schemaVersion !== "custom-eval-set-v1" || !Array.isArray(contract.itemVersions) || contract.itemVersions.length !== 1) return invalidContract();
    const item = contractRecord(contractRecord(contract.itemVersions[0]).item);
    const authoring = contractRecord(contract.authoring), config = contractRecord(item.config), gates = contractRecord(contract.gates);
    const prepared = prepareCustomEvalSet({
      schemaVersion: "custom-eval-set-draft-v1", setId: contract.setId, versionId: contract.id,
      version: authoring.version, expectedVersionId: authoring.expectedVersionId, name: contract.name,
      contains: config.contains, datasetPassRateThreshold: gates.datasetPassRateThreshold
    });
    if (stableStringify(snapshot) !== stableStringify(prepared.contract)) return invalidContract();
    return prepared.contract;
  } catch { return invalidContract(); }
}

import { parseCustomEvalSetContract } from "./custom-evals";
import { runDeterministicEval } from "./eval-engine";
import { stableHash, stableStringify } from "./hash";
import type { EvalResult, GateResult, JsonValue } from "./types";
import type {
  PrepareProvidedOutputRunRecordInput, ProvidedOutputDatasetRow, ProvidedOutputDatasetSnapshot,
  ProvidedOutputExecution, ProvidedOutputJsonField, ProvidedOutputRunDraft, ProvidedOutputRunPlan,
  ProvidedOutputRunRecord, ProvidedOutputRunRequest, ProvidedOutputSavedEvalSet, ResolveProvidedOutputRunInput
} from "./provided-output-types";
export type * from "./provided-output-types";

export const PROVIDED_OUTPUT_LIMITS = Object.freeze({
  rows: 100, outputBytes: 65_536, totalOutputBytes: 1_048_576,
  datasetBytes: 1_048_576, requestBytes: 2_097_152, recordBytes: 8_388_608,
  identifierBytes: 512, jsonDepth: 32, jsonNodes: 150_000
});

export class ProvidedOutputRunError extends Error {
  readonly code: string;
  readonly status: 422 | 409;
  constructor(code: string = "provided_output_invalid", status: 422 | 409 = 422) {
    super(code);
    this.name = "ProvidedOutputRunError";
    this.code = code;
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();
const bytes = (value: string): number => encoder.encode(value).byteLength;
const hash = (value: unknown): string => stableHash(value, 64);
const invalid = (code = "provided_output_invalid"): never => { throw new ProvidedOutputRunError(code); };

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

/** Copy only bounded JSON data properties; never invoke caller getters or toJSON. */
function snapshot(value: unknown, envelope = false): JsonValue {
  let nodes = 0, textBytes = 0;
  // A plan repeats source inputs in samples; the record also wraps that plan.
  // Domain parsers below still apply their original depth/node limits independently.
  const nodeLimit = envelope ? 500_000 : PROVIDED_OUTPUT_LIMITS.jsonNodes;
  const depthLimit = envelope ? 40 : PROVIDED_OUTPUT_LIMITS.jsonDepth;
  const ancestors = new Set<object>();
  function copy(item: unknown, depth: number): JsonValue {
    if (++nodes > nodeLimit || depth > depthLimit) return invalid();
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") return Number.isFinite(item) ? (item === 0 ? 0 : item) : invalid();
    if (typeof item === "string") {
      if (!validText(item) || (textBytes += bytes(item)) > 16_777_216) return invalid();
      return item;
    }
    if (!item || typeof item !== "object" || ancestors.has(item)) return invalid();
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return invalid();
    const descriptors = Object.getOwnPropertyDescriptors(item as object);
    const keys = Reflect.ownKeys(descriptors).filter(key => !(array && key === "length"));
    if (keys.some(key => typeof key !== "string") || keys.length > 100_000
      || array && (descriptors.length?.value !== keys.length || keys.some((key, index) => key !== String(index)))) return invalid();
    const result: JsonValue[] | Record<string, JsonValue> = array ? [] : Object.create(null);
    ancestors.add(item);
    try {
      for (const key of keys) {
        const descriptor = descriptors[key as string];
        if (!descriptor?.enumerable || !("value" in descriptor) || !validText(key as string)) return invalid();
        Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true, configurable: true, writable: true });
      }
    } finally { ancestors.delete(item); }
    return result;
  }
  try {
    const result = copy(value, 0);
    if (bytes(stableStringify(result)) > PROVIDED_OUTPUT_LIMITS.recordBytes) return invalid();
    return result;
  } catch { return invalid(); }
}

function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const result = value as Record<string, unknown>;
  if (keys && (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key)))) return invalid();
  return result;
}

function text(value: unknown, maximum = 512, nonblank = true): string {
  if (typeof value !== "string" || !validText(value) || bytes(value) > maximum || nonblank && !value.trim()) return invalid();
  return value;
}

function uuid(value: unknown): string {
  return typeof value === "string" && UUID.test(value) ? value : invalid();
}

function digest(value: unknown): string {
  return typeof value === "string" && HASH.test(value) ? value : invalid();
}

function integer(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 2_147_483_647 ? value : invalid();
}

function compareUtf8(left: string, right: string): number {
  const a = encoder.encode(left), b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export function prepareProvidedOutputRunDraft(value: unknown): ProvidedOutputRunDraft {
  const source = object(snapshot(value), ["schemaVersion", "runId", "datasetVersionId", "evalSetVersionId", "outputs"]);
  if (source.schemaVersion !== "provided-output-run-draft-v1" || !Array.isArray(source.outputs)
    || !source.outputs.length || source.outputs.length > PROVIDED_OUTPUT_LIMITS.rows) return invalid();
  let outputBytes = 0;
  const seen = new Set<string>();
  const outputs = source.outputs.map(raw => {
    const row = object(raw, ["rowId", "output"]), rowId = text(row.rowId);
    const output = text(row.output, PROVIDED_OUTPUT_LIMITS.outputBytes, false);
    if (seen.has(rowId) || (outputBytes += bytes(output)) > PROVIDED_OUTPUT_LIMITS.totalOutputBytes) return invalid("provided_output_coverage_invalid");
    seen.add(rowId);
    return { rowId, output };
  }).sort((a, b) => compareUtf8(a.rowId, b.rowId));
  return {
    schemaVersion: "provided-output-run-draft-v1", runId: uuid(source.runId),
    datasetVersionId: text(source.datasetVersionId), evalSetVersionId: uuid(source.evalSetVersionId), outputs
  };
}

export function prepareProvidedOutputRunRequest(value: unknown): ProvidedOutputRunRequest {
  const source = object(snapshot(value), ["schemaVersion", "draft", "expectedPlanFingerprint"]);
  if (source.schemaVersion !== "provided-output-run-request-v1") return invalid();
  const result: ProvidedOutputRunRequest = {
    schemaVersion: "provided-output-run-request-v1", draft: prepareProvidedOutputRunDraft(source.draft),
    expectedPlanFingerprint: digest(source.expectedPlanFingerprint)
  };
  if (bytes(stableStringify(result)) > PROVIDED_OUTPUT_LIMITS.requestBytes) return invalid();
  return result;
}

export function providedOutputStorageIds(workspaceId: string, publicRunId: string): { planId: string; runId: string } {
  const identity = hash({ workspaceId: text(workspaceId), runId: uuid(publicRunId) });
  return { planId: `provided_output_plan_${identity}`, runId: `provided_output_run_${identity}` };
}

export function providedOutputRequestFingerprint(workspaceId: string, value: unknown): string {
  return hash({ schemaVersion: "provided-output-request-fingerprint-v1", workspaceId: text(workspaceId), request: prepareProvidedOutputRunRequest(value) });
}

function nullableJson(value: unknown): ProvidedOutputJsonField {
  const field = object(value, ["present", "value"]);
  if (typeof field.present !== "boolean" || !field.present && field.value !== null) return invalid();
  return { present: field.present, value: field.value as JsonValue };
}

export function parseProvidedOutputDatasetSnapshot(value: unknown): ProvidedOutputDatasetSnapshot {
  const source = object(snapshot(value), ["dataset", "version", "rows"]);
  const dataset = object(source.dataset, ["id", "name", "kind"]);
  const version = object(source.version, ["id", "datasetId", "version", "fingerprint", "createdAt"]);
  const createdAt = text(version.createdAt, 64);
  if (!Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt
    || !Array.isArray(source.rows) || !source.rows.length || source.rows.length > PROVIDED_OUTPUT_LIMITS.rows) return invalid("provided_output_dataset_invalid");
  const seenIds = new Set<string>(), seenKeys = new Set<string>();
  const rows: ProvidedOutputDatasetRow[] = source.rows.map(raw => {
    const row = object(raw, ["id", "rowKey", "input", "expectedOutput", "context", "history", "traceFixture", "metadata", "reviewStatus"]);
    const id = text(row.id), rowKey = text(row.rowKey, 4096);
    if (seenIds.has(id) || seenKeys.has(rowKey) || typeof row.reviewStatus !== "string"
      || !["synthetic", "reviewed", "golden"].includes(row.reviewStatus)) return invalid("provided_output_dataset_invalid");
    seenIds.add(id); seenKeys.add(rowKey);
    return {
      id, rowKey, input: row.input as JsonValue, expectedOutput: nullableJson(row.expectedOutput),
      context: nullableJson(row.context), history: nullableJson(row.history), traceFixture: nullableJson(row.traceFixture),
      metadata: object(row.metadata) as Record<string, JsonValue>, reviewStatus: row.reviewStatus as ProvidedOutputDatasetRow["reviewStatus"]
    };
  }).sort((a, b) => compareUtf8(a.rowKey, b.rowKey) || compareUtf8(a.id, b.id));
  const result: ProvidedOutputDatasetSnapshot = {
    dataset: { id: text(dataset.id), name: text(dataset.name, 4096), kind: text(dataset.kind, 256) },
    version: { id: text(version.id), datasetId: text(version.datasetId), version: integer(version.version), fingerprint: text(version.fingerprint, 256), createdAt }, rows
  };
  if (result.dataset.id !== result.version.datasetId || bytes(stableStringify(result)) > PROVIDED_OUTPUT_LIMITS.datasetBytes) return invalid("provided_output_dataset_invalid");
  return result;
}

export function parseProvidedOutputEvalSetSource(value: unknown): ProvidedOutputSavedEvalSet {
  const source = object(snapshot(value), ["contract", "members"]);
  let contract: ProvidedOutputSavedEvalSet["contract"];
  try { contract = parseCustomEvalSetContract(source.contract); } catch { return invalid("provided_output_eval_set_invalid"); }
  if (!Array.isArray(source.members) || source.members.length !== contract.itemVersions.length) return invalid("provided_output_eval_set_invalid");
  const members = source.members.map((raw, index) => {
    const proof = object(raw, ["evalSetVersionId", "evalItemVersionId", "position", "weight", "criticality", "itemFingerprint"]);
    const pinned = contract.itemVersions[index];
    if (proof.evalSetVersionId !== contract.id || proof.evalItemVersionId !== pinned.item.id || proof.position !== index
      || proof.weight !== pinned.weight || proof.criticality !== pinned.criticality || proof.itemFingerprint !== pinned.item.fingerprint
      || pinned.item.type !== "string_check") return invalid("provided_output_eval_set_invalid");
    return {
      evalSetVersionId: contract.id, evalItemVersionId: pinned.item.id, position: index,
      weight: pinned.weight, criticality: "critical" as const, itemFingerprint: pinned.item.fingerprint
    };
  });
  return { contract, members };
}

export function resolveProvidedOutputRun(input: ResolveProvidedOutputRunInput): ProvidedOutputRunPlan {
  const workspaceId = text(input.workspaceId), draft = prepareProvidedOutputRunDraft(input.draft);
  const dataset = parseProvidedOutputDatasetSnapshot(input.dataset), evalSet = parseProvidedOutputEvalSetSource(input.evalSet);
  if (dataset.version.id !== draft.datasetVersionId || evalSet.contract.id !== draft.evalSetVersionId) return invalid("provided_output_source_mismatch");
  const outputs = new Map(draft.outputs.map(row => [row.rowId, row.output]));
  if (dataset.rows.length !== outputs.size || dataset.rows.some(row => !outputs.has(row.id))) return invalid("provided_output_coverage_invalid");
  const ids = providedOutputStorageIds(workspaceId, draft.runId);
  const rowFingerprints = dataset.rows.map(row => ({ rowId: row.id, fingerprint: hash({ schemaVersion: "provided-output-dataset-row-v1", datasetVersionId: dataset.version.id, row }) }));
  const samples = dataset.rows.map((row, rowIndex) => {
    const output = outputs.get(row.id)!;
    return {
      rowId: row.id, rowIndex, sourceId: row.id, sourceKind: "saved_dataset", datasetRowId: row.id,
      datasetRowFingerprint: rowFingerprints[rowIndex].fingerprint,
      snapshotHash: hash({ source: rowFingerprints[rowIndex].fingerprint, output }), input: row.input, output
    };
  });
  const manifestBase = {
    schemaVersion: "provided-output-sample-manifest-v1" as const, rows: samples,
    ordering: "utf8_row_key_then_id" as const, inclusionPolicy: "all_rows" as const, duplicatePolicy: "reject" as const
  };
  const base: Omit<ProvidedOutputRunPlan, "fingerprint"> = {
    schemaVersion: "provided-output-run-v1", id: ids.planId, runId: ids.runId, publicRunId: draft.runId,
    workspaceId, draft, dataset, datasetFingerprint: hash(dataset), rowFingerprints, evalSet,
    target: { kind: "provided_output", version: "provided-output-target-v1", fingerprint: hash({ schemaVersion: "provided-output-target-v1", outputs: draft.outputs }) },
    sampleManifest: { ...manifestBase, fingerprint: hash(manifestBase) },
    policy: { schemaVersion: "provided-output-policy-v1", evaluator: "case_insensitive_contains_v1", expectedOutputVisibility: "visible", maxTargetCalls: 0, maxJudgeCalls: 0 }
  };
  const result = { ...base, fingerprint: hash(base) };
  if (bytes(stableStringify(result)) > PROVIDED_OUTPUT_LIMITS.recordBytes) return invalid("provided_output_plan_invalid");
  return result;
}

export function parseProvidedOutputRunPlan(value: unknown): ProvidedOutputRunPlan {
  const source = object(snapshot(value, true));
  if (source.schemaVersion !== "provided-output-run-v1") return invalid("provided_output_plan_invalid");
  const rebuilt = resolveProvidedOutputRun({ workspaceId: source.workspaceId as string, draft: source.draft, dataset: source.dataset, evalSet: source.evalSet as ResolveProvidedOutputRunInput["evalSet"] });
  if (stableStringify(source) !== stableStringify(rebuilt)) return invalid("provided_output_plan_invalid");
  return rebuilt;
}

function resultId(plan: ProvidedOutputRunPlan, rowId: string, itemVersionId: string): string {
  return `provided_output_result_${hash({ runId: plan.runId, rowId, itemVersionId })}`;
}

/** Results are joined by both immutable sample and member identity, never position. */
export function validateProvidedOutputResults(planValue: unknown, value: unknown): EvalResult[] {
  const plan = parseProvidedOutputRunPlan(planValue), raw = snapshot(value);
  if (!Array.isArray(raw)) return invalid("provided_output_results_invalid");
  const expected = new Set(plan.sampleManifest.rows.flatMap(row => plan.evalSet.contract.itemVersions.map(member => stableStringify([row.rowId, member.item.id]))));
  for (const item of raw) {
    const result = object(item), key = stableStringify([result.rowId, result.evalItemVersionId]);
    if (!expected.delete(key)) return invalid("provided_output_results_invalid");
  }
  if (expected.size) return invalid("provided_output_results_invalid");
  const canonical = executeCanonical(plan).results;
  const byIdentity = new Map<string, Record<string, unknown>>(raw.map(item => {
    const result = object(item);
    return [stableStringify([result.rowId, result.evalItemVersionId]), result] as const;
  }));
  if (canonical.some(result => stableStringify(result) !== stableStringify(byIdentity.get(stableStringify([result.rowId, result.evalItemVersionId]))))) return invalid("provided_output_results_invalid");
  return canonical;
}

function executeCanonical(plan: ProvidedOutputRunPlan): ProvidedOutputExecution {
  const results: EvalResult[] = [];
  for (const sample of plan.sampleManifest.rows) {
    for (const member of plan.evalSet.contract.itemVersions) {
      const result = runDeterministicEval(member.item, sample);
      results.push({
        ...result, id: resultId(plan, sample.rowId, member.item.id),
        conciseRationale: "Case-insensitive configured-text check of the explicitly supplied actual output.",
        evidenceRefs: [`dataset-version:${plan.dataset.version.id}`, `dataset-row:${sample.datasetRowId}`, `eval-set-version:${plan.evalSet.contract.id}`],
        evaluatorVersion: member.item.fingerprint, provider: "local", model: "deterministic-string-check-v1"
      });
    }
  }
  // Keep the same completeness invariant even if a future supported contract has more members.
  const cells = new Set(results.map(result => stableStringify([result.rowId, result.evalItemVersionId])));
  if (cells.size !== results.length || results.length !== plan.sampleManifest.rows.length * plan.evalSet.contract.itemVersions.length) return invalid("provided_output_results_invalid");
  const gates = buildGates(plan, results);
  const base: Omit<ProvidedOutputExecution, "fingerprint"> = { schemaVersion: "provided-output-execution-v1", planFingerprint: plan.fingerprint, results, gates };
  const result = { ...base, fingerprint: hash(base) };
  if (bytes(stableStringify(result)) > PROVIDED_OUTPUT_LIMITS.recordBytes) return invalid("provided_output_record_invalid");
  return result;
}

function buildGates(plan: ProvidedOutputRunPlan, results: EvalResult[]): GateResult[] {
  const gates: GateResult[] = [], contract = plan.evalSet.contract;
  function gate(level: GateResult["level"], scopeId: string, score: number, passed: boolean, reasons: string[], sources: string[], formula: string, critical: string[] = []): GateResult {
    const base: Omit<GateResult, "fingerprint"> = {
      id: `provided_output_gate_${hash({ runId: plan.runId, level, scopeId })}`, runId: plan.runId, level, scopeId,
      score, passed, decision: passed ? "pass" : critical.length ? "hard_fail" : "soft_fail",
      thresholdVersion: contract.fingerprint, formula, reasons, failedCriticalComponents: critical, sourceResultIds: sources
    };
    const result = { ...base, fingerprint: hash(base) };
    gates.push(result);
    return result;
  }
  const rowGates: GateResult[] = [];
  for (const sample of plan.sampleManifest.rows) {
    const items: GateResult[] = [];
    for (const member of contract.itemVersions) {
      const result = results.find(result => result.rowId === sample.rowId && result.evalItemVersionId === member.item.id)!;
      const fields = result.fields.map(field => {
        const passed = field.passed === true && field.decision === "pass";
        const component = stableStringify([sample.rowId, member.item.id, field.key]);
        return gate("field", component, passed ? 100 : 0, passed, passed ? [] : ["contains_expected_failed"], [result.id], "configured text is contained in supplied actual output (case-insensitive)", passed ? [] : [component]);
      });
      const passed = fields.every(field => field.passed), critical = fields.flatMap(field => field.failedCriticalComponents);
      items.push(gate("item_row", stableStringify([sample.rowId, member.item.id]), passed ? 100 : 0, passed, passed ? [] : ["item_field_failed"], fields.map(field => field.id), "all gating fields pass", critical));
    }
    const passed = items.every(item => item.passed), critical = items.flatMap(item => item.failedCriticalComponents);
    rowGates.push(gate("row", sample.rowId, passed ? 100 : 0, passed, passed ? [] : ["row_item_failed"], items.map(item => item.id), "all pinned critical items pass; row threshold = 100", critical));
  }
  const passRate = rowGates.filter(row => row.passed).length / rowGates.length * 100;
  const datasetPassed = passRate >= contract.gates.datasetPassRateThreshold;
  const datasetGate = gate("dataset", plan.dataset.version.id, passRate, datasetPassed, datasetPassed ? [] : ["dataset_pass_rate"], rowGates.map(row => row.id), `passed rows / all rows * 100 >= ${contract.gates.datasetPassRateThreshold}`);
  const critical = rowGates.flatMap(row => row.failedCriticalComponents);
  const setPassed = datasetPassed && passRate >= contract.gates.evalSetThreshold && critical.length === 0;
  const setGate = gate("eval_set", contract.id, passRate, setPassed, setPassed ? [] : ["eval_set_threshold_or_critical_failure"], [datasetGate.id, ...rowGates.map(row => row.id)], "dataset passes AND eval set threshold passes AND no critical failures", critical);
  const targetGate = gate("target", `provided_output_target_${plan.target.fingerprint}`, passRate, setPassed, setPassed ? [] : ["provided_target_eval_set_failed"], [setGate.id], "all pinned eval sets pass for the supplied-output snapshot", critical);
  const criticalityGate = gate("criticality", "critical", passRate, critical.length === 0, critical.length ? ["critical_check_failed"] : [], rowGates.map(row => row.id), "no critical component fails", critical);
  const runPassed = setPassed && targetGate.passed && criticalityGate.passed && passRate >= contract.gates.runThreshold;
  gate("run", plan.runId, passRate, runPassed, runPassed ? [] : ["run_gate_failed"], [datasetGate.id, setGate.id, targetGate.id, criticalityGate.id], "dataset, eval set, target, criticality and run threshold all pass", critical);
  return gates;
}

export function executeProvidedOutputRun(value: unknown): ProvidedOutputExecution {
  return executeCanonical(parseProvidedOutputRunPlan(value));
}

export function prepareProvidedOutputRunRecord(input: PrepareProvidedOutputRunRecordInput): ProvidedOutputRunRecord {
  const workspaceId = text(input.workspaceId), request = prepareProvidedOutputRunRequest(input.request);
  const plan = resolveProvidedOutputRun({ workspaceId, draft: request.draft, dataset: input.dataset, evalSet: input.evalSet });
  if (request.expectedPlanFingerprint !== plan.fingerprint) throw new ProvidedOutputRunError("provided_output_preview_changed", 409);
  const base: Omit<ProvidedOutputRunRecord, "fingerprint"> = {
    schemaVersion: "provided-output-run-record-v1", workspaceId,
    requestFingerprint: providedOutputRequestFingerprint(workspaceId, request), plan, execution: executeCanonical(plan)
  };
  const result = { ...base, fingerprint: hash(base) };
  if (bytes(stableStringify(result)) > PROVIDED_OUTPUT_LIMITS.recordBytes) return invalid("provided_output_record_invalid");
  return result;
}

export function parseProvidedOutputRunRecord(value: unknown): ProvidedOutputRunRecord {
  const source = object(snapshot(value, true), ["schemaVersion", "workspaceId", "requestFingerprint", "plan", "execution", "fingerprint"]);
  if (source.schemaVersion !== "provided-output-run-record-v1") return invalid("provided_output_record_invalid");
  const plan = parseProvidedOutputRunPlan(source.plan);
  if (source.workspaceId !== plan.workspaceId) return invalid("provided_output_record_invalid");
  const rebuilt = prepareProvidedOutputRunRecord({
    workspaceId: plan.workspaceId,
    request: { schemaVersion: "provided-output-run-request-v1", draft: plan.draft, expectedPlanFingerprint: plan.fingerprint },
    dataset: plan.dataset, evalSet: plan.evalSet
  });
  if (stableStringify(source) !== stableStringify(rebuilt)) return invalid("provided_output_record_invalid");
  return rebuilt;
}

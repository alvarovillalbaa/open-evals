import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getCustomEvalSetVersion, type SavedCustomEvalVersion } from "./custom-evals";
import { isDatabaseUnavailable, queryRows, withTransaction } from "./service";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface ProvidedOutputDraft {
  schemaVersion: "provided-output-run-draft-v1";
  runId: string; datasetVersionId: string; evalSetVersionId: string;
  outputs: Array<{ rowId: string; output: string }>;
}
export interface ProvidedOutputRequest {
  schemaVersion: "provided-output-run-request-v1";
  draft: ProvidedOutputDraft; expectedPlanFingerprint: string;
}
export interface ProvidedOutputDatasetSnapshot {
  dataset: { id: string; name: string; kind: string };
  version: { id: string; datasetId: string; version: number; fingerprint: string; createdAt: string };
  rows: Array<{ id: string; rowKey: string; input: Json; metadata: { [key: string]: Json };
    expectedOutput: { present: boolean; value: Json }; context: { present: boolean; value: Json };
    history: { present: boolean; value: Json }; traceFixture: { present: boolean; value: Json };
    reviewStatus: "synthetic" | "reviewed" | "golden" }>;
}
export interface ProvidedOutputInputs { dataset: ProvidedOutputDatasetSnapshot; evalSet: SavedCustomEvalVersion }

/** Structural boundary only: the trusted core callback owns the complete versioned record. */
export interface ProvidedOutputRecord {
  schemaVersion: "provided-output-run-record-v1"; workspaceId: string; requestFingerprint: string;
  plan: { id: string; runId: string; publicRunId: string; workspaceId: string; fingerprint: string;
    draft: ProvidedOutputDraft; dataset: ProvidedOutputDatasetSnapshot;
    evalSet: { contract: unknown; members: SavedCustomEvalVersion["members"] };
    sampleManifest: { rows: Array<{ rowId: string; sourceKind: string; snapshotHash: string; datasetRowId: string; output: string }> } };
  execution: { planFingerprint: string; results: unknown[]; gates: unknown[]; fingerprint: string };
  fingerprint: string;
}
export interface ProvidedOutputCallbacks<T extends ProvidedOutputRecord> {
  prepare(input: { workspaceId: string; request: ProvidedOutputRequest; dataset: ProvidedOutputDatasetSnapshot; evalSet: SavedCustomEvalVersion }): T;
  validateRecord(value: unknown): T;
}
export class ProvidedOutputStoreError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); this.name = "ProvidedOutputStoreError"; }
}

const PROFILE = "provided-output-run-record-v1";
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
const SNAPSHOT_LIMIT = 1024 * 1024;
const RECORD_LIMIT = 8 * 1024 * 1024;
const keyFor = (runId: string) => `provided-output-run-v1:${runId}`;
const order = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
function fail(status: number, code: string): never { throw new ProvidedOutputStoreError(status, code); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(409, "provided_output_storage_conflict");
  return value as Record<string, unknown>;
}
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
}
const hash = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
function withoutFingerprint(value: unknown) {
  return Object.fromEntries(Object.entries(object(value)).filter(([key]) => key !== "fingerprint"));
}
function same(a: unknown, b: unknown) { return stable(a) === stable(b); }
function text(value: unknown, maximum = RECORD_LIMIT): asserts value is string {
  if (typeof value !== "string" || Buffer.byteLength(value) > maximum || value.includes("\0")) fail(422, "provided_output_invalid");
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail(422, "provided_output_invalid");
    } else if (unit >= 0xdc00 && unit <= 0xdfff) fail(422, "provided_output_invalid");
  }
}
function identifier(value: unknown): asserts value is string {
  text(value, 512);
  if (!value.trim().length) fail(422, "provided_output_invalid");
}
function uuid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) fail(422, "provided_output_invalid");
}
function keys(value: Record<string, unknown>, expected: string[]) {
  if (!same(Object.keys(value).sort(), [...expected].sort())) fail(422, "provided_output_invalid");
}
function requestObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(422, "provided_output_invalid");
  return value as Record<string, unknown>;
}
/** Refuse getters, hidden data, cycles and exotic objects before calling trusted validators. */
function boundedJson(value: unknown, maximum = RECORD_LIMIT): void {
  const path = new Set<object>(); let nodes = 0;
  const dataset = maximum === SNAPSHOT_LIMIT;
  function walk(item: unknown, depth: number) {
    if (++nodes > (dataset ? 150_000 : 500_000) || depth > (dataset ? 32 : 40)) fail(422, "provided_output_invalid");
    if (typeof item === "string") { text(item, maximum); return; }
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (!item || typeof item !== "object" || path.has(item)) fail(422, "provided_output_invalid");
    const array = Array.isArray(item), proto = Object.getPrototypeOf(item);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail(422, "provided_output_invalid");
    const descriptors = Object.getOwnPropertyDescriptors(item as object);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string")) fail(422, "provided_output_invalid");
    path.add(item);
    const names = Object.keys(descriptors);
    if (names.length - (array ? 1 : 0) > 100_000) fail(422, "provided_output_invalid");
    if (array) {
      if (names.length !== (item as unknown[]).length + 1 || !descriptors.length || descriptors.length.value !== (item as unknown[]).length) fail(422, "provided_output_invalid");
      for (let i = 0; i < (item as unknown[]).length; i++) {
        const descriptor = descriptors[String(i)];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail(422, "provided_output_invalid");
        walk(descriptor.value, depth + 1);
      }
    } else for (const key of names) {
      text(key, maximum); const descriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor)) fail(422, "provided_output_invalid");
      walk(descriptor.value, depth + 1);
    }
    path.delete(item);
  }
  try { walk(value, 0); if (Buffer.byteLength(stable(value)) > maximum) fail(422, "provided_output_invalid"); }
  catch (error) { if (error instanceof ProvidedOutputStoreError) throw error; fail(422, "provided_output_invalid"); }
}
function request(value: unknown): ProvidedOutputRequest {
  boundedJson(value, 2 * 1024 * 1024);
  const root = requestObject(value); keys(root, ["schemaVersion", "draft", "expectedPlanFingerprint"]);
  if (root.schemaVersion !== "provided-output-run-request-v1" || typeof root.expectedPlanFingerprint !== "string" || !HEX.test(root.expectedPlanFingerprint)) fail(422, "provided_output_invalid");
  const draft = requestObject(root.draft); keys(draft, ["schemaVersion", "runId", "datasetVersionId", "evalSetVersionId", "outputs"]);
  if (draft.schemaVersion !== "provided-output-run-draft-v1") fail(422, "provided_output_invalid");
  uuid(draft.runId); identifier(draft.datasetVersionId); uuid(draft.evalSetVersionId);
  if (!Array.isArray(draft.outputs) || !draft.outputs.length || draft.outputs.length > 100) fail(422, "provided_output_invalid");
  const seen = new Set<string>(); let size = 0;
  const outputs = draft.outputs.map(item => {
    const row = requestObject(item); keys(row, ["rowId", "output"]); identifier(row.rowId); text(row.output, 65536);
    if (seen.has(row.rowId)) fail(422, "provided_output_invalid");
    seen.add(row.rowId); size += Buffer.byteLength(row.output);
    return { rowId: row.rowId, output: row.output };
  }).sort((a, b) => order(a.rowId, b.rowId));
  if (size > SNAPSHOT_LIMIT) fail(422, "provided_output_invalid");
  return { schemaVersion: "provided-output-run-request-v1", expectedPlanFingerprint: root.expectedPlanFingerprint,
    draft: { schemaVersion: "provided-output-run-draft-v1", runId: draft.runId, datasetVersionId: draft.datasetVersionId, evalSetVersionId: draft.evalSetVersionId, outputs } };
}
function identities(workspaceId: string, publicRunId: string) {
  const identity = hash({ workspaceId, runId: publicRunId });
  return { planId: `provided_output_plan_${identity}`, runId: `provided_output_run_${identity}` };
}
function requestFingerprint(workspaceId: string, value: ProvidedOutputRequest) {
  return hash({ schemaVersion: "provided-output-request-fingerprint-v1", workspaceId, request: value });
}
async function operation<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (isDatabaseUnavailable(error)) throw error;
    if (error && typeof error === "object" && "code" in error && ["23505", "23503", "40001", "40P01"].includes(String(error.code))) fail(409, "provided_output_storage_conflict");
    throw error;
  }
}
async function workspace(client: PoolClient, workspaceId: string) {
  identifier(workspaceId);
  if (!(await client.query("select id from workspaces where id = $1 for update", [workspaceId])).rows.length) fail(404, "provided_output_not_found");
}

interface DatasetHead { datasetId: string; name: string; kind: string; id: string; version: number; fingerprint: string; createdAt: Date | string }
interface RawRow { id: string; rowKey: string; input: string; expectedOutput: string | null; context: string | null;
  history: string | null; traceFixture: string | null; metadata: string; reviewStatus: string }
async function inputs(client: PoolClient, workspaceId: string, selection: { datasetVersionId: string; evalSetVersionId: string }): Promise<ProvidedOutputInputs | undefined> {
  identifier(selection.datasetVersionId); uuid(selection.evalSetVersionId);
  const head = (await client.query<DatasetHead>(`select d.id as "datasetId", d.name, d.kind, v.id, v.version, v.fingerprint, v.created_at as "createdAt"
    from dataset_versions v join datasets d on d.id = v.dataset_id
    where d.workspace_id = $1 and v.id = $2 for update of v, d`, [workspaceId, selection.datasetVersionId])).rows[0];
  if (!head) return undefined;
  // An UPDATE lock on the FK parent also blocks new row inserts while this snapshot is prepared.
  const locked = (await client.query<{ id: string }>(`select id from dataset_rows where dataset_version_id = $1
    order by row_key collate "C", id collate "C" limit 101 for share`, [head.id])).rows;
  if (!locked.length || locked.length > 100) fail(422, "provided_output_dataset_size");
  const size = (await client.query<{ bytes: string }>(`select coalesce(sum(octet_length(id) + octet_length(row_key)
    + octet_length(input::text) + coalesce(octet_length(expected_output::text), 0) + coalesce(octet_length(context::text), 0)
    + coalesce(octet_length(history::text), 0) + coalesce(octet_length(trace_fixture::text), 0)
    + octet_length(metadata::text) + octet_length(review_status)), 0)::text as bytes
    from dataset_rows where dataset_version_id = $1`, [head.id])).rows[0];
  // JSONB text contains formatting spaces; only the parsed canonical snapshot has the exact 1 MiB limit.
  if (!size || BigInt(size.bytes) > BigInt(2 * SNAPSHOT_LIMIT)) fail(422, "provided_output_dataset_size");
  const rawRows = (await client.query<RawRow>(`select id, row_key as "rowKey", input::text, expected_output::text as "expectedOutput",
    context::text, history::text, trace_fixture::text as "traceFixture", metadata::text, review_status as "reviewStatus"
    from dataset_rows where dataset_version_id = $1 order by row_key collate "C", id collate "C"`, [head.id])).rows;
  if (rawRows.length !== locked.length) fail(409, "provided_output_storage_conflict");
  const field = (value: string | null) => ({ present: value !== null, value: value === null ? null : JSON.parse(value) as Json });
  const rows = rawRows.map(row => ({ id: row.id, rowKey: row.rowKey, input: JSON.parse(row.input) as Json,
    expectedOutput: field(row.expectedOutput), context: field(row.context), history: field(row.history), traceFixture: field(row.traceFixture),
    metadata: JSON.parse(row.metadata) as { [key: string]: Json }, reviewStatus: row.reviewStatus as "synthetic" | "reviewed" | "golden" }));
  // Refuse JSON numbers that the pg/JavaScript boundary cannot represent without changing stored JSONB values.
  const roundTrips = rows.map(row => ({ id: row.id, input: JSON.stringify(row.input), expected_output: row.expectedOutput.present ? JSON.stringify(row.expectedOutput.value) : null,
    context: row.context.present ? JSON.stringify(row.context.value) : null, history: row.history.present ? JSON.stringify(row.history.value) : null,
    trace_fixture: row.traceFixture.present ? JSON.stringify(row.traceFixture.value) : null, metadata: JSON.stringify(row.metadata) }));
  const exact = (await client.query<{ count: number }>(`select count(*)::int as count from dataset_rows r
    join jsonb_to_recordset($2::jsonb) as x(id text, input text, expected_output text, context text, history text, trace_fixture text, metadata text)
      on x.id = r.id where r.dataset_version_id = $1 and r.input is not distinct from x.input::jsonb
      and r.expected_output is not distinct from x.expected_output::jsonb and r.context is not distinct from x.context::jsonb
      and r.history is not distinct from x.history::jsonb and r.trace_fixture is not distinct from x.trace_fixture::jsonb
      and r.metadata is not distinct from x.metadata::jsonb`, [head.id, JSON.stringify(roundTrips)])).rows[0];
  if (exact?.count !== rows.length) fail(422, "provided_output_dataset_precision");
  const dataset: ProvidedOutputDatasetSnapshot = { dataset: { id: head.datasetId, name: head.name, kind: head.kind },
    version: { id: head.id, datasetId: head.datasetId, version: head.version, fingerprint: head.fingerprint,
      createdAt: head.createdAt instanceof Date ? head.createdAt.toISOString() : new Date(head.createdAt).toISOString() }, rows };
  boundedJson(dataset, SNAPSHOT_LIMIT);
  if (rows.some(row => !["synthetic", "reviewed", "golden"].includes(row.reviewStatus))) fail(422, "provided_output_dataset_invalid");
  const evalSet = await getCustomEvalSetVersion(workspaceId, selection.evalSetVersionId, client);
  return evalSet ? { dataset, evalSet } : undefined;
}

export async function getProvidedOutputInputs(workspaceId: string, selection: { datasetVersionId: string; evalSetVersionId: string }): Promise<ProvidedOutputInputs | undefined> {
  identifier(workspaceId); identifier(selection.datasetVersionId); uuid(selection.evalSetVersionId);
  const selected = { datasetVersionId: selection.datasetVersionId, evalSetVersionId: selection.evalSetVersionId };
  return operation(() => withTransaction(async client => { await workspace(client, workspaceId); return inputs(client, workspaceId, selected); }));
}
export async function listProvidedOutputSources(workspaceId: string) {
  identifier(workspaceId);
  const [datasets, evalSets] = await Promise.all([
    queryRows<{ datasetId: string; name: string; kind: string; versionId: string; version: number; fingerprint: string }>(
      `select d.id as "datasetId", d.name, d.kind, v.id as "versionId", v.version, v.fingerprint
        from dataset_versions v join datasets d on d.id = v.dataset_id where d.workspace_id = $1
        order by v.created_at desc, v.id collate "C" desc limit 101`, [workspaceId]),
    queryRows<{ setId: string; name: string; versionId: string; version: number; fingerprint: string }>(
      `select s.id as "setId", v.contract ->> 'name' as name, v.id as "versionId", v.version, v.fingerprint
        from eval_set_versions v join eval_sets s on s.id = v.eval_set_id where s.workspace_id = $1
        and v.contract ->> 'schemaVersion' = 'custom-eval-set-v1' order by v.created_at desc, v.id collate "C" desc limit 101`, [workspaceId]),
  ]);
  for (const row of datasets) { identifier(row.datasetId); identifier(row.versionId); text(row.name, 4096); text(row.kind, 256); text(row.fingerprint, 256);
    if (!row.name.trim() || !row.kind.trim() || !row.fingerprint.trim() || !Number.isInteger(row.version) || row.version < 1) fail(409, "provided_output_storage_conflict"); }
  for (const row of evalSets) { uuid(row.setId); uuid(row.versionId); text(row.name, 4096); text(row.fingerprint, 256);
    if (!row.name.trim() || !row.fingerprint.trim() || !Number.isInteger(row.version) || row.version < 1) fail(409, "provided_output_storage_conflict"); }
  return { datasets: datasets.slice(0, 100), evalSets: evalSets.slice(0, 100), datasetsHasMore: datasets.length > 100, evalSetsHasMore: evalSets.length > 100 };
}

function canonical<T extends ProvidedOutputRecord>(value: unknown, workspaceId: string, validate: (value: unknown) => T): T {
  let record: T;
  try { boundedJson(value); record = validate(value); boundedJson(record); }
  catch { fail(409, "provided_output_storage_conflict"); }
  if (!same(value, record) || record.schemaVersion !== PROFILE || record.workspaceId !== workspaceId) fail(409, "provided_output_storage_conflict");
  const plan = record.plan, execution = record.execution;
  uuid(plan.publicRunId);
  const ids = identities(workspaceId, plan.publicRunId);
  if (plan.workspaceId !== workspaceId || plan.id !== ids.planId || plan.runId !== ids.runId
    || record.fingerprint !== hash(withoutFingerprint(record)) || plan.fingerprint !== hash(withoutFingerprint(plan))
    || execution.fingerprint !== hash(withoutFingerprint(execution)) || execution.planFingerprint !== plan.fingerprint) fail(409, "provided_output_storage_conflict");
  const req = request({ schemaVersion: "provided-output-run-request-v1", draft: plan.draft, expectedPlanFingerprint: plan.fingerprint });
  if (record.requestFingerprint !== requestFingerprint(workspaceId, req) || plan.publicRunId !== req.draft.runId
    || plan.dataset.version.id !== req.draft.datasetVersionId) fail(409, "provided_output_storage_conflict");
  const contract = object(plan.evalSet.contract);
  if (contract.id !== req.draft.evalSetVersionId || plan.sampleManifest.rows.length !== plan.dataset.rows.length) fail(409, "provided_output_storage_conflict");
  const outputMap = new Map(req.draft.outputs.map(row => [row.rowId, row.output]));
  const sampleIds = new Set<string>(), datasetIds = new Set(plan.dataset.rows.map(row => row.id));
  for (const sample of plan.sampleManifest.rows) {
    if (!datasetIds.has(sample.datasetRowId) || outputMap.get(sample.datasetRowId) !== sample.output || sampleIds.has(sample.rowId)) fail(409, "provided_output_storage_conflict");
    sampleIds.add(sample.rowId);
  }
  const itemIds = new Set(plan.evalSet.members.map(member => member.evalItemVersionId));
  const resultPairs = new Set<string>();
  for (const value of execution.results) {
    const result = object(value); identifier(result.id);
    const pair = stable([result.rowId, result.evalItemVersionId]);
    if (!sampleIds.has(String(result.rowId)) || !itemIds.has(String(result.evalItemVersionId)) || resultPairs.has(pair)) fail(409, "provided_output_storage_conflict");
    resultPairs.add(pair);
  }
  if (execution.results.length !== sampleIds.size * itemIds.size || !itemIds.size) fail(409, "provided_output_storage_conflict");
  return record;
}

interface PlanRow { id: string; workspaceId: string; fingerprint: string; value: unknown; createdAt: Date | string }
async function readStored<T extends ProvidedOutputRecord>(client: PoolClient, workspaceId: string, publicRunId: string,
  validate: (value: unknown) => T, expectedRequest?: string): Promise<T | undefined> {
  const ids = identities(workspaceId, publicRunId);
  const plans = (await client.query<PlanRow>(`select id, workspace_id as "workspaceId", fingerprint,
    case when octet_length(resolved_plan::text) <= $2 then resolved_plan else null end as value, created_at as "createdAt"
    from run_plans where id = $1 limit 2`, [ids.planId, 2 * RECORD_LIMIT])).rows;
  const runs = (await client.query<{ id: string; workspaceId: string; planId: string; status: string; key: string }>(
    `select id, workspace_id as "workspaceId", run_plan_id as "planId", status, idempotency_key as key
      from eval_runs where id = $1 or (workspace_id = $2 and idempotency_key = $3) or run_plan_id = $4 limit 2`,
    [ids.runId, workspaceId, keyFor(publicRunId), ids.planId])).rows;
  if (!plans.length && !runs.length) return undefined;
  if (plans.length !== 1 || runs.length !== 1) fail(409, "provided_output_storage_conflict");
  const plan = plans[0], run = runs[0];
  if (plan.workspaceId !== workspaceId || run.workspaceId !== workspaceId || run.id !== ids.runId || run.planId !== ids.planId
    || run.status !== "completed" || run.key !== keyFor(publicRunId)) fail(409, "provided_output_storage_conflict");
  const record = canonical(plan.value, workspaceId, validate);
  if (record.plan.publicRunId !== publicRunId || plan.fingerprint !== record.plan.fingerprint
    || expectedRequest !== undefined && record.requestFingerprint !== expectedRequest) fail(409, "provided_output_storage_conflict");
  await parity(client, record);
  return record;
}
async function parity(client: PoolClient, record: ProvidedOutputRecord) {
  const runId = record.plan.runId;
  const samples = (await client.query<{ id: string; rowId: string; sourceKind: string; snapshotHash: string; status: string }>(
    `select id, row_id as "rowId", source_kind as "sourceKind", snapshot_hash as "snapshotHash", status from run_samples where eval_run_id = $1 limit $2`,
    [runId, record.plan.sampleManifest.rows.length + 1])).rows;
  const expectedSamples = record.plan.sampleManifest.rows.map(row => ({ id: sampleId(runId, row.rowId), rowId: row.rowId,
    sourceKind: row.sourceKind, snapshotHash: row.snapshotHash, status: "completed" }));
  compareRows(samples, expectedSamples);
  const resultSize = (await client.query<{ bytes: string }>(`select coalesce(sum(octet_length(original_output::text) + octet_length(normalized_fields::text)), 0)::text as bytes
    from eval_results where eval_run_id = $1`, [runId])).rows[0];
  if (!resultSize || BigInt(resultSize.bytes) > BigInt(2 * RECORD_LIMIT)) fail(409, "provided_output_storage_conflict");
  const results = (await client.query(`select id, run_sample_id as "sampleId", eval_item_version_id as "itemId",
    original_output as output, normalized_fields as fields, error from eval_results where eval_run_id = $1 limit $2`,
    [runId, record.execution.results.length + 1])).rows;
  const expectedResults = record.execution.results.map(value => { const r = object(value); return { id: r.id,
    sampleId: sampleId(runId, String(r.rowId)), itemId: r.evalItemVersionId, output: r.originalOutput, fields: r.fields, error: r.error ?? null }; });
  compareRows(results, expectedResults);
  const gateSize = (await client.query<{ bytes: string }>(`select coalesce(sum(octet_length(reasons::text)), 0)::text as bytes
    from gate_results where eval_run_id = $1`, [runId])).rows[0];
  if (!gateSize || BigInt(gateSize.bytes) > BigInt(2 * RECORD_LIMIT)) fail(409, "provided_output_storage_conflict");
  const gates = (await client.query(`select id, level, scope_id as "scopeId", to_jsonb(score) as score,
    passed, decision, formula, reasons, fingerprint from gate_results where eval_run_id = $1 limit $2`, [runId, record.execution.gates.length + 1])).rows;
  const expectedGates = record.execution.gates.map(value => { const g = object(value); return { id: g.id, level: g.level,
    scopeId: g.scopeId, score: g.score ?? null, passed: g.passed, decision: g.decision, formula: g.formula, reasons: g.reasons, fingerprint: g.fingerprint }; });
  compareRows(gates, expectedGates);
  const audit = (await client.query(`select actor_user_id as actor, metadata_hash as fingerprint, metadata from audit_events
    where workspace_id = $1 and action = 'provided_output.run.saved' and resource_type = 'provided_output_run' and resource_id = $2 limit 2`, [record.workspaceId, runId])).rows;
  if (audit.length !== 1) fail(409, "provided_output_storage_conflict");
  identifier(audit[0].actor);
  if (!same(audit[0].metadata, auditMetadata(record)) || audit[0].fingerprint !== hash(auditMetadata(record))) fail(409, "provided_output_storage_conflict");
}
function sampleId(runId: string, rowId: string) { return `provided_output_sample_${hash({ runId, rowId })}`; }
function compareRows(actual: unknown[], expected: unknown[]) {
  boundedJson(actual);
  const sorted = (rows: unknown[]) => rows.map(stable).sort();
  if (!same(sorted(actual), sorted(expected))) fail(409, "provided_output_storage_conflict");
}
function auditMetadata(record: ProvidedOutputRecord) {
  return { publicRunId: record.plan.publicRunId, runId: record.plan.runId, planId: record.plan.id,
    requestFingerprint: record.requestFingerprint, planFingerprint: record.plan.fingerprint, recordFingerprint: record.fingerprint };
}

export async function saveProvidedOutputRun<T extends ProvidedOutputRecord>(scope: { workspaceId: string; actorId: string },
  rawRequest: unknown, callbacks: ProvidedOutputCallbacks<T>): Promise<{ record: T; replayed: boolean }> {
  identifier(scope.workspaceId); identifier(scope.actorId);
  if (typeof callbacks?.prepare !== "function" || typeof callbacks?.validateRecord !== "function") fail(422, "provided_output_callbacks_required");
  scope = { workspaceId: scope.workspaceId, actorId: scope.actorId };
  callbacks = { prepare: callbacks.prepare, validateRecord: callbacks.validateRecord };
  const req = request(rawRequest), expectedRequest = requestFingerprint(scope.workspaceId, req);
  return operation(() => withTransaction(async client => {
    await workspace(client, scope.workspaceId);
    const replay = await readStored(client, scope.workspaceId, req.draft.runId, callbacks.validateRecord, expectedRequest);
    if (replay) return { record: replay, replayed: true };
    const selected = await inputs(client, scope.workspaceId, req.draft);
    if (!selected) fail(404, "provided_output_not_found");
    const prepared = callbacks.prepare({ workspaceId: scope.workspaceId, request: req, ...selected });
    const record = canonical(prepared, scope.workspaceId, callbacks.validateRecord);
    if (record.requestFingerprint !== expectedRequest || !same(record.plan.draft, req.draft)
      || record.plan.fingerprint !== req.expectedPlanFingerprint || !same(record.plan.dataset, selected.dataset)
      || !same(record.plan.evalSet, selected.evalSet)) fail(409, "provided_output_preview_changed");
    const collisions = await client.query(`select id from run_plans where id = $1 or fingerprint = $2`, [record.plan.id, record.plan.fingerprint]);
    if (collisions.rows.length) fail(409, "provided_output_storage_conflict");
    await client.query(`insert into run_plans (id, workspace_id, resolved_plan, fingerprint) values ($1, $2, $3::jsonb, $4)`,
      [record.plan.id, scope.workspaceId, JSON.stringify(record), record.plan.fingerprint]);
    await client.query(`insert into eval_runs (id, workspace_id, run_plan_id, status, idempotency_key) values ($1, $2, $3, 'completed', $4)`,
      [record.plan.runId, scope.workspaceId, record.plan.id, keyFor(req.draft.runId)]);
    for (const row of record.plan.sampleManifest.rows) await client.query(
      `insert into run_samples (id, eval_run_id, row_id, source_kind, snapshot_hash, status) values ($1, $2, $3, $4, $5, 'completed')`,
      [sampleId(record.plan.runId, row.rowId), record.plan.runId, row.rowId, row.sourceKind, row.snapshotHash]);
    for (const value of record.execution.results) {
      const r = object(value);
      await client.query(`insert into eval_results (id, eval_run_id, run_sample_id, eval_item_version_id, original_output, normalized_fields, error)
        values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`, [r.id, record.plan.runId, sampleId(record.plan.runId, String(r.rowId)),
        r.evalItemVersionId, JSON.stringify(r.originalOutput), JSON.stringify(r.fields), r.error ?? null]);
    }
    for (const value of record.execution.gates) {
      const g = object(value);
      await client.query(`insert into gate_results (id, eval_run_id, level, scope_id, score, passed, decision, formula, reasons, fingerprint)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`, [g.id, record.plan.runId, g.level, g.scopeId, g.score ?? null,
        g.passed, g.decision, g.formula, JSON.stringify(g.reasons), g.fingerprint]);
    }
    const metadata = auditMetadata(record);
    await client.query(`insert into audit_events (id, workspace_id, actor_user_id, action, resource_type, resource_id, metadata_hash, metadata)
      values ($1, $2, $3, 'provided_output.run.saved', 'provided_output_run', $4, $5, $6::jsonb)`,
      [`audit_${randomUUID()}`, scope.workspaceId, scope.actorId, record.plan.runId, hash(metadata), JSON.stringify(metadata)]);
    await parity(client, record);
    return { record, replayed: false };
  }));
}
export async function getProvidedOutputRun<T extends ProvidedOutputRecord>(workspaceId: string, publicRunId: string,
  validateRecord: (value: unknown) => T): Promise<T | undefined> {
  identifier(workspaceId); uuid(publicRunId);
  return operation(() => withTransaction(async client => { await workspace(client, workspaceId); return readStored(client, workspaceId, publicRunId, validateRecord); }));
}
export async function listProvidedOutputRuns<T extends ProvidedOutputRecord>(workspaceId: string, validateRecord: (value: unknown) => T) {
  identifier(workspaceId);
  return operation(() => withTransaction(async client => {
    await workspace(client, workspaceId);
    const rows = (await client.query<{ id: string; publicRunId: string; createdAt: Date | string }>(
      `select id, resolved_plan #>> '{plan,publicRunId}' as "publicRunId", created_at as "createdAt"
      from run_plans where workspace_id = $1 and resolved_plan ->> 'schemaVersion' = $2 order by created_at desc, id desc limit 21`, [workspaceId, PROFILE])).rows;
    const runs = [];
    for (const row of rows.slice(0, 20)) {
      if (!UUID.test(row.publicRunId) || identities(workspaceId, row.publicRunId).planId !== row.id) fail(409, "provided_output_storage_conflict");
      const record = await readStored(client, workspaceId, row.publicRunId, validateRecord);
      if (!record) fail(409, "provided_output_storage_conflict");
      const runGate = record.execution.gates.map(object).find(gate => gate.level === "run");
      if (!runGate || typeof runGate.passed !== "boolean") fail(409, "provided_output_storage_conflict");
      runs.push({ runId: record.plan.publicRunId, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        planFingerprint: record.plan.fingerprint, rowCount: record.plan.sampleManifest.rows.length, passed: runGate.passed });
    }
    return { runs, hasMore: rows.length > 20 };
  }));
}

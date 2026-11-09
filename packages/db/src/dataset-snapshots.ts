import type { PoolClient } from "pg";

export type DatasetJson = null | boolean | number | string | DatasetJson[] | { [key: string]: DatasetJson };
export interface DatasetSnapshot {
  dataset: { id: string; name: string; kind: string };
  version: { id: string; datasetId: string; version: number; fingerprint: string; createdAt: string };
  rows: Array<{
    id: string; rowKey: string; input: DatasetJson; metadata: { [key: string]: DatasetJson };
    expectedOutput: { present: boolean; value: DatasetJson }; context: { present: boolean; value: DatasetJson };
    history: { present: boolean; value: DatasetJson }; traceFixture: { present: boolean; value: DatasetJson };
    reviewStatus: "synthetic" | "reviewed" | "golden";
  }>;
}
export interface DatasetSnapshotHead {
  datasetId: string; name: string; kind: string; id: string; version: number;
  fingerprint: string; createdAt: Date | string;
}
export type DatasetSnapshotFailure = (status: number, code: string) => never;

const SNAPSHOT_LIMIT = 1024 * 1024;
// A canonical finite IEEE754 token has <=17 significant digits and exponent
// magnitude <=324. Even a conservative 343-byte expanded decimal is <64x a
// token of six bytes; shorter tokens have smaller expansions (<64x too).
// JSONB separator spaces cost at most 2x their canonical delimiters, while
// string/key escaping and raw identity bytes do not exceed canonical JSON.
// Therefore this bounds legitimate JSON.stringify-authored complete snapshots.
// Arbitrary SQL numerics with excessive trailing scale can still be refused.
// Exact per-value JSONB equality and the complete 1-MiB canonical limit follow.
const SNAPSHOT_WIRE_LIMIT = 64 * SNAPSHOT_LIMIT;
interface RawRow {
  id: string; rowKey: string; input: string; expectedOutput: string | null; context: string | null;
  history: string | null; traceFixture: string | null; metadata: string; reviewStatus: string;
}
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
}

/** The caller retains its existing public error contract; no partial snapshot is returned. */
export function assertDatasetSnapshotBounds(value: unknown, fail: DatasetSnapshotFailure): void {
  const path = new Set<object>(); let nodes = 0;
  function text(value: unknown) {
    if (typeof value !== "string" || Buffer.byteLength(value) > SNAPSHOT_LIMIT || value.includes("\0")) fail(422, "provided_output_invalid");
    for (let i = 0; i < value.length; i++) {
      const unit = value.charCodeAt(i);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) fail(422, "provided_output_invalid");
      } else if (unit >= 0xdc00 && unit <= 0xdfff) fail(422, "provided_output_invalid");
    }
  }
  function walk(item: unknown, depth: number) {
    if (++nodes > 150_000 || depth > 32) fail(422, "provided_output_invalid");
    if (typeof item === "string") { text(item); return; }
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
      text(key); const descriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor)) fail(422, "provided_output_invalid");
      walk(descriptor.value, depth + 1);
    }
    path.delete(item);
  }
  walk(value, 0);
  if (Buffer.byteLength(stable(value)) > SNAPSHOT_LIMIT) fail(422, "provided_output_invalid");
}

/** Caller holds the workspace lock; version/parent and row locks freeze this complete read. */
export async function loadDatasetSnapshot(
  client: PoolClient,
  workspaceId: string,
  datasetVersionId: string,
  fail: DatasetSnapshotFailure,
  onHead?: (head: DatasetSnapshotHead) => void,
  onRowIds?: (ids: string[]) => void
): Promise<DatasetSnapshot | undefined> {
  const head = (await client.query<DatasetSnapshotHead>(`select d.id as "datasetId", d.name, d.kind, v.id, v.version, v.fingerprint, v.created_at as "createdAt"
    from dataset_versions v join datasets d on d.id = v.dataset_id
    where d.workspace_id = $1 and v.id = $2 for update of v, d`, [workspaceId, datasetVersionId])).rows[0];
  if (!head) return undefined;
  onHead?.(head);
  // The FK parent UPDATE lock also blocks new row inserts while this snapshot is prepared.
  const locked = (await client.query<{ id: string }>(`select id from dataset_rows where dataset_version_id = $1
    order by row_key collate "C", id collate "C" limit 101 for share`, [head.id])).rows;
  onRowIds?.(locked.map(row => row.id));
  if (!locked.length || locked.length > 100) fail(422, "provided_output_dataset_size");
  const size = (await client.query<{ bytes: string }>(`select coalesce(sum(octet_length(id) + octet_length(row_key)
    + octet_length(input::text) + coalesce(octet_length(expected_output::text), 0) + coalesce(octet_length(context::text), 0)
    + coalesce(octet_length(history::text), 0) + coalesce(octet_length(trace_fixture::text), 0)
    + octet_length(metadata::text) + octet_length(review_status)), 0)::text as bytes
    from dataset_rows where dataset_version_id = $1`, [head.id])).rows[0];
  if (!size || BigInt(size.bytes) > BigInt(SNAPSHOT_WIRE_LIMIT)) fail(422, "provided_output_dataset_size");
  const rawRows = (await client.query<RawRow>(`select id, row_key as "rowKey", input::text, expected_output::text as "expectedOutput",
    context::text, history::text, trace_fixture::text as "traceFixture", metadata::text, review_status as "reviewStatus"
    from dataset_rows where dataset_version_id = $1 order by row_key collate "C", id collate "C"`, [head.id])).rows;
  if (rawRows.length !== locked.length) fail(409, "provided_output_storage_conflict");
  const field = (value: string | null) => ({ present: value !== null, value: value === null ? null : JSON.parse(value) as DatasetJson });
  const rows = rawRows.map(row => ({ id: row.id, rowKey: row.rowKey, input: JSON.parse(row.input) as DatasetJson,
    expectedOutput: field(row.expectedOutput), context: field(row.context), history: field(row.history), traceFixture: field(row.traceFixture),
    metadata: JSON.parse(row.metadata) as { [key: string]: DatasetJson }, reviewStatus: row.reviewStatus as "synthetic" | "reviewed" | "golden" }));
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
  const snapshot: DatasetSnapshot = { dataset: { id: head.datasetId, name: head.name, kind: head.kind },
    version: { id: head.id, datasetId: head.datasetId, version: head.version, fingerprint: head.fingerprint,
      createdAt: head.createdAt instanceof Date ? head.createdAt.toISOString() : new Date(head.createdAt).toISOString() }, rows };
  assertDatasetSnapshotBounds(snapshot, fail);
  if (rows.some(row => !["synthetic", "reviewed", "golden"].includes(row.reviewStatus))) fail(422, "provided_output_dataset_invalid");
  return snapshot;
}

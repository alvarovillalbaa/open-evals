import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import {
  assertDatasetSnapshotBounds, loadDatasetSnapshot,
  type DatasetSnapshot, type DatasetSnapshotFailure, type DatasetSnapshotHead
} from "./dataset-snapshots";
import { isDatabaseUnavailable, withTransaction } from "./service";
import type {
  CustomDatasetStoreCallbacks, CustomDatasetStoreContent, CustomDatasetStoreDetail, CustomDatasetStoreDraft,
  CustomDatasetStoreHead, CustomDatasetStoreManifest, CustomDatasetStoreRecord,
  CustomDatasetStoreSaveRequest, CustomDatasetStoreSummary, CustomDatasetStoreVersionSummary
} from "./custom-dataset-types";

export type * from "./custom-dataset-types";
export class CustomDatasetStoreError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); this.name = "CustomDatasetStoreError"; }
}

const KIND = "custom-dataset-v1" as const;
const ACTION = "custom_dataset.version.saved";
const RESOURCE = "custom_dataset_version";
const DATASET_PREFIX = "custom_dataset_";
const VERSION_PREFIX = "custom_dataset_version_";
const ROW_PREFIX = "custom_dataset_row_";
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
const RECORD_LIMIT = 8 * 1024 * 1024;
const MANIFEST_LIMIT = 128 * 1024;
const STATUSES = ["synthetic", "reviewed", "golden"];
type Reject = () => never;
function fail(status: number, code: string): never { throw new CustomDatasetStoreError(status, code); }
const conflict = (): never => fail(409, "custom_dataset_storage_conflict");
const invalid = (): never => fail(422, "custom_dataset_invalid");
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
}
const hash = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
const textHash = (value: string) => createHash("sha256").update(value).digest("hex");
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
const order = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
function text(value: unknown, maximum = 512, nonblank = true, reject: Reject = conflict): asserts value is string {
  if (typeof value !== "string" || Buffer.byteLength(value) > maximum || value.includes("\0") || nonblank && !value.trim()) reject();
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) reject();
    } else if (unit >= 0xdc00 && unit <= 0xdfff) reject();
  }
}
function uuid(value: unknown, reject: Reject = conflict): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) reject();
}
function fingerprint(value: unknown): asserts value is string {
  if (typeof value !== "string" || !HEX.test(value)) conflict();
}
function integer(value: unknown, maximum = 2_147_483_647): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > maximum) conflict();
}
function object(value: unknown, reject: Reject = conflict): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[], reject: Reject = conflict) {
  if (!same(Object.keys(value).sort(), [...expected].sort())) reject();
}
function withoutFingerprint(value: unknown) {
  return Object.fromEntries(Object.entries(object(value)).filter(([key]) => key !== "fingerprint"));
}
function boundedJson(value: unknown, maximum = RECORD_LIMIT, reject: Reject = conflict): void {
  const path = new Set<object>(); let nodes = 0;
  function walk(item: unknown, depth: number) {
    if (++nodes > 500_000 || depth > 40) reject();
    if (typeof item === "string") { text(item, maximum, false, reject); return; }
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (!item || typeof item !== "object" || path.has(item)) reject();
    const array = Array.isArray(item), proto = Object.getPrototypeOf(item);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) reject();
    const descriptors = Object.getOwnPropertyDescriptors(item as object);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string")) reject();
    path.add(item);
    const names = Object.keys(descriptors);
    if (names.length - (array ? 1 : 0) > 100_000) reject();
    if (array) {
      if (names.length !== (item as unknown[]).length + 1 || !descriptors.length || descriptors.length.value !== (item as unknown[]).length) reject();
      for (let i = 0; i < (item as unknown[]).length; i++) {
        const descriptor = descriptors[String(i)];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) reject();
        walk(descriptor.value, depth + 1);
      }
    } else for (const key of names) {
      text(key, maximum, false, reject); const descriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor)) reject();
      walk(descriptor.value, depth + 1);
    }
    path.delete(item);
  }
  try { walk(value, 0); if (Buffer.byteLength(stable(value)) > maximum) reject(); }
  catch (error) { if (error instanceof CustomDatasetStoreError) throw error; reject(); }
}
function iso(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) conflict();
  try { if (new Date(value).toISOString() !== value) conflict(); }
  catch { conflict(); }
  return value;
}
function date(value: Date | string) {
  try { return iso(value instanceof Date ? value.toISOString() : new Date(value).toISOString()); }
  catch { return conflict(); }
}
function identities(workspaceId: string, datasetId: string, versionId: string) {
  const versionHash = hash({ workspaceId, datasetId, versionId });
  return {
    datasetId: DATASET_PREFIX + hash({ workspaceId, datasetId }),
    versionId: VERSION_PREFIX + versionHash,
    auditId: "audit_custom_dataset_version_" + versionHash
  };
}
function rowIdentity(workspaceId: string, datasetId: string, versionId: string, rowKey: string) {
  return ROW_PREFIX + hash({ workspaceId, datasetId, versionId, rowKey });
}
function request(value: unknown): CustomDatasetStoreSaveRequest {
  boundedJson(value, 2 * 1024 * 1024, invalid);
  const root = object(value, invalid); keys(root, ["schemaVersion", "draft", "expectedPreviewFingerprint"], invalid);
  if (root.schemaVersion !== "custom-dataset-save-v1" || typeof root.expectedPreviewFingerprint !== "string" || !HEX.test(root.expectedPreviewFingerprint)) invalid();
  const draft = object(root.draft, invalid);
  keys(draft, ["schemaVersion", "datasetId", "versionId", "version", "expectedVersionId", "name", "format", "defaultReviewStatus", "sourceText"], invalid);
  if (draft.schemaVersion !== "custom-dataset-draft-v1") invalid();
  uuid(draft.datasetId, invalid); uuid(draft.versionId, invalid);
  if (typeof draft.version !== "number" || !Number.isInteger(draft.version) || draft.version < 1 || draft.version > 2_147_483_647) invalid();
  if (draft.expectedVersionId !== null) uuid(draft.expectedVersionId, invalid);
  if ((draft.version === 1) !== (draft.expectedVersionId === null) || draft.expectedVersionId === draft.versionId) invalid();
  text(draft.name, 4096, true, invalid); text(draft.sourceText, 2 * 1024 * 1024, true, invalid);
  if (draft.format !== "json" && draft.format !== "jsonl" || draft.defaultReviewStatus !== null
    && (typeof draft.defaultReviewStatus !== "string" || !STATUSES.includes(draft.defaultReviewStatus))) invalid();
  return { schemaVersion: "custom-dataset-save-v1", expectedPreviewFingerprint: root.expectedPreviewFingerprint,
    draft: { schemaVersion: "custom-dataset-draft-v1", datasetId: draft.datasetId, versionId: draft.versionId,
      version: draft.version, expectedVersionId: draft.expectedVersionId as string | null, name: draft.name,
      format: draft.format as "json" | "jsonl", defaultReviewStatus: draft.defaultReviewStatus as CustomDatasetStoreDraft["defaultReviewStatus"], sourceText: draft.sourceText } };
}
function head(value: unknown, workspaceId: string, publicDatasetId: string): CustomDatasetStoreHead | null {
  if (value === null) return null;
  const row = object(value);
  keys(row, ["datasetId", "publicDatasetId", "name", "kind", "versionId", "publicVersionId", "version", "contentFingerprint"]);
  uuid(row.publicDatasetId); uuid(row.publicVersionId); integer(row.version); fingerprint(row.contentFingerprint); text(row.name, 4096);
  const ids = identities(workspaceId, row.publicDatasetId, row.publicVersionId);
  if (row.publicDatasetId !== publicDatasetId || row.kind !== KIND || row.datasetId !== ids.datasetId || row.versionId !== ids.versionId) conflict();
  return row as unknown as CustomDatasetStoreHead;
}
function manifest(value: unknown, workspaceId: string): CustomDatasetStoreManifest {
  boundedJson(value, MANIFEST_LIMIT);
  const row = object(value);
  keys(row, ["schemaVersion", "workspaceId", "datasetId", "versionId", "createdAt", "intent", "head", "rowCount", "contentFingerprint", "previewFingerprint", "requestFingerprint"]);
  if (row.schemaVersion !== "custom-dataset-manifest-v1" || row.workspaceId !== workspaceId) conflict();
  iso(row.createdAt); integer(row.rowCount, 100); fingerprint(row.contentFingerprint); fingerprint(row.previewFingerprint); fingerprint(row.requestFingerprint);
  const intent = object(row.intent);
  keys(intent, ["schemaVersion", "workspaceId", "datasetId", "versionId", "version", "expectedVersionId", "name", "format", "defaultReviewStatus", "sourceDigest", "contentFingerprint", "fingerprint"]);
  if (intent.schemaVersion !== "custom-dataset-intent-v1" || intent.workspaceId !== workspaceId) conflict();
  uuid(intent.datasetId); uuid(intent.versionId); integer(intent.version); text(intent.name, 4096);
  if (intent.expectedVersionId !== null) uuid(intent.expectedVersionId);
  if (intent.expectedVersionId === intent.versionId) conflict();
  if (intent.format !== "json" && intent.format !== "jsonl" || intent.defaultReviewStatus !== null
    && (typeof intent.defaultReviewStatus !== "string" || !STATUSES.includes(intent.defaultReviewStatus))) conflict();
  fingerprint(intent.sourceDigest); fingerprint(intent.contentFingerprint); fingerprint(intent.fingerprint);
  if (intent.fingerprint !== hash(withoutFingerprint(intent)) || intent.contentFingerprint !== row.contentFingerprint) conflict();
  const ids = identities(workspaceId, intent.datasetId, intent.versionId);
  if (row.datasetId !== ids.datasetId || row.versionId !== ids.versionId) conflict();
  const previous = head(row.head, workspaceId, intent.datasetId);
  if (previous ? intent.version !== previous.version + 1 || intent.expectedVersionId !== previous.publicVersionId || intent.name !== previous.name
    : intent.version !== 1 || intent.expectedVersionId !== null) conflict();
  return row as unknown as CustomDatasetStoreManifest;
}
function nullable(value: unknown) {
  const field = object(value); keys(field, ["present", "value"]);
  if (typeof field.present !== "boolean" || !field.present && field.value !== null) conflict();
}
function restore(workspaceId: string, snapshot: DatasetSnapshot, rawManifest: unknown): CustomDatasetStoreRecord {
  assertDatasetSnapshotBounds(snapshot, () => conflict());
  const meta = manifest(rawManifest, workspaceId), intent = meta.intent, ids = identities(workspaceId, intent.datasetId, intent.versionId);
  const root = object(snapshot); keys(root, ["dataset", "version", "rows"]);
  const dataset = object(snapshot.dataset), version = object(snapshot.version);
  keys(dataset, ["id", "name", "kind"]); keys(version, ["id", "datasetId", "version", "fingerprint", "createdAt"]);
  if (dataset.id !== ids.datasetId || dataset.name !== intent.name || dataset.kind !== KIND || version.id !== ids.versionId
    || version.datasetId !== ids.datasetId || version.version !== intent.version || version.fingerprint !== meta.contentFingerprint
    || iso(version.createdAt) !== meta.createdAt || !Array.isArray(snapshot.rows) || snapshot.rows.length !== meta.rowCount) conflict();
  const seen = new Set<string>(); let previous: DatasetSnapshot["rows"][number] | undefined;
  for (const row of snapshot.rows) {
    keys(object(row), ["id", "rowKey", "input", "expectedOutput", "context", "history", "traceFixture", "metadata", "reviewStatus"]);
    text(row.rowKey, 4096); text(row.id); object(row.metadata);
    if (seen.has(row.rowKey) || row.id !== rowIdentity(workspaceId, intent.datasetId, intent.versionId, row.rowKey) || !STATUSES.includes(row.reviewStatus)) conflict();
    if (previous && (order(previous.rowKey, row.rowKey) > 0 || previous.rowKey === row.rowKey && order(previous.id, row.id) >= 0)) conflict();
    seen.add(row.rowKey); previous = row;
    nullable(row.expectedOutput); nullable(row.context); nullable(row.history); nullable(row.traceFixture);
  }
  const contentBase = { schemaVersion: "custom-dataset-version-v1" as const, workspaceId,
    dataset: { id: ids.datasetId, publicId: intent.datasetId, name: intent.name, kind: KIND },
    version: { id: ids.versionId, publicId: intent.versionId, version: intent.version,
      previousVersionId: meta.head?.versionId ?? null, previousPublicVersionId: meta.head?.publicVersionId ?? null }, rows: snapshot.rows };
  const content: CustomDatasetStoreContent = { ...contentBase, fingerprint: hash(contentBase) };
  if (content.fingerprint !== meta.contentFingerprint) conflict();
  const preview = { schemaVersion: "custom-dataset-preview-v1", workspaceId, intent, head: meta.head, content,
    canonicalSnapshotBytes: Buffer.byteLength(stable(snapshot)), createdAtByteAllowance: 24 };
  if (hash(preview) !== meta.previewFingerprint || meta.requestFingerprint !== hash({
    schemaVersion: "custom-dataset-request-fingerprint-v1", workspaceId, intent, expectedPreviewFingerprint: meta.previewFingerprint
  })) conflict();
  const record = { schemaVersion: "custom-dataset-record-v1" as const, workspaceId, content, snapshot, manifest: meta };
  const result = { ...record, fingerprint: hash(record) }; boundedJson(result);
  return result;
}
function recordHead(record: CustomDatasetStoreRecord): CustomDatasetStoreHead {
  return { datasetId: record.content.dataset.id, publicDatasetId: record.content.dataset.publicId,
    name: record.content.dataset.name, kind: KIND, versionId: record.content.version.id,
    publicVersionId: record.content.version.publicId, version: record.content.version.version, contentFingerprint: record.content.fingerprint };
}
function matchesRequest(meta: CustomDatasetStoreManifest, req: CustomDatasetStoreSaveRequest) {
  const draft = req.draft, intent = meta.intent;
  if (intent.datasetId !== draft.datasetId || intent.versionId !== draft.versionId || intent.version !== draft.version
    || intent.expectedVersionId !== draft.expectedVersionId || intent.name !== draft.name || intent.format !== draft.format
    || intent.defaultReviewStatus !== draft.defaultReviewStatus || intent.sourceDigest !== textHash(draft.sourceText)
    || meta.previewFingerprint !== req.expectedPreviewFingerprint || meta.requestFingerprint !== hash({
      schemaVersion: "custom-dataset-request-fingerprint-v1", workspaceId: meta.workspaceId, intent,
      expectedPreviewFingerprint: req.expectedPreviewFingerprint
    })) fail(409, "custom_dataset_identity_conflict");
}
async function operation<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (isDatabaseUnavailable(error)) throw error;
    if (error && typeof error === "object" && "code" in error && ["23505", "23503", "40001", "40P01"].includes(String(error.code))) conflict();
    throw error;
  }
}
async function workspace(client: PoolClient, workspaceId: string) {
  text(workspaceId, 512, true, invalid);
  if (!(await client.query("select id from workspaces where id = $1 for update", [workspaceId])).rows.length) fail(404, "custom_dataset_workspace_not_found");
}

interface AuditRow {
  id: string; workspaceId: string; actorId: string | null; action: string; resourceType: string; resourceId: string;
  metadataHash: string; metadata: unknown;
}
async function readManifest(client: PoolClient, workspaceId: string, versionId: string): Promise<CustomDatasetStoreManifest | undefined> {
  const versionHash = versionId.startsWith(VERSION_PREFIX) ? versionId.slice(VERSION_PREFIX.length) : "";
  if (!HEX.test(versionHash)) conflict();
  const auditId = "audit_custom_dataset_version_" + versionHash;
  const rows = (await client.query<AuditRow>(`select id, workspace_id as "workspaceId", actor_user_id as "actorId", action,
    resource_type as "resourceType", resource_id as "resourceId", metadata_hash as "metadataHash",
    case when octet_length(metadata::text) <= $3 then metadata else null end as metadata
    from audit_events where id = $1 or (resource_id = $2 and action = '${ACTION}') limit 2 for update`,
    [auditId, versionId, 2 * MANIFEST_LIMIT])).rows;
  if (!rows.length) return undefined;
  if (rows.length !== 1) conflict();
  const row = rows[0]; text(row.actorId);
  const meta = manifest(row.metadata, workspaceId);
  if (row.id !== auditId || row.workspaceId !== workspaceId || row.action !== ACTION || row.resourceType !== RESOURCE
    || row.resourceId !== versionId || meta.versionId !== versionId || row.metadataHash !== hash(meta)) conflict();
  return meta;
}
function profiled(head: Pick<DatasetSnapshotHead, "datasetId" | "id" | "kind">) {
  return head.kind === KIND || head.datasetId.startsWith(DATASET_PREFIX) || head.id.startsWith(VERSION_PREFIX);
}

/** Session-only callers may resolve legacy inputs too; custom markers never bypass integrity checks. */
export async function loadCustomAwareDatasetSnapshot(
  client: PoolClient, workspaceId: string, versionId: string, legacyFail: DatasetSnapshotFailure
): Promise<DatasetSnapshot | undefined> {
  let custom = versionId.startsWith(VERSION_PREFIX);
  let snapshot: DatasetSnapshot | undefined;
  try {
    snapshot = await loadDatasetSnapshot(client, workspaceId, versionId,
      (status, code) => custom ? conflict() : legacyFail(status, code),
      row => { custom ||= profiled(row); }, ids => { custom ||= ids.some(id => id.startsWith(ROW_PREFIX)); });
  } catch (error) {
    if (custom && (error instanceof RangeError || error instanceof SyntaxError || error instanceof TypeError)) conflict();
    throw error;
  }
  if (!snapshot) {
    if (versionId.startsWith(VERSION_PREFIX) && HEX.test(versionId.slice(VERSION_PREFIX.length))) {
      const ownedOrphan = await client.query(`select id from audit_events where workspace_id = $1 and
        (id = $2 or (action = '${ACTION}' and resource_id = $3)) limit 1`,
        [workspaceId, "audit_custom_dataset_version_" + versionId.slice(VERSION_PREFIX.length), versionId]);
      if (ownedOrphan.rows.length) conflict();
    }
    return undefined;
  }
  if (custom) {
    const meta = await readManifest(client, workspaceId, snapshot.version.id);
    if (!meta) conflict();
    restore(workspaceId, snapshot, meta);
  }
  return snapshot;
}
async function readVersion(client: PoolClient, workspaceId: string, versionId: string): Promise<CustomDatasetStoreRecord | undefined> {
  let snapshot: DatasetSnapshot | undefined;
  try { snapshot = await loadDatasetSnapshot(client, workspaceId, versionId, () => conflict()); }
  catch (error) {
    if (error instanceof RangeError || error instanceof SyntaxError || error instanceof TypeError) conflict();
    throw error;
  }
  const meta = await readManifest(client, workspaceId, versionId);
  if (!snapshot && !meta) return undefined;
  if (!snapshot || !meta) conflict();
  return restore(workspaceId, snapshot, meta);
}

interface DatasetRow { id: string; workspaceId: string; name: string; kind: string }
interface VersionRow { id: string; version: number; fingerprint: string; createdAt: Date | string; rowCount: number }
interface Statistics { count: string; minimum: number | null; maximum: number | null }
async function dataset(client: PoolClient, workspaceId: string, publicId: string): Promise<DatasetRow | undefined> {
  const id = DATASET_PREFIX + hash({ workspaceId, datasetId: publicId });
  const row = (await client.query<DatasetRow>(`select id, workspace_id as "workspaceId", name, kind from datasets where id = $1 for update`, [id])).rows[0];
  if (row) {
    text(row.name, 4096);
    if (row.workspaceId !== workspaceId || row.kind !== KIND || row.id !== id) conflict();
  } else {
    const orphan = await client.query(`select id from audit_events where workspace_id = $1 and action = '${ACTION}'
      and (metadata ->> 'datasetId' = $2 or metadata #>> '{intent,datasetId}' = $3) limit 1`, [workspaceId, id, publicId]);
    if (orphan.rows.length) conflict();
  }
  return row;
}
async function statistics(client: PoolClient, datasetId: string): Promise<{ count: number; maximum: number }> {
  const row = (await client.query<Statistics>(`select count(*)::text as count, min(version) as minimum, max(version) as maximum
    from dataset_versions where dataset_id = $1`, [datasetId])).rows[0];
  const count = Number(row?.count);
  if (!Number.isInteger(count) || count < 1 || count > 2_147_483_647 || row.minimum !== 1 || row.maximum !== count) conflict();
  return { count, maximum: count };
}
async function versions(client: PoolClient, datasetId: string, limit: number): Promise<VersionRow[]> {
  return (await client.query<VersionRow>(`select v.id, v.version, v.fingerprint, v.created_at as "createdAt",
    (select count(*)::int from (select id from dataset_rows where dataset_version_id = v.id limit 101) counted) as "rowCount"
    from dataset_versions v where v.dataset_id = $1 order by v.version desc limit $2 for update of v`, [datasetId, limit])).rows;
}
function summary(meta: CustomDatasetStoreManifest, row: VersionRow): CustomDatasetStoreVersionSummary {
  if (row.id !== meta.versionId || row.version !== meta.intent.version || row.fingerprint !== meta.contentFingerprint
    || date(row.createdAt) !== meta.createdAt || row.rowCount !== meta.rowCount) conflict();
  return { id: meta.intent.versionId, datasetId: meta.intent.datasetId, storageVersionId: row.id,
    version: row.version, contentFingerprint: row.fingerprint, createdAt: meta.createdAt, rowCount: meta.rowCount };
}
async function summaries(client: PoolClient, workspaceId: string, source: DatasetRow, limit: number) {
  const stats = await statistics(client, source.id), rows = await versions(client, source.id, limit);
  if (!rows.length || rows[0].version !== stats.maximum) conflict();
  const result: CustomDatasetStoreVersionSummary[] = [];
  for (const row of rows) {
    const meta = await readManifest(client, workspaceId, row.id);
    if (!meta || meta.datasetId !== source.id || meta.intent.name !== source.name || source.kind !== KIND) conflict();
    result.push(summary(meta, row));
  }
  return { rows: result, versionCount: stats.count };
}
async function currentHead(client: PoolClient, workspaceId: string, source: DatasetRow): Promise<CustomDatasetStoreHead> {
  const stats = await statistics(client, source.id), rows = await versions(client, source.id, 1);
  if (!rows.length || rows[0].version !== stats.maximum) conflict();
  const record = await readVersion(client, workspaceId, rows[0].id);
  if (!record || record.content.dataset.id !== source.id || record.content.dataset.name !== source.name) conflict();
  return recordHead(record);
}

export async function getCustomDatasetHead(workspaceId: string, datasetId: string): Promise<CustomDatasetStoreHead | null> {
  text(workspaceId, 512, true, invalid); uuid(datasetId, invalid);
  return operation(() => withTransaction(async client => {
    await workspace(client, workspaceId);
    const source = await dataset(client, workspaceId, datasetId);
    return source ? currentHead(client, workspaceId, source) : null;
  }));
}
export async function getCustomDatasetVersion(workspaceId: string, datasetId: string, versionId: string): Promise<CustomDatasetStoreRecord | undefined> {
  text(workspaceId, 512, true, invalid); uuid(datasetId, invalid); uuid(versionId, invalid);
  return operation(() => withTransaction(async client => {
    await workspace(client, workspaceId);
    const record = await readVersion(client, workspaceId, identities(workspaceId, datasetId, versionId).versionId);
    if (record && (record.content.dataset.publicId !== datasetId || record.content.version.publicId !== versionId)) conflict();
    return record;
  }));
}
export async function getCustomDataset(workspaceId: string, datasetId: string): Promise<CustomDatasetStoreDetail | undefined> {
  text(workspaceId, 512, true, invalid); uuid(datasetId, invalid);
  return operation(() => withTransaction(async client => {
    await workspace(client, workspaceId);
    const source = await dataset(client, workspaceId, datasetId);
    if (!source) return undefined;
    const recent = await summaries(client, workspaceId, source, 21);
    return { id: datasetId, storageDatasetId: source.id, name: source.name, versions: recent.rows.slice(0, 20), hasMore: recent.rows.length > 20 };
  }));
}
export async function listCustomDatasets(workspaceId: string): Promise<{ datasets: CustomDatasetStoreSummary[]; hasMore: boolean }> {
  text(workspaceId, 512, true, invalid);
  return operation(() => withTransaction(async client => {
    await workspace(client, workspaceId);
    const rows = (await client.query<DatasetRow>(`select d.id, d.workspace_id as "workspaceId", d.name, d.kind from datasets d
      where d.workspace_id = $1 and (d.kind = '${KIND}' or left(d.id, length('${DATASET_PREFIX}')) = '${DATASET_PREFIX}'
        or exists (select 1 from dataset_versions v where v.dataset_id = d.id and
          (left(v.id, length('${VERSION_PREFIX}')) = '${VERSION_PREFIX}' or exists
            (select 1 from dataset_rows r where r.dataset_version_id = v.id and left(r.id, length('${ROW_PREFIX}')) = '${ROW_PREFIX}'))))
      order by (select latest.created_at from dataset_versions latest where latest.dataset_id = d.id
        order by latest.version desc limit 1) desc nulls first, d.id collate "C" limit 101 for update of d`, [workspaceId])).rows;
    const result: CustomDatasetStoreSummary[] = [];
    for (const source of rows.slice(0, 100)) {
      if (source.workspaceId !== workspaceId || source.kind !== KIND || !source.id.startsWith(DATASET_PREFIX)) conflict();
      text(source.name, 4096);
      const recent = await summaries(client, workspaceId, source, 1), latest = recent.rows[0];
      if (identities(workspaceId, latest.datasetId, latest.id).datasetId !== source.id) conflict();
      result.push({ id: latest.datasetId, storageDatasetId: source.id, name: source.name, head: latest, versionCount: recent.versionCount });
    }
    return { datasets: result, hasMore: rows.length > 100 };
  }));
}

export async function saveCustomDatasetVersion<T extends CustomDatasetStoreRecord>(
  scope: { workspaceId: string; actorId: string },
  rawRequest: unknown,
  callbacks: CustomDatasetStoreCallbacks<T>
): Promise<{ record: T; replayed: boolean }> {
  text(scope.workspaceId, 512, true, invalid); text(scope.actorId, 512, true, invalid);
  if (typeof callbacks?.prepare !== "function" || typeof callbacks?.restore !== "function") fail(422, "custom_dataset_callbacks_required");
  scope = { workspaceId: scope.workspaceId, actorId: scope.actorId };
  callbacks = { prepare: callbacks.prepare, restore: callbacks.restore };
  const req = request(rawRequest), ids = identities(scope.workspaceId, req.draft.datasetId, req.draft.versionId);
  return operation(() => withTransaction(async client => {
    await workspace(client, scope.workspaceId);
    const collision = (await client.query<{ datasetId: string }>(`select dataset_id as "datasetId" from dataset_versions where id = $1 for update`, [ids.versionId])).rows[0];
    if (collision && collision.datasetId !== ids.datasetId) conflict();
    const replay = await readVersion(client, scope.workspaceId, ids.versionId);
    if (collision && !replay) conflict();
    if (replay) {
      matchesRequest(replay.manifest, req);
      const canonical = callbacks.restore({ workspaceId: scope.workspaceId, snapshot: replay.snapshot, manifest: replay.manifest });
      boundedJson(canonical); if (!same(canonical, replay)) conflict();
      return { record: canonical, replayed: true };
    }
    const source = await dataset(client, scope.workspaceId, req.draft.datasetId);
    const previous = source ? await currentHead(client, scope.workspaceId, source) : null;
    if (previous ? req.draft.expectedVersionId !== previous.publicVersionId || req.draft.version !== previous.version + 1
      : req.draft.expectedVersionId !== null || req.draft.version !== 1) fail(409, "custom_dataset_version_conflict");
    if (previous && previous.name !== req.draft.name) fail(409, "custom_dataset_name_immutable");
    const timestamp = (await client.query<{ createdAt: Date }>(`select date_trunc('milliseconds', current_timestamp) as "createdAt"`)).rows[0];
    if (!timestamp) conflict();
    const createdAt = date(timestamp.createdAt);
    const prepared = callbacks.prepare({ workspaceId: scope.workspaceId, request: req, head: previous, createdAt });
    boundedJson(prepared);
    const canonical = restore(scope.workspaceId, prepared.snapshot, prepared.manifest);
    if (!same(prepared, canonical) || !same(canonical.manifest.head, previous) || canonical.manifest.createdAt !== createdAt
      || canonical.content.dataset.id !== ids.datasetId || canonical.content.version.id !== ids.versionId) conflict();
    matchesRequest(canonical.manifest, req);
    const coreRecord = callbacks.restore({ workspaceId: scope.workspaceId, snapshot: canonical.snapshot, manifest: canonical.manifest });
    boundedJson(coreRecord); if (!same(coreRecord, canonical)) conflict();
    if (!source) await client.query(`insert into datasets (id, workspace_id, name, kind) values ($1, $2, $3, $4)`,
      [ids.datasetId, scope.workspaceId, req.draft.name, KIND]);
    await client.query(`insert into dataset_versions (id, dataset_id, version, fingerprint, created_at) values ($1, $2, $3, $4, $5::timestamptz)`,
      [ids.versionId, ids.datasetId, req.draft.version, canonical.content.fingerprint, createdAt]);
    for (const row of canonical.snapshot.rows) await client.query(`insert into dataset_rows
      (id, dataset_version_id, row_key, input, expected_output, context, history, trace_fixture, metadata, review_status)
      values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10)`,
      [row.id, ids.versionId, row.rowKey, JSON.stringify(row.input), row.expectedOutput.present ? JSON.stringify(row.expectedOutput.value) : null,
        row.context.present ? JSON.stringify(row.context.value) : null, row.history.present ? JSON.stringify(row.history.value) : null,
        row.traceFixture.present ? JSON.stringify(row.traceFixture.value) : null, JSON.stringify(row.metadata), row.reviewStatus]);
    await client.query(`insert into audit_events (id, workspace_id, actor_user_id, action, resource_type, resource_id, metadata_hash, metadata)
      values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [ids.auditId, scope.workspaceId, scope.actorId, ACTION, RESOURCE, ids.versionId, hash(canonical.manifest), JSON.stringify(canonical.manifest)]);
    const saved = await readVersion(client, scope.workspaceId, ids.versionId);
    if (!saved || !same(saved, canonical)) conflict();
    return { record: coreRecord, replayed: false };
  }));
}

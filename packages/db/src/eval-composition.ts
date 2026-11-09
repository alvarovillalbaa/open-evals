import type { PoolClient } from "pg";
import { withTransaction } from "./service";
import { httpBounded, httpClock, httpHash, httpIso, httpKeys, httpObject, httpParseRaw,
  httpSame, httpStable, httpText, httpUuid, httpWithoutFingerprint } from "./http-eval-types";
import type { EvalCompositionScope, EvalCompositionItemRef, EvalCompositionItemRecord,
  EvalCompositionSetRecord, EvalCompositionItemHead, EvalCompositionSetHead, EvalCompositionRestore,
  EvalCompositionItemCallbacks, EvalCompositionSetCallbacks, EvalCompositionSetReaders,
  EvalCompositionItemSummary, EvalCompositionSetSummary, EvalCompositionItemDetail, EvalCompositionSetDetail } from "./eval-composition-types";
export type * from "./eval-composition-types";

type Kind = "item" | "set";
type VersionRecord = EvalCompositionItemRecord | EvalCompositionSetRecord;
type Head = EvalCompositionItemHead | EvalCompositionSetHead;
type Restore = EvalCompositionRestore<VersionRecord>;
const RECORD_LIMIT = 1024 * 1024;
// Quoting a canonical JSON string can at most double its bytes; the fixed index is <64 KiB.
const STORAGE_LIMIT = 2 * RECORD_LIMIT + 65536;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const spec = (kind: Kind) => kind === "item"
  ? { parent: "eval_items", versions: "eval_item_versions", parentKey: "eval_item_id", column: "config", publicKey: "itemId" }
  : { parent: "eval_sets", versions: "eval_set_versions", parentKey: "eval_set_id", column: "contract", publicKey: "setId" };

export class EvalCompositionStoreError extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; this.name = "EvalCompositionStoreError"; }
}
const fail = (status: number, code: string): never => { throw new EvalCompositionStoreError(status, code); };
const conflict: () => never = () => fail(409, "eval_composition_storage_conflict");
const invalid: () => never = () => fail(422, "eval_composition_invalid");
async function operation<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof EvalCompositionStoreError) throw error;
    const code = (error as { code?: unknown })?.code;
    if (typeof code === "string" && ["23505", "23503", "23514", "22P02", "22003", "22001"].includes(code)) return conflict();
    if (typeof code === "string" && (/^08/.test(code) || ["57P01", "57P02", "57P03", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND"].includes(code))) fail(503, "eval_composition_database_unavailable");
    throw error;
  }
}
function checkScope(scope: EvalCompositionScope) {
  try { httpText(scope?.workspaceId); httpText(scope?.actorId); } catch { invalid(); }
}
function checkRead(workspaceId: string, publicId?: string, versionId?: string) {
  try { httpText(workspaceId); if (publicId !== undefined) httpUuid(publicId); if (versionId !== undefined) httpUuid(versionId); } catch { invalid(); }
}
async function workspace(client: PoolClient, workspaceId: string) {
  if (!(await client.query("select id from workspaces where id=$1 for update", [workspaceId])).rows.length) fail(404, "eval_composition_workspace_not_found");
}
async function lock(client: PoolClient, kind: Kind, workspaceId: string, publicId: string) {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`custom-eval-${kind}-v2:${workspaceId}:${publicId}`]);
}
function ids(kind: Kind, workspaceId: string, publicId: string, versionId: string) {
  const identity = httpHash({ schemaVersion: `custom-eval-${kind}-identity-v2`, workspaceId, id: publicId });
  const version = httpHash({ schemaVersion: `custom-eval-${kind}-version-identity-v2`, workspaceId, id: publicId, versionId });
  return { [`${kind}Id`]: `custom_eval_${kind}_v2_${identity}`, versionId: `custom_eval_${kind}_version_v2_${version}`, auditId: `audit_custom_eval_${kind}_v2_${version}` };
}
function publicId(kind: Kind, record: VersionRecord): string { return kind === "item" ? (record as EvalCompositionItemRecord).draft.itemId : (record as EvalCompositionSetRecord).draft.setId; }
function aggregateId(kind: Kind, record: VersionRecord): string { return kind === "item" ? (record as EvalCompositionItemRecord).storage.itemId : (record as EvalCompositionSetRecord).storage.setId; }
function head(kind: Kind, record: VersionRecord): Head {
  return { [`${kind}Id`]: publicId(kind, record), versionId: record.draft.versionId, version: record.draft.version,
    name: record.draft.name, contractFingerprint: record.contract.fingerprint, recordFingerprint: record.fingerprint } as unknown as Head;
}
function name(value: unknown) { httpText(value, 480); if (!(value as string).trim() || [...value as string].length > 120) invalid(); }
function fingerprint(value: unknown) { if (typeof value !== "string" || !FINGERPRINT.test(value)) invalid(); }
function itemRefs(value: unknown): EvalCompositionItemRef[] {
  if (!Array.isArray(value) || !value.length || value.length > 32) invalid();
  const seen = new Set<string>();
  return value.map(raw => { const ref = httpObject(raw); httpKeys(ref, ["itemId", "versionId", "fingerprint"]);
    httpUuid(ref.itemId); httpUuid(ref.versionId); fingerprint(ref.fingerprint);
    const key = `${ref.itemId}:${ref.versionId}`; if (seen.has(key)) invalid(); seen.add(key);
    return { itemId: ref.itemId as string, versionId: ref.versionId as string, fingerprint: ref.fingerprint as string };
  });
}
function request(kind: Kind, value: unknown): { schemaVersion: string; draft: VersionRecord["draft"]; expectedPreviewFingerprint: string } {
  try {
    httpBounded(value, 2 * RECORD_LIMIT); const s = httpObject(value); httpKeys(s, ["schemaVersion", "draft", "expectedPreviewFingerprint"]);
    if (s.schemaVersion !== `custom-eval-${kind}-save-v2`) invalid(); fingerprint(s.expectedPreviewFingerprint);
    const d = httpObject(s.draft); httpKeys(d, ["schemaVersion", `${kind}Id`, "versionId", "version", "expectedVersionId", "name", ...(kind === "item" ? ["contains"] : ["members", "datasetPassRateThreshold"])]);
    if (d.schemaVersion !== `custom-eval-${kind}-draft-v2`) invalid(); httpUuid(d[`${kind}Id`]); httpUuid(d.versionId); name(d.name);
    if (!Number.isInteger(d.version) || Number(d.version) < 1 || Number(d.version) > 2147483647
      || d.expectedVersionId !== null && (typeof d.expectedVersionId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(d.expectedVersionId))
      || d.version === 1 && d.expectedVersionId !== null || Number(d.version) > 1 && d.expectedVersionId === null || d.versionId === d.expectedVersionId) invalid();
    if (kind === "item") { httpText(d.contains, 4096); if (!(d.contains as string).trim()) invalid(); }
    else { itemRefs(d.members); if (typeof d.datasetPassRateThreshold !== "number" || !Number.isFinite(d.datasetPassRateThreshold) || d.datasetPassRateThreshold < 0 || d.datasetPassRateThreshold > 100) invalid(); }
    return JSON.parse(httpStable(value));
  } catch (error) { if (error instanceof EvalCompositionStoreError) throw error; return invalid(); }
}
function requestHash(kind: Kind, workspaceId: string, value: unknown) { return httpHash({ schemaVersion: `custom-eval-${kind}-save-fingerprint-v2`, workspaceId, request: value }); }
function canonical(kind: Kind, value: unknown, workspaceId: string, restore: Restore): VersionRecord {
  try {
    httpBounded(value, RECORD_LIMIT); const r = restore(value, workspaceId); httpBounded(r, RECORD_LIMIT);
    if (!httpSame(value, r) || r.schemaVersion !== `custom-eval-${kind}-record-v2` || r.workspaceId !== workspaceId
      || r.contract.schemaVersion !== `custom-eval-${kind}-v2` || r.contract.workspaceId !== workspaceId
      || !httpSame(r.storage, ids(kind, workspaceId, publicId(kind, r), r.draft.versionId))
      || r.fingerprint !== httpHash(httpWithoutFingerprint(r)) || r.contract.fingerprint !== httpHash(httpWithoutFingerprint(r.contract))) conflict();
    const req = request(kind, { schemaVersion: `custom-eval-${kind}-save-v2`, draft: r.draft, expectedPreviewFingerprint: r.previewFingerprint });
    if (r.requestFingerprint !== requestHash(kind, workspaceId, req)) conflict(); httpIso(r.createdAt);
    return r;
  } catch { return conflict(); }
}
function envelope(kind: Kind, r: VersionRecord) {
  return { schemaVersion: `custom-eval-${kind}-storage-v2`, workspaceId: r.workspaceId, [`${kind}Id`]: publicId(kind, r),
    versionId: r.draft.versionId, version: r.draft.version, recordFingerprint: r.fingerprint,
    requestFingerprint: r.requestFingerprint, recordText: httpStable(r) };
}
function metadata(kind: Kind, r: VersionRecord) {
  return { schemaVersion: `custom-eval-${kind}-audit-v2`, publicId: publicId(kind, r), publicVersionId: r.draft.versionId,
    storedVersionId: r.storage.versionId, version: r.draft.version, recordFingerprint: r.fingerprint, requestFingerprint: r.requestFingerprint };
}
interface NativeRow { id: string; aggregateId: string; workspaceId: string; aggregateName: string; type: string | null;
  version: number; fingerprint: string; createdAt: Date; raw: string | null; outputSchema: string | null }
async function readVersion<T extends VersionRecord>(client: PoolClient, kind: Kind, workspaceId: string, publicResourceId: string,
  versionId: string, restore: EvalCompositionRestore<T>, restoreItem?: EvalCompositionRestore<EvalCompositionItemRecord>): Promise<T | undefined> {
  const s = spec(kind), identity = ids(kind, workspaceId, publicResourceId, versionId), aggregate = identity[`${kind}Id`];
  const rows = (await client.query<NativeRow>(`select v.id,case when octet_length(v.${s.parentKey})<=256 then v.${s.parentKey} else null end as "aggregateId",p.workspace_id as "workspaceId",
    case when octet_length(p.name)<=480 then p.name else null end as "aggregateName",
    ${kind === "item" ? "case when octet_length(p.type)<=32 then p.type else null end" : "null::text"} as type,v.version,
    case when octet_length(v.fingerprint)<=64 then v.fingerprint else null end as fingerprint,v.created_at as "createdAt",
    case when octet_length(v.${s.column}::text)<=$3 then v.${s.column}::text else null end as raw,
    ${kind === "item" ? "case when octet_length(v.output_schema::text)<=32768 then v.output_schema::text else null end" : "null::text"} as "outputSchema"
    from ${s.versions} v join ${s.parent} p on p.id=v.${s.parentKey}
    where p.workspace_id=$1 and v.id=$2 for share of v,p`, [workspaceId, identity.versionId, STORAGE_LIMIT])).rows;
  if (!rows.length) {
    const orphan = await client.query(`select id from audit_events where id=$1 or (workspace_id=$2 and action=$3 and resource_id=$4 and metadata->>'storedVersionId'=$5) limit 1`,
      [identity.auditId, workspaceId, `custom_eval_${kind}_v2.saved`, aggregate, identity.versionId]);
    if (orphan.rows.length) conflict(); return undefined;
  }
  if (rows.length !== 1) conflict(); const row = rows[0]; let stored: Record<string, unknown>; let r: T;
  try {
    stored = httpObject(httpParseRaw(row.raw, STORAGE_LIMIT)); httpKeys(stored, ["schemaVersion", "workspaceId", `${kind}Id`, "versionId", "version", "recordFingerprint", "requestFingerprint", "recordText"]);
    if (typeof stored.recordText !== "string" || Buffer.byteLength(stored.recordText) > RECORD_LIMIT) conflict();
    r = canonical(kind, httpParseRaw(stored.recordText, RECORD_LIMIT), workspaceId, restore) as T;
    if (stored.recordText !== httpStable(r) || !httpSame(stored, envelope(kind, r)) || row.id !== r.storage.versionId
      || row.aggregateId !== aggregateId(kind, r) || aggregate !== row.aggregateId || publicId(kind, r) !== publicResourceId
      || r.draft.versionId !== versionId || row.version !== r.draft.version || row.fingerprint !== r.contract.fingerprint
      || httpIso(row.createdAt) !== r.createdAt || kind === "item" && row.type !== "string_check") conflict();
  } catch { return conflict(); }
  const params: unknown[] = [row.id, JSON.stringify(envelope(kind, r))];
  if (kind === "item") params.push(JSON.stringify((r as EvalCompositionItemRecord).contract.outputSchema));
  const native = await client.query(`select id from ${s.versions} where id=$1 and ${s.column}=$2::jsonb${kind === "item" ? " and output_schema=$3::jsonb" : ""}`, params);
  if (native.rows.length !== 1) conflict();
  const prior = (await client.query<{ id: string; fingerprint: string; recordFingerprint: string }>(`select case when octet_length(id)<=256 then id else null end as id,
    case when octet_length(fingerprint)<=64 then fingerprint else null end as fingerprint,
    case when octet_length(${s.column}->>'recordFingerprint')<=64 then ${s.column}->>'recordFingerprint' else null end as "recordFingerprint"
    from ${s.versions} where ${s.parentKey}=$1 and version=$2 limit 2`, [aggregate, r.draft.version - 1])).rows;
  if (r.draft.version === 1 ? prior.length !== 0 || r.head !== null : prior.length !== 1 || r.head === null
    || prior[0].id !== ids(kind, workspaceId, publicResourceId, r.draft.expectedVersionId as string).versionId
    || prior[0].fingerprint !== r.head?.contractFingerprint || prior[0].recordFingerprint !== r.head?.recordFingerprint) conflict();
  const audits = (await client.query<{ id: string; workspaceId: string; actor: string; action: string; resourceType: string; resourceId: string; hash: string; raw: string | null; createdAt: Date }>(
    `select id,workspace_id as "workspaceId",actor_user_id as actor,action,resource_type as "resourceType",resource_id as "resourceId",metadata_hash as hash,
      case when octet_length(metadata::text)<=16384 then metadata::text else null end as raw,created_at as "createdAt"
    from audit_events where id=$1 or (workspace_id=$2 and resource_id=$3 and action=$4 and metadata->>'storedVersionId'=$5) limit 2`,
    [identity.auditId, workspaceId, aggregate, `custom_eval_${kind}_v2.saved`, identity.versionId])).rows;
  if (audits.length !== 1) conflict(); const audit = audits[0], meta = metadata(kind, r);
  try { httpText(audit.actor); if (audit.id !== identity.auditId || audit.workspaceId !== workspaceId || audit.action !== `custom_eval_${kind}_v2.saved`
    || audit.resourceType !== `eval_${kind}` || audit.resourceId !== aggregate || audit.hash !== httpHash(meta)
    || !httpSame(httpParseRaw(audit.raw, 16384), meta) || httpIso(audit.createdAt) !== r.createdAt) conflict(); } catch { return conflict(); }
  if (kind === "set") {
    if (typeof restoreItem !== "function") conflict(); const set = r as EvalCompositionSetRecord;
    const members = (await client.query<{ itemId: string; position: number; weightOne: boolean; criticality: string }>(
      `select eval_item_version_id as "itemId",position,weight=1 as "weightOne",criticality from eval_set_item_versions
        where eval_set_version_id=$1 order by position,eval_item_version_id collate "C" limit 33 for share`, [row.id])).rows;
    if (!set.members.length || set.members.length > 32 || members.length !== set.members.length || set.contract.itemVersions.length !== members.length) conflict();
    for (let i = 0; i < members.length; i++) {
      const nativeMember = members[i], expected = set.members[i], contractMember = set.contract.itemVersions[i];
      if (nativeMember.position !== i || expected.position !== i || !nativeMember.weightOne || nativeMember.criticality !== "critical"
        || nativeMember.itemId !== expected.evalItemVersionId || expected.evalSetVersionId !== row.id || expected.weight !== 1 || expected.criticality !== "critical"
        || contractMember.weight !== 1 || contractMember.criticality !== "critical" || contractMember.item.id !== nativeMember.itemId) conflict();
      const item = await readVersion(client, "item", workspaceId, expected.publicItemId, expected.publicItemVersionId, restoreItem!);
      if (!item || item.storage.versionId !== nativeMember.itemId || item.contract.fingerprint !== expected.itemFingerprint
        || item.fingerprint !== expected.itemRecordFingerprint || !httpSame(item.contract, contractMember.item)) conflict();
    }
  }
  return r;
}
async function readHead<T extends VersionRecord>(client: PoolClient, kind: Kind, workspaceId: string, publicResourceId: string,
  restore: EvalCompositionRestore<T>, restoreItem?: EvalCompositionRestore<EvalCompositionItemRecord>): Promise<T | undefined> {
  const s = spec(kind), aggregate = ids(kind, workspaceId, publicResourceId, publicResourceId)[`${kind}Id`];
  const parent = (await client.query<{ name: string }>(`select case when octet_length(name)<=480 then name else null end as name from ${s.parent} where workspace_id=$1 and id=$2 for update`, [workspaceId, aggregate])).rows[0];
  const orphan = await client.query(`select a.id from audit_events a left join ${s.versions} v on v.id=a.metadata->>'storedVersionId'
    where a.workspace_id=$1 and a.action=$2 and a.resource_id=$3 and v.id is null limit 1`, [workspaceId, `custom_eval_${kind}_v2.saved`, aggregate]);
  if (orphan.rows.length) conflict(); if (!parent) return undefined;
  const stats = (await client.query<{ count: string; minimum: number; maximum: number }>(`select count(*)::text as count,min(version) as minimum,max(version) as maximum
    from ${s.versions} where ${s.parentKey}=$1`, [aggregate])).rows[0];
  const count = Number(stats.count); if (!Number.isSafeInteger(count) || count < 1 || count > 2147483647 || stats.minimum !== 1 || stats.maximum !== count) conflict();
  const latest = (await client.query<{ versionId: string }>(`select case when octet_length(${s.column}->>'versionId')<=36 then ${s.column}->>'versionId' else null end as "versionId"
    from ${s.versions} where ${s.parentKey}=$1 and version=$2`, [aggregate, stats.maximum])).rows[0];
  try { httpUuid(latest?.versionId); } catch { return conflict(); }
  const record = await readVersion(client, kind, workspaceId, publicResourceId, latest.versionId, restore, restoreItem);
  if (!record || record.draft.version !== count || record.draft.name !== parent.name) conflict();
  return record;
}
async function selectedItems(client: PoolClient, workspaceId: string, refs: EvalCompositionItemRef[], restore: EvalCompositionRestore<EvalCompositionItemRecord>) {
  const records: EvalCompositionItemRecord[] = [];
  for (const ref of refs) { const item = await readVersion(client, "item", workspaceId, ref.itemId, ref.versionId, restore);
    if (!item) return undefined; if (item.contract.fingerprint !== ref.fingerprint) fail(409, "eval_composition_source_conflict"); records.push(item); }
  return records;
}
async function save<T extends VersionRecord>(kind: Kind, scope: EvalCompositionScope, value: unknown,
  callbacks: { prepare(input: { workspaceId: string; request: unknown; head: unknown; createdAt: string; items: unknown[] }): T;
    restore: EvalCompositionRestore<T>; restoreItem?: EvalCompositionRestore<EvalCompositionItemRecord> }): Promise<{ record: T; replayed: boolean }> {
  checkScope(scope); if (typeof callbacks?.prepare !== "function" || typeof callbacks?.restore !== "function" || kind === "set" && typeof callbacks.restoreItem !== "function") invalid();
  const { workspaceId, actorId } = scope, req = request(kind, value), d = req.draft;
  const publicResourceId = kind === "item" ? (d as EvalCompositionItemRecord["draft"]).itemId : (d as EvalCompositionSetRecord["draft"]).setId;
  const identity = ids(kind, workspaceId, publicResourceId, d.versionId), aggregate = identity[`${kind}Id`], s = spec(kind), fp = requestHash(kind, workspaceId, req);
  return operation(() => withTransaction(async client => {
    await workspace(client, workspaceId); await lock(client, kind, workspaceId, publicResourceId);
    const replay = await readVersion(client, kind, workspaceId, publicResourceId, d.versionId, callbacks.restore, callbacks.restoreItem);
    if (replay) { if (replay.requestFingerprint !== fp || !httpSame(replay.draft, d) || replay.previewFingerprint !== req.expectedPreviewFingerprint) fail(409, "eval_composition_identity_conflict"); return { record: replay, replayed: true }; }
    const prior = await readHead(client, kind, workspaceId, publicResourceId, callbacks.restore, callbacks.restoreItem), priorHead = prior ? head(kind, prior) : null;
    if (priorHead ? d.expectedVersionId !== priorHead.versionId || d.version !== priorHead.version + 1 : d.version !== 1 || d.expectedVersionId !== null) fail(409, "eval_composition_version_conflict");
    const items = kind === "set" ? await selectedItems(client, workspaceId, (d as EvalCompositionSetRecord["draft"]).members, callbacks.restoreItem!) : [];
    if (!items) return fail(404, "eval_composition_source_not_found");
    const record = canonical(kind, callbacks.prepare({ workspaceId, request: req, head: priorHead, createdAt: await httpClock(client), items }), workspaceId, callbacks.restore) as T;
    if (record.requestFingerprint !== fp || !httpSame(record.draft, d) || record.previewFingerprint !== req.expectedPreviewFingerprint || !httpSame(record.head, priorHead)) conflict();
    if (!prior) { const inserted = await client.query(`insert into ${s.parent}(id,workspace_id,name${kind === "item" ? ",type" : ""})values($1,$2,$3${kind === "item" ? ",'string_check'" : ""}) on conflict do nothing returning id`, [aggregate, workspaceId, d.name]); if (inserted.rows.length !== 1) conflict(); }
    if (kind === "item") await client.query(`insert into eval_item_versions(id,eval_item_id,version,output_schema,config,fingerprint,created_at)values($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::timestamptz)`,
      [identity.versionId, aggregate, d.version, JSON.stringify((record as EvalCompositionItemRecord).contract.outputSchema), JSON.stringify(envelope(kind, record)), record.contract.fingerprint, record.createdAt]);
    else {
      await client.query(`insert into eval_set_versions(id,eval_set_id,version,contract,fingerprint,created_at)values($1,$2,$3,$4::jsonb,$5,$6::timestamptz)`,
        [identity.versionId, aggregate, d.version, JSON.stringify(envelope(kind, record)), record.contract.fingerprint, record.createdAt]);
      for (const member of (record as EvalCompositionSetRecord).members) await client.query(`insert into eval_set_item_versions(eval_set_version_id,eval_item_version_id,position,weight,criticality)values($1,$2,$3,1,'critical')`,
        [identity.versionId, member.evalItemVersionId, member.position]);
    }
    if ((await client.query(`update ${s.parent} set name=$3 where id=$1 and workspace_id=$2 returning id`, [aggregate, workspaceId, d.name])).rows.length !== 1) conflict();
    const meta = metadata(kind, record);
    await client.query(`insert into audit_events(id,workspace_id,actor_user_id,action,resource_type,resource_id,metadata_hash,metadata,created_at)values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::timestamptz)`,
      [identity.auditId, workspaceId, actorId, `custom_eval_${kind}_v2.saved`, `eval_${kind}`, aggregate, httpHash(meta), JSON.stringify(meta), record.createdAt]);
    const readback = await readVersion(client, kind, workspaceId, publicResourceId, d.versionId, callbacks.restore, callbacks.restoreItem);
    if (!readback || !httpSame(record, readback)) conflict(); return { record: readback, replayed: false };
  }));
}

export async function getCustomEvalItemVersionV2<T extends EvalCompositionItemRecord>(workspaceId: string, itemId: string, versionId: string,
  restore: EvalCompositionRestore<T>, client?: PoolClient): Promise<T | undefined> {
  checkRead(workspaceId, itemId, versionId); if (typeof restore !== "function") invalid();
  return operation(() => client ? readVersion(client, "item", workspaceId, itemId, versionId, restore) : withTransaction(async tx => { await workspace(tx, workspaceId); return readVersion(tx, "item", workspaceId, itemId, versionId, restore); }));
}
export async function getCustomEvalSetVersionV2<T extends EvalCompositionSetRecord>(workspaceId: string, setId: string, versionId: string,
  readers: EvalCompositionSetReaders<T>, client?: PoolClient): Promise<T | undefined> {
  checkRead(workspaceId, setId, versionId); if (typeof readers?.restoreSet !== "function" || typeof readers?.restoreItem !== "function") invalid();
  return operation(() => client ? readVersion(client, "set", workspaceId, setId, versionId, readers.restoreSet, readers.restoreItem) : withTransaction(async tx => { await workspace(tx, workspaceId); return readVersion(tx, "set", workspaceId, setId, versionId, readers.restoreSet, readers.restoreItem); }));
}
export async function getCustomEvalSetItemsV2(workspaceId: string, refs: EvalCompositionItemRef[], restoreItem: EvalCompositionRestore<EvalCompositionItemRecord>): Promise<EvalCompositionItemRecord[] | undefined> {
  checkRead(workspaceId); let selected: EvalCompositionItemRef[];
  try { httpBounded(refs, 65536); selected = itemRefs(refs); } catch { return invalid(); }
  if (typeof restoreItem !== "function") invalid();
  return operation(() => withTransaction(async client => { await workspace(client, workspaceId); return selectedItems(client, workspaceId, selected, restoreItem); }));
}
export function saveCustomEvalItemVersionV2<T extends EvalCompositionItemRecord>(scope: EvalCompositionScope, value: unknown, callbacks: EvalCompositionItemCallbacks<T>) { return save("item", scope, value, callbacks); }
export function saveCustomEvalSetVersionV2<T extends EvalCompositionSetRecord>(scope: EvalCompositionScope, value: unknown, callbacks: EvalCompositionSetCallbacks<T>) { return save("set", scope, value, callbacks); }
export async function getCustomEvalItemHeadV2<T extends EvalCompositionItemRecord>(workspaceId: string, itemId: string, restore: EvalCompositionRestore<T>): Promise<EvalCompositionItemHead | null> {
  checkRead(workspaceId, itemId); if (typeof restore !== "function") invalid();
  return operation(() => withTransaction(async client => { await workspace(client, workspaceId); await lock(client, "item", workspaceId, itemId); const r = await readHead(client, "item", workspaceId, itemId, restore); return r ? head("item", r) as EvalCompositionItemHead : null; }));
}
export async function getCustomEvalSetHeadV2<T extends EvalCompositionSetRecord>(workspaceId: string, setId: string, restoreSet: EvalCompositionRestore<T>, restoreItem: EvalCompositionRestore<EvalCompositionItemRecord>): Promise<EvalCompositionSetHead | null> {
  checkRead(workspaceId, setId); if (typeof restoreSet !== "function" || typeof restoreItem !== "function") invalid();
  return operation(() => withTransaction(async client => { await workspace(client, workspaceId); await lock(client, "set", workspaceId, setId); const r = await readHead(client, "set", workspaceId, setId, restoreSet, restoreItem); return r ? head("set", r) as EvalCompositionSetHead : null; }));
}

interface MetadataRow { aggregateId: string; aggregateName: string; count: string; minimum: number; maximum: number; id: string;
  version: number; fingerprint: string; createdAt: Date; envelope: unknown; publicId: unknown; versionId: unknown; name: unknown;
  contractFingerprint: unknown; recordFingerprint: unknown; recordWorkspace: unknown; recordSchema: unknown; recordStorage: unknown;
  recordCreatedAt: unknown; recordVersion: unknown; memberCount: unknown }
function metadataColumns(kind: Kind) {
  const s = spec(kind), text = `v.${s.column}->>'recordText'`, record = `(case when octet_length(${text})<=${RECORD_LIMIT} then (${text})::jsonb else null end)`;
  const bounded = (expression: string, bytes: number) => `case when octet_length((${expression})::text)<=${bytes} then ${expression} else null end`;
  return `${bounded("p.id",256)} as "aggregateId",${bounded("p.name",480)} as "aggregateName",statistics.count,statistics.minimum,statistics.maximum,${bounded("v.id",256)} as id,v.version,${bounded("v.fingerprint",64)} as fingerprint,v.created_at as "createdAt",
    ${bounded(`v.${s.column}-'recordText'`,16384)} as envelope,${bounded(`${record}#>>'{draft,${kind}Id}'`,36)} as "publicId",${bounded(`${record}#>>'{draft,versionId}'`,36)} as "versionId",${bounded(`${record}#>>'{draft,name}'`,480)} as name,
    ${bounded(`${record}#>>'{contract,fingerprint}'`,64)} as "contractFingerprint",${bounded(`${record}->>'fingerprint'`,64)} as "recordFingerprint",${bounded(`${record}->>'workspaceId'`,512)} as "recordWorkspace",
    ${bounded(`${record}->>'schemaVersion'`,64)} as "recordSchema",${bounded(`${record}->'storage'`,2048)} as "recordStorage",${bounded(`${record}->>'createdAt'`,24)} as "recordCreatedAt",${bounded(`${record}#>'{draft,version}'`,16)} as "recordVersion",
    ${kind === "set" ? `case when jsonb_typeof(${record}->'members')='array' then jsonb_array_length(${record}->'members') else null end` : "0"} as "memberCount"`;
}
function statistics(kind: Kind) { const s = spec(kind); return `cross join lateral(select count(*)::text as count,min(version) as minimum,max(version) as maximum from ${s.versions} where ${s.parentKey}=p.id) statistics`; }
function validateMetadata(kind: Kind, workspaceId: string, row: MetadataRow): (Head & { createdAt: string; memberCount: number }) {
  try {
    httpUuid(row.publicId); httpUuid(row.versionId); name(row.name); fingerprint(row.contractFingerprint); fingerprint(row.recordFingerprint);
    const identity = ids(kind, workspaceId, row.publicId as string, row.versionId as string), e = httpObject(row.envelope);
    httpKeys(e, ["schemaVersion", "workspaceId", `${kind}Id`, "versionId", "version", "recordFingerprint", "requestFingerprint"]); fingerprint(e.requestFingerprint);
    if (e.schemaVersion !== `custom-eval-${kind}-storage-v2` || e.workspaceId !== workspaceId || e[`${kind}Id`] !== row.publicId
      || e.versionId !== row.versionId || e.version !== row.version || e.recordFingerprint !== row.recordFingerprint
      || row.aggregateId !== identity[`${kind}Id`] || row.id !== identity.versionId || row.fingerprint !== row.contractFingerprint
      || row.recordWorkspace !== workspaceId || row.recordSchema !== `custom-eval-${kind}-record-v2` || !httpSame(row.recordStorage, identity)
      || row.recordVersion !== row.version || row.recordCreatedAt !== httpIso(row.createdAt) || !Number.isInteger(row.version) || row.version < 1
      || !Number.isInteger(row.memberCount) || Number(row.memberCount) < (kind === "set" ? 1 : 0) || Number(row.memberCount) > 32) conflict();
    return { [`${kind}Id`]: row.publicId, versionId: row.versionId, version: row.version, name: row.name,
      contractFingerprint: row.contractFingerprint, recordFingerprint: row.recordFingerprint, createdAt: row.recordCreatedAt, memberCount: row.memberCount } as unknown as Head & { createdAt: string; memberCount: number };
  } catch { return conflict(); }
}
async function list(kind: Kind, workspaceId: string) {
  checkRead(workspaceId); const s = spec(kind);
  return operation(() => withTransaction(async client => { await workspace(client, workspaceId);
    const rows = (await client.query<MetadataRow>(`select ${metadataColumns(kind)} from ${s.parent} p ${statistics(kind)}
      left join lateral(select * from ${s.versions} where ${s.parentKey}=p.id order by version desc limit 1) v on true
      where p.workspace_id=$1 and (left(p.id,length($2))=$2 or exists(select 1 from ${s.versions} x where x.${s.parentKey}=p.id and x.${s.column}->>'schemaVersion'=$3))
      order by p.name collate "C",p.id collate "C" limit 100`, [workspaceId, `custom_eval_${kind}_v2_`, `custom-eval-${kind}-storage-v2`])).rows;
    return rows.map(row => { const h = validateMetadata(kind, workspaceId, row), count = Number(row.count);
      if (!Number.isSafeInteger(count) || count !== h.version || row.minimum !== 1 || row.maximum !== count || h.name !== row.aggregateName) conflict();
      const { createdAt: _createdAt, memberCount, ...summaryHead } = h;
      return { [`${kind}Id`]: kind === "item" ? (h as EvalCompositionItemHead).itemId : (h as EvalCompositionSetHead).setId,
        name: h.name, versionCount: count, head: summaryHead, ...(kind === "set" ? { memberCount } : {}) };
    });
  }));
}
export async function listCustomEvalItemsV2(workspaceId: string, restore: EvalCompositionRestore<EvalCompositionItemRecord>): Promise<EvalCompositionItemSummary[]> {
  if (typeof restore !== "function") invalid(); return await list("item", workspaceId) as unknown as EvalCompositionItemSummary[];
}
export async function listCustomEvalSetsV2(workspaceId: string, restoreSet: EvalCompositionRestore<EvalCompositionSetRecord>, restoreItem: EvalCompositionRestore<EvalCompositionItemRecord>): Promise<EvalCompositionSetSummary[]> {
  if (typeof restoreSet !== "function" || typeof restoreItem !== "function") invalid(); return await list("set", workspaceId) as unknown as EvalCompositionSetSummary[];
}
/** Metadata only. Exact source loading validates the full canonical record, native members and audits. */
export async function listCustomEvalSetVersionsV2(workspaceId: string): Promise<{ versions: Array<EvalCompositionSetHead & { createdAt: string; memberCount: number }>; hasMore: boolean }> {
  checkRead(workspaceId);
  return operation(() => withTransaction(async client => { await workspace(client, workspaceId);
    const rows = (await client.query<MetadataRow>(`select ${metadataColumns("set")} from eval_sets p ${statistics("set")}
      join eval_set_versions v on v.eval_set_id=p.id where p.workspace_id=$1 and (
        left(p.id,length('custom_eval_set_v2_'))='custom_eval_set_v2_' or left(v.id,length('custom_eval_set_version_v2_'))='custom_eval_set_version_v2_'
        or v.contract->>'schemaVersion' in ('custom-eval-set-storage-v2','custom-eval-set-record-v2','custom-eval-set-v2'))
      order by v.created_at desc,v.id collate "C" desc limit 101`, [workspaceId])).rows;
    return { versions: rows.slice(0,100).map(row => validateMetadata("set", workspaceId, row) as EvalCompositionSetHead & { createdAt: string; memberCount: number }), hasMore: rows.length > 100 };
  }));
}
async function detail<T extends VersionRecord>(kind: Kind, workspaceId: string, publicResourceId: string, restore: EvalCompositionRestore<T>, restoreItem?: EvalCompositionRestore<EvalCompositionItemRecord>) {
  checkRead(workspaceId, publicResourceId); if (typeof restore !== "function" || kind === "set" && typeof restoreItem !== "function") invalid(); const s = spec(kind);
  return operation(() => withTransaction(async client => { await workspace(client, workspaceId); await lock(client, kind, workspaceId, publicResourceId);
    const current = await readHead(client, kind, workspaceId, publicResourceId, restore, restoreItem); if (!current) return undefined;
    const rows = (await client.query<MetadataRow>(`select ${metadataColumns(kind)} from ${s.parent} p ${statistics(kind)} join lateral(
      select * from ${s.versions} where ${s.parentKey}=p.id order by version desc limit 21) v on true where p.workspace_id=$1 and p.id=$2 order by v.version desc`, [workspaceId, aggregateId(kind, current)])).rows;
    const versions = rows.map(row => { const v = validateMetadata(kind, workspaceId, row); const { memberCount, ...item } = v; return kind === "item" ? item : v; });
    if (!versions.length || versions[0].recordFingerprint !== current.fingerprint) conflict();
    return { schemaVersion: `custom-eval-${kind}-detail-v2`, [`${kind}Id`]: publicResourceId, head: head(kind, current), versions: versions.slice(0,20), hasMore: versions.length > 20 };
  }));
}
export async function getCustomEvalItemV2<T extends EvalCompositionItemRecord>(workspaceId: string, itemId: string, restore: EvalCompositionRestore<T>): Promise<EvalCompositionItemDetail | undefined> {
  return await detail("item", workspaceId, itemId, restore) as EvalCompositionItemDetail | undefined;
}
export async function getCustomEvalSetV2<T extends EvalCompositionSetRecord>(workspaceId: string, setId: string, restoreSet: EvalCompositionRestore<T>, restoreItem: EvalCompositionRestore<EvalCompositionItemRecord>): Promise<EvalCompositionSetDetail | undefined> {
  return await detail("set", workspaceId, setId, restoreSet, restoreItem) as EvalCompositionSetDetail | undefined;
}

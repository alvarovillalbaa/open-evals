import type { PoolClient } from "pg";
import { getCustomEvalSetVersion } from "./custom-evals";
import { getCustomEvalSetVersionV2, listCustomEvalSetVersionsV2 } from "./eval-composition";
import { listProvidedOutputSources } from "./provided-output-runs";
import { loadCustomAwareDatasetSnapshot } from "./custom-datasets";
import { queryRows, withTransaction } from "./service";
import { HTTP_RECORD_LIMIT, httpBounded, httpClock, httpConflict, httpFail, httpFingerprint, httpHash,
  httpIso, httpKeys, httpObject, httpOperation, httpParseRaw, httpPlanIds, httpSame, httpStable, httpText, httpUuid,
  httpWithoutFingerprint, httpWorkspace, httpProfileVersion, httpTag, type HttpEvalStoreHead,
  type HttpEvalStoreDraft, type HttpEvalStoreSetRef, type HttpEvalStoreCompositionReaders, type HttpEvalStoreFamily,
  type HttpEvalStorePlan, type HttpEvalStorePlanCallbacks, type HttpEvalStoreSaveRequest } from "./http-eval-types";

const VERSION_ID = /^http_eval_plan_version_[0-9a-f]{64}$/;
// A canonical JSON string can double when quoted by JSONB; the fixed metadata index is <64 KiB.
const STORAGE_LIMIT = 2 * HTTP_RECORD_LIMIT + 65536;
const PRIVATE = `(left(id, length('http_eval_plan_')) = 'http_eval_plan_'
  or resolved_plan ->> 'schemaVersion' in ('http-target-eval-v1', 'http-eval-plan-record-v1', 'http-eval-plan-storage-v1','http-target-eval-v2','http-eval-plan-record-v2','http-eval-plan-storage-v2')
  or resolved_plan #>> '{content,schemaVersion}' in ('http-target-eval-v1','http-target-eval-v2'))`;
export interface HttpEvalPlanSummary {
  planId: string; versionId: string; storageVersionId: string; version: number; name: string;
  fingerprint: string; createdAt: string;
  family: HttpEvalStoreFamily;
}
function saveRequest(value: unknown): HttpEvalStoreSaveRequest {
  httpBounded(value, 2 * 1024 * 1024); const s = httpObject(value);
  httpKeys(s, ["schemaVersion", "draft", "expectedPreviewFingerprint"]);
  if (s.schemaVersion !== "http-eval-plan-save-v1" && s.schemaVersion !== "http-eval-plan-save-v2") httpFail(422, "http_eval_invalid");
  const version = httpProfileVersion(s as {schemaVersion:string});
  httpFingerprint(s.expectedPreviewFingerprint);
  const d = httpObject(s.draft);
  httpKeys(d, ["schemaVersion", "planId", "versionId", "version", "expectedVersionId", "name", "datasetVersionId", version === 1 ? "evalSetVersionIds" : "evalSetVersions", "target", "limits"]);
  if (d.schemaVersion !== httpTag("http-eval-plan-draft",version)) httpFail(422, "http_eval_invalid");
  httpUuid(d.planId); httpUuid(d.versionId); httpText(d.name, 4096); httpText(d.datasetVersionId);
  if (d.expectedVersionId !== null) httpUuid(d.expectedVersionId);
  if (!Number.isInteger(d.version) || Number(d.version) < 1 || Number(d.version) > 2_147_483_647
    || d.version === 1 && d.expectedVersionId !== null || Number(d.version) > 1 && d.expectedVersionId === null
    || d.versionId === d.expectedVersionId) httpFail(422, "http_eval_invalid");
  selection(d);
  // Trusted core preparation validates the complete endpoint/capability/limit contract before insertion.
  return JSON.parse(JSON.stringify(value)) as HttpEvalStoreSaveRequest;
}
function requestFingerprint(workspaceId: string, request: HttpEvalStoreSaveRequest) {
  return httpHash({ schemaVersion: httpTag("http-eval-plan-save-fingerprint",httpProfileVersion(request)), workspaceId, request });
}
export function httpPlanHead(record: HttpEvalStorePlan): HttpEvalStoreHead {
  const d = record.content.draft;
  return { planId: d.planId, versionId: d.versionId, version: d.version, name: d.name, fingerprint: record.fingerprint,
    ...(record.schemaVersion==="http-eval-plan-record-v2"?{profile:"http-target-eval-v2" as const}:{}) };
}
export function httpCanonicalPlan<P extends HttpEvalStorePlan>(value: unknown, workspaceId: string, parse: (value: unknown) => P): P {
  let r: P;
  try { httpBounded(value); r = parse(value); httpBounded(r); }
  catch { return httpConflict(); }
  const d = r.content.draft;
  if (r.schemaVersion !== "http-eval-plan-record-v1" && r.schemaVersion !== "http-eval-plan-record-v2") httpConflict();
  const version=httpProfileVersion(r);
  if (!httpSame(value, r) || r.content.schemaVersion !== httpTag("http-target-eval",version) || d.schemaVersion !== httpTag("http-eval-plan-draft",version)
    || r.workspaceId !== workspaceId || !httpSame(r.storage, httpPlanIds(workspaceId, d.planId, d.versionId))
    || r.fingerprint !== httpHash(httpWithoutFingerprint(r)) || r.content.fingerprint !== httpHash(httpWithoutFingerprint(r.content))
    || r.requestFingerprint !== requestFingerprint(workspaceId, { schemaVersion: httpTag("http-eval-plan-save",version), draft: d, expectedPreviewFingerprint: r.previewFingerprint })) httpConflict();
  httpIso(r.createdAt); httpUuid(d.planId); httpUuid(d.versionId);
  if (!Number.isInteger(d.version) || d.version < 1 || d.version > 2_147_483_647 || !r.content.samples.length || r.content.samples.length > 100
    || !r.content.items.length || r.content.items.length > 32 || r.content.evalSets.length !== (d.schemaVersion === "http-eval-plan-draft-v1" ? d.evalSetVersionIds.length : d.evalSetVersions.length)) httpConflict();
  if (r.head ? r.head.planId !== d.planId || r.head.versionId !== d.expectedVersionId || r.head.version + 1 !== d.version : d.expectedVersionId !== null || d.version !== 1) httpConflict();
  return r;
}
function auditMetadata(record: HttpEvalStorePlan) {
  return { schemaVersion: httpTag("http-eval-plan-audit",httpProfileVersion(record)), planId: record.content.draft.planId,
    versionId: record.content.draft.versionId, storageVersionId: record.storage.versionId,
    requestFingerprint: record.requestFingerprint, recordFingerprint: record.fingerprint };
}
function planStorage(record: HttpEvalStorePlan) {
  const d=record.content.draft;
  return {schemaVersion:httpTag("http-eval-plan-storage",httpProfileVersion(record)),workspaceId:record.workspaceId,storage:record.storage,createdAt:record.createdAt,
    content:{schemaVersion:record.content.schemaVersion,draft:{planId:d.planId,versionId:d.versionId,version:d.version,name:d.name}},
    fingerprint:record.fingerprint,recordText:httpStable(record)};
}
function storedPlan<P extends HttpEvalStorePlan>(raw:unknown,workspaceId:string,parse:(value:unknown)=>P):P {
  const storage=httpObject(httpParseRaw(raw,STORAGE_LIMIT));
  try {httpKeys(storage,["schemaVersion","workspaceId","storage","createdAt","content","fingerprint","recordText"]);}catch{return httpConflict();}
  if((storage.schemaVersion!=="http-eval-plan-storage-v1"&&storage.schemaVersion!=="http-eval-plan-storage-v2")||typeof storage.recordText!=="string"
    ||Buffer.byteLength(storage.recordText)>HTTP_RECORD_LIMIT)httpConflict();
  const record=httpCanonicalPlan(httpParseRaw(storage.recordText),workspaceId,parse);
  if(storage.recordText!==httpStable(record)||!httpSame(storage,planStorage(record)))httpConflict();
  return record;
}
export async function httpReadPlan<P extends HttpEvalStorePlan>(client: PoolClient, workspaceId: string,
  storageVersionId: string, parse: (value: unknown) => P): Promise<P | undefined> {
  if (!VERSION_ID.test(storageVersionId)) httpFail(422, "http_eval_invalid");
  const rows = (await client.query<{ id: string; workspaceId: string; raw: string | null; fingerprint: string; createdAt: Date }>(
    `select id, workspace_id as "workspaceId", fingerprint, created_at as "createdAt",
      case when octet_length(resolved_plan::text) <= $3 then resolved_plan::text else null end as raw
      from run_plans where workspace_id = $1 and id = $2 for share`, [workspaceId, storageVersionId, STORAGE_LIMIT])).rows;
  if (!rows.length) {
    const orphan = await client.query(`select id from audit_events where workspace_id = $1
      and resource_id = $2 and (resource_type = 'http_eval_plan_version' or action = 'http_eval.plan.saved') limit 1`, [workspaceId, storageVersionId]);
    if (orphan.rows.length) httpConflict();
    return undefined;
  }
  const row = rows[0], record = storedPlan(row.raw, workspaceId, parse);
  if (record.storage.versionId !== row.id || row.fingerprint !== record.fingerprint || httpIso(row.createdAt) !== record.createdAt) httpConflict();
  const exact = await client.query(`select id from run_plans where workspace_id = $1 and id = $2 and resolved_plan = $3::jsonb`,
    [workspaceId, row.id, JSON.stringify(planStorage(record))]);
  if (exact.rows.length !== 1) httpConflict();
  const audits = (await client.query<{ id: string; workspaceId: string; actor: string; action: string; type: string; resource: string;
    hash: string; raw: string | null; createdAt: Date }>(`select id, workspace_id as "workspaceId", actor_user_id as actor, action,
      resource_type as type, resource_id as resource, metadata_hash as hash,
      case when octet_length(metadata::text)<=16384 then metadata::text else null end as raw, created_at as "createdAt"
      from audit_events where id = $1 or (workspace_id = $2 and resource_id = $3 and
      (action = 'http_eval.plan.saved' or resource_type = 'http_eval_plan_version')) limit 2`, [record.storage.auditId, workspaceId, storageVersionId])).rows;
  if (audits.length !== 1) httpConflict();
  const audit = audits[0], metadata = auditMetadata(record);
  try { httpText(audit.actor); } catch { return httpConflict(); }
  if (audit.id !== record.storage.auditId || audit.workspaceId !== workspaceId || audit.action !== "http_eval.plan.saved"
    || audit.type !== "http_eval_plan_version" || audit.resource !== row.id || audit.hash !== httpHash(metadata)
    || !httpSame(httpParseRaw(audit.raw), metadata) || httpIso(audit.createdAt) !== record.createdAt) httpConflict();
  return record;
}
export async function httpPlanLock(client: PoolClient, workspaceId: string, publicPlanId: string): Promise<void> {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`http-eval-plan-v1:${workspaceId}:${publicPlanId}`]);
}
async function readHead<P extends HttpEvalStorePlan>(client: PoolClient, workspaceId: string, planId: string,
  parse: (value: unknown) => P): Promise<P | undefined> {
  const aggregateId = httpPlanIds(workspaceId, planId, planId).planId;
  const orphan = await client.query(`select a.id from audit_events a left join run_plans p on p.id=a.resource_id and p.workspace_id=a.workspace_id
    where a.workspace_id=$1 and a.action='http_eval.plan.saved' and a.metadata ->> 'planId'=$2 and p.id is null limit 1`, [workspaceId,planId]);
  if (orphan.rows.length) httpConflict();
  const rows = (await client.query<{ id: string }>(`select id from run_plans where workspace_id = $1 and ${PRIVATE}
    and (resolved_plan #>> '{content,draft,planId}' = $2 or resolved_plan #>> '{storage,planId}' = $3
      or id in (select resource_id from audit_events where workspace_id=$1 and action='http_eval.plan.saved' and metadata ->> 'planId'=$2))
    order by resolved_plan #> '{content,draft,version}' desc, created_at desc, id collate "C" desc limit 2`, [workspaceId, planId, aggregateId])).rows;
  if (!rows.length) return undefined;
  if (!VERSION_ID.test(rows[0].id)) httpConflict();
  const record = await httpReadPlan(client, workspaceId, rows[0].id, parse);
  if (!record || record.content.draft.planId !== planId) httpConflict();
  const mixed=await client.query(`select id from run_plans where workspace_id=$1 and ${PRIVATE}
    and (resolved_plan #>> '{content,draft,planId}'=$2 or resolved_plan #>> '{storage,planId}'=$3)
    and resolved_plan #>> '{content,schemaVersion}' is distinct from $4 limit 1`,[workspaceId,planId,aggregateId,record.content.schemaVersion]);
  if(mixed.rows.length) httpConflict();
  if (rows[1]) {
    const second = (await client.query<{ version: unknown }>(`select resolved_plan #> '{content,draft,version}' as version from run_plans where id = $1`, [rows[1].id])).rows[0];
    if (!second || second.version === record.content.draft.version) httpConflict();
  }
  return record;
}
type Selection = { datasetVersionId: string; evalSetVersionIds: string[] } | { schemaVersion: "http-eval-plan-draft-v2"; datasetVersionId: string; evalSetVersions: HttpEvalStoreSetRef[] };
function selection(value: unknown): Selection {
  const s=httpObject(value);httpBounded(s,2*1024*1024);httpText(s.datasetVersionId);
  if(s.schemaVersion!==undefined&&s.schemaVersion!=="http-eval-plan-draft-v1"&&s.schemaVersion!=="http-eval-plan-draft-v2")httpFail(422,"http_eval_invalid");
  if(s.schemaVersion!=="http-eval-plan-draft-v2"){
    if(!Array.isArray(s.evalSetVersionIds)||!s.evalSetVersionIds.length||s.evalSetVersionIds.length>8||new Set(s.evalSetVersionIds).size!==s.evalSetVersionIds.length)httpFail(422,"http_eval_invalid");
    for(const id of s.evalSetVersionIds)httpUuid(id);
    return {datasetVersionId:s.datasetVersionId as string,evalSetVersionIds:[...s.evalSetVersionIds] as string[]};
  }
  if(!Array.isArray(s.evalSetVersions)||!s.evalSetVersions.length||s.evalSetVersions.length>8)httpFail(422,"http_eval_invalid");
  const seen=new Set<string>();const refs=s.evalSetVersions.map(value=>{const r=httpObject(value);httpKeys(r,["schemaVersion","setId","versionId","fingerprint"]);
    if(r.schemaVersion!=="custom-eval-set-ref-v1"&&r.schemaVersion!=="custom-eval-set-ref-v2")httpFail(422,"http_eval_invalid");
    httpUuid(r.setId);httpUuid(r.versionId);httpFingerprint(r.fingerprint);const key=`${r.schemaVersion}:${r.setId}:${r.versionId}`;
    if(seen.has(key))httpFail(422,"http_eval_invalid");seen.add(key);return {...r} as unknown as HttpEvalStoreSetRef;
  });return {schemaVersion:"http-eval-plan-draft-v2",datasetVersionId:s.datasetVersionId as string,evalSetVersions:refs};
}
export async function getHttpEvalPlanSources(workspaceId: string, value: Selection | HttpEvalStoreDraft, readers?: HttpEvalStoreCompositionReaders) {
  httpText(workspaceId);const selected=selection(value);
  return httpOperation(() => withTransaction(async client => { await httpWorkspace(client, workspaceId); return sources(client, workspaceId, selected,readers); }));
}
async function sources(client: PoolClient, workspaceId: string, selected: Selection | HttpEvalStoreDraft, readers?: Partial<HttpEvalStoreCompositionReaders>) {
  const dataset = await loadCustomAwareDatasetSnapshot(client, workspaceId, selected.datasetVersionId, httpFail);
  if (!dataset) return undefined;
  const evalSets: HttpEvalStorePlan["content"]["evalSets"] = [];
  if("evalSetVersionIds" in selected){
    for (const id of selected.evalSetVersionIds) {const saved = await getCustomEvalSetVersion(workspaceId,id,client);if(!saved)return undefined;evalSets.push(saved);}
  }else for(const ref of selected.evalSetVersions){
    if(ref.schemaVersion==="custom-eval-set-ref-v1"){
      const saved=await getCustomEvalSetVersion(workspaceId,ref.versionId,client);if(!saved)return undefined;
      if(saved.contract.setId!==ref.setId||saved.contract.fingerprint!==ref.fingerprint)httpFail(409,"http_eval_source_conflict");
      evalSets.push({ref,contract:saved.contract,members:saved.members,sourceRecordFingerprint:null});
    }else{
      if(typeof readers?.restoreSet!=="function"||typeof readers?.restoreItem!=="function")httpFail(422,"http_eval_callbacks_required");
      const saved=await getCustomEvalSetVersionV2(workspaceId,ref.setId,ref.versionId,{restoreSet:readers.restoreSet,restoreItem:readers.restoreItem},client);
      if(!saved)return undefined;if(saved.contract.fingerprint!==ref.fingerprint)httpFail(409,"http_eval_source_conflict");
      evalSets.push({ref,contract:saved.contract,members:saved.members,sourceRecordFingerprint:saved.fingerprint});
    }
  }
  return { dataset, evalSets };
}
/** Two independently bounded metadata lanes; immutable v1 supplied-output selectors are unchanged. */
export async function listHttpEvalSources(workspaceId:string){
  const [v1,v2]=await Promise.all([listProvidedOutputSources(workspaceId),listCustomEvalSetVersionsV2(workspaceId)]);
  const evalSets:Array<{ref:HttpEvalStoreSetRef;name:string;version:number}>=[
    ...v1.evalSets.map(row=>({ref:{schemaVersion:"custom-eval-set-ref-v1" as const,setId:row.setId,versionId:row.versionId,fingerprint:row.fingerprint},name:row.name,version:row.version})),
    ...v2.versions.map(row=>({ref:{schemaVersion:"custom-eval-set-ref-v2" as const,setId:row.setId,versionId:row.versionId,fingerprint:row.contractFingerprint},name:row.name,version:row.version}))];
  return {datasets:v1.datasets,datasetsHasMore:v1.datasetsHasMore,evalSets,evalSetsHasMore:v1.evalSetsHasMore||v2.hasMore};
}
export async function getHttpEvalPlanHead<P extends HttpEvalStorePlan>(workspaceId: string, planId: string, parse: (value: unknown) => P): Promise<HttpEvalStoreHead | null> {
  httpText(workspaceId); httpUuid(planId);
  return httpOperation(() => withTransaction(async client => {
    await httpWorkspace(client, workspaceId); await httpPlanLock(client, workspaceId, planId);
    const record = await readHead(client, workspaceId, planId, parse); return record ? httpPlanHead(record) : null;
  }));
}
export async function getHttpEvalPlanVersion<P extends HttpEvalStorePlan>(workspaceId: string, planId: string, versionId: string,
  parse: (value: unknown) => P): Promise<P | undefined> {
  httpText(workspaceId); httpUuid(planId); httpUuid(versionId);
  return httpOperation(() => withTransaction(async client => { await httpWorkspace(client, workspaceId);
    return httpReadPlan(client, workspaceId, httpPlanIds(workspaceId, planId, versionId).versionId, parse); }));
}
export async function saveHttpEvalPlanVersion<P extends HttpEvalStorePlan>(scope: { workspaceId: string; actorId: string },
  value: unknown, callbacks: HttpEvalStorePlanCallbacks<P>): Promise<{ record: P; replayed: boolean }> {
  httpText(scope.workspaceId); httpText(scope.actorId);
  if (typeof callbacks?.prepare !== "function" || typeof callbacks?.parse !== "function") httpFail(422, "http_eval_callbacks_required");
  const { workspaceId, actorId } = scope, req = saveRequest(value), expected = requestFingerprint(workspaceId, req);
  const { prepare, parse } = callbacks, ids = httpPlanIds(workspaceId, req.draft.planId, req.draft.versionId);
  return httpOperation(() => withTransaction(async client => {
    await httpWorkspace(client, workspaceId); await httpPlanLock(client, workspaceId, req.draft.planId);
    const replay = await httpReadPlan(client, workspaceId, ids.versionId, parse);
    if (replay) { if (replay.requestFingerprint !== expected) httpConflict(); return { record: replay, replayed: true }; }
    const prior = await readHead(client, workspaceId, req.draft.planId, parse), head = prior ? httpPlanHead(prior) : null;
    if(prior&&httpProfileVersion(prior)!==httpProfileVersion(req))httpFail(409,"http_eval_plan_family_conflict");
    if (head ? head.versionId !== req.draft.expectedVersionId || head.version + 1 !== req.draft.version : req.draft.expectedVersionId !== null || req.draft.version !== 1) httpFail(409, "http_eval_plan_stale");
    const selected = await sources(client, workspaceId, req.draft,callbacks);
    if (!selected) httpFail(404, "http_eval_not_found");
    const record = httpCanonicalPlan(prepare({ workspaceId, request: req, ...selected, head, createdAt: await httpClock(client) }), workspaceId, parse);
    if (record.requestFingerprint !== expected || record.previewFingerprint !== req.expectedPreviewFingerprint || !httpSame(record.content.draft, req.draft)
      || !httpSame(record.content.dataset, selected.dataset) || !httpSame(record.content.evalSets, selected.evalSets)
      || !httpSame(record.head, head)) httpFail(409, "http_eval_preview_stale");
    const collision = await client.query("select id from run_plans where id = $1 or fingerprint = $2", [ids.versionId, record.fingerprint]);
    if (collision.rows.length) httpConflict();
    await client.query(`insert into run_plans (id, workspace_id, resolved_plan, fingerprint, created_at) values ($1,$2,$3::jsonb,$4,$5::timestamptz)`,
      [ids.versionId, workspaceId, JSON.stringify(planStorage(record)), record.fingerprint, record.createdAt]);
    const metadata = auditMetadata(record);
    await client.query(`insert into audit_events (id,workspace_id,actor_user_id,action,resource_type,resource_id,metadata_hash,metadata,created_at)
      values ($1,$2,$3,'http_eval.plan.saved','http_eval_plan_version',$4,$5,$6::jsonb,$7::timestamptz)`,
      [ids.auditId, workspaceId, actorId, ids.versionId, httpHash(metadata), JSON.stringify(metadata), record.createdAt]);
    const readback = await httpReadPlan(client, workspaceId, ids.versionId, parse);
    if (!readback || !httpSame(readback, record)) httpConflict();
    return { record: readback, replayed: false };
  }));
}
interface SummaryRow { id: string; planId: string; versionId: string; version: number; name: string; fingerprint: string; createdAt: Date;
  recordFingerprint: string; recordCreatedAt: string; storageVersionId: string; storagePlanId: string; family:HttpEvalStoreFamily; storageSchema:string }
const summaryColumn=(expression:string,maximum:number)=>`case when octet_length((${expression})::text)<=${maximum} then ${expression} else null end`;
const SUMMARY = `${summaryColumn("id",256)} as id, ${summaryColumn("resolved_plan #>> '{content,draft,planId}'",36)} as "planId", ${summaryColumn("resolved_plan #>> '{content,draft,versionId}'",36)} as "versionId",
  ${summaryColumn("resolved_plan #> '{content,draft,version}'",16)} as version, ${summaryColumn("resolved_plan #>> '{content,draft,name}'",4096)} as name,
  ${summaryColumn("fingerprint",64)} as fingerprint, created_at as "createdAt",
  ${summaryColumn("resolved_plan ->> 'fingerprint'",64)} as "recordFingerprint", ${summaryColumn("resolved_plan ->> 'createdAt'",24)} as "recordCreatedAt",
  ${summaryColumn("resolved_plan #>> '{storage,versionId}'",256)} as "storageVersionId", ${summaryColumn("resolved_plan #>> '{storage,planId}'",256)} as "storagePlanId",
  ${summaryColumn("resolved_plan #>> '{content,schemaVersion}'",64)} as family,${summaryColumn("resolved_plan->>'schemaVersion'",64)} as "storageSchema"`;
function summary(workspaceId: string, row: SummaryRow): HttpEvalPlanSummary {
  try { httpUuid(row.planId); httpUuid(row.versionId); httpText(row.name, 4096); httpFingerprint(row.fingerprint);
    const ids = httpPlanIds(workspaceId, row.planId, row.versionId);
    if (row.id !== ids.versionId || row.storageVersionId !== ids.versionId || row.storagePlanId !== ids.planId
      || row.recordFingerprint !== row.fingerprint || row.recordCreatedAt !== httpIso(row.createdAt)
      || !Number.isInteger(row.version) || row.version < 1 || row.version > 2_147_483_647
      || (row.family!=="http-target-eval-v1"&&row.family!=="http-target-eval-v2")||row.storageSchema!==httpTag("http-eval-plan-storage",httpProfileVersion({schemaVersion:row.family}))) httpConflict();
    return { planId: row.planId, versionId: row.versionId, storageVersionId: row.id, version: row.version, name: row.name, fingerprint: row.fingerprint, createdAt: httpIso(row.createdAt),family:row.family };
  } catch { return httpConflict(); }
}
/** Bounded metadata catalogue; exact version/head readers perform full snapshot and audit parity. */
export async function listHttpEvalPlans(workspaceId: string): Promise<{ plans: HttpEvalPlanSummary[]; hasMore: boolean }> {
  httpText(workspaceId);
  return httpOperation(async () => {
    const rows = await queryRows<SummaryRow>(`select * from (select distinct on (resolved_plan #>> '{content,draft,planId}') ${SUMMARY}
      from run_plans where workspace_id = $1 and ${PRIVATE} order by resolved_plan #>> '{content,draft,planId}',
      resolved_plan #> '{content,draft,version}' desc, created_at desc, id collate "C" desc) heads
      order by "createdAt" desc, id collate "C" desc limit 101`, [workspaceId]);
    return { plans: rows.slice(0,100).map(row => summary(workspaceId,row)), hasMore: rows.length > 100 };
  });
}
export async function getHttpEvalPlan(workspaceId: string, planId: string): Promise<{ planId: string; versions: HttpEvalPlanSummary[]; hasMore: boolean } | undefined> {
  httpText(workspaceId); httpUuid(planId);
  return httpOperation(async () => {
    const rows = await queryRows<SummaryRow>(`select ${SUMMARY} from run_plans where workspace_id = $1 and ${PRIVATE}
      and (resolved_plan #>> '{content,draft,planId}' = $2 or resolved_plan #>> '{storage,planId}' = $3
        or id in (select resource_id from audit_events where workspace_id=$1 and action='http_eval.plan.saved' and metadata ->> 'planId'=$2))
      order by resolved_plan #> '{content,draft,version}' desc, created_at desc, id collate "C" desc limit 21`,
      [workspaceId, planId, httpPlanIds(workspaceId, planId, planId).planId]);
    if (!rows.length) return undefined;
    const versions = rows.slice(0,20).map(row => summary(workspaceId,row));
    if (versions.some(row => row.planId !== planId||row.family!==versions[0].family) || new Set(versions.map(row=>row.version)).size !== versions.length) httpConflict();
    return { planId, versions, hasMore: rows.length > 20 };
  });
}

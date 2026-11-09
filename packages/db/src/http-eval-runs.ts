import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { queryRows, withTransaction } from "./service";
import { httpReadPlan } from "./http-eval-plans";
import { HTTP_RECORD_LIMIT, httpBounded, httpClock, httpConflict, httpEventId, httpFail, httpFingerprint,
  httpHash, httpIso, httpKeys, httpObject, httpOperation, httpParseRaw, httpRunIds, httpRunKey, httpSame,
  httpSampleId, httpStable, httpText, httpUuid, httpWithoutFingerprint, httpWorkspace, httpProfileVersion, httpTag,
  type HttpEvalStoreCall, type HttpEvalStoreClaim, type HttpEvalStoreLedger, type HttpEvalStorePlan,
  type HttpEvalStoreRowEvent, type HttpEvalStoreRun, type HttpEvalStoreRunCallbacks, type HttpEvalStoreStartRequest } from "./http-eval-types";

const WORKFLOWS = ["http-target-eval-v1","http-target-eval-v2"];
interface Reservation {
  schemaVersion: "http-eval-reservation-v1" | "http-eval-reservation-v2"; workspaceId: string; actorId: string;
  request: HttpEvalStoreStartRequest; planVersionId: string; planFingerprint: string;
  startedAt: string; leaseToken: string; initialLedgerFingerprint: string; fingerprint: string;
}
function startRequest(value: unknown): HttpEvalStoreStartRequest {
  httpBounded(value, 4096); const s = httpObject(value);
  httpKeys(s, ["schemaVersion", "runId", "planVersionId", "expectedPlanFingerprint"]);
  if ((s.schemaVersion !== "http-eval-start-v1"&&s.schemaVersion!=="http-eval-start-v2") || typeof s.planVersionId !== "string" || !/^http_eval_plan_version_[0-9a-f]{64}$/.test(s.planVersionId)) httpFail(422, "http_eval_invalid");
  httpUuid(s.runId); httpFingerprint(s.expectedPlanFingerprint);
  return { schemaVersion: s.schemaVersion, runId: s.runId, planVersionId: s.planVersionId, expectedPlanFingerprint: s.expectedPlanFingerprint };
}
const startHash = (workspaceId: string, request: HttpEvalStoreStartRequest) => httpHash({ schemaVersion: httpTag("http-eval-start-fingerprint",httpProfileVersion(request)), workspaceId, request });
const claimEventId = (workspaceId: string, runId: string, rowId: string) => `http_eval_claim_${httpHash({ workspaceId, runId, rowId })}`;
function claimPayload(workspaceId: string, publicRunId: string, claim: HttpEvalStoreClaim,version:1|2) {
  const value = { schemaVersion: httpTag("http-eval-claim-event",version), workspaceId, publicRunId, claim };
  return { ...value, fingerprint: httpHash(value) };
}
function rowEventStorage(event:HttpEvalStoreRowEvent) {
  return {schemaVersion:httpTag("http-eval-row-event-storage",httpProfileVersion(event)),eventId:event.id,eventFingerprint:event.fingerprint,eventText:httpStable(event)};
}
function storedRowEvent(raw:string):HttpEvalStoreRowEvent {
  const storage=httpObject(httpParseRaw(raw));
  try{httpKeys(storage,["schemaVersion","eventId","eventFingerprint","eventText"]);}catch{return httpConflict();}
  if((storage.schemaVersion!=="http-eval-row-event-storage-v1"&&storage.schemaVersion!=="http-eval-row-event-storage-v2")||typeof storage.eventText!=="string")httpConflict();
  const value=httpParseRaw(storage.eventText);httpObject(value);
  const event=value as HttpEvalStoreRowEvent;
  if(storage.eventText!==httpStable(event)||!httpSame(storage,rowEventStorage(event)))httpConflict();return event;
}
function expectedCall(record:HttpEvalStoreRun,rowId:string,now:string):HttpEvalStoreCall {
  const sample=record.plan.content.samples.find(s=>s.rowId===rowId),row=sample&&record.plan.content.dataset.rows.find(r=>r.id===sample.datasetRowId);
  if(!row)httpConflict();
  const base={schemaVersion:"http-json-target-request-v1",runId:record.ledger.publicRunId,rowId,input:row.input,
    ...(row.context.present?{context:row.context.value}:{}),...(row.history.present?{history:row.history.value}:{})};
  const fingerprint=httpHash({schemaVersion:"http-json-target-request-fingerprint-v1",workspaceId:record.workspaceId,planFingerprint:record.plan.fingerprint,body:base});
  return {endpoint:record.plan.content.target.endpoint,timeoutMs:Math.min(record.plan.content.target.timeoutMs,Date.parse(record.ledger.deadlineAt)-Date.parse(now)),
    body:httpStable({...base,requestFingerprint:fingerprint}),requestFingerprint:fingerprint,idempotencyKey:fingerprint};
}
function reservationMetadata(input: Reservation, ledger: HttpEvalStoreLedger) {
  return { schemaVersion: httpTag("http-eval-run-audit",httpProfileVersion(input)), publicRunId: ledger.publicRunId, runId: ledger.runId,
    workflowId: ledger.workflowId, planVersionId: input.planVersionId, planFingerprint: input.planFingerprint,
    requestFingerprint: ledger.requestFingerprint, initialLedgerFingerprint: input.initialLedgerFingerprint };
}
function canonical<P extends HttpEvalStorePlan, R extends HttpEvalStoreRun<P>>(workspaceId: string, plan: P,
  ledger: HttpEvalStoreLedger, events: HttpEvalStoreRowEvent[], cb: HttpEvalStoreRunCallbacks<P,R>): R {
  let record: R;
  try {
    const prepared = cb.build({ plan, ledger, events }); httpBounded(prepared);
    record = cb.parse(prepared); httpBounded(record);
    if (!httpSame(prepared, record)) httpConflict();
  } catch { return httpConflict(); }
  const ids = httpRunIds(workspaceId, record.ledger.publicRunId);
  const version=httpProfileVersion(plan);
  if (record.schemaVersion !== httpTag("http-eval-run-record",version) || record.ledger.schemaVersion!==httpTag("http-eval-run-ledger",version)
    ||record.execution.schemaVersion!==httpTag("http-eval-execution",version)||record.workspaceId !== workspaceId
    || !httpSame(record.plan, plan) || !httpSame(record.ledger, ledger) || record.ledger.workspaceId !== workspaceId
    || record.ledger.runId !== ids.runId || record.ledger.workflowId !== ids.workflowId
    || record.ledger.planVersionId !== plan.storage.versionId || record.ledger.planFingerprint !== plan.fingerprint
    || record.ledger.fingerprint !== httpHash(httpWithoutFingerprint(record.ledger))
    || record.fingerprint !== httpHash(httpWithoutFingerprint(record))
    || record.execution.fingerprint !== httpHash(httpWithoutFingerprint(record.execution))) httpConflict();
  if (!httpSame(record.ledger.rows.map(r=>r.rowId), plan.content.samples.map(s=>s.rowId))) httpConflict();
  for (const event of record.events) {
    if (event.schemaVersion!==httpTag("http-eval-row-event",version)||event.id !== httpEventId(workspaceId, ledger.publicRunId, event.rowId) || event.fingerprint !== httpHash(httpWithoutFingerprint(event))) httpConflict();
  }
  if (record.ledger.status === "running" && record.execution.gates.length) httpConflict();
  return record;
}
interface Projection { id: string; [key: string]: unknown }
function resultRows(record: HttpEvalStoreRun): Projection[] {
  return record.execution.results.map(value => {
    const r = httpObject(value); httpText(r.id); httpText(r.rowId); httpText(r.evalItemVersionId);
    const expected = `http_eval_result_${httpHash({ workspaceId: record.workspaceId, runId: record.ledger.publicRunId, rowId: r.rowId, evalItemVersionId: r.evalItemVersionId })}`;
    if (r.id !== expected || !record.ledger.rows.some(row => row.rowId === r.rowId) || !record.plan.content.items.some(item=>item.id===r.evalItemVersionId)) httpConflict();
    return { id: r.id, sampleId: httpSampleId(record.workspaceId, record.ledger.publicRunId, r.rowId), itemId: r.evalItemVersionId,
      output: r.originalOutput, fields: { schemaVersion: httpTag("http-eval-result-projection",httpProfileVersion(record)), result: value }, error: r.error ?? null };
  });
}
function gateRows(record: HttpEvalStoreRun): Projection[] {
  return record.execution.gates.map(value => {
    const g = httpObject(value); httpText(g.id); httpText(g.level); httpText(g.scopeId,4096);
    const expected = `http_eval_gate_${httpHash({ workspaceId: record.workspaceId, runId: record.ledger.publicRunId, level: g.level, scopeId: g.scopeId })}`;
    if (g.id !== expected || g.runId !== record.ledger.runId || typeof g.passed !== "boolean") httpConflict();
    return { id: g.id, level: g.level, scopeId: g.scopeId, score: g.score ?? null, passed: g.passed,
      decision: g.decision, formula: g.formula, reasons: { schemaVersion: httpTag("http-eval-gate-projection",httpProfileVersion(record)), gate: value }, fingerprint: g.fingerprint };
  });
}
function equalRows(actual: unknown[], expected: unknown[]): void {
  httpBounded(actual); httpBounded(expected);
  if (!httpSame(actual.map(httpStable).sort(), expected.map(httpStable).sort())) httpConflict();
}
async function sqlParity(client: PoolClient, record: HttpEvalStoreRun): Promise<void> {
  const runId = record.ledger.runId, expectedSamples = record.ledger.rows.map(row => {
    const sample = record.plan.content.samples.find(s=>s.rowId===row.rowId)!;
    return { id: httpSampleId(record.workspaceId,record.ledger.publicRunId,row.rowId), rowId: row.rowId,
      sourceKind: record.plan.content.schemaVersion, snapshotHash: sample.fingerprint, status: row.status };
  });
  const samples = (await client.query(`select id, row_id as "rowId", source_kind as "sourceKind", snapshot_hash as "snapshotHash", status
    from run_samples where eval_run_id = $1 limit 101`, [runId])).rows;
  equalRows(samples,expectedSamples);
  const size = (await client.query<{ bytes: string }>(`select ((select coalesce(sum(octet_length(original_output::text)+octet_length(normalized_fields::text)),0) from eval_results where eval_run_id=$1)
    + (select coalesce(sum(octet_length(reasons::text)),0) from gate_results where eval_run_id=$1))::text as bytes`, [runId])).rows[0];
  if (!size || BigInt(size.bytes)>BigInt(4*HTTP_RECORD_LIMIT)) httpConflict();
  const expectedResults=resultRows(record), expectedGates=gateRows(record);
  const results=(await client.query<{ id: string; sampleId: string; itemId: string; output: string; fields: string; error: string|null }>(`select id,
    run_sample_id as "sampleId", eval_item_version_id as "itemId", original_output::text as output, normalized_fields::text as fields,error
    from eval_results where eval_run_id=$1 limit $2`,[runId,expectedResults.length+1])).rows;
  equalRows(results.map(r=>({...r,output:httpParseRaw(r.output),fields:httpParseRaw(r.fields)})),expectedResults);
  const resultExact=(await client.query<{ count: number }>(`select count(*)::int as count from eval_results r
    join jsonb_to_recordset($2::jsonb) x(id text, output jsonb, fields jsonb) on r.id=x.id
    where r.eval_run_id=$1 and r.original_output=x.output and r.normalized_fields=x.fields`,[runId,JSON.stringify(expectedResults)])).rows[0];
  if (resultExact?.count!==expectedResults.length) httpConflict();
  const gates=(await client.query<{ id: string; level: string; scopeId: string; score: string; passed: boolean; decision: string; formula: string; reasons: string; fingerprint: string }>(
    `select id,level,scope_id as "scopeId",coalesce(to_jsonb(score),'null'::jsonb)::text as score,passed,decision,formula,reasons::text,fingerprint
    from gate_results where eval_run_id=$1 limit $2`,[runId,expectedGates.length+1])).rows;
  equalRows(gates.map(g=>({...g,score:httpParseRaw(g.score),reasons:httpParseRaw(g.reasons)})),expectedGates);
  const gateExact=(await client.query<{ count: number }>(`select count(*)::int as count from gate_results g
    join jsonb_to_recordset($2::jsonb) x(id text,score jsonb,reasons jsonb) on g.id=x.id
    where g.eval_run_id=$1 and coalesce(to_jsonb(g.score),'null'::jsonb)=x.score and g.reasons=x.reasons`,[runId,JSON.stringify(expectedGates)])).rows[0];
  if (gateExact?.count!==expectedGates.length) httpConflict();
}
interface Loaded<P extends HttpEvalStorePlan,R extends HttpEvalStoreRun<P>> { record: R; input: Reservation }
async function read<P extends HttpEvalStorePlan,R extends HttpEvalStoreRun<P>>(client: PoolClient,workspaceId: string,publicRunId: string,
  cb: HttpEvalStoreRunCallbacks<P,R>): Promise<Loaded<P,R>|undefined> {
  try { return await readStored(client,workspaceId,publicRunId,cb); }
  catch(error) {
    if(error && typeof error === "object" && "status" in error && (error.status === 409 || error.status === 422)) httpConflict();
    throw error;
  }
}
async function readStored<P extends HttpEvalStorePlan,R extends HttpEvalStoreRun<P>>(client: PoolClient,workspaceId: string,publicRunId: string,
  cb: HttpEvalStoreRunCallbacks<P,R>): Promise<Loaded<P,R>|undefined> {
  const ids=httpRunIds(workspaceId,publicRunId), keys=[httpRunKey(publicRunId,1),httpRunKey(publicRunId,2)];
  const workflows=(await client.query<{ id: string; workspaceId: string; kind: string; subjectId: string; status: string; key: string;
    input: string|null; output: string|null; error: string|null; attempts: number; createdAt: Date; updatedAt: Date }>(`select id,workspace_id as "workspaceId",
    workflow_id as kind,subject_id as "subjectId",status,idempotency_key as key,error,attempts,created_at as "createdAt",updated_at as "updatedAt",
    case when octet_length(input::text)<=$4 then input::text else null end as input,
    case when octet_length(output::text)<=$4 then output::text else null end as output from workflow_runs
    where id=$1 or (workspace_id=$2 and workflow_id=any($5::text[]) and idempotency_key=any($3::text[])) limit 2 for update`,[ids.workflowId,workspaceId,keys,2*HTTP_RECORD_LIMIT,WORKFLOWS])).rows;
  const runs=(await client.query<{ id: string; workspaceId: string; planId: string; status: string; key: string; createdAt: Date }>(`select id,
    workspace_id as "workspaceId",run_plan_id as "planId",status,idempotency_key as key,created_at as "createdAt" from eval_runs
    where id=$1 or (workspace_id=$2 and idempotency_key=any($3::text[])) limit 2 for update`,[ids.runId,workspaceId,keys])).rows;
  if (!workflows.length&&!runs.length) {
    const orphan=await client.query("select id from audit_events where workspace_id=$1 and (id=$2 or resource_id=$3) limit 1",[workspaceId,ids.auditId,ids.runId]);
    if (orphan.rows.length) httpConflict(); return undefined;
  }
  if (workflows.length!==1||runs.length!==1) httpConflict();
  const workflow=workflows[0],run=runs[0],rawInput=httpParseRaw(workflow.input),s=httpObject(rawInput);
  try { httpKeys(s,["schemaVersion","workspaceId","actorId","request","planVersionId","planFingerprint","startedAt","leaseToken","initialLedgerFingerprint","fingerprint"]);
    httpText(s.actorId);httpUuid(s.leaseToken);httpFingerprint(s.initialLedgerFingerprint);httpFingerprint(s.fingerprint); } catch { return httpConflict(); }
  const request=startRequest(s.request),input=rawInput as Reservation;
  const version=httpProfileVersion(request),key=httpRunKey(publicRunId,version);
  if (input.schemaVersion!==httpTag("http-eval-reservation",version)||input.workspaceId!==workspaceId||request.runId!==publicRunId
    ||input.planVersionId!==request.planVersionId||input.planFingerprint!==request.expectedPlanFingerprint||input.fingerprint!==httpHash(httpWithoutFingerprint(input))) httpConflict();
  const plan=await httpReadPlan(client,workspaceId,input.planVersionId,cb.parsePlan); if(!plan) httpConflict();
  if(httpProfileVersion(plan)!==version)httpConflict();
  const ledger=httpParseRaw(workflow.output) as HttpEvalStoreLedger;
  const initial=cb.create({workspaceId,request,plan,startedAt:httpIso(input.startedAt),leaseToken:input.leaseToken});
  if (initial.fingerprint!==input.initialLedgerFingerprint||workflow.id!==ids.workflowId||workflow.workspaceId!==workspaceId||workflow.kind!==plan.content.schemaVersion
    ||workflow.subjectId!==ids.runId||workflow.key!==key||workflow.error!==null||workflow.attempts!==1
    ||run.id!==ids.runId||run.workspaceId!==workspaceId||run.planId!==plan.storage.versionId||run.key!==key
    ||httpIso(workflow.createdAt)!==input.startedAt||httpIso(run.createdAt)!==input.startedAt
    ||Date.parse(httpIso(workflow.updatedAt))<Date.parse(input.startedAt)) httpConflict();
  const eventSize=(await client.query<{ count: number; bytes: string }>(`select count(*)::int as count,coalesce(sum(octet_length(payload::text)),0)::text as bytes
    from workflow_events where workflow_run_id=$1`,[ids.workflowId])).rows[0];
  if(!eventSize||eventSize.count>201||BigInt(eventSize.bytes)>BigInt(2*HTTP_RECORD_LIMIT)) httpConflict();
  const storedEvents=(await client.query<{ id: string; type: string; raw: string; createdAt: Date }>(`select id,event_type as type,payload::text as raw,created_at as "createdAt"
    from workflow_events where workflow_run_id=$1 limit 202`,[ids.workflowId])).rows;
  const events=storedEvents.filter(e=>e.type==="http_eval.row.finalized").map(e=>storedRowEvent(e.raw));
  const record=canonical(workspaceId,plan,ledger,events,cb),meta=reservationMetadata(input,initial);
  if(workflow.status!==ledger.status||run.status!==ledger.status||ledger.requestFingerprint!==startHash(workspaceId,request)
    ||ledger.leaseToken!==initial.leaseToken||ledger.startedAt!==initial.startedAt||ledger.deadlineAt!==initial.deadlineAt||ledger.leaseExpiresAt!==initial.leaseExpiresAt) httpConflict();
  const expectedEvents:Array<{id:string;type:string;payload:unknown;createdAt:string}>=[{id:ids.reservationEventId,type:"http_eval.run.reserved",payload:meta,createdAt:initial.startedAt}];
  for(const row of record.ledger.rows) if(row.claim) expectedEvents.push({id:claimEventId(workspaceId,publicRunId,row.rowId),type:"http_eval.row.claimed",payload:claimPayload(workspaceId,publicRunId,row.claim,version),createdAt:row.claim.claimedAt});
  for(const event of record.events) expectedEvents.push({id:event.id,type:"http_eval.row.finalized",payload:rowEventStorage(event),createdAt:event.completedAt});
  equalRows(storedEvents.map(e=>({id:e.id,type:e.type,payload:httpParseRaw(e.raw),createdAt:httpIso(e.createdAt)})),expectedEvents);
  const eventExact=(await client.query<{count:number}>(`select count(*)::int as count from workflow_events e join
    jsonb_to_recordset($2::jsonb) x(id text,payload jsonb) on e.id=x.id where e.workflow_run_id=$1 and e.payload=x.payload`,[ids.workflowId,JSON.stringify(expectedEvents)])).rows[0];
  if(eventExact?.count!==expectedEvents.length) httpConflict();
  const workflowExact=await client.query("select id from workflow_runs where id=$1 and input=$2::jsonb and output=$3::jsonb",[ids.workflowId,JSON.stringify(input),JSON.stringify(record.ledger)]);
  if(workflowExact.rows.length!==1) httpConflict();
  const audits=(await client.query<{id:string;workspaceId:string;actor:string;action:string;type:string;resource:string;hash:string;raw:string|null;createdAt:Date}>(`select id,
    workspace_id as "workspaceId",actor_user_id as actor,action,resource_type as type,resource_id as resource,metadata_hash as hash,
    case when octet_length(metadata::text)<=16384 then metadata::text else null end as raw,created_at as "createdAt"
    from audit_events where id=$1 or (workspace_id=$2 and action='http_eval.run.reserved' and resource_id=$3) limit 2`,[ids.auditId,workspaceId,ids.runId])).rows;
  if(audits.length!==1) httpConflict();const audit=audits[0];
  if(audit.id!==ids.auditId||audit.workspaceId!==workspaceId||audit.actor!==input.actorId||audit.action!=="http_eval.run.reserved"
    ||audit.type!=="http_eval_run"||audit.resource!==ids.runId||audit.hash!==httpHash(meta)||!httpSame(httpParseRaw(audit.raw),meta)||httpIso(audit.createdAt)!==input.startedAt) httpConflict();
  const recoveryEvents=record.events.filter(e=>e.errorCode==="http_eval_recovered_unknown"||e.errorCode==="http_eval_recovered_not_sent");
  const recoveryId=`audit_http_eval_recovery_${httpHash({workspaceId,runId:publicRunId})}`;
  const recoveryAudits=(await client.query<{id:string;workspaceId:string;actor:string;action:string;type:string;resource:string;hash:string;raw:string|null;createdAt:Date}>(
    `select id,workspace_id as "workspaceId",actor_user_id as actor,action,resource_type as type,resource_id as resource,metadata_hash as hash,
    case when octet_length(metadata::text)<=16384 then metadata::text else null end as raw,created_at as "createdAt"
    from audit_events where id=$1 or (workspace_id=$2 and action='http_eval.run.recovered' and resource_id=$3) limit 2`,[recoveryId,workspaceId,ids.runId])).rows;
  if(recoveryEvents.length){
    if(recoveryAudits.length!==1)httpConflict();
    const recoveredRows=new Set(recoveryEvents.map(e=>e.rowId)),previousBase={...httpWithoutFingerprint(record.ledger),status:"running",
      rows:record.ledger.rows.map(row=>recoveredRows.has(row.rowId)?{...row,status:row.claim?"claimed":"pending",eventId:null,eventFingerprint:null}:row)};
    const recoveryMeta={publicRunId,runId:ids.runId,previousLedgerFingerprint:httpHash(previousBase),ledgerFingerprint:record.ledger.fingerprint};
    const recoveryAudit=recoveryAudits[0];httpText(recoveryAudit.actor);
    if(recoveryAudit.id!==recoveryId||recoveryAudit.workspaceId!==workspaceId||recoveryAudit.action!=="http_eval.run.recovered"
      ||recoveryAudit.type!=="http_eval_run"||recoveryAudit.resource!==ids.runId||recoveryAudit.hash!==httpHash(recoveryMeta)
      ||!httpSame(httpParseRaw(recoveryAudit.raw),recoveryMeta)||recoveryEvents.some(e=>e.completedAt!==httpIso(recoveryAudit.createdAt)))httpConflict();
  }else if(recoveryAudits.length)httpConflict();
  await sqlParity(client,record);return {record,input};
}
async function runLock(client:PoolClient,workspaceId:string,runId:string):Promise<void>{
  await httpWorkspace(client,workspaceId);
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`http-eval-run-v1:${workspaceId}:${runId}`]);
}
function callbacks<P extends HttpEvalStorePlan,R extends HttpEvalStoreRun<P>>(value:HttpEvalStoreRunCallbacks<P,R>):HttpEvalStoreRunCallbacks<P,R>{
  for(const name of ["parsePlan","create","claim","finalize","recover","stop","build","parse"] as const) if(typeof value?.[name]!=="function") httpFail(422,"http_eval_callbacks_required");
  return {parsePlan:value.parsePlan,create:value.create,claim:value.claim,finalize:value.finalize,recover:value.recover,stop:value.stop,build:value.build,parse:value.parse};
}
export async function getHttpEvalRun<P extends HttpEvalStorePlan,R extends HttpEvalStoreRun<P>>(workspaceId:string,publicRunId:string,
  provided:HttpEvalStoreRunCallbacks<P,R>):Promise<R|undefined>{
  httpText(workspaceId);httpUuid(publicRunId);const cb=callbacks(provided);
  return httpOperation(()=>withTransaction(async client=>{await runLock(client,workspaceId,publicRunId);return (await read(client,workspaceId,publicRunId,cb))?.record;}));
}
export async function reserveHttpEvalRun<P extends HttpEvalStorePlan,R extends HttpEvalStoreRun<P>>(scope:{workspaceId:string;actorId:string},value:unknown,
  provided:HttpEvalStoreRunCallbacks<P,R>):Promise<{record:R;created:boolean}>{
  httpText(scope.workspaceId);httpText(scope.actorId);const {workspaceId,actorId}=scope,request=startRequest(value),cb=callbacks(provided),ids=httpRunIds(workspaceId,request.runId);
  return httpOperation(()=>withTransaction(async client=>{
    await runLock(client,workspaceId,request.runId);const replay=await read(client,workspaceId,request.runId,cb);
    if(replay){if(replay.record.ledger.requestFingerprint!==startHash(workspaceId,request)) httpConflict();return {record:replay.record,created:false};}
    const plan=await httpReadPlan(client,workspaceId,request.planVersionId,cb.parsePlan);if(!plan)httpFail(404,"http_eval_not_found");
    if(httpProfileVersion(plan)!==httpProfileVersion(request))httpFail(409,"http_eval_plan_family_conflict");
    const startedAt=await httpClock(client),ledger=cb.create({workspaceId,request,plan,startedAt,leaseToken:randomUUID()});
    const record=canonical(workspaceId,plan,ledger,[],cb);
    if(record.ledger.status!=="running"||record.ledger.rows.some(r=>r.status!=="pending"||r.claim!==null||r.eventId!==null)
      ||record.execution.results.length||record.execution.gates.length||record.ledger.requestFingerprint!==startHash(workspaceId,request))httpConflict();
    const version=httpProfileVersion(plan),base={schemaVersion:httpTag("http-eval-reservation",version),workspaceId,actorId,request,planVersionId:plan.storage.versionId,
      planFingerprint:plan.fingerprint,startedAt,leaseToken:ledger.leaseToken,initialLedgerFingerprint:ledger.fingerprint};
    const input:Reservation={...base,fingerprint:httpHash(base)},meta=reservationMetadata(input,ledger),key=httpRunKey(request.runId,version);
    await client.query(`insert into eval_runs(id,workspace_id,run_plan_id,status,idempotency_key,created_at)values($1,$2,$3,$4,$5,$6::timestamptz)`,[ids.runId,workspaceId,plan.storage.versionId,ledger.status,key,startedAt]);
    for(const sample of plan.content.samples)await client.query(`insert into run_samples(id,eval_run_id,row_id,source_kind,snapshot_hash,status)values($1,$2,$3,$4,$5,'pending')`,
      [httpSampleId(workspaceId,request.runId,sample.rowId),ids.runId,sample.rowId,plan.content.schemaVersion,sample.fingerprint]);
    await client.query(`insert into workflow_runs(id,workspace_id,workflow_id,subject_id,status,idempotency_key,input,output,error,attempts,created_at,updated_at)
      values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,null,1,$9::timestamptz,$9::timestamptz)`,[ids.workflowId,workspaceId,plan.content.schemaVersion,ids.runId,ledger.status,key,JSON.stringify(input),JSON.stringify(ledger),startedAt]);
    await client.query(`insert into workflow_events(id,workflow_run_id,event_type,payload,created_at)values($1,$2,'http_eval.run.reserved',$3::jsonb,$4::timestamptz)`,[ids.reservationEventId,ids.workflowId,JSON.stringify(meta),startedAt]);
    await client.query(`insert into audit_events(id,workspace_id,actor_user_id,action,resource_type,resource_id,metadata_hash,metadata,created_at)
      values($1,$2,$3,'http_eval.run.reserved','http_eval_run',$4,$5,$6::jsonb,$7::timestamptz)`,[ids.auditId,workspaceId,actorId,ids.runId,httpHash(meta),JSON.stringify(meta),startedAt]);
    const saved=await read(client,workspaceId,request.runId,cb);if(!saved||!httpSame(saved.record,record))httpConflict();return {record:saved.record,created:true};
  }));
}
async function updateLedger(client:PoolClient,record:HttpEvalStoreRun,now:string):Promise<void>{
  const result=await client.query(`update workflow_runs set output=$2::jsonb,status=$3,updated_at=$4::timestamptz where id=$1 returning id`,[record.ledger.workflowId,JSON.stringify(record.ledger),record.ledger.status,now]);
  const run=await client.query("update eval_runs set status=$2 where id=$1 returning id",[record.ledger.runId,record.ledger.status]);
  if(result.rows.length!==1||run.rows.length!==1)httpConflict();
}
export async function claimHttpEvalRunRow<P extends HttpEvalStorePlan,R extends HttpEvalStoreRun<P>>(workspaceId:string,publicRunId:string,
  intent:{rowId:string;leaseToken:string},provided:HttpEvalStoreRunCallbacks<P,R>):Promise<{claim:HttpEvalStoreClaim;request:HttpEvalStoreCall}>{
  httpText(workspaceId);httpUuid(publicRunId);httpText(intent.rowId);httpUuid(intent.leaseToken);
  const {rowId,leaseToken}=intent,cb=callbacks(provided);
  return httpOperation(()=>withTransaction(async client=>{
    await runLock(client,workspaceId,publicRunId);const loaded=await read(client,workspaceId,publicRunId,cb);if(!loaded)httpFail(404,"http_eval_not_found");
    const before=loaded.record,now=await httpClock(client),claimed=cb.claim({plan:before.plan,ledger:before.ledger,rowId,leaseToken,claimToken:randomUUID(),now});
    const next=canonical(workspaceId,before.plan,claimed.ledger,before.events,cb),row=next.ledger.rows.find(r=>r.rowId===rowId);
    if(!row||row.status!=="claimed"||!httpSame(row.claim,claimed.claim)||claimed.claim.claimedAt!==now
      ||claimed.request.requestFingerprint!==claimed.claim.requestFingerprint||!httpSame(claimed.request,expectedCall(before,rowId,now))
      ||!httpSame(next.execution,before.execution))httpConflict();
    await client.query(`insert into workflow_events(id,workflow_run_id,event_type,payload,created_at)values($1,$2,'http_eval.row.claimed',$3::jsonb,$4::timestamptz)`,
      [claimEventId(workspaceId,publicRunId,rowId),before.ledger.workflowId,JSON.stringify(claimPayload(workspaceId,publicRunId,claimed.claim,httpProfileVersion(before))),now]);
    const sample=await client.query("update run_samples set status='claimed' where id=$1 and status='pending' returning id",[httpSampleId(workspaceId,publicRunId,rowId)]);if(sample.rows.length!==1)httpConflict();
    await updateLedger(client,next,now);const saved=await read(client,workspaceId,publicRunId,cb);if(!saved||!httpSame(saved.record,next))httpConflict();
    return {claim:claimed.claim,request:claimed.request};
  }));
}
async function outcomeDelta(client:PoolClient,before:HttpEvalStoreRun,next:HttpEvalStoreRun,events:HttpEvalStoreRowEvent[],now:string):Promise<void>{
  for(const event of events){
    const prior=before.ledger.rows.find(r=>r.rowId===event.rowId);if(!prior||!["pending","claimed"].includes(prior.status))httpConflict();
    await client.query(`insert into workflow_events(id,workflow_run_id,event_type,payload,created_at)values($1,$2,'http_eval.row.finalized',$3::jsonb,$4::timestamptz)`,[event.id,before.ledger.workflowId,JSON.stringify(rowEventStorage(event)),event.completedAt]);
    const sample=await client.query("update run_samples set status=$2 where id=$1 and status=$3 returning id",[httpSampleId(before.workspaceId,before.ledger.publicRunId,event.rowId),event.status,prior.status]);if(sample.rows.length!==1)httpConflict();
  }
  const previousResults=resultRows(before),nextResults=resultRows(next),priorIds=new Set(previousResults.map(r=>r.id));
  for(const previous of previousResults)if(!nextResults.some(r=>httpSame(r,previous)))httpConflict();
  for(const r of nextResults)if(!priorIds.has(r.id))await client.query(`insert into eval_results(id,eval_run_id,run_sample_id,eval_item_version_id,original_output,normalized_fields,error)
    values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,[r.id,next.ledger.runId,r.sampleId,r.itemId,JSON.stringify(r.output),JSON.stringify(r.fields),r.error]);
  const previousGates=gateRows(before),nextGates=gateRows(next);
  if(previousGates.length){equalRows(previousGates,nextGates);}else for(const g of nextGates)await client.query(`insert into gate_results(id,eval_run_id,level,scope_id,score,passed,decision,formula,reasons,fingerprint)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,[g.id,next.ledger.runId,g.level,g.scopeId,g.score,g.passed,g.decision,g.formula,JSON.stringify(g.reasons),g.fingerprint]);
  await updateLedger(client,next,now);
}
export interface HttpEvalFinalizeIntent {rowId:string;claimToken:string;responseText?:string;errorCode?:string;errorOutcome?:"not_sent"|"unknown"}
export async function finalizeHttpEvalRunRow<P extends HttpEvalStorePlan,R extends HttpEvalStoreRun<P>>(workspaceId:string,publicRunId:string,
  intent:HttpEvalFinalizeIntent,provided:HttpEvalStoreRunCallbacks<P,R>):Promise<{record:R;replayed:boolean}>{
  httpText(workspaceId);httpUuid(publicRunId);httpText(intent.rowId);httpUuid(intent.claimToken);
  const {rowId,claimToken}=intent,cb=callbacks(provided);
  const response=Object.hasOwn(intent,"responseText"),failure=Object.hasOwn(intent,"errorCode"),outcome=Object.hasOwn(intent,"errorOutcome");
  if(response?(failure||outcome||typeof intent.responseText!=="string"||Buffer.byteLength(intent.responseText)>65536):(!failure||!outcome||typeof intent.errorCode!=="string"||!/^(?:http_eval|http_target)_[a-z0-9_]{1,100}$/.test(intent.errorCode)||(intent.errorOutcome!=="not_sent"&&intent.errorOutcome!=="unknown")))httpFail(422,"http_eval_invalid");
  const payload=response?{responseText:intent.responseText!}:{errorCode:intent.errorCode!,errorOutcome:intent.errorOutcome!};
  return httpOperation(()=>withTransaction(async client=>{
    await runLock(client,workspaceId,publicRunId);const loaded=await read(client,workspaceId,publicRunId,cb);if(!loaded)httpFail(404,"http_eval_not_found");
    const before=loaded.record,row=before.ledger.rows.find(r=>r.rowId===rowId),saved=before.events.find(e=>e.rowId===rowId);
    if(!row?.claim||row.claim.claimToken!==claimToken)httpFail(409,"http_eval_finalize_conflict");
    if(saved){
      const exact=response?saved.rawResponseHash===createHash("sha256").update(payload.responseText!).digest("hex"):
        saved.rawResponseHash===null&&saved.response===null&&saved.errorCode===payload.errorCode&&saved.status===(payload.errorOutcome==="unknown"?"outcome_unknown":"not_sent");
      if(!exact)httpFail(409,"http_eval_finalize_conflict");return {record:before,replayed:true};
    }
    const now=await httpClock(client);if(Date.parse(now)>=Date.parse(before.ledger.leaseExpiresAt))httpFail(409,"http_eval_finalize_conflict");
    const finalized=cb.finalize({plan:before.plan,ledger:before.ledger,rowId,claimToken,completedAt:now,...payload});
    const next=canonical(workspaceId,before.plan,finalized.ledger,[...before.events,finalized.event],cb);
    if(finalized.event.rowId!==rowId||finalized.event.completedAt!==now||!httpSame(finalized.event.claim,row.claim)
      ||!httpSame(finalized.results,next.execution.results.filter(value=>httpObject(value).rowId===rowId)))httpConflict();
    await outcomeDelta(client,before,next,[finalized.event],now);const readback=await read(client,workspaceId,publicRunId,cb);if(!readback||!httpSame(readback.record,next))httpConflict();
    return {record:readback.record,replayed:false};
  }));
}
export async function stopHttpEvalRun<P extends HttpEvalStorePlan,R extends HttpEvalStoreRun<P>>(workspaceId:string,publicRunId:string,
  intent:{leaseToken:string;reasonCode:string},provided:HttpEvalStoreRunCallbacks<P,R>):Promise<R>{
  httpText(workspaceId);httpUuid(publicRunId);httpUuid(intent.leaseToken);httpText(intent.reasonCode,128);const {leaseToken,reasonCode}=intent,cb=callbacks(provided);
  return httpOperation(()=>withTransaction(async client=>{
    await runLock(client,workspaceId,publicRunId);const loaded=await read(client,workspaceId,publicRunId,cb);if(!loaded)httpFail(404,"http_eval_not_found");const before=loaded.record;
    if(before.ledger.leaseToken!==leaseToken)httpFail(409,"http_eval_stop_conflict");
    if(before.ledger.status!=="running"){if(before.ledger.stopReason===reasonCode)return before;httpFail(409,"http_eval_stop_conflict");}
    const now=await httpClock(client),stopped=cb.stop({plan:before.plan,ledger:before.ledger,leaseToken,reasonCode,now});
    const next=canonical(workspaceId,before.plan,stopped.ledger,[...before.events,...stopped.events],cb);
    if(!httpSame(next.ledger.leaseToken,leaseToken)||stopped.events.some(e=>before.ledger.rows.find(r=>r.rowId===e.rowId)?.status!=="pending"||e.status!=="not_sent"))httpConflict();
    if(httpSame(before,next))return before;
    await outcomeDelta(client,before,next,stopped.events,now);const readback=await read(client,workspaceId,publicRunId,cb);if(!readback||!httpSame(readback.record,next))httpConflict();return readback.record;
  }));
}
export async function recoverHttpEvalRun<P extends HttpEvalStorePlan,R extends HttpEvalStoreRun<P>>(scope:{workspaceId:string;actorId:string},publicRunId:string,
  provided:HttpEvalStoreRunCallbacks<P,R>):Promise<R>{
  httpText(scope.workspaceId);httpText(scope.actorId);httpUuid(publicRunId);const {workspaceId,actorId}=scope,cb=callbacks(provided);
  return httpOperation(()=>withTransaction(async client=>{
    await runLock(client,workspaceId,publicRunId);const loaded=await read(client,workspaceId,publicRunId,cb);if(!loaded)httpFail(404,"http_eval_not_found");const before=loaded.record;
    if(before.ledger.status!=="running")return before;
    const now=await httpClock(client);if(Date.parse(now)<Date.parse(before.ledger.leaseExpiresAt))httpFail(409,"http_eval_recovery_too_early");
    const recovered=cb.recover({plan:before.plan,ledger:before.ledger,now}),next=canonical(workspaceId,before.plan,recovered.ledger,[...before.events,...recovered.events],cb);
    if(next.ledger.rows.some(r=>r.status==="pending"||r.status==="claimed"))httpConflict();
    await outcomeDelta(client,before,next,recovered.events,now);
    const meta={publicRunId,runId:before.ledger.runId,previousLedgerFingerprint:before.ledger.fingerprint,ledgerFingerprint:next.ledger.fingerprint};
    await client.query(`insert into audit_events(id,workspace_id,actor_user_id,action,resource_type,resource_id,metadata_hash,metadata,created_at)
      values($1,$2,$3,'http_eval.run.recovered','http_eval_run',$4,$5,$6::jsonb,$7::timestamptz)`,[`audit_http_eval_recovery_${httpHash({workspaceId,runId:publicRunId})}`,workspaceId,actorId,before.ledger.runId,httpHash(meta),JSON.stringify(meta),now]);
    const readback=await read(client,workspaceId,publicRunId,cb);if(!readback||!httpSame(readback.record,next))httpConflict();return readback.record;
  }));
}
export interface HttpEvalRunSummary {runId:string;storageRunId:string;planVersionId:string;planFingerprint:string;status:HttpEvalStoreLedger["status"];startedAt:string;deadlineAt:string;leaseExpiresAt:string}
/** Metadata only; exact get verifies the entire frozen plan, ledger, events and SQL projections. */
export async function listHttpEvalRuns(workspaceId:string,publicPlanId:string):Promise<{runs:HttpEvalRunSummary[];hasMore:boolean}>{
  httpText(workspaceId);httpUuid(publicPlanId);
  const header=(expression:string,maximum:number)=>`case when octet_length((${expression})::text)<=${maximum} then ${expression} else null end`;
  return httpOperation(async()=>{
    const rows=await queryRows<{id:string;runId:string;planVersionId:string;planFingerprint:string;status:string;startedAt:string;deadlineAt:string;leaseExpiresAt:string;
      storageRunId:string;storagePlanVersionId:string;storagePlanFingerprint:string;ledgerStatus:string;createdAt:Date;family:string;kind:string;ledgerSchema:string}>(
      `select ${header("w.id",256)} as id,${header("w.output ->> 'publicRunId'",36)} as "runId",${header("w.output ->> 'planVersionId'",256)} as "planVersionId",${header("w.output ->> 'planFingerprint'",64)} as "planFingerprint",
      ${header("w.status",32)} as status,${header("w.output ->> 'startedAt'",24)} as "startedAt",${header("w.output ->> 'deadlineAt'",24)} as "deadlineAt",${header("w.output ->> 'leaseExpiresAt'",24)} as "leaseExpiresAt",
      ${header("r.id",256)} as "storageRunId",${header("r.run_plan_id",256)} as "storagePlanVersionId",${header("p.fingerprint",64)} as "storagePlanFingerprint",${header("w.output ->> 'status'",32)} as "ledgerStatus",w.created_at as "createdAt",
      ${header("p.resolved_plan #>> '{content,schemaVersion}'",64)} as family,${header("w.workflow_id",64)} as kind,${header("w.output->>'schemaVersion'",64)} as "ledgerSchema"
      from workflow_runs w join eval_runs r on r.id=w.subject_id join run_plans p on p.id=r.run_plan_id
      where w.workspace_id=$1 and r.workspace_id=$1 and p.workspace_id=$1 and p.resolved_plan #>> '{content,draft,planId}'=$2
      and (w.workflow_id=any($3::text[]) or left(w.id,length('http_eval_workflow_'))='http_eval_workflow_')
      order by w.created_at desc,w.id collate "C" desc limit 21`,[workspaceId,publicPlanId,WORKFLOWS]);
    const runs=rows.slice(0,20).map(row=>{
      try{httpUuid(row.runId);httpFingerprint(row.planFingerprint);if(row.id!==httpRunIds(workspaceId,row.runId).workflowId
        ||row.storageRunId!==httpRunIds(workspaceId,row.runId).runId||row.storagePlanVersionId!==row.planVersionId||row.storagePlanFingerprint!==row.planFingerprint
        ||row.ledgerStatus!==row.status||httpIso(row.createdAt)!==row.startedAt||!WORKFLOWS.includes(row.family)||row.kind!==row.family
        ||row.ledgerSchema!==httpTag("http-eval-run-ledger",httpProfileVersion({schemaVersion:row.family}))
        ||!/^http_eval_plan_version_[0-9a-f]{64}$/.test(row.planVersionId)||!["running","completed","failed","interrupted","outcome_unknown"].includes(row.status))httpConflict();
        return {runId:row.runId,storageRunId:httpRunIds(workspaceId,row.runId).runId,planVersionId:row.planVersionId,planFingerprint:row.planFingerprint,
          status:row.status as HttpEvalStoreLedger["status"],startedAt:httpIso(row.startedAt),deadlineAt:httpIso(row.deadlineAt),leaseExpiresAt:httpIso(row.leaseExpiresAt)};
      }catch{return httpConflict();}
    });return {runs,hasMore:rows.length>20};
  });
}

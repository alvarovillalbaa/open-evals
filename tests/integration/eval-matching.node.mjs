import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

// T3 authored disposable database only. Guard and ownership verification precede every application import or write.
// The caller creates/migrates/drops this database. No target adapter or network target is imported.
const MARKER="open-evals-matching-v3-20261112-created-disposable-v1";
const applicationName=`oe_matching_v3_${randomUUID().replaceAll("-","")}`;
const environmentKeys=["DATABASE_URL","POSTGRES_URL","SUPABASE_DB_URL","DATABASE_SSL","SUPABASE_DB_SSL"];
const oldEnvironment=new Map(environmentKeys.map(key=>[key,process.env[key]]));
let containsCore,containsDb,Client,inspector,connectionString,databaseName,fixture,core,db,planCore,runCore,plans,runs,datasetCore,datasets,legacyCore,legacyDb,service,provided;
const plain=value=>JSON.parse(JSON.stringify(value));
const equalJson=(a,b)=>assert.deepEqual(plain(a),plain(b));
const status=expected=>error=>{assert.equal(error.status,expected);return true;};
const itemCallbacks={prepare:input=>core.prepareCustomEvalItemVersionRecordV3(input),restore:(value,ws)=>core.restoreCustomEvalItemVersionRecordV3(value,ws)};
const setCallbacks={prepare:input=>core.prepareCustomEvalSetVersionRecordV3(input),restore:(value,ws)=>core.restoreCustomEvalSetVersionRecordV3(value,ws),restoreItem:(value,ws)=>core.restoreMatchingEvalItemVersionRecord(value,ws)};
const readers={restoreSet:(value,ws)=>core.restoreCustomEvalSetVersionRecordV3(value,ws),restoreItem:(value,ws)=>core.restoreMatchingEvalItemVersionRecord(value,ws)};
const httpReaders={restoreSet:(value,ws)=>containsCore.restoreCustomEvalSetVersionRecordV2(value,ws),restoreItem:(value,ws)=>containsCore.restoreCustomEvalItemVersionRecordV2(value,ws),restoreSetV3:(value,ws)=>core.restoreCustomEvalSetVersionRecordV3(value,ws),restoreMatchingItem:(value,ws)=>core.restoreMatchingEvalItemVersionRecord(value,ws)};
const planCallbacks={prepare:input=>planCore.prepareHttpEvalPlanVersionRecord(input),parse:value=>planCore.parseHttpEvalPlanVersionRecord(value),...httpReaders};
const runCallbacks={parsePlan:value=>planCore.parseHttpEvalPlanVersionRecord(value),create:input=>runCore.createHttpEvalRunLedger(input),claim:input=>runCore.claimHttpEvalRow(input),
  finalize:input=>runCore.finalizeHttpEvalRow(input),recover:input=>runCore.recoverHttpEvalRun(input),stop:input=>runCore.stopHttpEvalRun(input),build:input=>runCore.buildHttpEvalRunRecord(input),parse:value=>runCore.parseHttpEvalRunRecord(value)};
function guard(){
  assert.equal(process.env.EVAL_MATCHING_TEST_ALLOW,"local-disposable");const url=new URL(process.env.EVAL_MATCHING_TEST_DATABASE_URL??"");
  assert.ok(["postgres:","postgresql:"].includes(url.protocol));assert.equal(url.hostname,"127.0.0.1");assert.equal(url.port,"65432");assert.equal(url.username,"postgres");
  assert.match(url.pathname,/^\/oe_matching_v3_test_[0-9]+_[0-9]+$/);assert.equal(url.search,"");assert.equal(url.hash,"");databaseName=url.pathname.slice(1);return url.toString();
}
async function verifyDatabase(){
  const rows=(await inspector.query(`select current_database() as name,shobj_description(d.oid,'pg_database') as marker,pg_get_userbyid(d.datdba) as owner,
    current_user as actor,host(inet_server_addr()) as address,inet_server_port() as port from pg_database d where d.datname=current_database()`)).rows;
  assert.equal(rows.length,1);const row=rows[0];assert.equal(row.name,databaseName);assert.equal(row.marker,MARKER);assert.equal(row.owner,"postgres");assert.equal(row.actor,"postgres");
  assert.equal(row.port,65432);assert.ok(["127.0.0.1","::ffff:127.0.0.1"].includes(row.address));
  const names=["users","workspaces","workspace_memberships","datasets","dataset_versions","dataset_rows","eval_items","eval_item_versions","eval_sets","eval_set_versions","eval_set_item_versions",
    "benchmarks","benchmark_versions","run_plans","eval_runs","run_samples","eval_results","gate_results","workflow_runs","workflow_events","audit_events"];
  const tables=(await inspector.query("select name,to_regclass('public.'||name)::text as relation from unnest($1::text[]) name",[names])).rows;
  assert.equal(tables.length,names.length);assert.ok(tables.every(row=>row.name===row.relation));
}
function active(){assert.ok(fixture?.created);return fixture;}
async function counts(){return(await inspector.query(`select
  (select count(*)::int from eval_items where workspace_id=any($1::text[])) as items,
  (select count(*)::int from eval_item_versions v join eval_items p on p.id=v.eval_item_id where p.workspace_id=any($1::text[])) as "itemVersions",
  (select count(*)::int from eval_sets where workspace_id=any($1::text[])) as sets,
  (select count(*)::int from eval_set_versions v join eval_sets p on p.id=v.eval_set_id where p.workspace_id=any($1::text[])) as "setVersions",
  (select count(*)::int from eval_set_item_versions m join eval_set_versions v on v.id=m.eval_set_version_id join eval_sets p on p.id=v.eval_set_id where p.workspace_id=any($1::text[])) as members,
  (select count(*)::int from benchmarks where workspace_id=any($1::text[])) as benchmarks,
  (select count(*)::int from run_plans where workspace_id=any($1::text[])) as plans,
  (select count(*)::int from eval_runs where workspace_id=any($1::text[])) as runs,
  (select count(*)::int from run_samples s join eval_runs r on r.id=s.eval_run_id where r.workspace_id=any($1::text[])) as samples,
  (select count(*)::int from eval_results e join eval_runs r on r.id=e.eval_run_id where r.workspace_id=any($1::text[])) as results,
  (select count(*)::int from gate_results g join eval_runs r on r.id=g.eval_run_id where r.workspace_id=any($1::text[])) as gates,
  (select count(*)::int from workflow_runs where workspace_id=any($1::text[])) as workflows,
  (select count(*)::int from workflow_events e join workflow_runs w on w.id=e.workflow_run_id where w.workspace_id=any($1::text[])) as events,
  (select count(*)::int from audit_events where workspace_id=any($1::text[])) as audits`,[active().workspaceIds])).rows[0];}
async function cleanup(){
  if(!fixture?.created)return;await verifyDatabase();const f=fixture;
  const workspaces=(await inspector.query("select id,name from workspaces where id=any($1::text[])",[f.workspaceIds])).rows;
  const users=(await inspector.query("select id,name,email from users where id=any($1::text[])",[f.actorIds])).rows;
  assert.equal(workspaces.length,2);assert.equal(users.length,2);for(const row of workspaces)assert.equal(row.name,`${applicationName}:${row.id}`);
  for(const row of users){assert.equal(row.name,applicationName);assert.equal(row.email,`${row.id}@composition.invalid`);}
  await inspector.query("begin");try{
    for(const table of ["workflow_runs","eval_runs","run_plans","benchmarks","datasets","eval_sets","eval_items","audit_events"])await inspector.query(`delete from ${table} where workspace_id=any($1::text[])`,[f.workspaceIds]);
    assert.ok(Object.values(await counts()).every(value=>value===0));
    await inspector.query("delete from workspaces where id=any($1::text[])",[f.workspaceIds]);await inspector.query("delete from users where id=any($1::text[])",[f.actorIds]);
    assert.equal((await inspector.query("select id from workspaces where id=any($1::text[])",[f.workspaceIds])).rowCount,0);
    assert.equal((await inspector.query("select id from users where id=any($1::text[])",[f.actorIds])).rowCount,0);
    await inspector.query("commit");fixture=undefined;
  }catch(error){await inspector.query("rollback");throw error;}
}
async function itemIntent(patch={},scope=active().scope){
  const draft=core.prepareCustomEvalItemDraftV3({schemaVersion:"custom-eval-item-draft-v3",itemId:randomUUID(),versionId:randomUUID(),version:1,expectedVersionId:null,name:"Authored exact item",expected:"APPROVED",...patch});
  const head=await db.getCustomEvalItemHeadV3(scope.workspaceId,draft.itemId,itemCallbacks.restore),preview=core.resolveCustomEvalItemPreviewV3({workspaceId:scope.workspaceId,draft,head});
  return {draft,request:core.prepareCustomEvalItemSaveRequestV3({schemaVersion:"custom-eval-item-save-v3",draft,expectedPreviewFingerprint:preview.fingerprint})};
}
const saveItem=(p,scope=active().scope)=>db.saveCustomEvalItemVersionV3(scope,p.request??p,itemCallbacks);
const readItem=(r,scope=active().scope)=>db.getCustomEvalItemVersionV3(scope.workspaceId,r.draft.itemId,r.draft.versionId,itemCallbacks.restore);
const itemRef=r=>({schemaVersion:r.schemaVersion==="custom-eval-item-record-v2"?"custom-eval-item-ref-v2":"custom-eval-item-ref-v3",itemId:r.draft.itemId,versionId:r.draft.versionId,fingerprint:r.contract.fingerprint});
async function item(patch={},scope=active().scope){const p=await itemIntent(patch,scope);return {...p,record:(await saveItem(p,scope)).record};}
async function setIntent(items,patch={},scope=active().scope){
  const draft=core.prepareCustomEvalSetDraftV3({schemaVersion:"custom-eval-set-draft-v3",setId:randomUUID(),versionId:randomUUID(),version:1,expectedVersionId:null,name:"Authored composed set",members:items.map(itemRef),datasetPassRateThreshold:100,...patch});
  const head=await db.getCustomEvalSetHeadV3(scope.workspaceId,draft.setId,readers.restoreSet,readers.restoreItem),selected=await db.getCustomEvalSetItemsV3(scope.workspaceId,draft.members,readers.restoreItem);assert.ok(selected);
  const preview=core.resolveCustomEvalSetPreviewV3({workspaceId:scope.workspaceId,draft,head,items:selected});
  return {draft,request:core.prepareCustomEvalSetSaveRequestV3({schemaVersion:"custom-eval-set-save-v3",draft,expectedPreviewFingerprint:preview.fingerprint})};
}
const saveSet=(p,scope=active().scope)=>db.saveCustomEvalSetVersionV3(scope,p.request??p,setCallbacks);
const readSet=(r,scope=active().scope)=>db.getCustomEvalSetVersionV3(scope.workspaceId,r.draft.setId,r.draft.versionId,readers);
async function set(items,patch={},scope=active().scope){const p=await setIntent(items,patch,scope);return {...p,record:(await saveSet(p,scope)).record};}
const setRef=r=>({schemaVersion:"custom-eval-set-ref-v3",setId:r.draft.setId,versionId:r.draft.versionId,fingerprint:r.contract.fingerprint});
async function contains(patch={},scope=active().scope){
  const draft=containsCore.prepareCustomEvalItemDraftV2({schemaVersion:"custom-eval-item-draft-v2",itemId:randomUUID(),versionId:randomUUID(),version:1,expectedVersionId:null,name:"Existing contains",contains:"APPROVED",...patch});
  const restore=containsCore.restoreCustomEvalItemVersionRecordV2,head=await containsDb.getCustomEvalItemHeadV2(scope.workspaceId,draft.itemId,restore);
  const preview=containsCore.resolveCustomEvalItemPreviewV2({workspaceId:scope.workspaceId,draft,head});
  return(await containsDb.saveCustomEvalItemVersionV2(scope,{schemaVersion:"custom-eval-item-save-v2",draft,expectedPreviewFingerprint:preview.fingerprint},{prepare:containsCore.prepareCustomEvalItemVersionRecordV2,restore})).record;
}
async function overlapping(threshold=100){
  const old=await contains(),exact=(await item()).record;
  const first=(await set([old],{name:"Contains only",datasetPassRateThreshold:threshold})).record,second=(await set([old,exact],{name:"Mixed acceptance",datasetPassRateThreshold:threshold})).record;
  return{items:[old,exact],sets:[first,second],refs:[setRef(first),setRef(second)]};
}
async function dataset(count=2){
  const draft=datasetCore.prepareCustomDatasetDraft({schemaVersion:"custom-dataset-draft-v1",datasetId:randomUUID(),versionId:randomUUID(),version:1,expectedVersionId:null,name:"Authored composition inputs",format:"json",defaultReviewStatus:"reviewed",
    sourceText:JSON.stringify(Array.from({length:count},(_,i)=>({rowKey:`Row${i}`,input:{prompt:`Authored row ${i}`},expectedOutput:"PRIVATE_AUTHORED_REFERENCE",...(i===0?{context:null,history:["authored"]}:{}),metadata:{}})))});
  const preview=datasetCore.resolveCustomDatasetPreview({workspaceId:active().scope.workspaceId,draft,head:null});
  return(await datasets.saveCustomDatasetVersion(active().scope,{schemaVersion:"custom-dataset-save-v1",draft,expectedPreviewFingerprint:preview.fingerprint},{prepare:input=>datasetCore.prepareCustomDatasetVersionRecord(input),restore:input=>datasetCore.restoreCustomDatasetVersionRecord(input)})).record;
}
async function planIntent(origin,patch={}){
  origin??=await overlapping();const input=await dataset();const draft=planCore.prepareHttpEvalPlanDraft({schemaVersion:"http-eval-plan-draft-v3",planId:randomUUID(),versionId:randomUUID(),version:1,expectedVersionId:null,name:"Authored composition plan",
    datasetVersionId:input.content.version.id,evalSetVersions:origin.refs,target:{targetId:"authored-target",targetVersion:"1",endpoint:"https://authored.example.com/evaluate",timeoutMs:1000},limits:{concurrency:1,maxDurationSeconds:5},...patch});
  const sources=await plans.getHttpEvalPlanSources(active().scope.workspaceId,draft,httpReaders);assert.ok(sources);
  const head=await plans.getHttpEvalPlanHead(active().scope.workspaceId,draft.planId,planCallbacks.parse),preview=planCore.resolveHttpEvalPlanPreview({workspaceId:active().scope.workspaceId,draft,...sources,head});
  return{origin,input,draft,preview,request:planCore.prepareHttpEvalPlanSaveRequest({schemaVersion:`http-eval-plan-save-${draft.schemaVersion.slice(-2)}`,draft,expectedPreviewFingerprint:preview.fingerprint})};
}
const savePlan=p=>plans.saveHttpEvalPlanVersion(active().scope,p.request??p,planCallbacks);
const readPlan=r=>plans.getHttpEvalPlanVersion(active().scope.workspaceId,r.content.draft.planId,r.content.draft.versionId,planCallbacks.parse);
async function plan(origin,patch={}){const p=await planIntent(origin,patch);return{...p,record:(await savePlan(p)).record};}
const start=(p,runId=randomUUID())=>({schemaVersion:`http-eval-start-${p.schemaVersion.slice(-2)}`,runId,planVersionId:p.storage.versionId,expectedPlanFingerprint:p.fingerprint});
const reserve=p=>runs.reserveHttpEvalRun(active().scope,p,runCallbacks);
const getRun=id=>runs.getHttpEvalRun(active().scope.workspaceId,id,runCallbacks);
const claim=(r,i)=>runs.claimHttpEvalRunRow(active().scope.workspaceId,r.ledger.publicRunId,{rowId:r.plan.content.samples[i].rowId,leaseToken:r.ledger.leaseToken},runCallbacks);
const response=(c,output)=>JSON.stringify({schemaVersion:"http-json-target-response-v1",requestFingerprint:c.claim.requestFingerprint,output});
const finish=(r,c,output="APPROVED")=>runs.finalizeHttpEvalRunRow(active().scope.workspaceId,r.ledger.publicRunId,{rowId:c.claim.rowId,claimToken:c.claim.claimToken,responseText:response(c,output)},runCallbacks);
async function complete(p,outputs=[]){let r=(await reserve(start(p))).record;for(let i=0;i<p.content.samples.length;i++){const c=await claim(r,i);r=(await finish(r,c,outputs[i]??"APPROVED")).record;}return r;}
async function blocked(operations){
  const blocker=new Client({connectionString,ssl:false,application_name:`${applicationName}_blocker`,statement_timeout:15000,query_timeout:17000});let settled;
  await blocker.connect();try{await blocker.query("begin");await blocker.query("select id from workspaces where id=$1 for update",[active().scope.workspaceId]);
    settled=Promise.allSettled(operations.map(operation=>operation()));let observed=false;
    for(let i=0;i<100;i++){const row=(await inspector.query("select count(*)::int as count from pg_stat_activity where application_name=$1 and wait_event_type='Lock'",[applicationName])).rows[0];if(row.count===operations.length){observed=true;break;}await delay(20);}assert.equal(observed,true);
    await blocker.query("commit");return await settled;
  }finally{await blocker.query("rollback").catch(()=>{});await blocker.end();if(settled)await settled;}
}
async function corruptJson(table,column,id,value,assertion){
  assert.ok(["eval_item_versions.config","eval_item_versions.output_schema","eval_set_versions.contract","run_plans.resolved_plan","workflow_events.payload","workflow_runs.output","eval_results.normalized_fields","gate_results.reasons","audit_events.metadata"].includes(`${table}.${column}`));
  const original=(await inspector.query(`select ${column}::text as value from ${table} where id=$1`,[id])).rows;assert.equal(original.length,1);
  try{await inspector.query(`update ${table} set ${column}=$2::jsonb where id=$1`,[id,typeof value==="string"?value:JSON.stringify(value)]);await assertion();}
  finally{await inspector.query(`update ${table} set ${column}=$2::jsonb where id=$1`,[id,original[0].value]);}
}
async function corruptScalar(table,column,id,value,assertion){
  assert.ok(["eval_item_versions.fingerprint","eval_item_versions.created_at","eval_set_versions.fingerprint","eval_set_versions.created_at","audit_events.metadata_hash","eval_items.name","eval_sets.name"].includes(`${table}.${column}`));
  const original=(await inspector.query(`select ${column} as value from ${table} where id=$1`,[id])).rows;assert.equal(original.length,1);
  try{await inspector.query(`update ${table} set ${column}=$2 where id=$1`,[id,value]);await assertion();}finally{await inspector.query(`update ${table} set ${column}=$2 where id=$1`,[id,original[0].value]);}
}
async function auditFailure(action,work){
  assert.ok(["custom_eval_item_v3.saved","custom_eval_set_v3.saved"].includes(action));const suffix=randomUUID().replaceAll("-",""),fn=`oe_composition_failure_${suffix}`,trigger=`oe_composition_trigger_${suffix}`,ws=active().scope.workspaceId;
  assert.match(ws,/^[0-9a-f-]{36}$/);assert.equal((await inspector.query("select to_regprocedure($1)::text as value",[`public.${fn}()`])).rows[0].value,null);let functionOid,triggerOid;
  try{await inspector.query(`create function public.${fn}() returns trigger language plpgsql as $$ begin if new.workspace_id='${ws}' and new.action='${action}' then raise exception 'authored owned composition failure'; end if; return new; end $$`);
    functionOid=(await inspector.query("select p.oid::text as oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1 and pg_get_userbyid(p.proowner)=current_user",[fn])).rows[0].oid;
    await inspector.query(`create trigger ${trigger} before insert on public.audit_events for each row execute function public.${fn}()`);
    triggerOid=(await inspector.query("select oid::text as oid from pg_trigger where tgname=$1 and tgrelid='public.audit_events'::regclass and tgfoid=$2::oid",[trigger,functionOid])).rows[0].oid;await work();
  }finally{
    if(triggerOid){assert.deepEqual((await inspector.query("select oid::text as oid,tgfoid::text as function from pg_trigger where tgname=$1 and tgrelid='public.audit_events'::regclass",[trigger])).rows,[{oid:triggerOid,function:functionOid}]);await inspector.query(`drop trigger ${trigger} on public.audit_events`);}
    if(functionOid){assert.deepEqual((await inspector.query("select p.oid::text as oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1 and pg_get_userbyid(p.proowner)=current_user",[fn])).rows,[{oid:functionOid}]);await inspector.query(`drop function public.${fn}()`);}
    assert.equal((await inspector.query("select to_regprocedure($1)::text as value",[`public.${fn}()`])).rows[0].value,null);assert.equal((await inspector.query("select oid from pg_trigger where tgname=$1",[trigger])).rowCount,0);
  }
}
function legacyImport(setId=`legacy_set_${randomUUID()}`,versionId=`legacy_version_${randomUUID()}`,members=[]){const id=`authored_benchmark_${randomUUID()}`;return{benchmarkId:id,benchmarkVersionId:`${id}_v1`,family:"authored",datasetRows:[],evalSet:{id:versionId,setId,name:"Authored legacy import",itemVersions:members,gates:{},fingerprint:`authored-${randomUUID()}`},license:"authored",limitations:[],fingerprint:`fixture-${randomUUID()}`};}

describe("Exact matching native persistence [T3; authored]",{concurrency:false,timeout:300000},()=>{
  before(async()=>{
    connectionString=guard();({Client}=createRequire(new URL("../../packages/db/package.json",import.meta.url))("pg"));
    inspector=new Client({connectionString,ssl:false,application_name:`${applicationName}_inspector`,connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:17000});await inspector.connect();await verifyDatabase();
    for(const key of environmentKeys)delete process.env[key];const url=new URL(connectionString);url.searchParams.set("application_name",applicationName);url.searchParams.set("options","-c statement_timeout=15000 -c lock_timeout=10000");process.env.DATABASE_URL=url.toString();
    containsCore=await import("../../packages/core/src/eval-composition.ts");containsDb=await import("../../packages/db/src/eval-composition.ts");core=await import("../../packages/core/src/eval-matching.ts");db=await import("../../packages/db/src/eval-matching.ts");planCore=await import("../../packages/core/src/http-eval-plans.ts");runCore=await import("../../packages/core/src/http-eval-runs.ts");
    plans=await import("../../packages/db/src/http-eval-plans.ts");runs=await import("../../packages/db/src/http-eval-runs.ts");datasetCore=await import("../../packages/core/src/custom-datasets.ts");datasets=await import("../../packages/db/src/custom-datasets.ts");
    legacyCore=await import("../../packages/core/src/custom-evals.ts");legacyDb=await import("../../packages/db/src/custom-evals.ts");service=await import("../../packages/db/src/service.ts");provided=await import("../../packages/db/src/provided-output-runs.ts");
  });
  beforeEach(async()=>{
    await verifyDatabase();const workspaceIds=[randomUUID(),randomUUID()],actorIds=[randomUUID(),randomUUID()];fixture={workspaceIds,actorIds,scope:{workspaceId:workspaceIds[0],actorId:actorIds[0]},foreignScope:{workspaceId:workspaceIds[1],actorId:actorIds[1]},created:false};
    await inspector.query("begin");try{for(const[i,id]of workspaceIds.entries()){await inspector.query("insert into users(id,email,name)values($1,$2,$3)",[actorIds[i],`${actorIds[i]}@composition.invalid`,applicationName]);await inspector.query("insert into workspaces(id,name,mode)values($1,$2,'hosted')",[id,`${applicationName}:${id}`]);await inspector.query("insert into workspace_memberships(workspace_id,user_id,role)values($1,$2,'owner')",[id,actorIds[i]]);}await inspector.query("commit");fixture.created=true;}catch(error){await inspector.query("rollback");throw error;}
  });
  afterEach(cleanup);
  after(async()=>{try{await cleanup();}finally{for(const[key,value]of oldEnvironment){if(value===undefined)delete process.env[key];else process.env[key]=value;}await inspector?.end();}});


  test("XM-PG01 exact record, native schema and content-free audit round trip",async()=>{
    const p=await item({name:"Literal café",expected:" APPROVED\n"}),r=p.record;equalJson(await readItem(r),r);
    const native=(await inspector.query("select v.*,p.type from eval_item_versions v join eval_items p on p.id=v.eval_item_id where v.id=$1",[r.storage.versionId])).rows[0];
    assert.equal(native.type,"exact_match");assert.equal(native.config.schemaVersion,"custom-eval-item-storage-v3");equalJson(JSON.parse(native.config.recordText),r);equalJson(native.output_schema,r.contract.outputSchema);
    const audit=(await inspector.query("select metadata from audit_events where id=$1",[r.storage.auditId])).rows[0];assert.equal(audit.metadata.recordFingerprint,r.fingerprint);assert.equal(JSON.stringify(audit.metadata).includes(r.draft.expected),false);
    assert.equal((await db.listCustomEvalItemsV3(active().scope.workspaceId,itemCallbacks.restore))[0].head.profile,"eval-matching-v3");
  });
  test("XM-PG02 exact append preserves old item mixed membership and frozen HTTP plan",async()=>{
    const origin=await overlapping(),p=await plan(origin),old=origin.items[1],oldSet=origin.sets[1];
    await item({itemId:old.draft.itemId,version:2,expectedVersionId:old.draft.versionId,name:"Later exact",expected:"OTHER"});
    await set([origin.items[0]],{setId:oldSet.draft.setId,version:2,expectedVersionId:oldSet.draft.versionId,name:"Later set"});
    equalJson(await readItem(old),old);equalJson(await readSet(oldSet),oldSet);equalJson(await readPlan(p.record),p.record);
  });
  test("XM-PG03 identical replay precedes a corrupt later head and creates no duplicate",async()=>{
    const old=await item(),next=await item({itemId:old.draft.itemId,version:2,expectedVersionId:old.draft.versionId,expected:"Later"}),before=await counts();
    await corruptJson("eval_item_versions","config",next.record.storage.versionId,{schemaVersion:"corrupt"},async()=>{const replay=await saveItem(old);assert.equal(replay.replayed,true);equalJson(replay.record,old.record);assert.deepEqual(await counts(),before);});
    const changed=plain(old.request);changed.draft.expected="DIFFERENT";await assert.rejects(saveItem(changed),status(409));assert.deepEqual(await counts(),before);
  });
  test("XM-PG04 mixed sources retain v2 and v3 identities in ordered native membership",async()=>{
    const origin=await overlapping(),r=origin.sets[1];equalJson(await readSet(r),r);assert.deepEqual(r.members.map(m=>m.itemSchemaVersion),["custom-eval-item-v2","custom-eval-item-v3"]);
    assert.equal((await counts()).itemVersions,2);assert.equal((await counts()).members,3);
    const native=(await inspector.query("select eval_item_version_id as id,position,weight,criticality from eval_set_item_versions where eval_set_version_id=$1 order by position",[r.storage.versionId])).rows;
    assert.deepEqual(native.map(m=>m.id),origin.items.map(i=>i.storage.versionId));assert.ok(native.every(m=>Number(m.weight)===1&&m.criticality==="critical"));
  });
  test("XM-PG05 mixed set replay does not follow changed source heads",async()=>{
    const origin=await overlapping(),first=await set(origin.items),later=await set(origin.items,{setId:first.draft.setId,version:2,expectedVersionId:first.draft.versionId,name:"Later set"});
    await item({itemId:origin.items[1].draft.itemId,version:2,expectedVersionId:origin.items[1].draft.versionId,expected:"Changed"});
    await corruptJson("eval_set_versions","contract",later.record.storage.versionId,{schemaVersion:"corrupt"},async()=>{const before=await counts(),replay=await saveSet(first);assert.equal(replay.replayed,true);equalJson(replay.record,first.record);assert.deepEqual(await counts(),before);});
  });
  test("XM-PG06 concurrent exact CAS writers have one winner and no orphan",async()=>{
    const first=await item(),patch={itemId:first.draft.itemId,version:2,expectedVersionId:first.draft.versionId},a=await itemIntent({...patch,expected:"A"}),b=await itemIntent({...patch,expected:"B"});
    const result=await blocked([()=>saveItem(a),()=>saveItem(b)]);assert.equal(result.filter(r=>r.status==="fulfilled").length,1);assert.equal(result.filter(r=>r.status==="rejected"&&r.reason.status===409).length,1);assert.equal((await counts()).itemVersions,2);
  });
  test("XM-PG07 concurrent mixed-set revisions preserve one membership order",async()=>{
    const origin=await overlapping(),first=origin.sets[1],patch={setId:first.draft.setId,version:2,expectedVersionId:first.draft.versionId},a=await setIntent(origin.items,patch),b=await setIntent([...origin.items].reverse(),patch);
    const result=await blocked([()=>saveSet(a),()=>saveSet(b)]);assert.equal(result.filter(r=>r.status==="fulfilled").length,1);assert.equal(result.filter(r=>r.status==="rejected"&&r.reason.status===409).length,1);assert.equal((await counts()).setVersions,3);
  });
  test("XM-PG08 identical concurrent create requests reserve one exact version",async()=>{
    const p=await itemIntent(),result=await blocked([()=>saveItem(p),()=>saveItem(p)]);assert.ok(result.every(r=>r.status==="fulfilled"));assert.deepEqual(result.map(r=>r.value.replayed).sort(),[false,true]);assert.equal((await counts()).itemVersions,1);assert.equal((await counts()).audits,1);
  });
  test("XM-PG09 failed item audit rolls back the aggregate and version atomically",async()=>{
    const p=await itemIntent(),before=await counts();await auditFailure("custom_eval_item_v3.saved",async()=>{await assert.rejects(saveItem(p));});assert.deepEqual(await counts(),before);
  });
  test("XM-PG10 failed mixed-set audit rolls back memberships without changing sources",async()=>{
    const origin=await overlapping(),p=await setIntent(origin.items),before=await counts();await auditFailure("custom_eval_set_v3.saved",async()=>{await assert.rejects(saveSet(p));});assert.deepEqual(await counts(),before);
  });
  test("XM-PG11 matching sources are workspace scoped and wrong fingerprints cannot write",async()=>{
    const foreign=(await item({},active().foreignScope)).record,local=await contains(),before=await counts();
    await assert.rejects(setIntent([local,foreign]));assert.deepEqual(await counts(),before);
    const good=(await item()).record,draft={schemaVersion:"custom-eval-set-draft-v3",setId:randomUUID(),versionId:randomUUID(),version:1,expectedVersionId:null,name:"Wrong ref",members:[{...itemRef(good),fingerprint:"0".repeat(64)}],datasetPassRateThreshold:100};
    const later=await counts();await assert.rejects(db.getCustomEvalSetItemsV3(active().scope.workspaceId,draft.members,readers.restoreItem),status(409));assert.deepEqual(await counts(),later);
  });
  test("XM-PG12 corrupt exact native schema or audit fails closed without repair",async()=>{
    const r=(await item()).record;
    await corruptJson("eval_item_versions","output_schema",r.storage.versionId,{fields:[]},async()=>{await assert.rejects(readItem(r),status(409));});
    await corruptScalar("audit_events","metadata_hash",r.storage.auditId,"0".repeat(64),async()=>{await assert.rejects(readItem(r),status(409));});
    equalJson(await readItem(r),r);
  });
  test("XM-PG13 changed native mixed weights or positions invalidate readback",async()=>{
    const r=(await set((await overlapping()).items)).record,member=r.members[0].evalItemVersionId;
    try{await inspector.query("update eval_set_item_versions set weight=2 where eval_set_version_id=$1 and eval_item_version_id=$2",[r.storage.versionId,member]);await assert.rejects(readSet(r),status(409));}
    finally{await inspector.query("update eval_set_item_versions set weight=1 where eval_set_version_id=$1 and eval_item_version_id=$2",[r.storage.versionId,member]);}
    equalJson(await readSet(r),r);
  });
  test("XM-PG14 equal public UUID pairs in item families remain separate native sources",async()=>{
    const old=await contains(),exact=(await item({itemId:old.draft.itemId,versionId:old.draft.versionId})).record,r=(await set([old,exact])).record;
    assert.notEqual(old.storage.itemId,exact.storage.itemId);assert.notEqual(old.storage.versionId,exact.storage.versionId);equalJson(await readSet(r),r);assert.equal((await counts()).itemVersions,2);
    assert.equal((await containsDb.listCustomEvalItemsV2(active().scope.workspaceId,containsCore.restoreCustomEvalItemVersionRecordV2)).length,1);
    assert.equal((await db.listCustomEvalItemsV3(active().scope.workspaceId,itemCallbacks.restore)).length,1);
  });
  test("XM-PG15 benchmark imports reject absent and foreign reserved identities before any write while near-prefix IDs remain valid",async()=>{
    const before=await counts();for(const prefix of["custom_eval_item_v3_","custom_eval_item_version_v3_","custom_eval_set_v3_","custom_eval_set_version_v3_"]){const input=legacyImport(`${prefix}${"a".repeat(64)}`);await assert.rejects(service.persistBenchmarkImport(active().scope.workspaceId,input),status(409));assert.deepEqual(await counts(),before);}
    const foreign=(await item({},active().foreignScope)).record,input=legacyImport();input.evalSet.itemVersions=[{item:{id:`legacy_${randomUUID()}`,itemId:foreign.storage.itemId,name:"Foreign collision",type:"string_check",outputSchema:{fields:[]},config:{},version:1,fingerprint:"authored"},weight:1,criticality:"critical"}];
    await assert.rejects(service.persistBenchmarkImport(active().scope.workspaceId,input),status(409));assert.equal((await counts()).benchmarks,0);
    const corruptItem=`authored_profile_${randomUUID()}`,corruptVersion=`authored_profile_version_${randomUUID()}`;
    await inspector.query("insert into eval_items(id,workspace_id,name,type)values($1,$2,'Authored corrupt profile','string_check')",[corruptItem,active().foreignScope.workspaceId]);
    await inspector.query("insert into eval_item_versions(id,eval_item_id,version,output_schema,config,fingerprint)values($1,$2,1,'{}'::jsonb,'{\"schemaVersion\":\"custom-eval-item-storage-v3\"}'::jsonb,'authored')",[corruptVersion,corruptItem]);
    const byProfile=legacyImport();byProfile.evalSet.itemVersions=[{item:{...input.evalSet.itemVersions[0].item,id:corruptVersion,itemId:corruptItem},weight:1,criticality:"critical"}];
    await assert.rejects(service.persistBenchmarkImport(active().scope.workspaceId,byProfile),status(409));assert.equal((await counts()).benchmarks,0);
    const near=legacyImport(`customXevalXsetXv2_${randomUUID()}`);await service.persistBenchmarkImport(active().scope.workspaceId,near);assert.equal((await counts()).benchmarks,1);assert.ok((await service.listScenarios(active().scope.workspaceId)).evalSets.some(s=>s.id===near.evalSet.setId));
  });
  test("XM-PG16 generic catalogue hides corrupt v3 ownership by aggregate, version or profile instead of treating it as legacy",async()=>{
    const origin=await overlapping();assert.equal((await service.listScenarios(active().scope.workspaceId)).evalSets.length,0);
    assert.equal((await provided.listProvidedOutputSources(active().scope.workspaceId)).evalSets.length,0);
    await assert.rejects(provided.getProvidedOutputInputs(active().scope.workspaceId,{datasetVersionId:"authored-unused",evalSetVersionId:origin.sets[0].storage.versionId}),status(422));
    const old=legacyImport();await service.persistBenchmarkImport(active().scope.workspaceId,old);const itemId=`custom_eval_item_v3_${"f".repeat(64)}`,itemVersion=`malformed_item_${randomUUID()}`;
    await inspector.query("insert into eval_items(id,workspace_id,name,type)values($1,$2,'Authored corrupted item','string_check')",[itemId,active().scope.workspaceId]);
    await inspector.query("insert into eval_item_versions(id,eval_item_id,version,output_schema,config,fingerprint)values($1,$2,1,'{}'::jsonb,'{}'::jsonb,'authored-corruption')",[itemVersion,itemId]);
    await inspector.query("insert into eval_set_item_versions(eval_set_version_id,eval_item_version_id,position,weight,criticality)values($1,$2,0,1,'critical')",[old.evalSet.id,itemVersion]);
    assert.equal((await service.listScenarios(active().scope.workspaceId)).evalSets.some(s=>s.id===old.evalSet.setId),false);
    const row=origin.sets[0],stored=(await inspector.query("select contract from eval_set_versions where id=$1",[row.storage.versionId])).rows[0].contract;
    await corruptJson("eval_set_versions","contract",row.storage.versionId,{...stored,schemaVersion:"corrupt"},async()=>{assert.equal((await service.listScenarios(active().scope.workspaceId)).evalSets.length,0);await assert.rejects(readSet(row),status(409));});
  });

  test("XM-PG17 shared contains and exact HTTP execution persists four results from two claims",async()=>{
    const p=await plan(),r=await complete(p.record);assert.equal(r.execution.results.length,4);assert.equal(r.execution.gates.length,16);assert.ok(r.execution.gates.every(g=>g.passed));
    const claims=(await inspector.query("select count(*)::int as count from workflow_events where workflow_run_id=$1 and event_type='http_eval.row.claimed'",[r.ledger.workflowId])).rows[0].count;
    assert.equal(claims,2);assert.equal(r.execution.results.filter(v=>v.model==="literal_exact_text_v1").length,2);equalJson(await getRun(r.ledger.publicRunId),r);
  });
  test("XM-PG18 persisted exact critical failure blocks low-threshold gates",async()=>{
    const origin=await overlapping(0),p=await plan(origin),r=await complete(p.record,["approved","approved"]);
    assert.equal(r.execution.gates.find(g=>g.level==="eval_set"&&g.scopeId===origin.sets[0].storage.versionId).passed,true);
    assert.equal(r.execution.gates.find(g=>g.level==="eval_set"&&g.scopeId===origin.sets[1].storage.versionId).passed,false);
    for(const level of ["dataset","target","criticality","run"])assert.equal(r.execution.gates.find(g=>g.level===level).passed,false);
  });
  test("XM-PG19 completed request and finalization replay do not redispatch and survive deletion of live sources",async()=>{
    const p=await plan(),request=start(p.record),initial=(await reserve(request)).record,c=await claim(initial,0),first=await finish(initial,c);assert.equal((await finish(initial,c)).replayed,true);await assert.rejects(finish(initial,c,"changed"),status(409));
    const c2=await claim(first.record,1),done=(await finish(first.record,c2)).record;await inspector.query("delete from datasets where workspace_id=$1",[active().scope.workspaceId]);await inspector.query("delete from eval_sets where workspace_id=$1",[active().scope.workspaceId]);await inspector.query("delete from eval_items where workspace_id=$1",[active().scope.workspaceId]);
    const before=await counts(),replay=await reserve(request);assert.equal(replay.created,false);equalJson(replay.record,done);equalJson(await readPlan(p.record),p.record);equalJson(await getRun(done.ledger.publicRunId),done);assert.deepEqual(await counts(),before);await assert.rejects(claim(done,0),status(409));assert.deepEqual(await counts(),before);
  });
  test("XM-PG20 v3 recovery preserves known responses, records uncertainty once and prevents late overwrite",async()=>{
    const origin=await overlapping(),input=await dataset(3),p=await plan(origin,{datasetVersionId:input.content.version.id,limits:{concurrency:1,maxDurationSeconds:5}}),initial=(await reserve(start(p.record))).record;
    const a=await claim(initial,0),known=(await finish(initial,a)).record,b=await claim(known,1);await assert.rejects(runs.recoverHttpEvalRun(active().scope,initial.ledger.publicRunId,runCallbacks),status(409));
    await delay(Math.max(0,Date.parse(initial.ledger.leaseExpiresAt)-Date.now()+60));const recovered=await runs.recoverHttpEvalRun(active().scope,initial.ledger.publicRunId,runCallbacks);assert.deepEqual(recovered.ledger.rows.map(r=>r.status),["succeeded","outcome_unknown","not_sent"]);
    equalJson(recovered.events.find(e=>e.rowId===a.claim.rowId),known.events[0]);assert.ok(recovered.events.every(e=>e.schemaVersion==="http-eval-row-event-v3"));assert.equal(recovered.execution.gates.find(g=>g.level==="run").passed,false);
    const before=await counts();await assert.rejects(finish(initial,b),status(409));equalJson(await runs.recoverHttpEvalRun(active().scope,initial.ledger.publicRunId,runCallbacks),recovered);assert.deepEqual(await counts(),before);equalJson(await getRun(initial.ledger.publicRunId),recovered);
  });
});

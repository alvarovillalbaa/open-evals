import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

// Authored UNRUN. Guard and ownership verification precede every application import or write.
// The caller creates/migrates/drops this database. No target adapter or network target is imported.
const MARKER="open-evals-composition-v2-20261109-created-disposable-v1";
const applicationName=`oe_composition_v2_${randomUUID().replaceAll("-","")}`;
const environmentKeys=["DATABASE_URL","POSTGRES_URL","SUPABASE_DB_URL","DATABASE_SSL","SUPABASE_DB_SSL"];
const oldEnvironment=new Map(environmentKeys.map(key=>[key,process.env[key]]));
let Client,inspector,connectionString,databaseName,fixture,core,db,planCore,runCore,plans,runs,datasetCore,datasets,legacyCore,legacyDb,service,provided;
const plain=value=>JSON.parse(JSON.stringify(value));
const equalJson=(a,b)=>assert.deepEqual(plain(a),plain(b));
const status=expected=>error=>{assert.equal(error.status,expected);return true;};
const itemCallbacks={prepare:input=>core.prepareCustomEvalItemVersionRecordV2(input),restore:(value,ws)=>core.restoreCustomEvalItemVersionRecordV2(value,ws)};
const setCallbacks={prepare:input=>core.prepareCustomEvalSetVersionRecordV2(input),restore:(value,ws)=>core.restoreCustomEvalSetVersionRecordV2(value,ws),restoreItem:(value,ws)=>core.restoreCustomEvalItemVersionRecordV2(value,ws)};
const readers={restoreSet:(value,ws)=>core.restoreCustomEvalSetVersionRecordV2(value,ws),restoreItem:(value,ws)=>core.restoreCustomEvalItemVersionRecordV2(value,ws)};
const planCallbacks={prepare:input=>planCore.prepareHttpEvalPlanVersionRecord(input),parse:value=>planCore.parseHttpEvalPlanVersionRecord(value),...readers};
const runCallbacks={parsePlan:value=>planCore.parseHttpEvalPlanVersionRecord(value),create:input=>runCore.createHttpEvalRunLedger(input),claim:input=>runCore.claimHttpEvalRow(input),
  finalize:input=>runCore.finalizeHttpEvalRow(input),recover:input=>runCore.recoverHttpEvalRun(input),stop:input=>runCore.stopHttpEvalRun(input),build:input=>runCore.buildHttpEvalRunRecord(input),parse:value=>runCore.parseHttpEvalRunRecord(value)};
function guard(){
  assert.equal(process.env.EVAL_COMPOSITION_TEST_ALLOW,"local-disposable");const url=new URL(process.env.EVAL_COMPOSITION_TEST_DATABASE_URL??"");
  assert.ok(["postgres:","postgresql:"].includes(url.protocol));assert.equal(url.hostname,"127.0.0.1");assert.equal(url.port,"65432");assert.equal(url.username,"postgres");
  assert.match(url.pathname,/^\/oe_composition_v2_test_[0-9]+_[0-9]+$/);assert.equal(url.search,"");assert.equal(url.hash,"");databaseName=url.pathname.slice(1);return url.toString();
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
  const draft=core.prepareCustomEvalItemDraftV2({schemaVersion:"custom-eval-item-draft-v2",itemId:randomUUID(),versionId:randomUUID(),version:1,expectedVersionId:null,name:"Authored contains item",contains:"blue",...patch});
  const head=await db.getCustomEvalItemHeadV2(scope.workspaceId,draft.itemId,itemCallbacks.restore),preview=core.resolveCustomEvalItemPreviewV2({workspaceId:scope.workspaceId,draft,head});
  return {draft,request:core.prepareCustomEvalItemSaveRequestV2({schemaVersion:"custom-eval-item-save-v2",draft,expectedPreviewFingerprint:preview.fingerprint})};
}
const saveItem=(p,scope=active().scope)=>db.saveCustomEvalItemVersionV2(scope,p.request??p,itemCallbacks);
const readItem=(r,scope=active().scope)=>db.getCustomEvalItemVersionV2(scope.workspaceId,r.draft.itemId,r.draft.versionId,itemCallbacks.restore);
const itemRef=r=>({itemId:r.draft.itemId,versionId:r.draft.versionId,fingerprint:r.contract.fingerprint});
async function item(patch={},scope=active().scope){const p=await itemIntent(patch,scope);return {...p,record:(await saveItem(p,scope)).record};}
async function setIntent(items,patch={},scope=active().scope){
  const draft=core.prepareCustomEvalSetDraftV2({schemaVersion:"custom-eval-set-draft-v2",setId:randomUUID(),versionId:randomUUID(),version:1,expectedVersionId:null,name:"Authored composed set",members:items.map(itemRef),datasetPassRateThreshold:100,...patch});
  const head=await db.getCustomEvalSetHeadV2(scope.workspaceId,draft.setId,readers.restoreSet,readers.restoreItem),selected=await db.getCustomEvalSetItemsV2(scope.workspaceId,draft.members,readers.restoreItem);assert.ok(selected);
  const preview=core.resolveCustomEvalSetPreviewV2({workspaceId:scope.workspaceId,draft,head,items:selected});
  return {draft,request:core.prepareCustomEvalSetSaveRequestV2({schemaVersion:"custom-eval-set-save-v2",draft,expectedPreviewFingerprint:preview.fingerprint})};
}
const saveSet=(p,scope=active().scope)=>db.saveCustomEvalSetVersionV2(scope,p.request??p,setCallbacks);
const readSet=(r,scope=active().scope)=>db.getCustomEvalSetVersionV2(scope.workspaceId,r.draft.setId,r.draft.versionId,readers);
async function set(items,patch={},scope=active().scope){const p=await setIntent(items,patch,scope);return {...p,record:(await saveSet(p,scope)).record};}
const setRef=r=>({schemaVersion:"custom-eval-set-ref-v2",setId:r.draft.setId,versionId:r.draft.versionId,fingerprint:r.contract.fingerprint});
async function overlapping(threshold=100){
  const items=[];for(const contains of ["red","blue","green"])items.push((await item({name:`Authored ${contains}`,contains})).record);
  const a=await set(items.slice(0,2),{name:"Red and blue",datasetPassRateThreshold:threshold}),b=await set(items.slice(1),{name:"Blue and green",datasetPassRateThreshold:threshold});
  return {items,sets:[a.record,b.record],refs:[setRef(a.record),setRef(b.record)]};
}
async function dataset(count=2){
  const draft=datasetCore.prepareCustomDatasetDraft({schemaVersion:"custom-dataset-draft-v1",datasetId:randomUUID(),versionId:randomUUID(),version:1,expectedVersionId:null,name:"Authored composition inputs",format:"json",defaultReviewStatus:"reviewed",
    sourceText:JSON.stringify(Array.from({length:count},(_,i)=>({rowKey:`Row${i}`,input:{prompt:`Authored row ${i}`},expectedOutput:"PRIVATE_AUTHORED_REFERENCE",...(i===0?{context:null,history:["authored"]}:{}),metadata:{}})))});
  const preview=datasetCore.resolveCustomDatasetPreview({workspaceId:active().scope.workspaceId,draft,head:null});
  return(await datasets.saveCustomDatasetVersion(active().scope,{schemaVersion:"custom-dataset-save-v1",draft,expectedPreviewFingerprint:preview.fingerprint},{prepare:input=>datasetCore.prepareCustomDatasetVersionRecord(input),restore:input=>datasetCore.restoreCustomDatasetVersionRecord(input)})).record;
}
async function planIntent(origin,patch={}){
  origin??=await overlapping();const input=await dataset();const draft=planCore.prepareHttpEvalPlanDraft({schemaVersion:"http-eval-plan-draft-v2",planId:randomUUID(),versionId:randomUUID(),version:1,expectedVersionId:null,name:"Authored composition plan",
    datasetVersionId:input.content.version.id,evalSetVersions:origin.refs,target:{targetId:"authored-target",targetVersion:"1",endpoint:"https://authored.example.com/evaluate",timeoutMs:1000},limits:{concurrency:1,maxDurationSeconds:5},...patch});
  const sources=await plans.getHttpEvalPlanSources(active().scope.workspaceId,draft,readers);assert.ok(sources);
  const head=await plans.getHttpEvalPlanHead(active().scope.workspaceId,draft.planId,planCallbacks.parse),preview=planCore.resolveHttpEvalPlanPreview({workspaceId:active().scope.workspaceId,draft,...sources,head});
  return{origin,input,draft,preview,request:planCore.prepareHttpEvalPlanSaveRequest({schemaVersion:draft.schemaVersion==="http-eval-plan-draft-v1"?"http-eval-plan-save-v1":"http-eval-plan-save-v2",draft,expectedPreviewFingerprint:preview.fingerprint})};
}
const savePlan=p=>plans.saveHttpEvalPlanVersion(active().scope,p.request??p,planCallbacks);
const readPlan=r=>plans.getHttpEvalPlanVersion(active().scope.workspaceId,r.content.draft.planId,r.content.draft.versionId,planCallbacks.parse);
async function plan(origin,patch={}){const p=await planIntent(origin,patch);return{...p,record:(await savePlan(p)).record};}
const start=(p,runId=randomUUID())=>({schemaVersion:p.schemaVersion==="http-eval-plan-record-v1"?"http-eval-start-v1":"http-eval-start-v2",runId,planVersionId:p.storage.versionId,expectedPlanFingerprint:p.fingerprint});
const reserve=p=>runs.reserveHttpEvalRun(active().scope,p,runCallbacks);
const getRun=id=>runs.getHttpEvalRun(active().scope.workspaceId,id,runCallbacks);
const claim=(r,i)=>runs.claimHttpEvalRunRow(active().scope.workspaceId,r.ledger.publicRunId,{rowId:r.plan.content.samples[i].rowId,leaseToken:r.ledger.leaseToken},runCallbacks);
const response=(c,output)=>JSON.stringify({schemaVersion:"http-json-target-response-v1",requestFingerprint:c.claim.requestFingerprint,output});
const finish=(r,c,output="red blue green")=>runs.finalizeHttpEvalRunRow(active().scope.workspaceId,r.ledger.publicRunId,{rowId:c.claim.rowId,claimToken:c.claim.claimToken,responseText:response(c,output)},runCallbacks);
async function complete(p,outputs=[]){let r=(await reserve(start(p))).record;for(let i=0;i<p.content.samples.length;i++){const c=await claim(r,i);r=(await finish(r,c,outputs[i]??"red blue green")).record;}return r;}
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
  assert.ok(["custom_eval_item_v2.saved","custom_eval_set_v2.saved"].includes(action));const suffix=randomUUID().replaceAll("-",""),fn=`oe_composition_failure_${suffix}`,trigger=`oe_composition_trigger_${suffix}`,ws=active().scope.workspaceId;
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

describe("Evaluator composition native persistence [T3; authored UNRUN]",{concurrency:false,timeout:300000},()=>{
  before(async()=>{
    connectionString=guard();({Client}=createRequire(new URL("../../packages/db/package.json",import.meta.url))("pg"));
    inspector=new Client({connectionString,ssl:false,application_name:`${applicationName}_inspector`,connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:17000});await inspector.connect();await verifyDatabase();
    for(const key of environmentKeys)delete process.env[key];const url=new URL(connectionString);url.searchParams.set("application_name",applicationName);url.searchParams.set("options","-c statement_timeout=15000 -c lock_timeout=10000");process.env.DATABASE_URL=url.toString();
    core=await import("../../packages/core/src/eval-composition.ts");db=await import("../../packages/db/src/eval-composition.ts");planCore=await import("../../packages/core/src/http-eval-plans.ts");runCore=await import("../../packages/core/src/http-eval-runs.ts");
    plans=await import("../../packages/db/src/http-eval-plans.ts");runs=await import("../../packages/db/src/http-eval-runs.ts");datasetCore=await import("../../packages/core/src/custom-datasets.ts");datasets=await import("../../packages/db/src/custom-datasets.ts");
    legacyCore=await import("../../packages/core/src/custom-evals.ts");legacyDb=await import("../../packages/db/src/custom-evals.ts");service=await import("../../packages/db/src/service.ts");provided=await import("../../packages/db/src/provided-output-runs.ts");
  });
  beforeEach(async()=>{
    await verifyDatabase();const workspaceIds=[randomUUID(),randomUUID()],actorIds=[randomUUID(),randomUUID()];fixture={workspaceIds,actorIds,scope:{workspaceId:workspaceIds[0],actorId:actorIds[0]},foreignScope:{workspaceId:workspaceIds[1],actorId:actorIds[1]},created:false};
    await inspector.query("begin");try{for(const[i,id]of workspaceIds.entries()){await inspector.query("insert into users(id,email,name)values($1,$2,$3)",[actorIds[i],`${actorIds[i]}@composition.invalid`,applicationName]);await inspector.query("insert into workspaces(id,name,mode)values($1,$2,'hosted')",[id,`${applicationName}:${id}`]);await inspector.query("insert into workspace_memberships(workspace_id,user_id,role)values($1,$2,'owner')",[id,actorIds[i]]);}await inspector.query("commit");fixture.created=true;}catch(error){await inspector.query("rollback");throw error;}
  });
  afterEach(cleanup);
  after(async()=>{try{await cleanup();}finally{for(const[key,value]of oldEnvironment){if(value===undefined)delete process.env[key];else process.env[key]=value;}await inspector?.end();}});

  test("CP-PG01 standalone item canonical record, native columns and content-free audit round trip",async()=>{
    const p=await item({name:"Unicode café",contains:"blue\nquoted \"text\""}),r=p.record;equalJson(await readItem(r),r);
    const native=(await inspector.query("select v.*,p.workspace_id,p.type from eval_item_versions v join eval_items p on p.id=v.eval_item_id where v.id=$1",[r.storage.versionId])).rows[0];
    assert.equal(native.workspace_id,active().scope.workspaceId);assert.equal(native.type,"string_check");assert.equal(native.config.schemaVersion,"custom-eval-item-storage-v2");assert.equal(typeof native.config.recordText,"string");
    equalJson(JSON.parse(native.config.recordText),r);equalJson(native.output_schema,r.contract.outputSchema);assert.equal(native.fingerprint,r.contract.fingerprint);assert.equal(native.created_at.toISOString(),r.createdAt);
    const audit=(await inspector.query("select actor_user_id,resource_id,metadata from audit_events where id=$1",[r.storage.auditId])).rows[0];assert.equal(audit.actor_user_id,active().scope.actorId);assert.equal(audit.resource_id,r.storage.itemId);assert.equal(audit.metadata.recordFingerprint,r.fingerprint);assert.equal(JSON.stringify(audit.metadata).includes(r.draft.contains),false);
    const listed=await db.listCustomEvalItemsV2(active().scope.workspaceId,itemCallbacks.restore);assert.equal(listed.length,1);assert.equal(listed[0].head.contractFingerprint,r.contract.fingerprint);
  });
  test("CP-PG02 item append rename preserves exact old item, set and frozen plan after both heads advance",async()=>{
    const origin=await overlapping(),p=await plan(origin),old=origin.items[1],oldSet=origin.sets[0];
    const next=await item({itemId:old.draft.itemId,version:2,expectedVersionId:old.draft.versionId,name:"Renamed blue v2",contains:"changed"});
    await set([origin.items[0],next.record],{setId:oldSet.draft.setId,version:2,expectedVersionId:oldSet.draft.versionId,name:"Renamed set v2"});
    equalJson(await readItem(old),old);equalJson(await readSet(oldSet),oldSet);equalJson(await readPlan(p.record),p.record);
    assert.equal((await db.getCustomEvalItemV2(active().scope.workspaceId,old.draft.itemId,itemCallbacks.restore)).head.name,"Renamed blue v2");
  });
  test("CP-PG03 identical item replay precedes malformed later head and changes no rows",async()=>{
    const old=await item(),next=await item({itemId:old.draft.itemId,version:2,expectedVersionId:old.draft.versionId,name:"Later item",contains:"later"});
    const before=await counts();await corruptJson("eval_item_versions","config",next.record.storage.versionId,{schemaVersion:"corrupt"},async()=>{const replay=await saveItem(old);assert.equal(replay.replayed,true);equalJson(replay.record,old.record);assert.deepEqual(await counts(),before);});
    const changed=plain(old.request);changed.draft.contains="different";await assert.rejects(saveItem(changed),status(409));assert.deepEqual(await counts(),before);
  });
  test("CP-PG04 two multi-item sets share one exact native item version while retaining order and all memberships",async()=>{
    const origin=await overlapping();assert.equal((await counts()).itemVersions,3);assert.equal((await counts()).members,4);
    for(const r of origin.sets){equalJson(await readSet(r),r);assert.equal(r.members.length,2);assert.deepEqual(r.members.map(m=>m.position),[0,1]);}
    assert.equal(origin.sets[0].members[1].evalItemVersionId,origin.sets[1].members[0].evalItemVersionId);
    const listed=await db.listCustomEvalSetsV2(active().scope.workspaceId,readers.restoreSet,readers.restoreItem);assert.equal(listed.length,2);assert.ok(listed.every(row=>row.memberCount===2));
  });
  test("CP-PG05 set replay precedes later head corruption and never substitutes current source item versions",async()=>{
    const a=(await item()).record,p=await set([a]),next=await set([a],{setId:p.draft.setId,version:2,expectedVersionId:p.draft.versionId,name:"Later set"});
    await item({itemId:a.draft.itemId,version:2,expectedVersionId:a.draft.versionId,contains:"different",name:"Different source head"});const before=await counts();
    await corruptJson("eval_set_versions","contract",next.record.storage.versionId,{schemaVersion:"corrupt"},async()=>{const replay=await saveSet(p);assert.equal(replay.replayed,true);equalJson(replay.record,p.record);assert.deepEqual(await counts(),before);});
  });
  test("CP-PG06 independently blocked item CAS writers produce one winner and no orphan version",async()=>{
    const first=await item(),patch={itemId:first.draft.itemId,version:2,expectedVersionId:first.draft.versionId};
    const a=await itemIntent({...patch,name:"Winner A"}),b=await itemIntent({...patch,name:"Winner B"});const outcomes=await blocked([()=>saveItem(a),()=>saveItem(b)]);
    assert.equal(outcomes.filter(r=>r.status==="fulfilled").length,1);assert.equal(outcomes.filter(r=>r.status==="rejected"&&r.reason.status===409).length,1);
    const detail=await db.getCustomEvalItemV2(active().scope.workspaceId,first.draft.itemId,itemCallbacks.restore);assert.equal(detail.versions.length,2);assert.equal((await counts()).itemVersions,2);assert.equal((await counts()).audits,2);
  });
  test("CP-PG07 independently blocked set CAS writers preserve exactly one ordered membership revision",async()=>{
    const a=(await item({contains:"red"})).record,b=(await item({contains:"blue"})).record,first=await set([a]);const patch={setId:first.draft.setId,version:2,expectedVersionId:first.draft.versionId};
    const left=await setIntent([a,b],{...patch,name:"Left"}),right=await setIntent([b,a],{...patch,name:"Right"});const outcomes=await blocked([()=>saveSet(left),()=>saveSet(right)]);
    assert.equal(outcomes.filter(r=>r.status==="fulfilled").length,1);assert.equal(outcomes.filter(r=>r.status==="rejected"&&r.reason.status===409).length,1);assert.equal((await counts()).setVersions,2);assert.equal((await counts()).members,3);
  });
  test("CP-PG08 identical concurrent create requests reserve one item identity and return exact replay",async()=>{
    const intent=await itemIntent(),outcomes=await blocked([()=>saveItem(intent),()=>saveItem(intent)]);assert.ok(outcomes.every(r=>r.status==="fulfilled"));
    assert.deepEqual(outcomes.map(r=>r.value.replayed).sort(),[false,true]);equalJson(outcomes[0].value.record,outcomes[1].value.record);assert.equal((await counts()).itemVersions,1);assert.equal((await counts()).audits,1);
  });
  test("CP-PG09 item audit failure rolls back aggregate, version and audit atomically",async()=>{
    const intent=await itemIntent(),before=await counts();await auditFailure("custom_eval_item_v2.saved",async()=>{await assert.rejects(saveItem(intent),/authored owned composition failure/);assert.deepEqual(await counts(),before);});
    assert.equal((await saveItem(intent)).replayed,false);
  });
  test("CP-PG10 set audit failure rolls back native version and every membership without touching source items",async()=>{
    const a=(await item()).record,b=(await item({contains:"green"})).record,intent=await setIntent([a,b]),before=await counts();
    await auditFailure("custom_eval_set_v2.saved",async()=>{await assert.rejects(saveSet(intent),/authored owned composition failure/);assert.deepEqual(await counts(),before);});equalJson(await readItem(a),a);assert.equal((await saveSet(intent)).replayed,false);
  });
  test("CP-PG11 public UUID tuples are workspace scoped and foreign or mismatched source refs cannot write",async()=>{
    const first=await item(),foreign=await item({itemId:first.draft.itemId,versionId:first.draft.versionId},active().foreignScope);assert.notEqual(first.record.storage.versionId,foreign.record.storage.versionId);
    const other=(await item({},active().foreignScope)).record;assert.equal(await db.getCustomEvalItemVersionV2(active().scope.workspaceId,other.draft.itemId,other.draft.versionId,itemCallbacks.restore),undefined);
    assert.equal(await db.getCustomEvalSetItemsV2(active().scope.workspaceId,[itemRef(other)],readers.restoreItem),undefined);const before=await counts();
    await assert.rejects(db.getCustomEvalSetItemsV2(active().scope.workspaceId,[{...itemRef(first.record),fingerprint:"f".repeat(64)}],readers.restoreItem),status(409));assert.deepEqual(await counts(),before);
  });
  test("CP-PG12 item native schema, canonical envelope, timestamp and audit corruption fail closed without repair",async()=>{
    const p=await item(),r=p.record,original=(await inspector.query("select config from eval_item_versions where id=$1",[r.storage.versionId])).rows[0].config;
    await corruptJson("eval_item_versions","output_schema",r.storage.versionId,{fields:[]},()=>assert.rejects(readItem(r),status(409)));
    await corruptJson("eval_item_versions","config",r.storage.versionId,{...original,recordText:original.recordText+" "},()=>assert.rejects(readItem(r),status(409)));
    await corruptScalar("eval_item_versions","fingerprint",r.storage.versionId,"f".repeat(64),()=>assert.rejects(readItem(r),status(409)));
    await corruptScalar("eval_item_versions","created_at",r.storage.versionId,"2000-01-01T00:00:00.000Z",()=>assert.rejects(readItem(r),status(409)));
    await corruptScalar("audit_events","metadata_hash",r.storage.auditId,"f".repeat(64),()=>assert.rejects(readItem(r),status(409)));equalJson(await readItem(r),r);
  });
  test("CP-PG13 duplicate positions, non-unit weights and altered native membership criticality are refused",async()=>{
    const origin=await overlapping(),r=origin.sets[0],member=r.members[0];
    for(const[column,value,previous]of[["position",1,0],["position",8,0],["weight","1.01","1"],["criticality","standard","critical"]]){
      assert.ok(["position","weight","criticality"].includes(column));
      try{await inspector.query(`update eval_set_item_versions set ${column}=$3 where eval_set_version_id=$1 and eval_item_version_id=$2`,[r.storage.versionId,member.evalItemVersionId,value]);await assert.rejects(readSet(r),status(409));}
      finally{await inspector.query(`update eval_set_item_versions set ${column}=$3 where eval_set_version_id=$1 and eval_item_version_id=$2`,[r.storage.versionId,member.evalItemVersionId,previous]);}
    }equalJson(await readSet(r),r);
  });
  test("CP-PG14 bounded metadata history retains twenty versions and oversized or malformed indices fail closed",async()=>{
    const first=await item();let previous=first.record;
    for(let version=2;version<=22;version++)previous=(await item({itemId:first.draft.itemId,version,expectedVersionId:previous.draft.versionId,name:`Historical version ${version}`})).record;
    const detail=await db.getCustomEvalItemV2(active().scope.workspaceId,first.draft.itemId,itemCallbacks.restore);assert.equal(detail.versions.length,20);assert.equal(detail.hasMore,true);assert.equal(detail.versions[0].version,22);assert.equal(Object.hasOwn(detail.versions[0],"contract"),false);equalJson(await readItem(first.record),first.record);
    const stored=(await inspector.query("select config from eval_item_versions where id=$1",[previous.storage.versionId])).rows[0].config;
    await corruptJson("eval_item_versions","config",previous.storage.versionId,{...stored,unexpected:"x".repeat(20000)},()=>assert.rejects(db.listCustomEvalItemsV2(active().scope.workspaceId,itemCallbacks.restore),status(409)));
    await corruptJson("eval_item_versions","config",previous.storage.versionId,{...stored,recordText:"{"},()=>assert.rejects(db.listCustomEvalItemsV2(active().scope.workspaceId,itemCallbacks.restore),status(409)));
    await corruptJson("audit_events","metadata",previous.storage.auditId,{unexpected:"x".repeat(20000)},()=>assert.rejects(readItem(previous),status(409)));
  });
  test("CP-PG15 benchmark imports reject absent and foreign reserved identities before any write while near-prefix IDs remain valid",async()=>{
    const before=await counts();for(const prefix of["custom_eval_item_v2_","custom_eval_item_version_v2_","custom_eval_set_v2_","custom_eval_set_version_v2_"]){const input=legacyImport(`${prefix}${"a".repeat(64)}`);await assert.rejects(service.persistBenchmarkImport(active().scope.workspaceId,input),status(409));assert.deepEqual(await counts(),before);}
    const foreign=(await item({},active().foreignScope)).record,input=legacyImport();input.evalSet.itemVersions=[{item:{id:`legacy_${randomUUID()}`,itemId:foreign.storage.itemId,name:"Foreign collision",type:"string_check",outputSchema:{fields:[]},config:{},version:1,fingerprint:"authored"},weight:1,criticality:"critical"}];
    await assert.rejects(service.persistBenchmarkImport(active().scope.workspaceId,input),status(409));assert.equal((await counts()).benchmarks,0);
    const corruptItem=`authored_profile_${randomUUID()}`,corruptVersion=`authored_profile_version_${randomUUID()}`;
    await inspector.query("insert into eval_items(id,workspace_id,name,type)values($1,$2,'Authored corrupt profile','string_check')",[corruptItem,active().foreignScope.workspaceId]);
    await inspector.query("insert into eval_item_versions(id,eval_item_id,version,output_schema,config,fingerprint)values($1,$2,1,'{}'::jsonb,'{\"schemaVersion\":\"custom-eval-item-storage-v2\"}'::jsonb,'authored')",[corruptVersion,corruptItem]);
    const byProfile=legacyImport();byProfile.evalSet.itemVersions=[{item:{...input.evalSet.itemVersions[0].item,id:corruptVersion,itemId:corruptItem},weight:1,criticality:"critical"}];
    await assert.rejects(service.persistBenchmarkImport(active().scope.workspaceId,byProfile),status(409));assert.equal((await counts()).benchmarks,0);
    const near=legacyImport(`customXevalXsetXv2_${randomUUID()}`);await service.persistBenchmarkImport(active().scope.workspaceId,near);assert.equal((await counts()).benchmarks,1);assert.ok((await service.listScenarios(active().scope.workspaceId)).evalSets.some(s=>s.id===near.evalSet.setId));
  });
  test("CP-PG16 generic catalogue hides corrupt v2 ownership by aggregate, version or profile instead of treating it as legacy",async()=>{
    const origin=await overlapping();assert.equal((await service.listScenarios(active().scope.workspaceId)).evalSets.length,0);
    assert.equal((await provided.listProvidedOutputSources(active().scope.workspaceId)).evalSets.length,0);
    await assert.rejects(provided.getProvidedOutputInputs(active().scope.workspaceId,{datasetVersionId:"authored-unused",evalSetVersionId:origin.sets[0].storage.versionId}),status(422));
    const old=legacyImport();await service.persistBenchmarkImport(active().scope.workspaceId,old);const itemId=`custom_eval_item_v2_${"f".repeat(64)}`,itemVersion=`malformed_item_${randomUUID()}`;
    await inspector.query("insert into eval_items(id,workspace_id,name,type)values($1,$2,'Authored corrupted item','string_check')",[itemId,active().scope.workspaceId]);
    await inspector.query("insert into eval_item_versions(id,eval_item_id,version,output_schema,config,fingerprint)values($1,$2,1,'{}'::jsonb,'{}'::jsonb,'authored-corruption')",[itemVersion,itemId]);
    await inspector.query("insert into eval_set_item_versions(eval_set_version_id,eval_item_version_id,position,weight,criticality)values($1,$2,0,1,'critical')",[old.evalSet.id,itemVersion]);
    assert.equal((await service.listScenarios(active().scope.workspaceId)).evalSets.some(s=>s.id===old.evalSet.setId),false);
    const row=origin.sets[0],stored=(await inspector.query("select contract from eval_set_versions where id=$1",[row.storage.versionId])).rows[0].contract;
    await corruptJson("eval_set_versions","contract",row.storage.versionId,{...stored,schemaVersion:"corrupt"},async()=>{assert.equal((await service.listScenarios(active().scope.workspaceId)).evalSets.length,0);await assert.rejects(readSet(row),status(409));});
  });
  test("CP-PG17 shared HTTP store preserves v1 execution and rejects plan-family switches in either direction",async()=>{
    const v1=legacyCore.prepareCustomEvalSet({schemaVersion:"custom-eval-set-draft-v1",setId:randomUUID(),versionId:randomUUID(),version:1,expectedVersionId:null,name:"Authored v1",contains:"blue",datasetPassRateThreshold:100});await legacyDb.saveCustomEvalSet(active().scope,v1);
    const input=await dataset(),draft=planCore.prepareHttpEvalPlanDraft({schemaVersion:"http-eval-plan-draft-v1",planId:randomUUID(),versionId:randomUUID(),version:1,expectedVersionId:null,name:"Historical v1 plan",datasetVersionId:input.content.version.id,evalSetVersionIds:[v1.draft.versionId],target:{targetId:"authored",targetVersion:"1",endpoint:"https://authored.example.com/evaluate",timeoutMs:1000},limits:{concurrency:1,maxDurationSeconds:5}});
    const selected=await plans.getHttpEvalPlanSources(active().scope.workspaceId,draft),preview=planCore.resolveHttpEvalPlanPreview({workspaceId:active().scope.workspaceId,draft,...selected,head:null});
    const saved=await savePlan({schemaVersion:"http-eval-plan-save-v1",draft,expectedPreviewFingerprint:preview.fingerprint}),record=await complete(saved.record,["blue","blue"]);assert.equal(record.schemaVersion,"http-eval-run-record-v1");assert.equal(record.execution.results.length,2);equalJson(await getRun(record.ledger.publicRunId),record);
    const legacyRun={plan:{id:`authored_legacy_plan_${randomUUID()}`,planFingerprint:`authored_legacy_fingerprint_${randomUUID()}`,sampleManifest:{rows:[]}},results:[],gates:[],idempotencyKey:`authored-legacy-${randomUUID()}`};
    await service.persistEvalRun(active().scope.workspaceId,legacyRun);await service.persistEvalRun(active().scope.workspaceId,legacyRun);
    assert.deepEqual((await service.listRunBatches(active().scope.workspaceId)).map(row=>row.id),[legacyRun.plan.id]);
    const origin=await overlapping(),p=await plan(origin),before=await counts();const v2Draft={...p.draft,planId:draft.planId,versionId:randomUUID(),version:2,expectedVersionId:draft.versionId};
    await assert.rejects(savePlan({schemaVersion:"http-eval-plan-save-v2",draft:v2Draft,expectedPreviewFingerprint:"f".repeat(64)}),status(409));
    const v1Draft={...draft,planId:p.draft.planId,versionId:randomUUID(),version:2,expectedVersionId:p.draft.versionId};await assert.rejects(savePlan({schemaVersion:"http-eval-plan-save-v1",draft:v1Draft,expectedPreviewFingerprint:"f".repeat(64)}),status(409));assert.deepEqual(await counts(),before);
    for(const schemaVersion of["http-target-eval-v2","http-eval-plan-record-v2","http-eval-plan-storage-v2"])await assert.rejects(service.persistEvalRun(active().scope.workspaceId,{...legacyRun,idempotencyKey:randomUUID(),plan:{...legacyRun.plan,id:randomUUID(),schemaVersion}}),status(409));
    const stored=(await inspector.query("select resolved_plan from run_plans where id=$1",[p.record.storage.versionId])).rows[0].resolved_plan;
    await corruptJson("run_plans","resolved_plan",p.record.storage.versionId,{...stored,schemaVersion:"corrupt",content:{...stored.content,schemaVersion:"corrupt"}},async()=>{
      await assert.rejects(service.persistEvalRun(active().scope.workspaceId,{...legacyRun,idempotencyKey:randomUUID(),plan:{...legacyRun.plan,id:randomUUID(),planFingerprint:p.record.fingerprint}}),status(409));
      assert.deepEqual((await service.listRunBatches(active().scope.workspaceId)).map(row=>row.id),[legacyRun.plan.id]);
    });assert.deepEqual(await counts(),before);
    const mixed=await plan({refs:[origin.refs[0],{schemaVersion:"custom-eval-set-ref-v1",setId:v1.draft.setId,versionId:v1.draft.versionId,fingerprint:v1.contract.fingerprint}]});assert.equal(mixed.record.content.items.length,3);assert.equal(mixed.record.content.evalSets.find(s=>s.ref.schemaVersion==="custom-eval-set-ref-v1").sourceRecordFingerprint,null);
  });
  test("CP-PG18 two real overlapping sets execute one claim per row, six unique results and all twenty gates",async()=>{
    const p=await plan();equalJson(await readPlan(p.record),p.record);assert.equal(p.record.content.evalSets.length,2);assert.equal(p.record.content.items.length,3);assert.ok(p.record.content.evalSets.every(s=>s.members.every(m=>typeof m.publicItemId==="string"&&typeof m.itemRecordFingerprint==="string")));
    const initial=(await reserve(start(p.record))).record;assert.ok(initial.ledger.rows.every(r=>r.status==="pending"&&r.claim===null));assert.equal((await counts()).results,0);const calls=[];let record=initial;
    for(let i=0;i<2;i++){const c=await claim(record,i);calls.push(c.request);const body=JSON.parse(c.request.body);assert.equal(c.request.idempotencyKey,c.claim.requestFingerprint);assert.equal(c.request.body.includes("PRIVATE_AUTHORED_REFERENCE"),false);assert.equal(Object.hasOwn(body,"expectedOutput"),false);assert.equal(Object.hasOwn(body,"context"),i===0);record=(await finish(record,c)).record;}
    assert.equal(new Set(calls.map(c=>c.idempotencyKey)).size,2);assert.equal(record.execution.results.length,6);assert.equal(new Set(record.execution.results.map(r=>`${r.rowId}:${r.evalItemVersionId}`)).size,6);assert.equal(record.execution.gates.length,20);assert.equal(new Set(record.execution.gates.map(g=>g.level)).size,8);assert.ok(record.execution.gates.every(g=>g.passed));
    assert.equal((await inspector.query("select count(*)::int as count from workflow_events where workflow_run_id=$1 and event_type='http_eval.row.claimed'",[record.ledger.workflowId])).rows[0].count,2);equalJson(await getRun(record.ledger.publicRunId),record);assert.equal((await counts()).results,6);assert.equal((await counts()).gates,20);
  });
  test("CP-PG19 shared critical failure blocks both owning sets and dataset at permissive thresholds without duplicate scoring",async()=>{
    const origin=await overlapping(0),p=await plan(origin),record=await complete(p.record,["red green","red blue green"]),blue=origin.items[1].contract.id;
    assert.equal(record.execution.results.filter(r=>r.evalItemVersionId===blue).length,2);const setGates=record.execution.gates.filter(g=>g.level==="eval_set");assert.equal(setGates.length,2);assert.ok(setGates.every(g=>!g.passed&&g.reasons.includes("critical_evaluator_failed")));
    const overlap=setGates[0].sourceResultIds.filter(id=>setGates[1].sourceResultIds.includes(id));assert.equal(overlap.length,2);assert.ok(record.execution.results.filter(r=>overlap.includes(r.id)).every(r=>r.evalItemVersionId===blue));
    assert.equal(record.execution.gates.find(g=>g.level==="dataset").passed,false);assert.equal(record.execution.gates.find(g=>g.level==="run").passed,false);equalJson(await getRun(record.ledger.publicRunId),record);
  });
  test("CP-PG20 completed request and finalization replay do not redispatch and survive deletion of live sources",async()=>{
    const p=await plan(),request=start(p.record),initial=(await reserve(request)).record,c=await claim(initial,0),first=await finish(initial,c);assert.equal((await finish(initial,c)).replayed,true);await assert.rejects(finish(initial,c,"changed"),status(409));
    const c2=await claim(first.record,1),done=(await finish(first.record,c2)).record;await inspector.query("delete from datasets where workspace_id=$1",[active().scope.workspaceId]);await inspector.query("delete from eval_sets where workspace_id=$1",[active().scope.workspaceId]);await inspector.query("delete from eval_items where workspace_id=$1",[active().scope.workspaceId]);
    const before=await counts(),replay=await reserve(request);assert.equal(replay.created,false);equalJson(replay.record,done);equalJson(await readPlan(p.record),p.record);equalJson(await getRun(done.ledger.publicRunId),done);assert.deepEqual(await counts(),before);await assert.rejects(claim(done,0),status(409));assert.deepEqual(await counts(),before);
  });
  test("CP-PG21 v2 recovery preserves known responses, records uncertainty once and prevents late overwrite",async()=>{
    const origin=await overlapping(),input=await dataset(3),p=await plan(origin,{datasetVersionId:input.content.version.id,limits:{concurrency:1,maxDurationSeconds:5}}),initial=(await reserve(start(p.record))).record;
    const a=await claim(initial,0),known=(await finish(initial,a)).record,b=await claim(known,1);await assert.rejects(runs.recoverHttpEvalRun(active().scope,initial.ledger.publicRunId,runCallbacks),status(409));
    await delay(Math.max(0,Date.parse(initial.ledger.leaseExpiresAt)-Date.now()+60));const recovered=await runs.recoverHttpEvalRun(active().scope,initial.ledger.publicRunId,runCallbacks);assert.deepEqual(recovered.ledger.rows.map(r=>r.status),["succeeded","outcome_unknown","not_sent"]);
    equalJson(recovered.events.find(e=>e.rowId===a.claim.rowId),known.events[0]);assert.ok(recovered.events.every(e=>e.schemaVersion==="http-eval-row-event-v2"));assert.equal(recovered.execution.gates.find(g=>g.level==="run").passed,false);
    const before=await counts();await assert.rejects(finish(initial,b),status(409));equalJson(await runs.recoverHttpEvalRun(active().scope,initial.ledger.publicRunId,runCallbacks),recovered);assert.deepEqual(await counts(),before);equalJson(await getRun(initial.ledger.publicRunId),recovered);
  });
  test("CP-PG22 mixed profile events and altered native result or gate projections cannot be read or repaired by GET",async()=>{
    const p=await plan(),record=await complete(p.record),event=record.events[0],native=(await inspector.query("select payload from workflow_events where id=$1",[event.id])).rows[0].payload;
    const storedPlan=(await inspector.query("select resolved_plan from run_plans where id=$1",[p.record.storage.versionId])).rows[0].resolved_plan;
    await corruptJson("run_plans","resolved_plan",p.record.storage.versionId,{...storedPlan,content:{...storedPlan.content,draft:{...storedPlan.content.draft,name:"x".repeat(20000)}}},()=>assert.rejects(plans.listHttpEvalPlans(active().scope.workspaceId),status(409)));
    await corruptJson("workflow_runs","output",record.ledger.workflowId,{...record.ledger,publicRunId:"x".repeat(20000)},()=>assert.rejects(runs.listHttpEvalRuns(active().scope.workspaceId,p.draft.planId),status(409)));
    await corruptJson("workflow_events","payload",event.id,{...native,schemaVersion:"http-eval-row-event-storage-v1"},()=>assert.rejects(getRun(record.ledger.publicRunId),status(409)));
    const result=record.execution.results[0];await corruptJson("eval_results","normalized_fields",result.id,{schemaVersion:"http-eval-result-projection-v1",result},()=>assert.rejects(getRun(record.ledger.publicRunId),status(409)));
    const gate=record.execution.gates.find(g=>g.level==="run");await corruptJson("gate_results","reasons",gate.id,{schemaVersion:"http-eval-gate-projection-v2",gate:{...gate,passed:false}},()=>assert.rejects(getRun(record.ledger.publicRunId),status(409)));equalJson(await getRun(record.ledger.publicRunId),record);
  });
  test("CP-PG23 thirty-two native members round trip and a thirty-third member or duplicate ref writes nothing",async()=>{
    const items=[];for(let i=0;i<33;i++)items.push((await item({name:`Authored member ${i}`,contains:`word${i}`})).record);
    const p=await set(items.slice(0,32));assert.equal((await readSet(p.record)).members.length,32);assert.equal((await counts()).members,32);const before=await counts(),request=plain(p.request);
    request.draft={...request.draft,setId:randomUUID(),versionId:randomUUID(),members:items.map(itemRef)};await assert.rejects(saveSet(request),status(422));request.draft.members=[itemRef(items[0]),itemRef(items[0])];await assert.rejects(saveSet(request),status(422));assert.deepEqual(await counts(),before);
  });
  test("CP-PG24 tiny finite thresholds and large tiny-decimal responses retain canonical text without JSONB expansion",async()=>{
    const a=(await item({contains:"1e-308"})).record,s=await set([a],{datasetPassRateThreshold:1e-308}),p=await plan({refs:[setRef(s.record)]}),output=Array(9000).fill(1e-308),record=await complete(p.record,[output,output]);
    const native=(await inspector.query("select contract from eval_set_versions where id=$1",[s.record.storage.versionId])).rows[0].contract;assert.equal(typeof native.recordText,"string");assert.equal(JSON.parse(native.recordText).draft.datasetPassRateThreshold,1e-308);
    const stored=(await inspector.query("select payload,octet_length(payload::text)::int as bytes from workflow_events where workflow_run_id=$1 and event_type='http_eval.row.finalized'",[record.ledger.workflowId])).rows;assert.equal(stored.length,2);assert.ok(stored.every(row=>row.bytes<150000&&typeof row.payload.eventText==="string"&&row.payload.eventText.includes("1e-308")));
    assert.ok(record.events.every(event=>event.response.output.length===9000&&event.response.output[0]===1e-308));equalJson(await getRun(record.ledger.publicRunId),record);
  });
});

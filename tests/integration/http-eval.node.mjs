import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

// Authored UNRUN T3. The caller owns creation/migrations/drop of this explicitly marked database.
// No target adapter, server, browser or model is imported or called by this suite.
const MARKER = "open-evals-http-target-runs-20261109-created-disposable-v1";
const applicationName = `oe_http_eval_${randomUUID().replaceAll("-", "")}`;
const environmentKeys = ["DATABASE_URL", "POSTGRES_URL", "SUPABASE_DB_URL", "DATABASE_SSL", "SUPABASE_DB_SSL"];
const previousEnvironment = new Map(environmentKeys.map(key=>[key,process.env[key]]));
let Client, inspector, connectionString, databaseName, fixture;
let plansCore, runsCore, datasetsCore, evalCore, plans, runs, datasets, evals, service, hash;
const plain = value => JSON.parse(JSON.stringify(value));
const equalJson = (actual,expected) => assert.deepEqual(plain(actual),plain(expected));
const errorStatus = status => error => { assert.equal(error.status,status); return true; };
const planCallbacks = {prepare:input=>plansCore.prepareHttpEvalPlanVersionRecord(input),parse:value=>plansCore.parseHttpEvalPlanVersionRecord(value)};
const runCallbacks = {
  parsePlan:value=>plansCore.parseHttpEvalPlanVersionRecord(value),create:input=>runsCore.createHttpEvalRunLedger(input),
  claim:input=>runsCore.claimHttpEvalRow(input),finalize:input=>runsCore.finalizeHttpEvalRow(input),
  recover:input=>runsCore.recoverHttpEvalRun(input),stop:input=>runsCore.stopHttpEvalRun(input),
  build:input=>runsCore.buildHttpEvalRunRecord(input),parse:value=>runsCore.parseHttpEvalRunRecord(value)
};
function guardedUrl() {
  assert.equal(process.env.HTTP_EVAL_TEST_ALLOW,"local-disposable");
  const url=new URL(process.env.HTTP_EVAL_TEST_DATABASE_URL??"");
  assert.ok(["postgres:","postgresql:"].includes(url.protocol));assert.equal(url.hostname,"127.0.0.1");
  assert.equal(url.port,"65432");assert.equal(url.username,"postgres");
  assert.match(url.pathname,/^\/oe_http_eval_test_[0-9]+_[0-9]+$/);assert.equal(url.search,"");assert.equal(url.hash,"");
  databaseName=url.pathname.slice(1);return url.toString();
}
async function verifyDatabase() {
  const rows=(await inspector.query(`select current_database() as name,shobj_description(d.oid,'pg_database') as marker,
    pg_get_userbyid(d.datdba) as owner,current_user as actor,host(inet_server_addr()) as address,inet_server_port() as port
    from pg_database d where d.datname=current_database()`)).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].name,databaseName);assert.equal(rows[0].marker,MARKER);
  assert.equal(rows[0].owner,"postgres");assert.equal(rows[0].actor,"postgres");assert.equal(rows[0].port,65432);
  assert.ok(["127.0.0.1","::ffff:127.0.0.1"].includes(rows[0].address));
  const names=["users","workspaces","workspace_memberships","datasets","dataset_versions","dataset_rows","eval_sets","eval_set_versions",
    "eval_items","eval_item_versions","eval_set_item_versions","run_plans","eval_runs","run_samples","eval_results","gate_results","workflow_runs","workflow_events","audit_events"];
  const tables=(await inspector.query("select name,to_regclass('public.'||name)::text as relation from unnest($1::text[]) name",[names])).rows;
  assert.equal(tables.length,names.length);assert.ok(tables.every(row=>row.name===row.relation));
}
function active(){assert.ok(fixture?.created);return fixture;}
async function domainCounts(){return (await inspector.query(`select
  (select count(*)::int from run_plans where workspace_id=any($1::text[])) as plans,
  (select count(*)::int from eval_runs where workspace_id=any($1::text[])) as runs,
  (select count(*)::int from run_samples s join eval_runs r on r.id=s.eval_run_id where r.workspace_id=any($1::text[])) as samples,
  (select count(*)::int from eval_results e join eval_runs r on r.id=e.eval_run_id where r.workspace_id=any($1::text[])) as results,
  (select count(*)::int from gate_results g join eval_runs r on r.id=g.eval_run_id where r.workspace_id=any($1::text[])) as gates,
  (select count(*)::int from workflow_runs where workspace_id=any($1::text[])) as workflows,
  (select count(*)::int from workflow_events e join workflow_runs w on w.id=e.workflow_run_id where w.workspace_id=any($1::text[])) as events,
  (select count(*)::int from audit_events where workspace_id=any($1::text[]) and left(action,length('http_eval.'))='http_eval.') as audits`,[active().workspaceIds])).rows[0];}
const emptyCounts={plans:0,runs:0,samples:0,results:0,gates:0,workflows:0,events:0,audits:0};
async function cleanupFixture(){
  if(!fixture?.created)return;await verifyDatabase();const f=fixture;
  const ws=(await inspector.query("select id,name from workspaces where id=any($1::text[])",[f.workspaceIds])).rows;
  const users=(await inspector.query("select id,email,name from users where id=any($1::text[])",[f.actorIds])).rows;
  assert.equal(ws.length,2);assert.equal(users.length,2);
  for(const row of ws)assert.equal(row.name,`${applicationName}:${row.id}`);
  for(const row of users){assert.equal(row.name,applicationName);assert.equal(row.email,`${row.id}@http-eval.invalid`);}
  await inspector.query("begin");try{
    await inspector.query("delete from workflow_runs where workspace_id=any($1::text[])",[f.workspaceIds]);
    await inspector.query("delete from eval_runs where workspace_id=any($1::text[])",[f.workspaceIds]);
    await inspector.query("delete from run_plans where workspace_id=any($1::text[])",[f.workspaceIds]);
    await inspector.query("delete from datasets where workspace_id=any($1::text[])",[f.workspaceIds]);
    await inspector.query("delete from eval_sets where workspace_id=any($1::text[])",[f.workspaceIds]);
    await inspector.query("delete from eval_items where workspace_id=any($1::text[])",[f.workspaceIds]);
    await inspector.query("delete from audit_events where workspace_id=any($1::text[])",[f.workspaceIds]);
    assert.deepEqual(await domainCounts(),emptyCounts);
    await inspector.query("delete from workspaces where id=any($1::text[])",[f.workspaceIds]);
    await inspector.query("delete from users where id=any($1::text[])",[f.actorIds]);
    assert.equal((await inspector.query("select id from workspaces where id=any($1::text[])",[f.workspaceIds])).rowCount,0);
    assert.equal((await inspector.query("select id from users where id=any($1::text[])",[f.actorIds])).rowCount,0);
    await inspector.query("commit");fixture=undefined;
  }catch(error){await inspector.query("rollback");throw error;}
}
async function source(scope=active().scope,count=2,inputValue){
  const draft=datasetsCore.prepareCustomDatasetDraft({schemaVersion:"custom-dataset-draft-v1",datasetId:randomUUID(),versionId:randomUUID(),version:1,
    expectedVersionId:null,name:"Authored HTTP inputs",format:"json",defaultReviewStatus:"reviewed",sourceText:JSON.stringify(Array.from({length:count},(_,i)=>({
      rowKey:`Key${String(i).padStart(3,"0")}`,input:inputValue??{prompt:`Authored input ${i}`,number:9007199254740992},expectedOutput:"SECRET_REFERENCE",
      ...(i===0?{context:null,history:["Authored history"]}:{}),traceFixture:"SECRET_TRACE",metadata:JSON.parse('{"__proto__":{"authored":true},"constructor":"data","toJSON":"data"}')
    })))});
  const preview=datasetsCore.resolveCustomDatasetPreview({workspaceId:scope.workspaceId,draft,head:null});
  const saved=await datasets.saveCustomDatasetVersion(scope,{schemaVersion:"custom-dataset-save-v1",draft,expectedPreviewFingerprint:preview.fingerprint},{
    prepare:input=>datasetsCore.prepareCustomDatasetVersionRecord(input),restore:input=>datasetsCore.restoreCustomDatasetVersionRecord(input)});
  const evalSetVersionIds=[];
  for(const [index,contains]of["approved","ready"].entries()){
    const prepared=evalCore.prepareCustomEvalSet({schemaVersion:"custom-eval-set-draft-v1",setId:randomUUID(),versionId:randomUUID(),version:1,expectedVersionId:null,
      name:`Authored HTTP evaluator ${index}`,contains,datasetPassRateThreshold:100});
    evalSetVersionIds.push((await evals.saveCustomEvalSet(scope,prepared)).version.id);
  }
  return {dataset:saved.record,datasetVersionId:saved.record.content.version.id,evalSetVersionIds:evalSetVersionIds.sort()};
}
async function planIntent(patch={},scope=active().scope,origin){
  origin??=await source(scope);const draft=plansCore.prepareHttpEvalPlanDraft({schemaVersion:"http-eval-plan-draft-v1",planId:randomUUID(),versionId:randomUUID(),version:1,
    expectedVersionId:null,name:"Authored HTTP plan",datasetVersionId:origin.datasetVersionId,evalSetVersionIds:origin.evalSetVersionIds,
    target:{targetId:"authored-target",targetVersion:"1",endpoint:"https://target.example.com/evaluate",timeoutMs:1000},limits:{concurrency:1,maxDurationSeconds:5},...patch});
  const selected=await plans.getHttpEvalPlanSources(scope.workspaceId,draft);assert.ok(selected);
  const head=await plans.getHttpEvalPlanHead(scope.workspaceId,draft.planId,planCallbacks.parse);
  const preview=plansCore.resolveHttpEvalPlanPreview({workspaceId:scope.workspaceId,draft,...selected,head});
  return {origin,draft,preview,request:plansCore.prepareHttpEvalPlanSaveRequest({schemaVersion:"http-eval-plan-save-v1",draft,expectedPreviewFingerprint:preview.fingerprint})};
}
const save=(request,scope=active().scope,cb=planCallbacks)=>plans.saveHttpEvalPlanVersion(scope,request,cb);
const readPlan=(record,scope=active().scope)=>plans.getHttpEvalPlanVersion(scope.workspaceId,record.content.draft.planId,record.content.draft.versionId,planCallbacks.parse);
async function preparedPlan(patch={},count=2){const origin=await source(active().scope,count),p=await planIntent(patch,active().scope,origin);return {...p,record:(await save(p.request)).record};}
function start(plan,runId=randomUUID()){return {schemaVersion:"http-eval-start-v1",runId,planVersionId:plan.storage.versionId,expectedPlanFingerprint:plan.fingerprint};}
const reserve=(request,scope=active().scope)=>runs.reserveHttpEvalRun(scope,request,runCallbacks);
const get=(runId,scope=active().scope)=>runs.getHttpEvalRun(scope.workspaceId,runId,runCallbacks);
const claim=(record,index=0)=>runs.claimHttpEvalRunRow(active().scope.workspaceId,record.ledger.publicRunId,{rowId:record.plan.content.samples[index].rowId,leaseToken:record.ledger.leaseToken},runCallbacks);
function response(c,output="Approved and ready"){return JSON.stringify({schemaVersion:"http-json-target-response-v1",requestFingerprint:c.claim.requestFingerprint,output});}
const finish=(record,c,output="Approved and ready")=>runs.finalizeHttpEvalRunRow(active().scope.workspaceId,record.ledger.publicRunId,{rowId:c.claim.rowId,claimToken:c.claim.claimToken,responseText:response(c,output)},runCallbacks);
async function complete(plan,outputs){let record=(await reserve(start(plan))).record;for(let i=0;i<plan.content.samples.length;i++){const c=await claim(record,i);record=(await finish(record,c,outputs?.[i]??"Approved and ready")).record;}return record;}
async function positivelyBlocked(started){
  for(let i=0;i<80;i++){const row=(await inspector.query("select count(*)::int as count from pg_stat_activity where application_name=$1 and wait_event_type='Lock'",[applicationName])).rows[0];if(row.count>=started)return;await delay(25);}assert.fail("expected actual SQL writers waiting on the owned workspace lock");
}
async function blockedWriters(operation){
  const blocker=new Client({connectionString,ssl:false,application_name:`${applicationName}_blocker`,statement_timeout:15000,query_timeout:17000});
  let settled;
  await blocker.connect();try{await blocker.query("begin");await blocker.query("select id from workspaces where id=$1 for update",[active().scope.workspaceId]);
    settled=Promise.allSettled([operation(),operation()]);await positivelyBlocked(2);await blocker.query("commit");return await settled;
  }finally{await blocker.query("rollback").catch(()=>{});await blocker.end();if(settled)await settled;}
}
async function withFailureTrigger(table,action,operation){
  assert.ok(["audit_events","workflow_events"].includes(table));assert.ok(["http_eval.plan.saved","http_eval.row.finalized"].includes(action));
  const suffix=randomUUID().replaceAll("-",""),fn=`oe_http_failure_${suffix}`,trigger=`oe_http_trigger_${suffix}`,workspace=active().scope.workspaceId;
  assert.match(workspace,/^[0-9a-f-]{36}$/);assert.equal((await inspector.query("select to_regprocedure($1)::text as value",[`public.${fn}()`])).rows[0].value,null);
  let functionOid,triggerOid;
  try{
    const predicate=table==="audit_events"?`new.workspace_id='${workspace}' and new.action='${action}'`:
      `new.event_type='${action}' and exists(select 1 from workflow_runs where id=new.workflow_run_id and workspace_id='${workspace}')`;
    await inspector.query(`create function public.${fn}() returns trigger language plpgsql as $$ begin if ${predicate} then raise exception 'authored owned HTTP failure'; end if; return new; end $$`);
    functionOid=(await inspector.query("select p.oid::text as oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1 and pg_get_userbyid(p.proowner)=current_user",[fn])).rows[0].oid;
    await inspector.query(`create trigger ${trigger} before insert on public.${table} for each row execute function public.${fn}()`);
    triggerOid=(await inspector.query("select oid::text as oid from pg_trigger where tgname=$1 and tgrelid=$2::regclass and tgfoid=$3::oid",[trigger,`public.${table}`,functionOid])).rows[0].oid;
    await operation();
  }finally{
    if(triggerOid){const found=(await inspector.query("select oid::text as oid,tgfoid::text as function from pg_trigger where tgname=$1 and tgrelid=$2::regclass",[trigger,`public.${table}`])).rows;assert.deepEqual(found,[{oid:triggerOid,function:functionOid}]);await inspector.query(`drop trigger ${trigger} on public.${table}`);}
    if(functionOid){const found=(await inspector.query("select p.oid::text as oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1 and pg_get_userbyid(p.proowner)=current_user",[fn])).rows;assert.deepEqual(found,[{oid:functionOid}]);await inspector.query(`drop function public.${fn}()`);}
    assert.equal((await inspector.query("select to_regprocedure($1)::text as value",[`public.${fn}()`])).rows[0].value,null);
    assert.equal((await inspector.query("select oid from pg_trigger where tgname=$1",[trigger])).rowCount,0);
  }
}

describe("HTTP eval native persistence [T3; authored UNRUN]",{concurrency:false,timeout:300000},()=>{
  before(async()=>{
    connectionString=guardedUrl();({Client}=createRequire(new URL("../../packages/db/package.json",import.meta.url))("pg"));
    inspector=new Client({connectionString,ssl:false,application_name:`${applicationName}_inspector`,connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:17000});
    await inspector.connect();await verifyDatabase();for(const key of environmentKeys)delete process.env[key];
    const url=new URL(connectionString);url.searchParams.set("application_name",applicationName);url.searchParams.set("options","-c statement_timeout=15000 -c lock_timeout=10000");process.env.DATABASE_URL=url.toString();
    plansCore=await import("../../packages/core/src/http-eval-plans.ts");runsCore=await import("../../packages/core/src/http-eval-runs.ts");
    datasetsCore=await import("../../packages/core/src/custom-datasets.ts");evalCore=await import("../../packages/core/src/custom-evals.ts");
    plans=await import("../../packages/db/src/http-eval-plans.ts");runs=await import("../../packages/db/src/http-eval-runs.ts");
    datasets=await import("../../packages/db/src/custom-datasets.ts");evals=await import("../../packages/db/src/custom-evals.ts");service=await import("../../packages/db/src/service.ts");
    ({stableHash:hash}=await import("../../packages/core/src/hash.ts"));
  });
  beforeEach(async()=>{
    await verifyDatabase();const workspaceIds=[randomUUID(),randomUUID()],actorIds=[randomUUID(),randomUUID()];
    fixture={workspaceIds,actorIds,scope:{workspaceId:workspaceIds[0],actorId:actorIds[0]},foreignScope:{workspaceId:workspaceIds[1],actorId:actorIds[1]},created:false};
    await inspector.query("begin");try{for(const[index,id]of workspaceIds.entries()){
      await inspector.query("insert into users(id,email,name)values($1,$2,$3)",[actorIds[index],`${actorIds[index]}@http-eval.invalid`,applicationName]);
      await inspector.query("insert into workspaces(id,name,mode)values($1,$2,'local')",[id,`${applicationName}:${id}`]);
      await inspector.query("insert into workspace_memberships(workspace_id,user_id,role)values($1,$2,'owner')",[id,actorIds[index]]);
    }await inspector.query("commit");fixture.created=true;}catch(error){await inspector.query("rollback");throw error;}
  });
  afterEach(cleanupFixture);
  after(async()=>{try{await cleanupFixture();}finally{for(const[key,value]of previousEnvironment){if(value===undefined)delete process.env[key];else process.env[key]=value;}await inspector?.end();}});

  test("HTTP-PG01 complete plan storage retains both evaluator memberships and source optional-field presence",async()=>{
    const p=await preparedPlan();equalJson(await readPlan(p.record),p.record);assert.equal(p.record.content.evalSets.length,2);assert.equal(p.record.content.items.length,2);
    equalJson(p.record.content.dataset.rows[0].context,{present:true,value:null});equalJson(p.record.content.dataset.rows[1].context,{present:false,value:null});
    assert.equal(Object.hasOwn(p.record.content.dataset.rows[0].metadata,"__proto__"),true);
    const row=(await inspector.query("select id,fingerprint,resolved_plan,created_at from run_plans where id=$1",[p.record.storage.versionId])).rows[0];
    assert.equal(row.fingerprint,p.record.fingerprint);assert.equal(row.resolved_plan.schemaVersion,"http-eval-plan-storage-v1");
    equalJson(JSON.parse(row.resolved_plan.recordText),p.record);assert.equal(row.created_at.toISOString(),p.record.createdAt);
    assert.deepEqual(await domainCounts(),{...emptyCounts,plans:1,audits:1});
  });
  test("HTTP-PG02 history retains exact old versions and old save replay precedes a corrupt later head",async()=>{
    const p=await preparedPlan();let record=p.record;
    for(let version=2;version<=22;version++){const next=await planIntent({planId:p.draft.planId,versionId:randomUUID(),version,expectedVersionId:record.content.draft.versionId,name:`Version ${version}`},active().scope,p.origin);record=(await save(next.request)).record;}
    const history=await plans.getHttpEvalPlan(active().scope.workspaceId,p.draft.planId);assert.equal(history.versions.length,20);assert.equal(history.hasMore,true);assert.equal(history.versions[0].version,22);
    equalJson(await readPlan(p.record),p.record);await inspector.query("update run_plans set fingerprint=$2 where id=$1",[record.storage.versionId,"f".repeat(64)]);
    const replay=await save(p.request);assert.equal(replay.replayed,true);equalJson(replay.record,p.record);
  });
  test("HTTP-PG03 stale parent and changed reused identity cannot append partial plans",async()=>{
    const p=await preparedPlan(),a=await planIntent({planId:p.draft.planId,version:2,expectedVersionId:p.draft.versionId},active().scope,p.origin),b=await planIntent({planId:p.draft.planId,version:2,expectedVersionId:p.draft.versionId},active().scope,p.origin);
    await save(a.request);const before=await domainCounts();await assert.rejects(save(b.request),errorStatus(409));
    const changed=plain(p.request);changed.draft.name="Changed identity";await assert.rejects(save(changed),errorStatus(409));assert.deepEqual(await domainCounts(),before);
  });
  test("HTTP-PG04 workspace hashes isolate equal public identities and foreign frozen-source selections",async()=>{
    const p=await preparedPlan(),foreign=await planIntent({planId:p.draft.planId,versionId:p.draft.versionId},active().foreignScope),saved=(await save(foreign.request,active().foreignScope)).record;
    assert.notEqual(saved.storage.versionId,p.record.storage.versionId);assert.notEqual(saved.fingerprint,p.record.fingerprint);
    assert.equal(await plans.getHttpEvalPlanSources(active().foreignScope.workspaceId,{datasetVersionId:p.origin.datasetVersionId,evalSetVersionIds:p.origin.evalSetVersionIds}),undefined);
    await assert.rejects(reserve(start(p.record),active().foreignScope),errorStatus(404));
  });
  test("HTTP-PG05 JSONB numeric changes that round to the old JavaScript value fail strict plan readback",async()=>{
    const p=await preparedPlan();await inspector.query("update run_plans set resolved_plan=jsonb_set(resolved_plan,'{recordText}',to_jsonb(replace(resolved_plan->>'recordText',$2,$3))) where id=$1",[p.record.storage.versionId,'"number":9007199254740992','"number":9007199254740993']);
    await assert.rejects(readPlan(p.record),errorStatus(409));
    assert.ok((await inspector.query("select resolved_plan->>'recordText' as value from run_plans where id=$1",[p.record.storage.versionId])).rows[0].value.includes('"number":9007199254740993'));
  });
  test("HTTP-PG06 legacy readers and writers exclude corrupt private plans but retain literal near-prefix legacy IDs",async()=>{
    const p=await preparedPlan(),legacy={plan:{id:`httpXevalXplan_${randomUUID()}`,planFingerprint:hash({workspaceId:active().scope.workspaceId,nonce:randomUUID()},64),sampleManifest:{rows:[]}},results:[],gates:[],idempotencyKey:randomUUID()};
    await service.persistEvalRun(active().scope.workspaceId,legacy);assert.ok((await service.listRunBatches(active().scope.workspaceId)).some(row=>row.id===legacy.plan.id));
    await inspector.query("update run_plans set resolved_plan=jsonb_set(jsonb_set(resolved_plan,'{schemaVersion}','\"broken\"'::jsonb),'{content,schemaVersion}','\"broken\"'::jsonb) where id=$1",[p.record.storage.versionId]);
    assert.equal(await service.getRunBatch(active().scope.workspaceId,p.record.storage.versionId),undefined);
    assert.ok(!(await service.listRunBatches(active().scope.workspaceId)).some(row=>row.id===p.record.storage.versionId));
    for(const plan of [{...legacy.plan,id:p.record.storage.versionId},{...legacy.plan,planFingerprint:p.record.fingerprint}])await assert.rejects(service.persistEvalRun(active().scope.workspaceId,{...legacy,plan,idempotencyKey:randomUUID()}),errorStatus(409));
  });
  test("HTTP-PG07 a real owned audit trigger rolls back the entire plan save",async()=>{
    const p=await planIntent(),before=await domainCounts();await withFailureTrigger("audit_events","http_eval.plan.saved",async()=>{await assert.rejects(save(p.request));});
    assert.deepEqual(await domainCounts(),before);assert.equal(await plans.getHttpEvalPlan(active().scope.workspaceId,p.draft.planId),undefined);
  });
  test("HTTP-PG08 reservation atomically persists all pending samples, ledger, reservation event and audit",async()=>{
    const p=await preparedPlan(),request=start(p.record),saved=await reserve(request);assert.equal(saved.created,true);equalJson(await get(request.runId),saved.record);
    assert.ok(saved.record.ledger.rows.every(row=>row.status==="pending"&&row.claim===null));assert.equal(saved.record.execution.gates.length,0);
    const c=await domainCounts();assert.deepEqual(c,{...emptyCounts,plans:1,runs:1,samples:2,workflows:1,events:1,audits:2});
  });
  test("HTTP-PG09 one immutable plan supports many executions and repeated POST identity only reads existing state",async()=>{
    const p=await preparedPlan(),a=start(p.record),b=start(p.record);const first=await reserve(a),second=await reserve(b),before=await domainCounts();
    assert.notEqual(first.record.ledger.runId,second.record.ledger.runId);assert.equal((await reserve(a)).created,false);assert.deepEqual(await domainCounts(),before);
    const history=await runs.listHttpEvalRuns(active().scope.workspaceId,p.draft.planId);assert.equal(history.runs.length,2);assert.ok(history.runs.every(row=>row.status==="running"));
  });
  test("HTTP-PG10 changed starts cannot reuse an execution identity or mutate its recorded intent",async()=>{
    const p=await preparedPlan(),request=start(p.record),saved=await reserve(request),before=await domainCounts();
    await assert.rejects(reserve({...request,expectedPlanFingerprint:"f".repeat(64)}),errorStatus(409));equalJson(await get(request.runId),saved.record);assert.deepEqual(await domainCounts(),before);
  });
  test("HTTP-PG11 a row claim is committed before work is returned and no second claim exposes another request",async()=>{
    const p=await preparedPlan(),record=(await reserve(start(p.record))).record,c=await claim(record);
    const saved=await get(record.ledger.publicRunId);equalJson(saved.ledger.rows[0].claim,c.claim);assert.equal(saved.ledger.rows[0].status,"claimed");
    assert.ok(!c.request.body.includes("SECRET_REFERENCE"));assert.ok(!c.request.body.includes("SECRET_TRACE"));
    await assert.rejects(claim(record),errorStatus(409));assert.equal((await domainCounts()).events,2);
  });
  test("HTTP-PG12 positively blocked concurrent claimants accept only one durable dispatch token",async()=>{
    const p=await preparedPlan(),record=(await reserve(start(p.record))).record,results=await blockedWriters(()=>claim(record));
    assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(results.filter(r=>r.status==="rejected").length,1);
    assert.equal(results.find(r=>r.status==="rejected").reason.status,409);assert.equal((await domainCounts()).events,2);
  });
  test("HTTP-PG13 configured concurrency limits the actual number of simultaneous pending SQL claims",async()=>{
    const p=await preparedPlan({limits:{concurrency:2,maxDurationSeconds:5}},3),record=(await reserve(start(p.record))).record;
    await claim(record,0);await claim(record,1);await assert.rejects(claim(record,2),errorStatus(409));assert.equal((await get(record.ledger.publicRunId)).ledger.rows.filter(r=>r.status==="claimed").length,2);
  });
  test("HTTP-PG14 real stored responses produce a complete row-by-item matrix and all terminal gate levels",async()=>{
    const p=await preparedPlan(),record=await complete(p.record,["Approved and ready","Approved only"]);
    assert.equal(record.execution.results.length,4);assert.equal(record.events.length,2);assert.equal(record.ledger.status,"completed");
    assert.deepEqual([...new Set(record.execution.gates.map(g=>g.level))].sort(),["criticality","dataset","eval_set","field","item_row","row","run","target"]);
    assert.equal(record.execution.gates.find(g=>g.level==="run").passed,false);
    const datasetGates=record.execution.gates.filter(g=>g.level==="dataset");assert.ok(datasetGates.every(g=>g.scopeId.includes(p.record.content.dataset.version.id)));
    const raw=(await inspector.query("select payload from workflow_events where workflow_run_id=$1 and event_type='http_eval.row.finalized'",[record.ledger.workflowId])).rows;
    assert.equal(raw.length,2);equalJson(raw.map(r=>JSON.parse(r.payload.eventText).response.output).sort(),["Approved and ready","Approved only"].sort());
    const projections=(await inspector.query("select original_output,normalized_fields from eval_results where eval_run_id=$1",[record.ledger.runId])).rows;
    assert.ok(projections.every(r=>!JSON.stringify(r).includes("Approved and ready")&&!JSON.stringify(r).includes("SECRET_REFERENCE")));
    equalJson(await get(record.ledger.publicRunId),record);
  });
  test("HTTP-PG15 identical finalization replays while changed raw spelling and a wrong token cannot overwrite evidence",async()=>{
    const p=await preparedPlan(),record=(await reserve(start(p.record))).record,c=await claim(record),raw=response(c),first=await finish(record,c),before=await domainCounts();
    const replay=await runs.finalizeHttpEvalRunRow(active().scope.workspaceId,record.ledger.publicRunId,{rowId:c.claim.rowId,claimToken:c.claim.claimToken,responseText:raw},runCallbacks);
    assert.equal(replay.replayed,true);equalJson(replay.record,first.record);
    await assert.rejects(runs.finalizeHttpEvalRunRow(active().scope.workspaceId,record.ledger.publicRunId,{rowId:c.claim.rowId,claimToken:c.claim.claimToken,responseText:` ${raw}`},runCallbacks),errorStatus(409));
    await assert.rejects(runs.finalizeHttpEvalRunRow(active().scope.workspaceId,record.ledger.publicRunId,{rowId:c.claim.rowId,claimToken:randomUUID(),responseText:raw},runCallbacks),errorStatus(409));
    assert.deepEqual(await domainCounts(),before);
  });
  test("HTTP-PG16 known not-sent and unknown transport errors remain distinct and cannot pass missing coverage",async()=>{
    const p=await preparedPlan(),record=(await reserve(start(p.record))).record,a=await claim(record,0),bRow=p.record.content.samples[1].rowId;
    await runs.finalizeHttpEvalRunRow(active().scope.workspaceId,record.ledger.publicRunId,{rowId:a.claim.rowId,claimToken:a.claim.claimToken,errorCode:"http_target_dns_rejected",errorOutcome:"not_sent"},runCallbacks);
    const b=await claim(record,1),done=(await runs.finalizeHttpEvalRunRow(active().scope.workspaceId,record.ledger.publicRunId,{rowId:bRow,claimToken:b.claim.claimToken,errorCode:"http_target_timeout",errorOutcome:"unknown"},runCallbacks)).record;
    assert.deepEqual(done.ledger.rows.map(r=>r.status),["not_sent","outcome_unknown"]);assert.equal(done.ledger.status,"outcome_unknown");assert.equal(done.execution.results.length,0);
    assert.equal(done.execution.gates.find(g=>g.level==="run").passed,false);equalJson(await get(record.ledger.publicRunId),done);
  });
  test("HTTP-PG17 deadline stop marks only pending rows and preserves an in-flight token for known late finalization",async()=>{
    const p=await preparedPlan({},3),record=(await reserve(start(p.record))).record,first=await claim(record,0);await finish(record,first);
    const second=await claim(record,1);await delay(Math.max(0,Date.parse(record.ledger.deadlineAt)-Date.now()+60));
    const stopped=await runs.stopHttpEvalRun(active().scope.workspaceId,record.ledger.publicRunId,{leaseToken:record.ledger.leaseToken,reasonCode:"http_eval_deadline_reached"},runCallbacks);
    assert.deepEqual(stopped.ledger.rows.map(r=>r.status),["succeeded","claimed","not_sent"]);assert.equal(stopped.execution.gates.length,0);
    const known=(await finish(record,second)).record;assert.deepEqual(known.ledger.rows.map(r=>r.status),["succeeded","succeeded","not_sent"]);assert.equal(known.ledger.status,"failed");
    assert.equal(known.execution.gates.find(g=>g.level==="run").passed,false);equalJson(known.events[0],stopped.events[0]);await assert.rejects(claim(record,2),errorStatus(409));
  });
  test("HTTP-PG18 explicit post-grace recovery preserves known rows, marks uncertainty and prevents late overwrite",async()=>{
    const p=await preparedPlan({},3),record=(await reserve(start(p.record))).record,first=await claim(record,0);await finish(record,first);const second=await claim(record,1);
    await assert.rejects(runs.recoverHttpEvalRun(active().scope,record.ledger.publicRunId,runCallbacks),errorStatus(409));
    const unchanged=await get(record.ledger.publicRunId);assert.equal(unchanged.ledger.rows[1].status,"claimed");
    await delay(Math.max(0,Date.parse(record.ledger.leaseExpiresAt)-Date.now()+60));
    const recovered=await runs.recoverHttpEvalRun(active().scope,record.ledger.publicRunId,runCallbacks);
    assert.deepEqual(recovered.ledger.rows.map(r=>r.status),["succeeded","outcome_unknown","not_sent"]);assert.equal(recovered.execution.gates.find(g=>g.level==="run").passed,false);
    equalJson(recovered.events[0],unchanged.events[0]);const before=await domainCounts();await assert.rejects(finish(record,second),errorStatus(409));
    equalJson(await runs.recoverHttpEvalRun(active().scope,record.ledger.publicRunId,runCallbacks),recovered);assert.deepEqual(await domainCounts(),before);
    await inspector.query("update audit_events set metadata_hash=$2 where action='http_eval.run.recovered' and resource_id=$1",[record.ledger.runId,"f".repeat(64)]);
    await assert.rejects(get(record.ledger.publicRunId),errorStatus(409));
  });
  test("HTTP-PG19 invalid response envelopes fail closed while zero and false remain actual JSON output values",async()=>{
    const p=await preparedPlan(),record=(await reserve(start(p.record))).record,a=await claim(record,0);
    const invalid=(await runs.finalizeHttpEvalRunRow(active().scope.workspaceId,record.ledger.publicRunId,{rowId:a.claim.rowId,claimToken:a.claim.claimToken,responseText:'{"output":"invented"}'},runCallbacks)).record;
    assert.equal(invalid.events[0].status,"failed");assert.equal(invalid.events[0].response,null);assert.equal(invalid.execution.results.length,0);
    const b=await claim(record,1),done=(await finish(record,b,false)).record;assert.equal(done.events[1].response.output,false);assert.equal(done.execution.gates.find(g=>g.level==="run").passed,false);
    const zeros=await complete(p.record,[0,0]);assert.ok(zeros.events.every(e=>e.response.output===0));
  });
  test("HTTP-PG20 native execution status, attempts and compact ledger corruption are refused without repair",async()=>{
    const p=await preparedPlan(),record=(await reserve(start(p.record))).record;
    for(const[field,value]of[["status","completed"],["attempts",2]]){
      await inspector.query(`update workflow_runs set ${field}=$2 where id=$1`,[record.ledger.workflowId,value]);await assert.rejects(get(record.ledger.publicRunId),errorStatus(409));
      await inspector.query(`update workflow_runs set ${field}=$2 where id=$1`,[record.ledger.workflowId,field==="status"?"running":1]);
    }
    await inspector.query("update workflow_runs set output=jsonb_set(output,'{rows,0,status}','\"succeeded\"'::jsonb) where id=$1",[record.ledger.workflowId]);
    await assert.rejects(get(record.ledger.publicRunId),errorStatus(409));
  });
  test("HTTP-PG21 event JSONB precision loss is caught even when parsing would reproduce the old fingerprint",async()=>{
    const p=await preparedPlan(),record=(await reserve(start(p.record))).record,c=await claim(record),saved=(await finish(record,c,9007199254740992)).record;
    await inspector.query("update workflow_events set payload=jsonb_set(payload,'{eventText}',to_jsonb(replace(payload->>'eventText',$2,$3))) where id=$1",[saved.events[0].id,'"output":9007199254740992','"output":9007199254740993']);
    await assert.rejects(get(record.ledger.publicRunId),errorStatus(409));
    assert.ok((await inspector.query("select payload->>'eventText' as value from workflow_events where id=$1",[saved.events[0].id])).rows[0].value.includes('"output":9007199254740993'));
  });
  test("HTTP-PG22 samples, full evaluator projection and gate metadata must all match the frozen record",async()=>{
    const p=await preparedPlan(),record=await complete(p.record),sample=(await inspector.query("select id from run_samples where eval_run_id=$1 order by id limit 1",[record.ledger.runId])).rows[0];
    await inspector.query("update run_samples set snapshot_hash=$2 where id=$1",[sample.id,"f".repeat(64)]);await assert.rejects(get(record.ledger.publicRunId),errorStatus(409));
    const row=record.ledger.rows.find(r=>runsCore.httpEvalSampleId(active().scope.workspaceId,record.ledger.publicRunId,r.rowId)===sample.id);
    await inspector.query("update run_samples set snapshot_hash=$2 where id=$1",[sample.id,p.record.content.samples.find(s=>s.rowId===row.rowId).fingerprint]);
    const result=record.execution.results[0];await inspector.query("update eval_results set normalized_fields=jsonb_set(normalized_fields,'{result,evaluatorVersion}','\"changed\"'::jsonb) where id=$1",[result.id]);
    await assert.rejects(get(record.ledger.publicRunId),errorStatus(409));await inspector.query("update eval_results set normalized_fields=$2::jsonb where id=$1",[result.id,JSON.stringify({schemaVersion:"http-eval-result-projection-v1",result})]);
    const gate=record.execution.gates[0];await inspector.query("update gate_results set reasons=jsonb_set(reasons,'{gate,thresholdVersion}','\"changed\"'::jsonb) where id=$1",[gate.id]);await assert.rejects(get(record.ledger.publicRunId),errorStatus(409));
  });
  test("HTTP-PG23 a real finalization event failure rolls back ledger, sample and every evaluator result",async()=>{
    const p=await preparedPlan(),record=(await reserve(start(p.record))).record,c=await claim(record),before=await get(record.ledger.publicRunId),counts=await domainCounts();
    await withFailureTrigger("workflow_events","http_eval.row.finalized",async()=>{await assert.rejects(finish(record,c));});
    equalJson(await get(record.ledger.publicRunId),before);assert.deepEqual(await domainCounts(),counts);
  });
  test("HTTP-PG24 positively blocked duplicate starts create one reservation and return one read-only replay",async()=>{
    const p=await preparedPlan(),request=start(p.record),results=await blockedWriters(()=>reserve(request));
    assert.ok(results.every(r=>r.status==="fulfilled"));assert.deepEqual(results.map(r=>r.value.created).sort(),[false,true]);
    const counts=await domainCounts();assert.equal(counts.runs,1);assert.equal(counts.workflows,1);assert.equal(counts.samples,2);assert.equal(counts.events,1);
  });
  test("HTTP-PG25 escaped valid names and target identifiers roundtrip above the old small request allowance",async()=>{
    const name="\u0001".repeat(4096),target={targetId:"\u0002".repeat(512),targetVersion:"\u0003".repeat(512),endpoint:`https://target.example.com/${"p".repeat(3900)}`,timeoutMs:1000};
    const p=await planIntent({name,target});assert.ok(Buffer.byteLength(JSON.stringify(p.request))>32768);
    const saved=(await save(p.request)).record;assert.equal(saved.content.draft.name,name);equalJson(await readPlan(saved),saved);
  });
  test("HTTP-PG26 partial own reservations are conflicts while foreign and clean absent identities remain undisclosed",async()=>{
    const p=await preparedPlan(),request=start(p.record),record=(await reserve(request)).record;
    assert.equal(await get(request.runId,active().foreignScope),undefined);assert.equal(await get(randomUUID()),undefined);
    await inspector.query("delete from workflow_runs where id=$1",[record.ledger.workflowId]);await assert.rejects(get(request.runId),errorStatus(409));
    await inspector.query("delete from eval_runs where id=$1",[record.ledger.runId]);await assert.rejects(get(request.runId),errorStatus(409));assert.equal(await get(request.runId,active().foreignScope),undefined);
  });
  test("HTTP-PG27 exact frozen plans remain executable and readable after live dataset and evaluator deletion",async()=>{
    const p=await preparedPlan();await inspector.query("delete from datasets where workspace_id=$1",[active().scope.workspaceId]);await inspector.query("delete from eval_sets where workspace_id=$1",[active().scope.workspaceId]);await inspector.query("delete from eval_items where workspace_id=$1",[active().scope.workspaceId]);
    equalJson(await readPlan(p.record),p.record);const record=await complete(p.record);assert.equal(record.execution.results.length,4);assert.equal(record.execution.gates.find(g=>g.level==="run").passed,true);equalJson(await get(record.ledger.publicRunId),record);
  });
  test("HTTP-PG28 the whole one-hundred-row population reserves intact and an added row never enters a saved plan",async()=>{
    const p=await preparedPlan({},100),record=(await reserve(start(p.record))).record;assert.equal(record.ledger.rows.length,100);assert.equal((await domainCounts()).samples,100);
    await inspector.query("insert into dataset_rows(id,dataset_version_id,row_key,input,metadata,review_status)values($1,$2,'Overflow','0'::jsonb,'{}'::jsonb,'reviewed')",[`http-fixture-extra-${randomUUID()}`,p.origin.datasetVersionId]);
    await assert.rejects(plans.getHttpEvalPlanSources(active().scope.workspaceId,p.draft),errorStatus(409));equalJson(await readPlan(p.record),p.record);assert.equal((await get(record.ledger.publicRunId)).ledger.rows.length,100);
  });
  test("HTTP-PG29 a trusted callback regression cannot change any frozen outbound request projection",async()=>{
    const p=await preparedPlan({limits:{concurrency:1,maxDurationSeconds:120}}),record=(await reserve(start(p.record))).record,before=await domainCounts();
    for(const change of [value=>({...value,endpoint:"https://other.example.com/evaluate"}),value=>({...value,body:` ${value.body}`}),value=>({...value,timeoutMs:value.timeoutMs+1}),value=>({...value,idempotencyKey:"different"})]){
      let prepared=0;
      const bridge={...runCallbacks,claim:input=>{const value=runsCore.claimHttpEvalRow(input);prepared++;return {...value,request:change(value.request)};}};
      await assert.rejects(runs.claimHttpEvalRunRow(active().scope.workspaceId,record.ledger.publicRunId,{rowId:p.record.content.samples[0].rowId,leaseToken:record.ledger.leaseToken},bridge),errorStatus(409));
      assert.equal(prepared,1);assert.deepEqual(await domainCounts(),before);equalJson(await get(record.ledger.publicRunId),record);
    }
  });
  test("HTTP-PG30 canonical near-one-MiB inputs and repeated large tiny-decimal outputs survive PostgreSQL expansion",async()=>{
    const origin=await source(active().scope,1,{left:Array.from({length:70000},()=>1e-308),right:Array.from({length:70000},()=>1e-308)}),p=await planIntent({limits:{concurrency:1,maxDurationSeconds:120}},active().scope,origin),saved=(await save(p.request)).record;
    assert.ok(Buffer.byteLength(JSON.stringify(saved.content.dataset))>980000);equalJson(await readPlan(saved),saved);
    const sourceWire=(await inspector.query("select octet_length(input::text) as bytes from dataset_rows where dataset_version_id=$1",[origin.datasetVersionId])).rows[0].bytes;
    assert.ok(sourceWire>32*1024*1024);assert.ok(sourceWire<64*1024*1024);
    const planWire=(await inspector.query("select octet_length(resolved_plan::text) as bytes from run_plans where id=$1",[saved.storage.versionId])).rows[0].bytes;assert.ok(planWire<3*1024*1024);
    const many=await preparedPlan({limits:{concurrency:1,maxDurationSeconds:120}},12),output=Array.from({length:9000},()=>1e-308),record=await complete(many.record,Array.from({length:12},()=>output));
    assert.equal(record.events.length,12);assert.ok(record.events.every(e=>e.response.output.length===9000));equalJson(await get(record.ledger.publicRunId),record);
    const wire=(await inspector.query("select sum(octet_length(payload::text))::int as bytes from workflow_events where workflow_run_id=$1 and event_type='http_eval.row.finalized'",[record.ledger.workflowId])).rows[0].bytes;
    assert.ok(wire<2*1024*1024);
  });
  test("HTTP-PG31 canonical storage envelopes reject metadata drift and noncanonical text without changing domain values",async()=>{
    const p=await preparedPlan();await inspector.query("update run_plans set resolved_plan=jsonb_set(resolved_plan,'{content,draft,name}','\"different index\"'::jsonb) where id=$1",[p.record.storage.versionId]);
    await assert.rejects(readPlan(p.record),errorStatus(409));
    await inspector.query("update run_plans set resolved_plan=jsonb_set(resolved_plan,'{content,draft,name}',to_jsonb($2::text)) where id=$1",[p.record.storage.versionId,p.draft.name]);
    await inspector.query("update run_plans set resolved_plan=jsonb_set(resolved_plan,'{recordText}',to_jsonb(' '||(resolved_plan->>'recordText'))) where id=$1",[p.record.storage.versionId]);
    await assert.rejects(readPlan(p.record),errorStatus(409));
  });
});

import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const {Pool}=createRequire(new URL('../../packages/db/package.json',import.meta.url))('pg');
export const MARKER='open-evals-harbor-20261111-authored-disposable-v1';
export function fixtureGuard() {
  assert.equal(process.env.HARBOR_TEST_ALLOW,'local-disposable');assert.equal(process.env.AUTH_MODE,'hosted');
  const url=new URL(process.env.HARBOR_TEST_DATABASE_URL??'missing:');
  assert.ok(['postgres:','postgresql:'].includes(url.protocol));assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/open_evals_harbor_ci_[0-9a-f]{16}$/);
  const endpoint=new URL(process.env.HARBOR_TEST_URL??'missing:');assert.equal(endpoint.protocol,'http:');assert.equal(endpoint.hostname,'127.0.0.1');
  assert.ok(process.env.AUTH_SECRET?.length>=32 && process.env.API_KEY_PEPPER?.length>=32);
  return {databaseUrl:url.href,endpoint:endpoint.origin};
}
export async function guardedPool() {
  const config=fixtureGuard(),pool=new Pool({connectionString:config.databaseUrl,max:4,statement_timeout:10000});
  const marker=await pool.query("select shobj_description(oid,'pg_database') as marker from pg_database where datname=current_database()");
  assert.equal(marker.rows[0]?.marker,MARKER);return pool;
}
export async function createHarborFixture() {
  const {endpoint}=fixtureGuard(),pool=await guardedPool(),prefix='hbr_'+randomUUID().replaceAll('-',''),id=name=>prefix+'_'+name;
  const data={prefix,workspaceId:id('workspace'),foreignWorkspaceId:id('foreign_workspace'),projectId:id('project'),otherProjectId:id('other_project'),foreignProjectId:id('foreign_project'),actorId:id('actor'),endpoint,keys:{},cookies:{}};
  function cookie(workspaceId,role) {
    const encoded=Buffer.from(JSON.stringify({userId:data.actorId,workspaceId,role,expiresAt:Date.now()+3600000})).toString('base64url');
    return 'open_evals_session='+encoded+'.'+createHmac('sha256',process.env.AUTH_SECRET).update(encoded).digest('base64url');
  }
  for(const role of ['owner','editor','viewer'])data.cookies[role]=cookie(data.workspaceId,role);
  data.cookies.foreignOwner=cookie(data.foreignWorkspaceId,'owner');
  for(const name of ['own','other','foreign','read','write','revoked'])data.keys[name]=id(name)+'_authored_disposable_key';
  const directory=join(process.env.HARBOR_WORK,'fixtures');await mkdir(directory,{recursive:true,mode:0o700});
  await writeFile(join(directory,prefix+'.json'),JSON.stringify(data),{flag:'wx',mode:0o600});
  const sql=async(query,args=[]) => (await pool.query(query,args)).rows;
  await sql('insert into workspaces(id,name,mode) values($1,$2,\'hosted\'),($3,$4,\'hosted\')',[data.workspaceId,prefix,data.foreignWorkspaceId,prefix+' foreign']);
  await sql('insert into projects(id,workspace_id,name,environment) values($1,$2,\'Authored project\',\'test\'),($3,$2,\'Other project\',\'test\'),($4,$5,\'Foreign project\',\'test\')',[data.projectId,data.workspaceId,data.otherProjectId,data.foreignProjectId,data.foreignWorkspaceId]);
  for(const name of Object.keys(data.keys)) {
    const project=name==='other'?data.otherProjectId:name==='foreign'?data.foreignProjectId:data.projectId;
    const scopes=name==='read'?['evals:read']:name==='write'?['evals:write']:['evals:read','evals:write'];
    await sql(`insert into project_api_keys(id,project_id,key_hash,scope,scopes,name,key_prefix,revoked_at) values($1,$2,$3,'test',$4::text[],$5,'authored',$6)`,
      [id('key_'+name),project,createHmac('sha256',process.env.API_KEY_PEPPER).update(data.keys[name]).digest('hex'),scopes,prefix,name==='revoked'?new Date():null]);
  }
  async function request(query='',body,who='owner',extra={}) {
    const headers=who==='anonymous'?{}:data.cookies[who]?{cookie:data.cookies[who]}:{authorization:'Bearer '+data.keys[who]};
    const response=await fetch(endpoint+'/api/v1/harbor'+query,{method:body===undefined?'GET':'POST',headers:{...headers,...(body!==undefined?{'content-type':'application/json'}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});
    assert.match(response.headers.get('content-type')??'',/application\/json/);return {status:response.status,body:await response.json(),headers:response.headers};
  }
  return {...data,pool,sql,request,close:()=>pool.end()};
}
export async function cleanupHarborFixture(pool,data) {
  assert.match(data.prefix,/^hbr_[0-9a-f]{32}$/);
  const ids=[data.workspaceId,data.foreignWorkspaceId];assert.deepEqual(ids,[data.prefix+'_workspace',data.prefix+'_foreign_workspace']);
  await pool.query(`drop trigger if exists ${data.prefix}_audit_fail on audit_events`);
  await pool.query(`drop function if exists ${data.prefix}_audit_fn()`);
  for(const query of [
    'delete from audit_events where workspace_id=any($1::text[])',
    'delete from run_plans where workspace_id=any($1::text[])',
    'delete from scenario_versions where suite_id in(select id from scenario_suites where workspace_id=any($1::text[]))',
    'delete from scenario_suites where workspace_id=any($1::text[])',
    'delete from project_api_keys where project_id in(select id from projects where workspace_id=any($1::text[]))',
    'delete from projects where workspace_id=any($1::text[])',
    'delete from workspace_memberships where workspace_id=any($1::text[])',
    'delete from workspaces where id=any($1::text[])'])await pool.query(query,[ids]);
  for(const table of ['workspaces','projects','run_plans','scenario_suites','audit_events']) {
    const column=table==='workspaces'?'id':'workspace_id';const result=await pool.query(`select count(*)::int as count from ${table} where ${column}=any($1::text[])`,[ids]);assert.equal(result.rows[0].count,0);
  }
}

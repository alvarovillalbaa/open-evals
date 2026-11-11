import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { withTransaction } from "./service";

export interface HarborStoreScope { workspaceId: string; actorId: string; projectId?: string }
export interface HarborTaskPort {
  schemaVersion: "harbor-task-version-v1"; workspaceId: string; taskId: string; versionId: string; version: number;
  expectedVersionId: string | null; name: string; fingerprint: string;
}
export interface HarborPlanPort {
  schemaVersion: "harbor-plan-v1"; workspaceId: string; draft: { planId: string; projectId: string; name: string };
  tasks: HarborTaskPort[]; fingerprint: string;
}
export interface HarborRunPort {
  schemaVersion: "harbor-run-v1"; workspaceId: string; runId: string; planId: string; planFingerprint: string;
  projectId: string; status: string; fingerprint: string;
}
export interface HarborStoreParsers<T extends HarborTaskPort, P extends HarborPlanPort, R extends HarborRunPort> {
  task: (value: unknown) => T; plan: (value: unknown) => P; run: (value: unknown, plan: P) => R;
}
export class HarborStoreError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "HarborStoreError"; }
}
const fail = (status: number, code: string): never => { throw new HarborStoreError(status, code); };
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
function uuid(value: string) { if (!UUID.test(value)) fail(422, "harbor_invalid_id"); }
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return Array.isArray(value) ? `[${value.map(stable).join(",")}]`
    : `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`;
}
function key(kind: string, workspaceId: string, id: string) {
  uuid(id); return `harbor_${kind}_${createHash("sha256").update(stable([workspaceId, kind, id])).digest("hex")}`;
}
function checked<T extends { workspaceId: string; fingerprint: string }>(raw: unknown, workspaceId: string, parse: (value: unknown) => T): T {
  let value: T;
  try { value = parse(raw); } catch { return fail(409, "harbor_storage_conflict"); }
  if (value.workspaceId !== workspaceId || stable(value) !== stable(raw) || Buffer.byteLength(stable(value)) > 7 * 1024 * 1024) return fail(409, "harbor_storage_conflict");
  const { fingerprint, ...content } = value;
  if (fingerprint !== createHash("sha256").update(stable(content)).digest("hex")) return fail(409, "harbor_storage_conflict");
  return value;
}
async function workspace(client: PoolClient, scope: HarborStoreScope) {
  const result = await client.query('select id from workspaces where id=$1 for update', [scope.workspaceId]);
  if (result.rowCount !== 1) fail(404, "harbor_workspace_not_found");
}
async function project(client: PoolClient, scope: HarborStoreScope, projectId: string) {
  if (scope.projectId !== undefined && scope.projectId !== projectId) fail(404, "harbor_plan_not_found");
  const result = await client.query('select id from projects where workspace_id=$1 and id=$2', [scope.workspaceId, projectId]);
  if (result.rowCount !== 1) fail(404, "harbor_project_not_found");
}
async function audit(client: PoolClient, scope: HarborStoreScope, action: string, id: string, fingerprint: string) {
  const eventId = 'harbor_audit_' + createHash('sha256').update(stable([scope.workspaceId, action, id, fingerprint])).digest('hex');
  await client.query(`insert into audit_events(id,workspace_id,actor_user_id,action,resource_type,resource_id,metadata)
    values($1,$2,$3,$4,'harbor',$5,$6::jsonb) on conflict(id) do nothing`,
    [eventId, scope.workspaceId, scope.actorId, action, id, JSON.stringify({ fingerprint })]);
}
async function taskVersion<T extends HarborTaskPort>(client: PoolClient, scope: HarborStoreScope, taskId: string, versionId: string, parse: (value: unknown) => T): Promise<T> {
  if (scope.projectId !== undefined) return fail(403, "harbor_workspace_session_required");
  const result = await client.query<{ scenario: unknown; fingerprint: string; version: number }>(`select v.scenario,v.fingerprint,v.version from scenario_versions v
    join scenario_suites s on s.id=v.suite_id where s.workspace_id=$1 and s.id=$2 and v.id=$3`,
    [scope.workspaceId, key('task', scope.workspaceId, taskId), key('task_version', scope.workspaceId, versionId)]);
  const row = result.rows[0]; if (!row) return fail(404, "harbor_task_not_found");
  const value = checked(row.scenario, scope.workspaceId, parse);
  if (value.taskId !== taskId || value.versionId !== versionId || value.fingerprint !== row.fingerprint || value.version !== row.version) return fail(409, "harbor_storage_conflict");
  return value;
}
export async function getHarborTaskVersion<T extends HarborTaskPort>(scope: HarborStoreScope, taskId: string, versionId: string, parse: (value: unknown) => T): Promise<T> {
  return withTransaction(client => taskVersion(client, scope, taskId, versionId, parse));
}
export async function saveHarborTask<T extends HarborTaskPort>(scope: HarborStoreScope, input: T, parse: (value: unknown) => T) {
  if (scope.projectId !== undefined) return fail(403, "harbor_workspace_session_required");
  const value = checked(input, scope.workspaceId, parse), suiteId = key('task', scope.workspaceId, value.taskId), versionId = key('task_version', scope.workspaceId, value.versionId);
  return withTransaction(async client => {
    await workspace(client, scope);
    const replay = await client.query<{ scenario: unknown; fingerprint: string }>('select scenario,fingerprint from scenario_versions where id=$1', [versionId]);
    if (replay.rows[0]) {
      if (replay.rows[0].fingerprint !== value.fingerprint || stable(checked(replay.rows[0].scenario, scope.workspaceId, parse)) !== stable(value)) return fail(409, "harbor_task_replay_conflict");
      return { task: value, replayed: true };
    }
    const suite = await client.query<{ workspace_id: string }>('select workspace_id from scenario_suites where id=$1', [suiteId]);
    const heads = await client.query<{ scenario: unknown; fingerprint: string; version: number }>('select scenario,fingerprint,version from scenario_versions where suite_id=$1 order by version desc,id desc limit 2', [suiteId]);
    if (suite.rows[0] && suite.rows[0].workspace_id !== scope.workspaceId) return fail(409, "harbor_storage_conflict");
    if (!suite.rowCount && heads.rowCount) return fail(409, "harbor_storage_conflict");
    const previous = heads.rows[0] ? checked(heads.rows[0].scenario, scope.workspaceId, parse) : null;
    if (heads.rows.length > 1 && heads.rows[1]!.version === heads.rows[0]!.version || suite.rowCount && !previous) return fail(409, "harbor_storage_conflict");
    if (previous && (previous.taskId !== value.taskId || previous.fingerprint !== heads.rows[0]!.fingerprint || previous.version !== heads.rows[0]!.version)) return fail(409, "harbor_storage_conflict");
    if (value.expectedVersionId !== (previous?.versionId ?? null) || value.version !== (previous?.version ?? 0) + 1) return fail(409, "harbor_task_head_changed");
    if (!suite.rowCount) await client.query('insert into scenario_suites(id,workspace_id,name) values($1,$2,$3)', [suiteId, scope.workspaceId, value.name]);
    await client.query('insert into scenario_versions(id,suite_id,version,scenario,fingerprint) values($1,$2,$3,$4::jsonb,$5)', [versionId, suiteId, value.version, JSON.stringify(value), value.fingerprint]);
    await audit(client, scope, 'harbor.task.saved', value.versionId, value.fingerprint);
    return { task: value, replayed: false };
  });
}
export async function listHarborTasks(scope: HarborStoreScope) {
  if (scope.projectId !== undefined) return fail(403, "harbor_workspace_session_required");
  return withTransaction(async client => {
    const result = await client.query(`select v.scenario->>'taskId' as "taskId",v.scenario->>'versionId' as "versionId",v.version,
      v.scenario->>'name' as name,v.fingerprint,v.scenario#>>'{bundle,taskName}' as "nativeTaskName",
      v.scenario#>>'{bundle,taskVersion}' as "nativeTaskVersion",v.scenario#>>'{bundle,fingerprint}' as "bundleFingerprint"
      from scenario_suites s join scenario_versions v on v.suite_id=s.id where s.workspace_id=$1
      and left(s.id,length('harbor_task_'))='harbor_task_' and v.scenario->>'schemaVersion'='harbor-task-version-v1'
      order by s.id,v.version desc,v.id desc limit 101`, [scope.workspaceId]);
    return { versions: result.rows.slice(0,100), hasMore: result.rows.length > 100 };
  });
}
async function plan<P extends HarborPlanPort>(client: PoolClient, scope: HarborStoreScope, planId: string, parse: (value: unknown) => P): Promise<P> {
  const result = await client.query<{ resolved_plan: unknown; fingerprint: string }>('select resolved_plan,fingerprint from run_plans where workspace_id=$1 and id=$2', [scope.workspaceId, key('plan', scope.workspaceId, planId)]);
  const row = result.rows[0]; if (!row) return fail(404, "harbor_plan_not_found");
  const value = checked(row.resolved_plan, scope.workspaceId, parse);
  if (value.draft.planId !== planId || value.fingerprint !== row.fingerprint) return fail(409, "harbor_storage_conflict");
  await project(client, scope, value.draft.projectId);
  return value;
}
export async function getHarborPlan<P extends HarborPlanPort>(scope: HarborStoreScope, planId: string, parse: (value: unknown) => P) { return withTransaction(client => plan(client,scope,planId,parse)); }
export async function saveHarborPlan<T extends HarborTaskPort,P extends HarborPlanPort>(scope: HarborStoreScope, input: P, parsers: { task: (value: unknown) => T; plan: (value: unknown) => P }) {
  if (scope.projectId !== undefined) return fail(403, "harbor_workspace_session_required");
  const value = checked(input, scope.workspaceId, parsers.plan), id = key('plan',scope.workspaceId,value.draft.planId);
  return withTransaction(async client => {
    await workspace(client, scope); await project(client, scope, value.draft.projectId);
    for (const selected of value.tasks) {
      const saved = await taskVersion(client,scope,selected.taskId,selected.versionId,parsers.task);
      if (stable(saved) !== stable(selected)) return fail(409, "harbor_task_selection_mismatch");
    }
    const existing = await client.query<{ resolved_plan: unknown; fingerprint: string }>('select resolved_plan,fingerprint from run_plans where id=$1 or fingerprint=$2',[id,value.fingerprint]);
    if (existing.rowCount) {
      if (existing.rowCount !== 1 || existing.rows[0]!.fingerprint !== value.fingerprint || stable(checked(existing.rows[0]!.resolved_plan,scope.workspaceId,parsers.plan)) !== stable(value)) return fail(409,"harbor_plan_replay_conflict");
      return {plan:value,replayed:true};
    }
    await client.query('insert into run_plans(id,workspace_id,resolved_plan,fingerprint) values($1,$2,$3::jsonb,$4)',[id,scope.workspaceId,JSON.stringify(value),value.fingerprint]);
    await audit(client,scope,'harbor.plan.saved',value.draft.planId,value.fingerprint);
    return {plan:value,replayed:false};
  });
}
export async function listHarborPlans(scope: HarborStoreScope) {
  return withTransaction(async client => {
    const result = await client.query(`select resolved_plan#>>'{draft,planId}' as "planId",resolved_plan#>>'{draft,name}' as name,
      resolved_plan#>>'{draft,projectId}' as "projectId",fingerprint,created_at as "createdAt" from run_plans
      where workspace_id=$1 and left(id,length('harbor_plan_'))='harbor_plan_' and resolved_plan->>'schemaVersion'='harbor-plan-v1'
      and ($2::text is null or resolved_plan#>>'{draft,projectId}'=$2) order by created_at desc,id desc limit 101`,[scope.workspaceId,scope.projectId??null]);
    return {plans:result.rows.slice(0,100),hasMore:result.rows.length>100};
  });
}
async function run<T extends HarborTaskPort,P extends HarborPlanPort,R extends HarborRunPort>(client:PoolClient,scope:HarborStoreScope,runId:string,parsers:HarborStoreParsers<T,P,R>) {
  const result=await client.query<{resolved_plan:unknown;fingerprint:string}>('select resolved_plan,fingerprint from run_plans where workspace_id=$1 and id=$2',[scope.workspaceId,key('run',scope.workspaceId,runId)]);
  const row=result.rows[0]; if(!row) return fail(404,'harbor_run_not_found');
  const raw=row.resolved_plan as Record<string,unknown>;
  if(typeof raw?.planId!=='string') return fail(409,'harbor_storage_conflict');
  const source=await plan(client,scope,raw.planId,parsers.plan);
  const value=checked(raw,scope.workspaceId,v=>parsers.run(v,source));
  if(value.runId!==runId || value.fingerprint!==row.fingerprint || value.planFingerprint!==source.fingerprint) return fail(409,'harbor_storage_conflict');
  return {run:value,plan:source};
}
export async function getHarborRun<T extends HarborTaskPort,P extends HarborPlanPort,R extends HarborRunPort>(scope:HarborStoreScope,runId:string,parsers:HarborStoreParsers<T,P,R>) { return withTransaction(client=>run(client,scope,runId,parsers)); }
export async function startHarborRun<T extends HarborTaskPort,P extends HarborPlanPort,R extends HarborRunPort>(scope:HarborStoreScope,planId:string,runId:string,expected:string,parsers:HarborStoreParsers<T,P,R>,create:(plan:P,runId:string,now:string)=>R) {
  return withTransaction(async client=>{
    await workspace(client,scope); const source=await plan(client,scope,planId,parsers.plan);
    if(source.fingerprint!==expected) return fail(409,'harbor_plan_changed');
    const id=key('run',scope.workspaceId,runId),existing=await client.query('select id from run_plans where id=$1',[id]);
    if(existing.rowCount) { const saved=await run(client,scope,runId,parsers); if(saved.plan.fingerprint!==expected) return fail(409,'harbor_run_replay_conflict'); return {...saved,replayed:true}; }
    const value=checked(create(source,runId,new Date().toISOString()),scope.workspaceId,v=>parsers.run(v,source));
    await client.query('insert into run_plans(id,workspace_id,resolved_plan,fingerprint) values($1,$2,$3::jsonb,$4)',[id,scope.workspaceId,JSON.stringify(value),value.fingerprint]);
    await audit(client,scope,'harbor.run.reserved',runId,value.fingerprint);
    return {run:value,plan:source,replayed:false};
  });
}
export async function updateHarborRun<T extends HarborTaskPort,P extends HarborPlanPort,R extends HarborRunPort,E extends object>(scope:HarborStoreScope,runId:string,parsers:HarborStoreParsers<T,P,R>,transition:(run:R,plan:P,now:string)=>{run:R}&E) {
  return withTransaction(async client=>{
    await workspace(client,scope); const previous=await run(client,scope,runId,parsers);
    const changed=transition(previous.run,previous.plan,new Date().toISOString());
    const value=checked(changed.run,scope.workspaceId,v=>parsers.run(v,previous.plan));
    if(value.runId!==runId || value.planId!==previous.run.planId || value.planFingerprint!==previous.run.planFingerprint || value.projectId!==previous.run.projectId) return fail(409,'harbor_run_identity_mismatch');
    if(value.fingerprint!==previous.run.fingerprint) {
      const updated=await client.query('update run_plans set resolved_plan=$1::jsonb,fingerprint=$2 where id=$3 and workspace_id=$4 and fingerprint=$5',[JSON.stringify(value),value.fingerprint,key('run',scope.workspaceId,runId),scope.workspaceId,previous.run.fingerprint]);
      if(updated.rowCount!==1) return fail(409,'harbor_run_head_changed');
      await audit(client,scope,'harbor.run.updated',runId,value.fingerprint);
    }
    return {...changed,run:value,plan:previous.plan};
  });
}
export async function listHarborRuns(scope:HarborStoreScope,planId:string) {
  uuid(planId);
  return withTransaction(async client=>{
    const result=await client.query(`select resolved_plan->>'runId' as "runId",resolved_plan->>'status' as status,
      resolved_plan->>'projectId' as "projectId",resolved_plan->>'createdAt' as "createdAt",fingerprint from run_plans where workspace_id=$1
      and left(id,length('harbor_run_'))='harbor_run_' and resolved_plan->>'schemaVersion'='harbor-run-v1'
      and resolved_plan->>'planId'=$2 and ($3::text is null or resolved_plan->>'projectId'=$3) order by created_at desc,id desc limit 101`,[scope.workspaceId,planId,scope.projectId??null]);
    return {runs:result.rows.slice(0,100),hasMore:result.rows.length>100};
  });
}
export async function listHarborProjects(scope:HarborStoreScope) {
  if(scope.projectId!==undefined) return fail(403,'harbor_workspace_session_required');
  return withTransaction(async client=>{const result=await client.query('select id,name,environment from projects where workspace_id=$1 order by name,id limit 101',[scope.workspaceId]); return {projects:result.rows.slice(0,100),hasMore:result.rows.length>100};});
}

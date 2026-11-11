import {
  HarborTaskError, claimHarborTask, completeHarborTask, createHarborRun, harborUuid,
  parseHarborPlan, parseHarborPlanDraft, parseHarborRun, parseHarborTaskVersion,
  prepareHarborPlan, prepareHarborTask, recoverHarborRun
} from "@open-evals/core";
import {
  HarborStoreError, getHarborPlan, getHarborRun, getHarborTaskVersion, isDatabaseUnavailable,
  listHarborPlans, listHarborProjects, listHarborRuns, listHarborTasks, saveHarborPlan,
  saveHarborTask, startHarborRun, updateHarborRun, type HarborStoreScope
} from "@open-evals/db";
import { requireRouteAuth, type RouteAuthContext } from "./auth";
import { InstructionRequestError } from "./instruction-request";

const parsers = { task: parseHarborTaskVersion, plan: parseHarborPlan, run: parseHarborRun };
const fail = (status: number, code: string): never => { throw new HarborStoreError(status, code); };
export async function requireHarborAuth(mode: "read" | "write", workspaceOnly = false) {
  const auth = await requireRouteAuth(mode === "write" ? "editor" : "viewer", mode === "write" ? "evals:write" : "evals:read");
  if (auth.authKind === "api_key" && (!auth.projectId || workspaceOnly)) fail(403, "harbor_workspace_session_required");
  if (mode === "write" && auth.authKind === "local" && (process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL))) fail(403, "harbor_hosted_session_required");
  return auth;
}
function scope(auth: RouteAuthContext): HarborStoreScope {
  return { workspaceId: auth.workspaceId, actorId: auth.user.id, ...(auth.authKind === "api_key" ? { projectId: auth.projectId } : {}) };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(422,"harbor_request_object_required");
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, names: string[]) {
  if (Object.keys(value).sort().join("\0") !== [...names].sort().join("\0")) fail(422,"harbor_request_fields_invalid");
}
function text(value: unknown): string { if(typeof value!=="string" || !value || value.length>200) return fail(422,"harbor_request_text_invalid"); return value; }
async function preparePlan(auth: RouteAuthContext, input: unknown) {
  const draft = parseHarborPlanDraft(input), own = scope(auth);
  const snapshots = [];
  for (const ref of draft.tasks) snapshots.push(await getHarborTaskVersion(own, ref.taskId, ref.versionId, parseHarborTaskVersion));
  return prepareHarborPlan(auth.workspaceId, draft, snapshots);
}
export async function readHarbor(auth: RouteAuthContext, query: URLSearchParams) {
  const own=scope(auth),kind=query.get("kind")??"catalog";
  const allowed:Record<string,string[]>={catalog:["kind"],plans:["kind"],task:["kind","taskId","versionId"],plan:["kind","planId"],run:["kind","runId"],runs:["kind","planId"]};
  if(!allowed[kind] || [...query.keys()].some(key=>!allowed[kind]!.includes(key) || query.getAll(key).length!==1)) return fail(422,"harbor_query_invalid");
  if(kind==="catalog" || kind==="task") {
    if(auth.authKind==="api_key") return fail(403,"harbor_workspace_session_required");
    if(kind==="task") return {task:await getHarborTaskVersion(own,harborUuid(query.get('taskId')),harborUuid(query.get('versionId')),parseHarborTaskVersion)};
    const [tasks,plans,projects]=await Promise.all([listHarborTasks(own),listHarborPlans(own),listHarborProjects(own)]);
    return {tasks,plans,projects,canWrite:["owner","admin","editor"].includes(auth.role) && !(auth.authKind==="local" && (process.env.NODE_ENV==="production" || Boolean(process.env.VERCEL)))};
  }
  if(kind==="plans") return listHarborPlans(own);
  if(kind==="plan") return {plan:await getHarborPlan(own,harborUuid(query.get('planId')),parseHarborPlan)};
  if(kind==="run") return getHarborRun(own,harborUuid(query.get('runId')),parsers);
  const id=harborUuid(query.get('planId'));
  await getHarborPlan(own,id,parseHarborPlan);
  return listHarborRuns(own,id);
}
export async function writeHarbor(auth: RouteAuthContext, input: unknown) {
  const value=object(input),action=text(value.action),own=scope(auth);
  if(["task.preview","task.save","plan.preview","plan.save","run.recover"].includes(action) && auth.authKind==="api_key") return fail(403,"harbor_workspace_session_required");
  if(action==="task.preview" || action==="task.save") {
    fields(value,action==="task.save"?["action","draft","previewFingerprint"]:["action","draft"]);
    const task=prepareHarborTask(auth.workspaceId,value.draft);
    if(action==="task.preview") return {task,executed:false};
    if(task.fingerprint!==value.previewFingerprint) return fail(409,"harbor_preview_changed");
    return saveHarborTask(own,task,parseHarborTaskVersion);
  }
  if(action==="plan.preview" || action==="plan.save") {
    fields(value,action==="plan.save"?["action","draft","previewFingerprint"]:["action","draft"]);
    const plan=await preparePlan(auth,value.draft);
    if(action==="plan.preview") {
      // Project existence and sharing scope are checked before a useful preview.
      const projects=await listHarborProjects(own);
      if(!projects.projects.some(p=>p.id===plan.draft.projectId)) return fail(404,"harbor_project_not_found");
      return {plan,executed:false,sharesTaskSourceWithProjectKeys:true};
    }
    if(plan.fingerprint!==value.previewFingerprint) return fail(409,"harbor_preview_changed");
    return saveHarborPlan(own,plan,parsers);
  }
  if(action==="run.start") {
    fields(value,["action","planId","runId","planFingerprint"]);
    return startHarborRun(own,harborUuid(value.planId),harborUuid(value.runId),text(value.planFingerprint),parsers,createHarborRun);
  }
  if(action==="run.claim") {
    fields(value,["action","runId","versionId","claimId"]);
    const versionId=harborUuid(value.versionId),claimId=harborUuid(value.claimId);
    return updateHarborRun(own,harborUuid(value.runId),parsers,(run,plan,now)=>claimHarborTask(run,plan,versionId,claimId,now));
  }
  if(action==="run.complete") {
    fields(value,["action","runId","versionId","claimId","result"]);
    const versionId=harborUuid(value.versionId),claimId=harborUuid(value.claimId);
    return updateHarborRun(own,harborUuid(value.runId),parsers,(run,plan)=>completeHarborTask(run,plan,versionId,claimId,value.result));
  }
  if(action==="run.recover") {
    fields(value,["action","runId"]);
    return updateHarborRun(own,harborUuid(value.runId),parsers,(run,plan)=>({run:recoverHarborRun(run,plan)}));
  }
  return fail(422,"harbor_action_invalid");
}
export function harborResponse(value: unknown, status=200) { return Response.json(value,{status,headers:{"Cache-Control":"no-store"}}); }
export function harborErrorResponse(error:unknown) {
  const candidate=error instanceof Error && "status" in error?Number(error.status):error instanceof HarborTaskError?
    /(?:already_claimed|deadline_reached|completion_conflict|claim_mismatch)$/.test(error.code)?409:422:500;
  const status=isDatabaseUnavailable(error)?503:Number.isInteger(candidate)&&candidate>=400&&candidate<=599?candidate:500;
  const code=status<500 && error instanceof Error && /^[a-zA-Z0-9_:.-]{1,160}$/.test(error.message)?error.message:status===503?"database_unavailable":"harbor_request_failed";
  return harborResponse({error:code},status);
}
export function checkHarborOrigin(request:Request) {
  const origin=request.headers.get('origin');
  if(origin && origin!==new URL(request.url).origin) throw new InstructionRequestError(403,'harbor_origin_forbidden');
}

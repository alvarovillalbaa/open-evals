import {
  harborBoundedJson, harborUuid, parseHarborPlan, parseHarborPlanDraft, parseHarborRun, parseHarborTaskVersion, prepareHarborTask, stableStringify,
  type HarborPlan, type HarborPlanDraft, type HarborResult, type HarborRun, type HarborTaskDraft, type HarborTaskVersion
} from "@open-evals/core";
import { normalizePromptEndpoint } from "./prompts";

export class HarborHttpError extends Error {
  constructor(readonly code: string, readonly status?: number) { super(code); this.name="HarborHttpError"; }
}
export interface HarborRequestOptions { signal?: AbortSignal }
export interface HarborRunReply { run: HarborRun; plan: HarborPlan; claimedNow?: boolean; replayed?: boolean }
function object(value:unknown):Record<string,unknown> {
  if(!value || typeof value!=="object" || Array.isArray(value)) throw new HarborHttpError('harbor_response_invalid');
  return value as Record<string,unknown>;
}
function runReply(value:unknown):HarborRunReply {
  const raw=object(value),plan=parseHarborPlan(raw.plan),run=parseHarborRun(raw.run,plan);
  for(const key of ['claimedNow','replayed']) if(Object.hasOwn(raw,key) && typeof raw[key]!=="boolean") throw new HarborHttpError('harbor_response_invalid');
  return {plan,run,...(typeof raw.claimedNow==='boolean'?{claimedNow:raw.claimedNow}:{}),...(typeof raw.replayed==='boolean'?{replayed:raw.replayed}:{})};
}
/** Each request is attempted once. A failed mutation response never authorizes execution retry. */
export class HarborClient {
  private readonly endpoint:string;
  constructor(endpoint:string, private readonly apiKey?:string) { this.endpoint=normalizePromptEndpoint(endpoint); }
  private async request(query:URLSearchParams|null, body:unknown|undefined, options:HarborRequestOptions={}) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
    let response:Response;
    try {
      const payload=body===undefined?undefined:JSON.stringify(harborBoundedJson(body,2*1024*1024));
      response=await fetch(this.endpoint+'/api/v1/harbor'+(query?'?'+query:''),{
        method:body===undefined?'GET':'POST',headers:{...(this.apiKey?{authorization:'Bearer '+this.apiKey}:{}),...(payload?{'content-type':'application/json'}:{})},
        body:payload,redirect:'error',signal});
      const reader=response.body?.getReader(); if(!reader) throw new HarborHttpError('harbor_response_invalid');
      const chunks:Uint8Array[]=[];let bytes=0;
      try { for(;;) { const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>8*1024*1024){await reader.cancel();throw new HarborHttpError('harbor_response_too_large');}chunks.push(part.value); } }
      finally {reader.releaseLock();}
      const data=Buffer.concat(chunks),value=object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)));
      if(!response.ok) throw new HarborHttpError(typeof value.error==='string'&&/^[a-zA-Z0-9_:.-]{1,160}$/.test(value.error)?value.error:'harbor_request_rejected',response.status);
      return value;
    } catch(error) { if(error instanceof HarborHttpError) throw error; throw new HarborHttpError('harbor_request_unconfirmed'); }
    finally {clearTimeout(timer);}
  }
  async previewTask(draft:HarborTaskDraft,options?:HarborRequestOptions):Promise<HarborTaskVersion> {
    const task=parseHarborTaskVersion((await this.request(null,{action:'task.preview',draft},options)).task);
    if(task.fingerprint!==prepareHarborTask(task.workspaceId,draft).fingerprint) throw new HarborHttpError('harbor_response_identity_mismatch');return task;
  }
  async saveTask(draft:HarborTaskDraft,previewFingerprint:string,options?:HarborRequestOptions) {
    const raw=await this.request(null,{action:'task.save',draft,previewFingerprint},options),task=parseHarborTaskVersion(raw.task);
    if(task.fingerprint!==previewFingerprint || typeof raw.replayed!=='boolean') throw new HarborHttpError('harbor_response_invalid');
    return {task,replayed:raw.replayed};
  }
  async getTask(taskId:string,versionId:string,options?:HarborRequestOptions) {
    const raw=await this.request(new URLSearchParams({kind:'task',taskId:harborUuid(taskId),versionId:harborUuid(versionId)}),undefined,options);
    const task=parseHarborTaskVersion(raw.task);if(task.taskId!==taskId || task.versionId!==versionId) throw new HarborHttpError('harbor_response_identity_mismatch');return task;
  }
  async previewPlan(draft:HarborPlanDraft,options?:HarborRequestOptions) {
    const plan=parseHarborPlan((await this.request(null,{action:'plan.preview',draft},options)).plan);
    if(stableStringify(plan.draft)!==stableStringify(parseHarborPlanDraft(draft))) throw new HarborHttpError('harbor_response_identity_mismatch');return plan;
  }
  async savePlan(draft:HarborPlanDraft,previewFingerprint:string,options?:HarborRequestOptions) {
    const raw=await this.request(null,{action:'plan.save',draft,previewFingerprint},options),plan=parseHarborPlan(raw.plan);
    if(plan.fingerprint!==previewFingerprint || typeof raw.replayed!=='boolean') throw new HarborHttpError('harbor_response_invalid');return {plan,replayed:raw.replayed};
  }
  async getPlan(planId:string,options?:HarborRequestOptions) {
    const plan=parseHarborPlan((await this.request(new URLSearchParams({kind:'plan',planId:harborUuid(planId)}),undefined,options)).plan);
    if(plan.draft.planId!==planId) throw new HarborHttpError('harbor_response_identity_mismatch');return plan;
  }
  async getRun(runId:string,options?:HarborRequestOptions) {
    const reply=runReply(await this.request(new URLSearchParams({kind:'run',runId:harborUuid(runId)}),undefined,options));
    if(reply.run.runId!==runId) throw new HarborHttpError('harbor_response_identity_mismatch');return reply;
  }
  async startRun(plan:HarborPlan,runId:string,options?:HarborRequestOptions) {
    plan=parseHarborPlan(plan);const reply=runReply(await this.request(null,{action:'run.start',planId:plan.draft.planId,planFingerprint:plan.fingerprint,runId:harborUuid(runId)},options));
    if(reply.run.runId!==runId || reply.plan.fingerprint!==plan.fingerprint) throw new HarborHttpError('harbor_response_identity_mismatch');return reply;
  }
  async claimTask(runId:string,versionId:string,claimId:string,options?:HarborRequestOptions) {
    const reply=runReply(await this.request(null,{action:'run.claim',runId:harborUuid(runId),versionId:harborUuid(versionId),claimId:harborUuid(claimId)},options));
    const row=reply.run.rows.find(row=>row.versionId===versionId);
    if(reply.run.runId!==runId || !row || row.claimId!==claimId || typeof reply.claimedNow!=='boolean') throw new HarborHttpError('harbor_response_identity_mismatch');return reply;
  }
  async completeTask(runId:string,versionId:string,claimId:string,result:HarborResult,options?:HarborRequestOptions) {
    const reply=runReply(await this.request(null,{action:'run.complete',runId:harborUuid(runId),versionId:harborUuid(versionId),claimId:harborUuid(claimId),result},options));
    const row=reply.run.rows.find(row=>row.versionId===versionId);
    if(reply.run.runId!==runId || !row || row.claimId!==claimId || !row.result || stableStringify(row.result)!==stableStringify(result)) throw new HarborHttpError('harbor_response_identity_mismatch');return reply;
  }
  async recoverRun(runId:string,options?:HarborRequestOptions) {
    const reply=runReply(await this.request(null,{action:'run.recover',runId:harborUuid(runId)},options));
    if(reply.run.runId!==runId) throw new HarborHttpError('harbor_response_identity_mismatch');return reply;
  }
}

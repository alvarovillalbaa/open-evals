import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { HarborClient, HarborHttpError, normalizePromptEndpoint } from "@open-evals/sdk";
import { harborUuid, parseHarborResult, type HarborPlan, type HarborResult } from "@open-evals/core";
import type { CliContext } from "./program";

const PROVIDERS=new Set(['OPENAI_API_KEY','ANTHROPIC_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY','MISTRAL_API_KEY','OPENROUTER_API_KEY']);
class HarborCliError extends Error { constructor(readonly code:string) {super(code);} }
const fail=(code:string):never=>{throw new HarborCliError(code);};
async function readJson(path:string, maximum=32768):Promise<unknown> {
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {const stat=await file.stat();if(!stat.isFile() || stat.nlink!==1 || stat.size<1 || stat.size>maximum) return fail('harbor_file_invalid');
    const bytes=await file.readFile();if(bytes.length!==stat.size) return fail('harbor_file_changed');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  finally {await file.close();}
}
async function writeJson(path:string,value:unknown) {
  const bytes=JSON.stringify(value,null,2)+'\n';
  if(Buffer.byteLength(bytes)>8*1024*1024) return fail('harbor_file_limit');
  const file=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try {await file.writeFile(bytes);await file.sync();} finally {await file.close();}
}
function childEnvironment(env:Readonly<Record<string,string|undefined>>, selected:string[]) {
  const result:Record<string,string>={HARBOR_TELEMETRY:'0',PYTHONDONTWRITEBYTECODE:'1'};
  for(const name of ['PATH','HOME','LANG','LC_ALL','TZ','TMPDIR','SSL_CERT_FILE','SSL_CERT_DIR',...selected]) if(env[name]) result[name]=env[name]!;
  return result;
}
async function native(python:string,args:string[],cwd:string,env:Record<string,string>,timeoutMs:number) {
  return new Promise<{exitCode:number|null;stdout:string}>((resolvePromise,reject)=>{
    const child=spawn(python,['-m','open_evals_harbor.cli',...args],{cwd,env,stdio:['ignore','pipe','pipe'],detached:true});
    const chunks:Buffer[]=[];let bytes=0,failed=false,term:ReturnType<typeof setTimeout>|undefined,kill:ReturnType<typeof setTimeout>|undefined;
    const signal=(name:NodeJS.Signals)=>{if(child.pid)try{process.kill(-child.pid,name);}catch{}};
    const end=()=>{if(failed)return;failed=true;signal('SIGINT');term=setTimeout(()=>signal('SIGTERM'),3000);kill=setTimeout(()=>signal('SIGKILL'),6000);};
    const timer=setTimeout(end,timeoutMs);
    const collect=(part:Buffer,retain:boolean)=>{bytes+=part.length;if(bytes>131072){end();return;}if(retain)chunks.push(part);};
    child.stdout.on('data',part=>collect(part,true));child.stderr.on('data',part=>collect(part,false));
    child.on('error',()=>{clearTimeout(timer);clearTimeout(term);clearTimeout(kill);reject(new HarborCliError('harbor_native_unavailable'));});
    child.on('close',code=>{clearTimeout(timer);clearTimeout(term);clearTimeout(kill);
      if(failed)reject(new HarborCliError('harbor_native_unconfirmed'));else resolvePromise({exitCode:code,stdout:Buffer.concat(chunks).toString('utf8')});});
  });
}
function redacted(raw:unknown,plan:HarborPlan,versionId:string,executionId:string):HarborResult {
  if(!raw || typeof raw!=='object' || Array.isArray(raw)) return fail('harbor_native_report_invalid');
  const source=raw as Record<string,unknown>,task=plan.tasks.find(t=>t.versionId===versionId);
  if(!task || source.executionId!==executionId || source.bundleFingerprint!==task.bundle.fingerprint || source.runtime!==task.bundle.runtime
    || source.executed!==true || source.reportAuthority!=='local-runner') return fail('harbor_native_report_invalid');
  const names=['nativeTrialId','nativeResultSha256','nativeChecksum','nativeAgent','startedAt','finishedAt','rewards','exceptionType'];
  const result:Record<string,unknown>={schemaVersion:'harbor-result-v1',executionId,bundleFingerprint:source.bundleFingerprint,runtime:source.runtime,
    agent:source.agent,outcome:source.outcome,nativeRewardValid:source.nativeRewardValid??false,errorCode:source.error??null};
  for(const name of names) result[name]=source.outcome==='unknown'?null:source[name]??null;
  return parseHarborResult(result,task.bundle,plan.draft.agent,executionId);
}
const specs:Record<string,{values:string[];required:string[];execute?:boolean}>={
  pack:{values:['--task','--out','--python-bin'],required:['--task','--out']},
  run:{values:['--plan-id','--run-id','--journal-dir','--docker-socket','--provider-env','--python-bin','--endpoint'],required:['--plan-id'],execute:true},
  status:{values:['--run-id','--endpoint'],required:['--run-id']},
  report:{values:['--run-id','--version-id','--claim-id','--file','--endpoint'],required:['--run-id','--version-id','--claim-id','--file']}
};
export async function runHarborCli(args:readonly string[],context:CliContext):Promise<number> {
  const output=(value:unknown)=>context.stdout(JSON.stringify(value,null,2)+'\n');
  try {
    if(!args.length || args[0]==='--help') {output({commands:['harbor pack --task DIR --out bundle.json [--python-bin PATH]',
      'harbor run --plan-id UUID [--execute --run-id UUID --journal-dir DIR --docker-socket PATH --python-bin PATH --provider-env NAME,NAME]',
      'harbor status --run-id UUID','harbor report --run-id UUID --version-id UUID --claim-id UUID --file result.json'],
      notes:['Preview is the default. Saving a plan shares source with its selected project keys.','Use OPEN_EVALS_URL and OPEN_EVALS_API_KEY; neither is forwarded to Harbor.',
        'Execution uses an already installed open-evals-harbor[runtime] package. No automatic installation or execution retry.','A lost claim response requires status/recovery, not another dispatch.']});return 0;}
    const command=args[0]!,spec=specs[command];if(!spec)return fail('harbor_command_invalid');
    const flags=new Map<string,string>();let execute=false;
    for(let i=1;i<args.length;i++) {
      const flag=args[i]!;if(flag==='--json')continue;
      if(flag==='--execute' && spec.execute){if(execute)return fail('harbor_duplicate_flag');execute=true;continue;}
      if(!spec.values.includes(flag) || flags.has(flag) || !args[i+1] || args[i+1]!.startsWith('--'))return fail('harbor_flag_invalid');
      flags.set(flag,args[++i]!);
    }
    for(const flag of spec.required)if(!flags.has(flag))return fail('harbor_missing_flag');
    const env=context.env??process.env,python=flags.get('--python-bin')??'python3';
    if(command==='pack') {
      const result=await native(python,['pack','--task',resolve(flags.get('--task')!),'--out',resolve(flags.get('--out')!)],process.cwd(),childEnvironment(env,[]),30000);
      if(result.exitCode!==0)return fail('harbor_pack_failed');output(JSON.parse(result.stdout));return 0;
    }
    const endpoint=normalizePromptEndpoint(flags.get('--endpoint')??env.OPEN_EVALS_URL??'http://127.0.0.1:3216');
    const client=new HarborClient(endpoint,env.OPEN_EVALS_API_KEY);
    if(command==='status'){output(await client.getRun(harborUuid(flags.get('--run-id'))));return 0;}
    if(command==='report') {
      const runId=harborUuid(flags.get('--run-id')),versionId=harborUuid(flags.get('--version-id')),claimId=harborUuid(flags.get('--claim-id'));
      const saved=await client.getRun(runId),index=saved.run.rows.findIndex(row=>row.versionId===versionId),row=saved.run.rows[index];
      if(!row || row.claimId!==claimId)return fail('harbor_claim_mismatch');
      const result=parseHarborResult(await readJson(flags.get('--file')!),saved.plan.tasks[index]!.bundle,saved.plan.draft.agent,row.executionId);
      output(await client.completeTask(runId,versionId,claimId,result));return 0;
    }
    const plan=await client.getPlan(harborUuid(flags.get('--plan-id')));
    if(!execute) {output({executed:false,planId:plan.draft.planId,planFingerprint:plan.fingerprint,agent:plan.draft.agent,reward:plan.draft.reward,
      taskTimeoutSeconds:plan.draft.taskTimeoutSeconds,tasks:plan.tasks.map(t=>({taskId:t.taskId,versionId:t.versionId,name:t.name,bundleFingerprint:t.bundle.fingerprint}))});return 0;}
    if(process.platform==='win32')return fail('harbor_posix_runner_required');
    for(const flag of ['--run-id','--journal-dir','--docker-socket'])if(!flags.has(flag))return fail('harbor_execution_flag_required');
    const selected=flags.get('--provider-env')?.split(',')??[];
    if(selected.length>6 || new Set(selected).size!==selected.length || selected.some(name=>!PROVIDERS.has(name) || !env[name])
      || plan.draft.agent.kind==='reference' && selected.length || plan.draft.agent.kind==='model' && !selected.length)return fail('harbor_provider_selection_invalid');
    const parent=resolve(flags.get('--journal-dir')!),parentInfo=await lstat(parent);
    if(!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || parentInfo.uid!==process.getuid?.())return fail('harbor_journal_directory_invalid');
    const runId=harborUuid(flags.get('--run-id')),directory=join(await realpath(parent),'harbor-run-'+runId);
    await mkdir(directory,{mode:0o700});
    await writeJson(join(directory,'reservation.json'),{endpoint,runId,planId:plan.draft.planId,planFingerprint:plan.fingerprint,state:'reservation_unconfirmed'});
    const reserved=await client.startRun(plan,runId);
    await writeJson(join(directory,'reserved.json'),reserved);
    if(reserved.replayed)return fail('harbor_existing_reservation_read_only');
    for(const task of plan.tasks) {
      const claimId=randomUUID(),row=reserved.run.rows.find(r=>r.versionId===task.versionId)!;
      const taskRoot=join(directory,task.versionId);await mkdir(taskRoot,{mode:0o700});
      const bundlePath=join(taskRoot,'bundle.json');await writeJson(bundlePath,task.bundle);
      await writeJson(join(taskRoot,'claim.json'),{runId,versionId:task.versionId,executionId:row.executionId,claimId,state:'claim_unconfirmed'});
      const claimed=await client.claimTask(runId,task.versionId,claimId);
      await writeJson(join(taskRoot,'claimed.json'),claimed);
      if(!claimed.claimedNow)return fail('harbor_claim_not_new');
      const nativeArgs=['run','--bundle',bundlePath,'--execution-id',row.executionId,'--agent',plan.draft.agent.name,
        '--timeout-seconds',String(plan.draft.taskTimeoutSeconds),'--work-root',taskRoot,'--docker-socket',resolve(flags.get('--docker-socket')!),'--execute'];
      if(plan.draft.agent.model)nativeArgs.push('--model',plan.draft.agent.model);
      for(const name of selected)nativeArgs.push('--provider-env',name);
      const observed=await native(python,nativeArgs,taskRoot,childEnvironment(env,selected),(plan.draft.taskTimeoutSeconds+15)*1000);
      const result=redacted(JSON.parse(observed.stdout),plan,task.versionId,row.executionId);
      if(observed.exitCode!==0 && result.outcome!=='unknown')return fail('harbor_native_report_invalid');
      await writeJson(join(taskRoot,'result.json'),result);
      const completed=await client.completeTask(runId,task.versionId,claimId,result);
      await writeJson(join(taskRoot,'receipt.json'),completed);
      if(result.outcome==='unknown')return fail('harbor_execution_unknown_recovery_required');
    }
    output(await client.getRun(runId));return 0;
  } catch(error) {
    const code=error instanceof HarborCliError || error instanceof HarborHttpError?error.code:'harbor_command_unconfirmed';
    context.stderr(JSON.stringify({ok:false,error:code,executionRetryAuthorized:false})+'\n');return 1;
  }
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { HarborPlan, HarborPlanDraft, HarborRun, HarborTaskBundle, HarborTaskDraft, HarborTaskVersion } from "@open-evals/core";
import { Panel } from "../../components";

type TaskSummary={taskId:string;versionId:string;version:number;name:string;fingerprint:string;nativeTaskName:string;nativeTaskVersion:string;bundleFingerprint:string};
type PlanSummary={planId:string;name:string;projectId:string;fingerprint:string;createdAt:string};
type RunSummary={runId:string;status:string;fingerprint:string;createdAt:string};
type Catalog={tasks:{versions:TaskSummary[];hasMore:boolean};plans:{plans:PlanSummary[];hasMore:boolean};projects:{projects:Array<{id:string;name:string;environment:string}>;hasMore:boolean};canWrite:boolean};
const input="w-full min-w-0 rounded-md border border-border bg-panel px-3 py-2 text-sm";
const button="min-h-10 rounded-md border border-border bg-panel px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const primary=button+" bg-foreground text-background hover:opacity-90";
async function request<T>(query:string,body?:unknown):Promise<T> {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try {
    const response=await fetch('/api/v1/harbor'+query,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store',redirect:'error',signal:controller.signal});
    const reader=response.body?.getReader();if(!reader)throw new Error('harbor_response_invalid');
    const chunks:Uint8Array[]=[];let count=0;
    try {for(;;){const part=await reader.read();if(part.done)break;count+=part.value.length;if(count>8*1024*1024){await reader.cancel();throw new Error('harbor_response_too_large');}chunks.push(part.value);}}
    finally {reader.releaseLock();}
    const bytes=new Uint8Array(count);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!response.ok)throw new Error(typeof result.error==='string'&&/^[a-zA-Z0-9_:.-]{1,160}$/.test(result.error)?result.error:'harbor_request_failed');
    return result as T;
  } finally {clearTimeout(timer);}
}
function message(error:unknown) {
  const code=error instanceof Error?error.message:'';
  if(code==='authentication_required')return 'Sign in to your workspace to use Harbor tasks.';
  if(code==='database_unavailable')return 'The workspace database is unavailable. Your unsaved draft is still here.';
  if(code==='harbor_origin_forbidden')return 'The request address could not be verified. Your unsaved draft is still here.';
  if(code==='harbor_task_head_changed')return 'A newer task version was saved. Keep your draft, then inspect the latest version before making a new one.';
  if(code==='harbor_workspace_session_required')return 'Use a workspace session to author tasks and plans. Project keys can read and run their own plans.';
  return /^[a-zA-Z0-9_:.-]{1,160}$/.test(code)?code.replaceAll('_',' '):'The response is unconfirmed. Keep this draft and check saved history before starting another action.';
}
export function HarborWorkbench() {
  const [catalog,setCatalog]=useState<Catalog>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const lock=useRef(false);
  const [bundle,setBundle]=useState<HarborTaskBundle>(),[taskName,setTaskName]=useState(''),[taskIdentity,setTaskIdentity]=useState<{taskId:string;versionId:string;version:number;expectedVersionId:string|null}>();
  const [taskPreview,setTaskPreview]=useState<{draft:HarborTaskDraft;task:HarborTaskVersion}>(),[inspectedTask,setInspectedTask]=useState<HarborTaskVersion>();
  const [selected,setSelected]=useState<string[]>([]),[planName,setPlanName]=useState(''),[projectId,setProjectId]=useState(''),[agentName,setAgentName]=useState('nop'),[model,setModel]=useState('');
  const [rewardKey,setRewardKey]=useState('reward'),[minimum,setMinimum]=useState('1'),[seconds,setSeconds]=useState('180'),[sharing,setSharing]=useState(false);
  const [planIdentity,setPlanIdentity]=useState(''),[planPreview,setPlanPreview]=useState<{draft:HarborPlanDraft;plan:HarborPlan}>();
  const [savedPlan,setSavedPlan]=useState<HarborPlan>(),[runs,setRuns]=useState<RunSummary[]>([]),[run,setRun]=useState<HarborRun>(),[commandRunId,setCommandRunId]=useState('');
  const writable=catalog?.canWrite===true;
  async function perform(work:()=>Promise<void>) {
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');
    try {await work();}catch(error){setError(message(error));}finally{lock.current=false;setBusy(false);}
  }
  async function refreshCatalog(){setCatalog(await request<Catalog>('?kind=catalog'));}
  async function openPlan(id:string,runId?:string) {
    const result=await request<{plan:HarborPlan}>('?kind=plan&planId='+encodeURIComponent(id));setSavedPlan(result.plan);setCommandRunId(crypto.randomUUID());setRun(undefined);
    const history=await request<{runs:RunSummary[]}>('?kind=runs&planId='+encodeURIComponent(id));setRuns(history.runs);
    if(runId){const detail=await request<{run:HarborRun;plan:HarborPlan}>('?kind=run&runId='+encodeURIComponent(runId));if(detail.plan.fingerprint!==result.plan.fingerprint || detail.run.planId!==id)throw new Error('harbor_run_identity_mismatch');setRun(detail.run);}
    window.history.replaceState(null,'','/evals/harbor?planId='+encodeURIComponent(id)+(runId?'&runId='+encodeURIComponent(runId):''));
  }
  useEffect(()=>{void perform(async()=>{await refreshCatalog();const query=new URLSearchParams(window.location.search);const planId=query.get('planId');if(planId)await openPlan(planId,query.get('runId')??undefined);});},[]);
  function invalidatePlan(){setPlanPreview(undefined);}
  function newTask(){setBundle(undefined);setTaskName('');setTaskIdentity(undefined);setTaskPreview(undefined);setInspectedTask(undefined);setNotice('Choose a bundle to start a new task.');}
  async function inspectTask(summary:TaskSummary,edit=false) {
    const result=await request<{task:HarborTaskVersion}>('?kind=task&taskId='+summary.taskId+'&versionId='+summary.versionId);setInspectedTask(result.task);
    if(edit){setBundle(result.task.bundle);setTaskName(result.task.name);setTaskIdentity({taskId:result.task.taskId,versionId:crypto.randomUUID(),version:result.task.version+1,expectedVersionId:result.task.versionId});setTaskPreview(undefined);}
  }
  return <div className="grid min-w-0 gap-6">
    <div aria-live="polite" className="min-w-0">{busy?<p role="status" className="text-sm text-muted-foreground">Working…</p>:null}{error?<p role="alert" className="break-words text-sm text-danger">{error}{error.startsWith('Sign in to your workspace')?<a className="ml-1 underline" href="/login">Sign in</a>:null}</p>:null}{notice?<p role="status" className="text-sm">{notice}</p>:null}</div>
    {!catalog?<div className="grid gap-3 border border-border p-4"><p className="text-sm">Load your saved tasks, plans and projects.</p><button className={button} disabled={busy} onClick={()=>void perform(refreshCatalog)}>Load workspace</button></div>:<>
      {!writable?<p className="border border-border bg-muted p-3 text-sm">Read-only access. A workspace editor can save tasks and plans.</p>:null}
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-2">
        <Panel title="Import and version a task"><div className="grid min-w-0 gap-4">
          <p className="text-sm text-muted-foreground">Create a JSON bundle with <code>open-evals-harbor pack --task DIR --out bundle.json</code>. Supported: Harbor 0.25.0, schema 1.4, one Linux Dockerfile task and shared verifier. Source is stored; it is never executed here.</p>
          <label className="grid gap-1 text-sm">Task bundle<input className={input} type="file" accept="application/json,.json" disabled={!writable||busy} onChange={event=>{const file=event.currentTarget.files?.[0];if(!file)return;void perform(async()=>{
            setTaskPreview(undefined);if(file.size<1||file.size>1536*1024)throw new Error('harbor_bundle_file_limit');
            const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer())) as HarborTaskBundle;
            setBundle(data);if(!taskIdentity)setTaskIdentity({taskId:crypto.randomUUID(),versionId:crypto.randomUUID(),version:1,expectedVersionId:null});
            if(!taskName && typeof data.taskName==='string')setTaskName(data.taskName);setNotice('Bundle loaded. Preview validates its bytes before saving.');
          });}} /></label>
          <label className="grid gap-1 text-sm">Task name<input className={input} maxLength={160} value={taskName} disabled={!writable||busy} onChange={event=>{setTaskName(event.target.value);setTaskPreview(undefined);}} /></label>
          <p className="text-xs text-muted-foreground">{taskIdentity?`Version ${taskIdentity.version} · ${taskIdentity.taskId}`:'New task'}</p>
          <div className="flex flex-wrap gap-2"><button className={button} disabled={!writable||busy||!bundle||!taskIdentity||!taskName.trim()} onClick={()=>void perform(async()=>{
            const draft:HarborTaskDraft={...taskIdentity!,name:taskName,bundle:bundle!};const result=await request<{task:HarborTaskVersion}>('',{action:'task.preview',draft});setTaskPreview({draft,task:result.task});
          })}>Preview task</button><button className={button} disabled={busy} onClick={newTask}>Start new task</button></div>
          {taskPreview?<div className="grid min-w-0 gap-3 border border-border bg-muted p-3" aria-label="Task preview"><p className="text-sm">{taskPreview.task.bundle.taskName} · {taskPreview.task.bundle.taskVersion} · {taskPreview.task.bundle.files.length} files</p><p className="break-all font-mono text-xs">{taskPreview.task.fingerprint}</p><p className="text-xs">Bytes verified. Native execution has not been verified by this save.</p><button className={primary} disabled={busy||!writable} onClick={()=>void perform(async()=>{
            const result=await request<{task:HarborTaskVersion;replayed:boolean}>('',{action:'task.save',draft:taskPreview.draft,previewFingerprint:taskPreview.task.fingerprint});
            setInspectedTask(result.task);setTaskIdentity({taskId:result.task.taskId,versionId:crypto.randomUUID(),version:result.task.version+1,expectedVersionId:result.task.versionId});setTaskPreview(undefined);await refreshCatalog();setNotice(result.replayed?'The identical task version was already saved.':'Task version saved.');
          })}>Save task version</button></div>:null}
          <h2 className="text-sm font-semibold">Saved task versions</h2>
          {!catalog.tasks.versions.length?<p className="text-sm text-muted-foreground">No Harbor task versions saved yet.</p>:<ul className="grid min-w-0 gap-3">{catalog.tasks.versions.map(task=><li className="grid min-w-0 gap-2 border border-border p-3" key={task.versionId}><p className="break-words text-sm font-medium">{task.name} · v{task.version}</p><p className="break-all text-xs text-muted-foreground">{task.nativeTaskName} · {task.nativeTaskVersion}</p><div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>void perform(()=>inspectTask(task))}>Inspect version</button><button className={button} disabled={busy||!writable} onClick={()=>void perform(()=>inspectTask(task,true))}>New version from v{task.version}</button></div></li>)}</ul>}
          {catalog.tasks.hasMore?<p className="text-xs">Showing the first 100 saved versions.</p>:null}
          {inspectedTask?<details open className="min-w-0 border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Version {inspectedTask.version} source manifest</summary><p className="mt-2 break-all font-mono text-xs">{inspectedTask.versionId}<br/>{inspectedTask.bundle.fingerprint}</p><ul className="mt-3 grid gap-2 text-xs">{inspectedTask.bundle.files.map(file=><li className="min-w-0 break-all" key={file.path}><strong>{file.path}</strong> · {file.bytes} bytes · {file.mode}<br/><span className="text-muted-foreground">{file.sha256}</span></li>)}</ul></details>:null}
        </div></Panel>
        <Panel title="Create an exact-source plan"><div className="grid min-w-0 gap-4">
          <label className="grid gap-1 text-sm">Plan name<input className={input} value={planName} maxLength={160} disabled={busy||!writable} onChange={event=>{setPlanName(event.target.value);invalidatePlan();}} /></label>
          <label className="grid gap-1 text-sm">Project<select className={input} value={projectId} disabled={busy||!writable} onChange={event=>{setProjectId(event.target.value);setSharing(false);invalidatePlan();}}><option value="">Select an existing project</option>{catalog.projects.projects.map(project=><option key={project.id} value={project.id}>{project.name} · {project.environment}</option>)}</select></label>
          {!catalog.projects.projects.length?<p className="text-sm text-muted-foreground">No existing projects are available. Create a project through your normal workspace setup before sharing task source.</p>:null}
          <fieldset className="grid min-w-0 gap-2" disabled={busy||!writable}><legend className="mb-2 text-sm font-medium">Exact task versions · up to 4</legend>{catalog.tasks.versions.map(task=><label className="flex min-w-0 items-start gap-2 text-sm" key={task.versionId}><input type="checkbox" className="mt-1" checked={selected.includes(task.versionId)} disabled={!selected.includes(task.versionId)&&selected.length>=4} onChange={event=>{setSelected(event.target.checked?[...selected,task.versionId]:selected.filter(id=>id!==task.versionId));invalidatePlan();}}/><span className="min-w-0 break-words">{task.name} · v{task.version}<span className="block break-all font-mono text-xs text-muted-foreground">{task.versionId}</span></span></label>)}</fieldset>
          <label className="grid gap-1 text-sm">Harbor agent<input className={input} value={agentName} disabled={busy||!writable} onChange={event=>{setAgentName(event.target.value);invalidatePlan();}} /></label><p className="text-xs text-muted-foreground">Use oracle or nop to verify a task without a model. A model agent requires an explicit model and local provider selection.</p>
          {!['oracle','nop'].includes(agentName)?<label className="grid gap-1 text-sm">Provider/model<input className={input} value={model} disabled={busy||!writable} onChange={event=>{setModel(event.target.value);invalidatePlan();}} /></label>:null}
          <div className="grid min-w-0 gap-3 sm:grid-cols-3"><label className="grid min-w-0 gap-1 text-sm">Reward key<input className={input} value={rewardKey} disabled={busy||!writable} onChange={event=>{setRewardKey(event.target.value);invalidatePlan();}}/></label><label className="grid min-w-0 gap-1 text-sm">Minimum reward<input className={input} type="number" value={minimum} disabled={busy||!writable} onChange={event=>{setMinimum(event.target.value);invalidatePlan();}}/></label><label className="grid min-w-0 gap-1 text-sm">Seconds per task<input className={input} type="number" min={1} max={900} step={1} value={seconds} disabled={busy||!writable} onChange={event=>{setSeconds(event.target.value);invalidatePlan();}}/></label></div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={sharing} disabled={busy||!writable} onChange={event=>{setSharing(event.target.checked);invalidatePlan();}}/><span>Share the selected task source with this project’s API keys when I save the plan.</span></label>
          <button className={button} disabled={busy||!writable||!sharing||!projectId||!selected.length||!planName.trim()||!minimum.trim()||!seconds.trim()} onClick={()=>void perform(async()=>{
            const id=planIdentity||crypto.randomUUID();setPlanIdentity(id);const reference=['oracle','nop'].includes(agentName);
            const draft:HarborPlanDraft={planId:id,name:planName,projectId,tasks:selected.map(id=>{const row=catalog.tasks.versions.find(t=>t.versionId===id)!;return {taskId:row.taskId,versionId:row.versionId,fingerprint:row.fingerprint};}),agent:{name:agentName,model:reference?null:model,kind:reference?'reference':'model'},reward:{key:rewardKey,minimum:Number(minimum)},taskTimeoutSeconds:Number(seconds)};
            const result=await request<{plan:HarborPlan}>('',{action:'plan.preview',draft});setPlanPreview({draft,plan:result.plan});
          })}>Preview plan</button>
          {planPreview?<div className="grid min-w-0 gap-3 border border-border bg-muted p-3" aria-label="Plan preview"><p className="text-sm">{planPreview.plan.tasks.length} task versions · {planPreview.plan.draft.agent.name} · {planPreview.plan.draft.taskTimeoutSeconds}s per task</p><p className="text-sm">Pass rule: {planPreview.plan.draft.reward.key} ≥ {planPreview.plan.draft.reward.minimum}</p><p className="break-all font-mono text-xs">{planPreview.plan.fingerprint}</p><p className="text-xs">Saving shares the frozen source with project {planPreview.plan.draft.projectId}. No task is launched.</p><button className={primary} disabled={busy||!writable||!sharing} onClick={()=>void perform(async()=>{
            const result=await request<{plan:HarborPlan;replayed:boolean}>('',{action:'plan.save',draft:planPreview.draft,previewFingerprint:planPreview.plan.fingerprint});setPlanPreview(undefined);setPlanIdentity('');await refreshCatalog();await openPlan(result.plan.draft.planId);setNotice(result.replayed?'The identical plan was already saved.':'Plan saved. Preview it with the CLI before explicit execution.');
          })}>Save shared plan</button></div>:null}
          <h2 className="text-sm font-semibold">Saved plans</h2>{!catalog.plans.plans.length?<p className="text-sm text-muted-foreground">No Harbor plans saved yet.</p>:<ul className="grid gap-2">{catalog.plans.plans.map(plan=><li key={plan.planId}><button className={button+' w-full break-words text-left'} disabled={busy} onClick={()=>void perform(()=>openPlan(plan.planId))}>{plan.name}</button></li>)}</ul>}
          {catalog.plans.hasMore?<p className="text-xs">Showing the first 100 saved plans.</p>:null}
        </div></Panel>
      </div>
      {savedPlan?<Panel title={savedPlan.draft.name}><div className="grid min-w-0 gap-4"><p className="break-all font-mono text-xs">Plan {savedPlan.draft.planId}<br/>{savedPlan.fingerprint}</p>
        <p className="text-sm">From the repository root, preview using your project key in OPEN_EVALS_API_KEY and this app’s URL in OPEN_EVALS_URL. <a className="underline" target="_blank" rel="noreferrer" href="https://github.com/alvarovillalbaa/open-evals/blob/main/docs/runbooks/harbor-tasks.md">CLI setup guide</a></p>
        <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">{`node apps/cli/bin/open-evals.mjs harbor run --plan-id ${savedPlan.draft.planId}`}</pre>
        <p className="text-sm">After reviewing the plan, explicitly execute with the separately installed Python runtime and local Docker. The journal directory must already exist. Keep it for result recovery.</p>
        <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">{`node apps/cli/bin/open-evals.mjs harbor run --plan-id ${savedPlan.draft.planId} --execute --run-id ${commandRunId} --journal-dir ./harbor-runs --docker-socket /var/run/docker.sock --python-bin "$PWD/.venv-harbor/bin/python"`}</pre>
        <p className="text-xs text-muted-foreground">Model plans also require --provider-env with selected provider variable names. OpenEvals credentials are excluded from the Harbor environment. Interrupted dispatch is recorded as unknown; it is never retried automatically.</p>
        <button className={button} disabled={busy} onClick={()=>void perform(()=>openPlan(savedPlan.draft.planId,run?.runId))}>Refresh saved runs</button>
        {!runs.length?<p className="text-sm text-muted-foreground">No runs have been reserved for this plan.</p>:<ul className="grid min-w-0 gap-2">{runs.map(row=><li key={row.runId}><button className={button+' w-full break-all text-left'} disabled={busy} onClick={()=>void perform(()=>openPlan(savedPlan.draft.planId,row.runId))}>{row.status} · {row.runId}</button></li>)}</ul>}
        {run?<div className="grid min-w-0 gap-3" aria-label="Saved Harbor run"><h2 className="text-base font-semibold">Run {run.status}</h2><p className="break-all text-xs">{run.runId}</p><p className="text-xs text-muted-foreground">These are local-runner reports, not remote attestation. Reference agents verify the task, not model quality.</p>{run.rows.map(row=><div className="grid min-w-0 gap-2 border border-border p-3" key={row.versionId}><p className="break-all text-sm">{row.versionId}</p><p className="text-sm">{row.status}{row.result?' · '+row.result.outcome:''} · {row.qualityPassed===null?'No quality decision':row.qualityPassed?'Reward rule passed':'Reward rule failed'}</p>{row.result?.rewards?<pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(row.result.rewards)}</pre>:null}{row.result?.nativeResultSha256?<p className="break-all font-mono text-xs">Result SHA-256: {row.result.nativeResultSha256}</p>:null}{row.result?.exceptionType||row.result?.errorCode?<p className="break-words text-xs">{row.result.exceptionType??row.result.errorCode}</p>:null}</div>)}{writable&&run.rows.some(row=>row.status==='pending'||row.status==='claimed')?<div className="grid gap-2 border border-border bg-muted p-3"><p className="text-sm">If the local runner has stopped, mark outstanding claims unknown and unsent tasks not sent. This closes this run without dispatching anything.</p><button className={button} disabled={busy} onClick={()=>void perform(async()=>{await request('',{action:'run.recover',runId:run.runId});await openPlan(savedPlan.draft.planId,run.runId);setNotice('Interrupted run closed. No task was retried.');})}>Close interrupted run</button></div>:null}</div>:null}
      </div></Panel>:null}
    </>}
  </div>;
}

import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createHarborFixture} from '../helpers/harbor-api-fixture.mjs';
let fixture,planId;
const observations=new WeakMap();
const sourceBundle=resolve('tests/fixtures/harbor-recorded-bundle.json');
test.describe.configure({mode:'serial'});
test.beforeAll(async()=>{fixture=await createHarborFixture();});
test.afterAll(async()=>{await fixture?.close();});
async function surface(browser,width,cookie=fixture.cookies.owner) {
  const context=await browser.newContext({viewport:{width,height:950}}),endpoint=fixture.endpoint;
  await context.addCookies([{name:'open_evals_session',value:cookie.slice('open_evals_session='.length),url:endpoint,httpOnly:true,sameSite:'Lax'}]);
  await context.route('**/*',route=>new URL(route.request().url()).origin===endpoint?route.continue():route.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const observation={page,errors,responses:[],pending:[]};observations.set(context,observation);
  page.on('response',response=>{
    if(new URL(response.url()).pathname!=='/api/v1/harbor')return;
    observation.pending.push((async()=>{let body;try{body=await response.json();}catch{}const request=response.request();let action;try{action=request.postDataJSON()?.action;}catch{}
      observation.responses.push({status:response.status(),method:request.method(),action:action??null,error:typeof body?.error==='string'?body.error:null,taskPreview:!!body?.task,planPreview:!!body?.plan});})());
  });
  return {context,page,errors};
}
async function dispose(context,suffix='') {
  const observation=observations.get(context),id=test.info().title.split(' ')[0]+suffix;
  try {
    await Promise.allSettled(observation.pending);
    const page=observation.page;
    if(page.isClosed()){await writeFile(join(process.env.HARBOR_PROOF,'browser-'+id+'-diagnostics.json'),JSON.stringify({pageClosedBeforeCapture:true,pageErrors:observation.errors,responses:observation.responses})+'\n');return;}
    await writeFile(join(process.env.HARBOR_PROOF,'browser-'+id+'-diagnostics.json'),JSON.stringify({url:page.url(),pageErrors:observation.errors,
      responses:observation.responses,alerts:await page.getByRole('alert').allTextContents(),selects:await page.locator('select').evaluateAll(elements=>elements.map(element=>({value:element.value,options:[...element.options].map(option=>({label:option.label,value:option.value,selected:option.selected}))}))),body:(await page.locator('body').innerText()).slice(0,20000)},null,2)+'\n');
    await page.screenshot({path:join(process.env.HARBOR_PROOF,'browser-'+id+'-last.png'),fullPage:true});
  } finally {if(!observation.page.isClosed())await context.close();}
}
async function snapshot(page,id){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);await page.screenshot({path:join(process.env.HARBOR_PROOF,'browser-'+id+'.png'),fullPage:true});}
test('HB-B01 desktop imports, saves and versions authored task bytes',async({browser})=>{
  const {context,page,errors}=await surface(browser,1440);
  try {
    await page.goto(fixture.endpoint+'/evals/harbor');await expect(page.getByText('No Harbor task versions saved yet.')).toBeVisible();
    await page.getByLabel('Task bundle',{exact:true}).setInputFiles(sourceBundle);await page.getByLabel('Task name',{exact:true}).fill('Browser task');
    await page.getByRole('button',{name:'Preview task',exact:true}).click();await expect(page.getByLabel('Task preview')).toBeVisible();await page.getByRole('button',{name:'Save task version',exact:true}).click();await expect(page.getByText('Task version saved.',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'New version from v1',exact:true}).click();await page.getByLabel('Task name',{exact:true}).fill('Browser task revised');await page.getByRole('button',{name:'Preview task',exact:true}).click();await page.getByRole('button',{name:'Save task version',exact:true}).click();await expect(page.getByRole('button',{name:'New version from v2',exact:true})).toBeVisible();
    const rows=await fixture.sql("select scenario->>'taskId' as task,scenario->>'versionId' as version,scenario#>>'{bundle,fingerprint}' as fingerprint from scenario_versions v join scenario_suites s on s.id=v.suite_id where s.workspace_id=$1 order by v.version",[fixture.workspaceId]);expect(rows).toHaveLength(2);expect(rows[0].task).toBe(rows[1].task);expect(rows[0].version).not.toBe(rows[1].version);expect(rows[0].fingerprint).toBe(rows[1].fingerprint);
    await snapshot(page,'HB-B01');expect(errors).toEqual([]);
  } finally {await dispose(context);}
});
test('HB-B02 narrow screen selects exact versions and persists a shared plan',async({browser})=>{
  const {context,page,errors}=await surface(browser,390);
  try {
    await page.goto(fixture.endpoint+'/evals/harbor');await page.getByLabel('Plan name',{exact:true}).fill('Browser plan');
    const project=page.getByRole('combobox',{name:'Project',exact:true});
    await expect(project.locator('option').filter({hasText:/^Authored project · test$/})).toHaveAttribute('value',fixture.projectId);
    await project.selectOption({label:'Authored project · test'});
    await page.getByLabel(/Browser task revised · v2/).check();await page.getByLabel('Harbor agent',{exact:true}).fill('oracle');await page.getByLabel(/Share the selected task source/).check();
    await page.getByRole('button',{name:'Preview plan',exact:true}).click();await expect(page.getByLabel('Plan preview')).toBeVisible();
    const response=page.waitForResponse(r=>r.url()===fixture.endpoint+'/api/v1/harbor'&&r.request().method()==='POST'&&r.request().postDataJSON().action==='plan.save');
    await page.getByRole('button',{name:'Save shared plan',exact:true}).click();const saved=await (await response).json();planId=saved.plan.draft.planId;
    await expect(page).toHaveURL(new RegExp('planId='+planId));await page.reload();await expect(page.getByText('No runs have been reserved for this plan.',{exact:true})).toBeVisible();await expect(page.getByText(saved.plan.fingerprint,{exact:false})).toBeVisible();
    expect(saved.plan.tasks[0].version).toBe(2);expect(saved.plan.draft.projectId).toBe(fixture.projectId);await snapshot(page,'HB-B02');expect(errors).toEqual([]);
  } finally {await dispose(context);}
});
test('HB-B03 desktop reloads actual CLI-native results and closes an interrupted claim',async({browser})=>{
  const readback=JSON.parse(await readFile(join(process.env.HARBOR_WORK,'api-browser-readback.json'))),owner=JSON.parse(await readFile(join(process.env.HARBOR_WORK,'fixtures',readback.fixturePrefix+'.json')));
  const {context,page,errors}=await surface(browser,1440,owner.cookies.owner);
  try {
    await page.goto(owner.endpoint+'/evals/harbor?planId='+readback.planId+'&runId='+readback.runId);await expect(page.getByRole('heading',{name:'Run completed',exact:true})).toBeVisible();await expect(page.getByText(/Reward rule passed/)).toBeVisible();await page.reload();await expect(page.getByText(/Result SHA-256:/)).toBeVisible();
    const post=async body=>{const response=await fetch(owner.endpoint+'/api/v1/harbor',{method:'POST',headers:{cookie:owner.cookies.owner,'content-type':'application/json'},body:JSON.stringify(body)});expect(response.status).toBe(200);return response.json();};
    const response=await fetch(owner.endpoint+'/api/v1/harbor?kind=plan&planId='+readback.planId,{headers:{cookie:owner.cookies.owner}}),source=await response.json();
    const started=await post({action:'run.start',planId:readback.planId,runId:randomUUID(),planFingerprint:source.plan.fingerprint});await post({action:'run.claim',runId:started.run.runId,versionId:source.plan.tasks[0].versionId,claimId:randomUUID()});
    await page.goto(owner.endpoint+'/evals/harbor?planId='+readback.planId+'&runId='+started.run.runId);await page.getByRole('button',{name:'Close interrupted run',exact:true}).click();await expect(page.getByRole('heading',{name:'Run unknown',exact:true})).toBeVisible();await expect(page.getByText(/No quality decision/)).toBeVisible();await snapshot(page,'HB-B03');expect(errors).toEqual([]);
  } finally {await dispose(context);}
});
test('HB-B04 narrow failure preserves a draft and viewer access stays read-only',async({browser})=>{
  const {context,page,errors}=await surface(browser,390);
  try {
    await page.goto(fixture.endpoint+'/evals/harbor');await page.getByLabel('Task bundle',{exact:true}).setInputFiles(sourceBundle);await page.getByLabel('Task name',{exact:true}).fill('Draft survives failure');
    await page.route('**/api/v1/harbor',async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON().action==='task.preview')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'database_unavailable'})});return route.continue();});
    await page.getByRole('button',{name:'Preview task',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'The workspace database is unavailable.'})).toContainText('Your unsaved draft is still here.');await expect(page.getByLabel('Task name',{exact:true})).toHaveValue('Draft survives failure');await expect(page.getByRole('button',{name:'Save task version',exact:true})).toHaveCount(0);
    const rows=await fixture.sql('select count(*)::int as count from scenario_versions v join scenario_suites s on s.id=v.suite_id where s.workspace_id=$1',[fixture.workspaceId]);expect(rows[0].count).toBe(2);await snapshot(page,'HB-B04');expect(errors).toEqual([]);
  } finally {await dispose(context);}
  const viewer=await surface(browser,390,fixture.cookies.viewer);
  try {await viewer.page.goto(fixture.endpoint+'/evals/harbor');await expect(viewer.page.getByText(/Read-only access/)).toBeVisible();await expect(viewer.page.getByRole('button',{name:'Preview task',exact:true})).toBeDisabled();expect(viewer.errors).toEqual([]);}finally{await dispose(viewer.context,'-viewer');}
});

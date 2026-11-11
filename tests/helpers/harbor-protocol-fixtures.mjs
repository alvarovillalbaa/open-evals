import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
export const recordedBundle=JSON.parse(await readFile(new URL('../fixtures/harbor-recorded-bundle.json',import.meta.url)));
export const recordedReport=JSON.parse(await readFile(new URL('../fixtures/harbor-recorded-oracle-report.json',import.meta.url)));
// These are authored protocol fixtures derived from the retained native run.
// Rebinding an execution ID here is a test input, never fresh native attestation.
export function taskDraft(change={}) {return {taskId:randomUUID(),versionId:randomUUID(),version:1,expectedVersionId:null,name:'Authored Harbor task',bundle:structuredClone(recordedBundle),...change};}
export function planDraft(task,change={}) {return {planId:randomUUID(),name:'Authored Harbor plan',projectId:'authored-project',tasks:[{taskId:task.taskId,versionId:task.versionId,fingerprint:task.fingerprint}],agent:{name:'oracle',model:null,kind:'reference'},reward:{key:'reward',minimum:1},taskTimeoutSeconds:180,...change};}
export function resultFor(row,change={}) {
  const result={schemaVersion:'harbor-result-v1',executionId:row.executionId};
  for(const key of ['bundleFingerprint','runtime','agent','outcome','nativeTrialId','nativeResultSha256','nativeChecksum','nativeAgent','startedAt','finishedAt','nativeRewardValid','rewards','exceptionType'])result[key]=structuredClone(recordedReport[key]);
  return {...result,errorCode:null,...change};
}

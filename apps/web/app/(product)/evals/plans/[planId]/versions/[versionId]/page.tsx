import Link from "next/link";
import { connection } from "next/server";
import { LinkButton, PageHeader, StateGate } from "../../../../../components";
import { loadHttpTargetPlanRuns } from "@/lib/http-target-runs";
import { HttpExecutionControls } from "../../../http-execution-controls";
import { CompleteJson, PlanSnapshot } from "../../../http-target-view";

export default async function HttpPlanVersionPage({ params }: { params: Promise<{ planId: string; versionId: string }> }) {
  await connection();
  const { planId, versionId } = await params, state = await loadHttpTargetPlanRuns(planId, versionId);
  return <div className="grid min-w-0 gap-6"><PageHeader title="Exact saved HTTP eval plan" actions={<LinkButton href={`/evals/plans/${planId}`}>Plan history</LinkButton>} /><StateGate state={state} accessDeniedTitle="Saved plan unavailable" accessDeniedBody="A workspace session with evaluation access is required.">{({ data }) => data.detail ? <>
    <section className="grid min-w-0 gap-3 border border-border bg-panel p-4"><h2 className="break-words text-lg font-semibold">{data.detail.record.content.draft.name} · version {data.detail.record.content.draft.version}</h2><p className="break-all font-mono text-xs">Public version ID: {versionId}</p><p className="break-all font-mono text-xs">Stored version ID: {data.detail.record.storage.versionId}</p><PlanSnapshot content={data.detail.record.content} /><CompleteJson label="Inspect complete immutable plan version" value={data.detail.record} /></section>
    <HttpExecutionControls key={data.detail.record.fingerprint} plan={data.detail.record} canWrite={data.detail.canWrite} />
    <section className="grid min-w-0 gap-3" aria-label="Recorded executions for all versions of this plan"><h2 className="font-semibold">Recorded executions across this plan's versions</h2><p className="text-xs text-muted-foreground">This is the history observed when the page loaded, including running reservations. Reload to find an execution whose response was lost. Opening a run does not dispatch calls.</p>{data.detail.history.runs.length ? <ol className="grid min-w-0 gap-3">{data.detail.history.runs.map(run => <li className="grid min-w-0 gap-1 border border-border bg-panel p-3" key={run.runId}><Link className="break-all font-mono text-sm underline underline-offset-4" href={`/evals/plans/runs/${run.runId}`}>{run.runId}</Link><p className="text-sm">{run.status.replaceAll("_", " ")}</p><time className="text-xs text-muted-foreground" dateTime={run.startedAt}>{run.startedAt}</time><p className="break-all font-mono text-xs">Stored plan version: {run.planVersionId}</p></li>)}</ol> : <p className="text-sm text-muted-foreground">No executions were listed when this page loaded.</p>}{data.detail.history.hasMore ? <p className="text-xs text-muted-foreground">Showing the most recent 20 executions. Older runs remain available by their exact public execution IDs.</p> : null}</section>
  </> : <p className="text-sm text-muted-foreground">This exact saved plan version was not found in your workspace.</p>}</StateGate></div>;
}

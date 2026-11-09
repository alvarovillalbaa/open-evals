import { connection } from "next/server";
import { LinkButton, PageHeader, StateGate } from "../../../../components";
import { loadHttpTargetRun } from "@/lib/http-target-runs";
import { HttpExecutionControls } from "../../http-execution-controls";
import { CompleteJson, PlanSnapshot } from "../../http-target-view";

export default async function HttpRunPage({ params }: { params: Promise<{ runId: string }> }) {
  await connection();
  const { runId } = await params, state = await loadHttpTargetRun(runId);
  return <div className="grid min-w-0 gap-6"><PageHeader title="Recorded HTTP eval execution" actions={<LinkButton href="/evals/plans">All HTTP plans</LinkButton>} /><StateGate state={state} accessDeniedTitle="Execution unavailable" accessDeniedBody="A workspace session with evaluation access is required.">{({ data }) => data.record ? <>
    <p className="break-all font-mono text-xs">{runId}</p>
    <section className="grid min-w-0 gap-3 border border-border bg-panel p-4"><h2 className="break-words font-semibold">{data.record.plan.content.draft.name} · frozen version {data.record.plan.content.draft.version}</h2><PlanSnapshot content={data.record.plan.content} /><CompleteJson label="Inspect this execution's immutable saved plan" value={data.record.plan} /><LinkButton href={`/evals/plans/${data.record.plan.content.draft.planId}/versions/${data.record.plan.content.draft.versionId}`}>Open exact saved plan and history</LinkButton></section>
    <HttpExecutionControls key={runId} plan={data.record.plan} canWrite={data.canWrite} initialRecord={data.record} />
  </> : <p className="text-sm text-muted-foreground">This execution is not currently recorded in your workspace. An absent read does not cancel a request already sent. Preserve the public execution ID and reload before creating another.</p>}</StateGate></div>;
}

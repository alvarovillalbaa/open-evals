import Link from "next/link";
import { connection } from "next/server";
import { LinkButton, PageHeader, StateGate } from "../../components";
import { loadHttpTargetPlans } from "@/lib/http-target-plans";
import { HttpPlanComposer } from "./http-plan-composer";

export default async function HttpPlansPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const params = await searchParams;
  const bounded = (key: string) => typeof params[key] === "string" && params[key].length <= 36 ? params[key] : undefined;
  const state = await loadHttpTargetPlans({ composition: params.family === "composition", setId: bounded("setId"), setVersionId: bounded("setVersionId"), copyPlanId: bounded("copyPlanId"), copyVersionId: bounded("copyVersionId"), sourceRequested: ["setId", "setVersionId", "copyPlanId", "copyVersionId"].some(key => params[key] !== undefined) });
  return <div className="grid min-w-0 gap-6">
    <PageHeader title="HTTP eval plans" actions={<><LinkButton href="/evals">Back to Evals</LinkButton><LinkButton href="/evals/plans?family=composition">New reusable-composition plan</LinkButton><LinkButton href="/evals/plans">New single-check plan</LinkButton></>} />
    <p className="max-w-3xl text-sm leading-6 text-muted-foreground">Save exact dataset, evaluator and HTTP target versions together. Preview and save make no calls. Execute a saved plan only when you explicitly choose to send its frozen inputs.</p>
    <StateGate state={state} accessDeniedTitle="HTTP eval plans unavailable" accessDeniedBody="A workspace session with evaluation access is required.">{({ data }) => <>
      {data.requestedSourceUnavailable ? <p role="alert" className="text-sm text-danger">The requested saved source is unavailable in this workspace. No current version was substituted. Choose an accessible exact source before previewing.</p> : null}
      <HttpPlanComposer key={`${data.initialFamily}/${data.initialDatasetId ?? ""}/${data.initialSetRefs.map(ref => `${ref.setId}/${ref.versionId}`).join(",")}`} canWrite={data.canWrite} sources={data.sources} initialFamily={data.initialFamily} initialSetRefs={data.initialSetRefs} initialDatasetId={data.initialDatasetId} />
      <section className="grid min-w-0 gap-3" aria-labelledby="http-plan-history-heading"><h2 id="http-plan-history-heading" className="font-semibold">Saved plans listed when this page loaded</h2>{data.list.plans.length ? <ol className="grid min-w-0 gap-3 md:grid-cols-2">{data.list.plans.map(plan => <li className="grid min-w-0 gap-2 border border-border bg-panel p-4" key={plan.planId}><Link className="break-words font-medium underline underline-offset-4" href={`/evals/plans/${plan.planId}`}>{plan.name}</Link><p className="text-sm">Latest listed version: {plan.version}</p><p className="break-all font-mono text-xs text-muted-foreground">{plan.planId}</p><Link className="text-sm underline underline-offset-4" href={`/evals/plans/${plan.planId}/versions/${plan.versionId}`}>Inspect this exact version</Link></li>)}</ol> : <p className="border border-dashed border-border p-4 text-sm text-muted-foreground">No plans were listed when this page loaded. After saving, use the saved-version link above or reload this list.</p>}{data.list.hasMore ? <p className="text-xs text-muted-foreground">Showing the 100 most recent plans. Earlier saved plans remain available through their exact IDs.</p> : null}</section>
    </>}</StateGate>
  </div>;
}

import Link from "next/link";
import { connection } from "next/server";
import { LinkButton, PageHeader, StateGate } from "../../components";
import { loadHttpTargetPlans } from "@/lib/http-target-plans";
import { HttpPlanComposer } from "./http-plan-composer";

export default async function HttpPlansPage() {
  await connection();
  const state = await loadHttpTargetPlans();
  return <div className="grid min-w-0 gap-6">
    <PageHeader title="HTTP eval plans" actions={<LinkButton href="/evals">Back to Evals</LinkButton>} />
    <p className="max-w-3xl text-sm leading-6 text-muted-foreground">Save exact dataset, evaluator and HTTP target versions together. Preview and save make no calls. Execute a saved plan only when you explicitly choose to send its frozen inputs.</p>
    <StateGate state={state} accessDeniedTitle="HTTP eval plans unavailable" accessDeniedBody="A workspace session with evaluation access is required.">{({ data }) => <>
      <HttpPlanComposer canWrite={data.canWrite} sources={data.sources} />
      <section className="grid min-w-0 gap-3" aria-labelledby="http-plan-history-heading"><h2 id="http-plan-history-heading" className="font-semibold">Saved plans listed when this page loaded</h2>{data.list.plans.length ? <ol className="grid min-w-0 gap-3 md:grid-cols-2">{data.list.plans.map(plan => <li className="grid min-w-0 gap-2 border border-border bg-panel p-4" key={plan.planId}><Link className="break-words font-medium underline underline-offset-4" href={`/evals/plans/${plan.planId}`}>{plan.name}</Link><p className="text-sm">Latest listed version: {plan.version}</p><p className="break-all font-mono text-xs text-muted-foreground">{plan.planId}</p><Link className="text-sm underline underline-offset-4" href={`/evals/plans/${plan.planId}/versions/${plan.versionId}`}>Inspect this exact version</Link></li>)}</ol> : <p className="border border-dashed border-border p-4 text-sm text-muted-foreground">No plans were listed when this page loaded. After saving, use the saved-version link above or reload this list.</p>}{data.list.hasMore ? <p className="text-xs text-muted-foreground">Showing the 100 most recent plans. Earlier saved plans remain available through their exact IDs.</p> : null}</section>
    </>}</StateGate>
  </div>;
}

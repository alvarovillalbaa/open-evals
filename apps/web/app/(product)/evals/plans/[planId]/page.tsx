import Link from "next/link";
import { connection } from "next/server";
import { LinkButton, PageHeader, StateGate } from "../../../components";
import { loadHttpTargetPlan } from "@/lib/http-target-plans";
import { HttpPlanComposer } from "../http-plan-composer";
import { CompleteJson } from "../http-target-view";

export default async function HttpPlanPage({ params }: { params: Promise<{ planId: string }> }) {
  await connection();
  const { planId } = await params, state = await loadHttpTargetPlan(planId);
  return <div className="grid min-w-0 gap-6"><PageHeader title="Saved HTTP eval plan" actions={<LinkButton href="/evals/plans">All HTTP plans</LinkButton>} /><StateGate state={state} accessDeniedTitle="Plan access unavailable" accessDeniedBody="A workspace session with evaluation access is required.">{({ data }) => data.detail ? <>
    <section className="grid min-w-0 gap-3"><h2 className="break-words text-lg font-semibold">{data.detail.record.content.draft.name}</h2><p className="break-all font-mono text-xs">{data.detail.planId}</p><CompleteJson label="Inspect latest saved plan record observed by this page" value={data.detail.record} /></section>
    <section className="grid min-w-0 gap-3" aria-label="Immutable plan version history"><h2 className="font-semibold">Version history</h2><ol className="grid min-w-0 gap-2">{data.detail.versions.map(version => <li className="grid min-w-0 gap-1 border border-border bg-panel p-3" key={version.versionId}><Link className="text-sm font-medium underline underline-offset-4" href={`/evals/plans/${planId}/versions/${version.versionId}`}>Version {version.version}: {version.name}</Link><p className="break-all font-mono text-xs text-muted-foreground">{version.versionId}</p><time className="text-xs text-muted-foreground" dateTime={version.createdAt}>{version.createdAt}</time></li>)}</ol>{data.detail.hasMore ? <p className="text-xs text-muted-foreground">Showing the most recent 20 versions. Older immutable versions remain available by exact version ID.</p> : null}</section>
    <HttpPlanComposer key={data.detail.record.fingerprint} canWrite={data.canWrite} sources={data.sources} initialHead={data.detail.head} initialRecord={data.detail.record} />
  </> : <p className="text-sm text-muted-foreground">This plan was not found in your workspace.</p>}</StateGate></div>;
}

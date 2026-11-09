import Link from "next/link";
import { ArrowRight, Flag, GitBranch } from "lucide-react";
import { LinkButton, Notice, PageHeader, StateGate } from "../components";
import { loadCampaigns, loadInstructions } from "@/lib/loaders";

export default async function ImprovePage() {
  const [instructions, campaigns] = await Promise.all([loadInstructions(), loadCampaigns()]);
  return (
    <div className="grid min-w-0 gap-6">
      <PageHeader title="Improve" />
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">Compose system-prompt instructions, review immutable saved versions, and prepare a request for improvement from an existing version. Follow persisted campaigns and their reported status separately.</p>
      <Notice>Saving a preparation request records pending review. It does not start a campaign, generate candidates, call a model or promote a release.</Notice>
      <section aria-labelledby="instruction-heading" className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="instruction-heading" className="flex items-center gap-2 text-lg font-semibold"><GitBranch className="size-4" aria-hidden="true" />Instruction authoring</h2><LinkButton href="/instructions">Open Instructions <ArrowRight className="size-4" aria-hidden="true" /></LinkButton></div>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">Open a definition to compose, preview and save an immutable draft when your role allows it. Saved-version review also provides request preparation and read-only request history.</p>
        <StateGate state={instructions}>
          {({ data }) => data.definitions.length ? (
            <div className="grid min-w-0 gap-3 md:grid-cols-2">
              {data.definitions.map((definition) => (
                <Link href={`/instructions/${encodeURIComponent(definition.id)}`} className="grid min-w-0 content-start gap-3 border border-border bg-panel p-4 hover:bg-muted" key={definition.id}>
                  <div className="min-w-0"><h3 className="break-words font-medium">{definition.stableKey}</h3><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{definition.id}</p></div>
                  <p className="text-sm text-muted-foreground">{definition.versions.length} saved versions</p>
                  <span className="inline-flex items-center gap-2 text-sm font-medium">Review instruction <ArrowRight className="size-4" aria-hidden="true" /></span>
                </Link>
              ))}
            </div>
          ) : <p className="border border-dashed border-border bg-panel p-4 text-sm text-muted-foreground">No instruction definitions are available in your current scope. An editor can create one in Instructions.</p>}
        </StateGate>
      </section>
      <section aria-labelledby="campaign-heading" className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="campaign-heading" className="flex items-center gap-2 text-lg font-semibold"><Flag className="size-4" aria-hidden="true" />Campaigns</h2><LinkButton href="/campaigns">View campaign history <ArrowRight className="size-4" aria-hidden="true" /></LinkButton></div>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">Review persisted campaigns here. Pending preparation requests remain in their instruction history until a separate approved workflow starts a campaign.</p>
        <StateGate state={campaigns} accessDeniedTitle="Campaign access unavailable" accessDeniedBody="Your current role, key or scope does not allow these campaigns.">
          {({ data }) => data.campaigns.length ? (
            <div className="grid min-w-0 gap-3 md:grid-cols-2">
              {data.campaigns.map((campaign, index) => {
                const id = typeof campaign.id === "string" ? campaign.id : undefined;
                const status = typeof campaign.status === "string" ? campaign.status : undefined;
                const candidateCount = typeof campaign.candidateCount === "number" && Number.isInteger(campaign.candidateCount) && campaign.candidateCount >= 0 ? campaign.candidateCount : undefined;
                return (
                  <article className="grid min-w-0 content-start gap-3 border border-border bg-panel p-4" key={id ?? index}>
                    <h3 className="break-all font-mono text-sm">{id ?? "Campaign ID not supplied"}</h3>
                    <dl className="grid gap-2 text-sm"><div><dt className="text-xs text-muted-foreground">Reported status</dt><dd className="break-words">{status ?? "Not supplied"}</dd></div><div><dt className="text-xs text-muted-foreground">Candidates</dt><dd>{candidateCount === undefined ? "Not supplied" : candidateCount}</dd></div></dl>
                  </article>
                );
              })}
            </div>
          ) : <p className="border border-dashed border-border bg-panel p-4 text-sm text-muted-foreground">No campaigns are saved in this workspace. Prepare a request from a saved instruction version to begin the review workflow.</p>}
        </StateGate>
      </section>
    </div>
  );
}

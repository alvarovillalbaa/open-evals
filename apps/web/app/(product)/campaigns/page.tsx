import { Flag } from "lucide-react";
import { EmptyState, PageHeader, StateGate, Stat, Table, Notice } from "../components";
import { loadCampaigns } from "@/lib/loaders";

export default async function CampaignsPage() {
  const state = await loadCampaigns();
  return (
    <div className="grid gap-5">
      <PageHeader title="Campaigns" eyebrow="Improve" />
      <Notice>Campaign starts, release promotions, rollback, and live experiment changes require approval before mutation.</Notice>
      <StateGate state={state}>
        {({ data }) => (
          <div className="grid gap-5">
            <div className="grid gap-3 md:grid-cols-2">
              <Stat label="Campaigns" value={data.campaigns.length} />
              <Stat label="Candidates" value={data.campaigns.reduce((sum, campaign) => sum + Number(campaign.candidateCount ?? campaign.candidate_count ?? 0), 0)} />
            </div>
            {data.campaigns.length ? (
              <Table>
                <thead>
                  <tr className="border-b border-border bg-muted text-left text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2 font-medium">campaign</th>
                    <th className="px-3 py-2 font-medium">status</th>
                    <th className="px-3 py-2 font-medium">candidates</th>
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.map((campaign) => (
                    <tr className="border-b border-border last:border-0" key={String(campaign.id)}>
                      <td className="px-3 py-3 font-mono text-xs">{String(campaign.id)}</td>
                      <td className="px-3 py-3">{String(campaign.status ?? "")}</td>
                      <td className="px-3 py-3">{String(campaign.candidateCount ?? campaign.candidate_count ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState icon={<Flag className="size-5" aria-hidden="true" />} title="No campaigns yet" body="Optimization campaigns will appear after an approved start request." />
            )}
          </div>
        )}
      </StateGate>
    </div>
  );
}

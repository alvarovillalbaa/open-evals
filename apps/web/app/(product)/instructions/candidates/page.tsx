import { PageHeader, StateGate, Table, EmptyState } from "../../components";
import { loadInstructions } from "@/lib/loaders";

export default async function CandidatesPage() {
  const state = await loadInstructions();
  return (
    <div className="grid gap-5">
      <PageHeader title="Candidates" eyebrow="Instructions" />
      <StateGate state={state}>
        {({ data }) =>
          data.candidates.length ? (
            <Table>
              <thead>
                <tr className="border-b border-border bg-muted text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2 font-medium">candidate</th>
                  <th className="px-3 py-2 font-medium">campaign</th>
                  <th className="px-3 py-2 font-medium">status</th>
                  <th className="px-3 py-2 font-medium">operator</th>
                </tr>
              </thead>
              <tbody>
                {data.candidates.map((candidate) => (
                  <tr className="border-b border-border last:border-0" key={String(candidate.id)}>
                    <td className="px-3 py-3 font-mono text-xs">{String(candidate.id)}</td>
                    <td className="px-3 py-3 font-mono text-xs">{String(candidate.campaign_id ?? candidate.campaignId ?? "")}</td>
                    <td className="px-3 py-3">{String(candidate.status ?? "")}</td>
                    <td className="px-3 py-3">{String(candidate.mutation_operator ?? candidate.mutationOperator ?? "")}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No candidates yet" body="Instruction candidates will appear after an optimization campaign creates them." />
          )
        }
      </StateGate>
    </div>
  );
}

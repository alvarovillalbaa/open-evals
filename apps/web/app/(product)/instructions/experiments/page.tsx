import { PageHeader, StateGate, Table, EmptyState } from "../../components";
import { loadInstructions } from "@/lib/loaders";

export default async function ExperimentsPage() {
  const state = await loadInstructions();
  return (
    <div className="grid gap-5">
      <PageHeader title="Experiments" eyebrow="Instructions" />
      <StateGate state={state}>
        {({ data }) =>
          data.experiments.length ? (
            <Table>
              <thead>
                <tr className="border-b border-border bg-muted text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2 font-medium">experiment</th>
                  <th className="px-3 py-2 font-medium">status</th>
                  <th className="px-3 py-2 font-medium">assignment unit</th>
                </tr>
              </thead>
              <tbody>
                {data.experiments.map((experiment) => (
                  <tr className="border-b border-border last:border-0" key={String(experiment.id)}>
                    <td className="px-3 py-3 font-mono text-xs">{String(experiment.id)}</td>
                    <td className="px-3 py-3">{String(experiment.status ?? "")}</td>
                    <td className="px-3 py-3">{String(experiment.assignment_unit ?? experiment.assignmentUnit ?? "")}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No experiments yet" body="Online experiments will appear here after assignment policies are created." />
          )
        }
      </StateGate>
    </div>
  );
}

import { Layers3, ListChecks } from "lucide-react";
import { EmptyState, PageHeader, Panel, StateGate, Stat, Table } from "../components";
import { loadScenarios } from "@/lib/loaders";

export default async function ScenariosPage() {
  const state = await loadScenarios();
  return (
    <div className="grid gap-5">
      <PageHeader title="Scenarios" eyebrow="Evals" />
      <StateGate state={state}>
        {({ data }) => (
          <div className="grid gap-5">
            <div className="grid gap-3 md:grid-cols-3">
              <Stat label="Scenario suites" value={data.suites.length} />
              <Stat label="Scenario versions" value={data.suites.reduce((sum, suite) => sum + suite.versions.length, 0)} />
              <Stat label="Eval sets" value={data.evalSets.length} />
            </div>
            {data.suites.length ? (
              <Table>
                <thead>
                  <tr className="border-b border-border bg-muted text-left text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2 font-medium">suite</th>
                    <th className="px-3 py-2 font-medium">versions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.suites.map((suite) => (
                    <tr className="border-b border-border last:border-0" key={suite.id}>
                      <td className="px-3 py-3">
                        <p className="font-medium">{suite.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{suite.id}</p>
                      </td>
                      <td className="px-3 py-3">{suite.versions.length}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState icon={<Layers3 className="size-5" aria-hidden="true" />} title="No scenarios yet" body="Scenario suites will appear after they are created or imported." />
            )}
            <Panel title="Eval sets" icon={<ListChecks className="size-4" aria-hidden="true" />}>
              {data.evalSets.length ? (
                <div className="grid gap-2">
                  {data.evalSets.map((set) => (
                    <div className="grid grid-cols-[1fr_auto] items-center gap-3 border border-border bg-muted px-3 py-2 text-sm" key={set.id}>
                      <span>{set.name}</span>
                      <span>{set.versions.length} versions</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Eval sets are managed inside scenarios.</p>
              )}
            </Panel>
          </div>
        )}
      </StateGate>
    </div>
  );
}

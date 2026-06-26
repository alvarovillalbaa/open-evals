import { Database, FilePlus2 } from "lucide-react";
import { EmptyState, LinkButton, PageHeader, Panel, StateGate, Stat, Table } from "../components";
import { loadBenchmarks } from "@/lib/loaders";

export default async function BenchmarksPage() {
  const state = await loadBenchmarks();
  return (
    <div className="grid gap-5">
      <PageHeader
        title="Benchmarks"
        eyebrow="Evals"
        actions={
          <LinkButton href="/runs/import">
            <FilePlus2 className="size-4" aria-hidden="true" />
            Import traces
          </LinkButton>
        }
      />
      <StateGate state={state}>
        {({ data }) => (
          <div className="grid gap-5">
            <div className="grid gap-3 md:grid-cols-3">
              <Stat label="Benchmarks" value={data.benchmarks.length} />
              <Stat label="Datasets" value={data.datasets.length} />
              <Stat label="Dataset versions" value={data.datasets.reduce((sum, dataset) => sum + dataset.versions.length, 0)} />
            </div>
            {data.benchmarks.length ? (
              <Table>
                <thead>
                  <tr className="border-b border-border bg-muted text-left text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2 font-medium">benchmark</th>
                    <th className="px-3 py-2 font-medium">source</th>
                    <th className="px-3 py-2 font-medium">license</th>
                    <th className="px-3 py-2 font-medium">versions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.benchmarks.map((benchmark) => (
                    <tr className="border-b border-border last:border-0" key={benchmark.id}>
                      <td className="px-3 py-3">
                        <p className="font-medium">{benchmark.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{benchmark.id}</p>
                      </td>
                      <td className="px-3 py-3">{benchmark.source}</td>
                      <td className="px-3 py-3">{benchmark.license}</td>
                      <td className="px-3 py-3">{benchmark.versions.length}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState icon={<Database className="size-5" aria-hidden="true" />} title="No benchmarks yet" body="Imported benchmark packs and their dataset versions will appear here." />
            )}
            <Panel title="Datasets" icon={<Database className="size-4" aria-hidden="true" />}>
              {data.datasets.length ? (
                <div className="grid gap-2">
                  {data.datasets.map((dataset) => (
                    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border border-border bg-muted px-3 py-2 text-sm" key={dataset.id}>
                      <span>{dataset.name}</span>
                      <span className="text-muted-foreground">{dataset.kind}</span>
                      <span>{dataset.versions.length} versions</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Datasets are managed inside benchmarks.</p>
              )}
            </Panel>
          </div>
        )}
      </StateGate>
    </div>
  );
}

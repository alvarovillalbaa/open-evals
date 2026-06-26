import Link from "next/link";
import { ArrowRight, CheckCircle2, Hash, Rows3, XCircle } from "lucide-react";
import { ImportAction, LinkButton, PageHeader, StateGate, Stat, Table, EmptyState } from "../components";
import { loadRunBatches } from "@/lib/loaders";

export default async function RunsPage() {
  const state = await loadRunBatches();
  return (
    <div className="grid gap-5">
      <PageHeader title="Runs" eyebrow="Evals" actions={<ImportAction />} />
      <StateGate state={state}>
        {({ data }) => {
          const failed = data.reduce((sum, batch) => sum + batch.failedGateCount, 0);
          return (
            <div className="grid gap-5">
              <div className="grid gap-3 md:grid-cols-4">
                <Stat label="Batches" value={data.length} />
                <Stat label="Nested runs" value={data.reduce((sum, batch) => sum + batch.runCount, 0)} />
                <Stat label="Samples" value={data.reduce((sum, batch) => sum + batch.sampleCount, 0)} />
                <Stat label="Gate failures" value={failed} tone={failed ? "bad" : "good"} />
              </div>
              {data.length ? (
                <Table>
                  <thead>
                    <tr className="border-b border-border bg-muted text-left text-xs uppercase text-muted-foreground">
                      <th className="px-3 py-2 font-medium">batch</th>
                      <th className="px-3 py-2 font-medium">status</th>
                      <th className="px-3 py-2 font-medium">runs</th>
                      <th className="px-3 py-2 font-medium">samples</th>
                      <th className="px-3 py-2 font-medium">results</th>
                      <th className="px-3 py-2 font-medium">plan hash</th>
                      <th className="px-3 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((batch) => (
                      <tr className="border-b border-border last:border-0" key={batch.id}>
                        <td className="px-3 py-3 font-mono text-xs">{batch.runPlanId}</td>
                        <td className="px-3 py-3">
                          <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs">
                            {batch.failedGateCount ? <XCircle className="size-3 text-danger" aria-hidden="true" /> : <CheckCircle2 className="size-3 text-emerald-700" aria-hidden="true" />}
                            {batch.status}
                          </span>
                        </td>
                        <td className="px-3 py-3">{batch.runCount}</td>
                        <td className="px-3 py-3">{batch.sampleCount}</td>
                        <td className="px-3 py-3">{batch.resultCount}</td>
                        <td className="px-3 py-3 font-mono text-xs">
                          <span className="inline-flex items-center gap-1">
                            <Hash className="size-3" aria-hidden="true" />
                            {batch.planFingerprint.slice(0, 12)}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <Link className="inline-flex items-center gap-1 text-sm font-medium" href={`/runs/${batch.id}`}>
                            Open <ArrowRight className="size-3" aria-hidden="true" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <EmptyState
                  icon={<Rows3 className="size-5" aria-hidden="true" />}
                  title="No runs yet"
                  body="Persisted run batches will appear after traces and eval run requests are ingested."
                  action={
                    <LinkButton href="/runs/import" primary>
                      Import traces
                    </LinkButton>
                  }
                />
              )}
            </div>
          );
        }}
      </StateGate>
    </div>
  );
}

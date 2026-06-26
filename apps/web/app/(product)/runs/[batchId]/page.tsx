import { notFound } from "next/navigation";
import { CheckCircle2, Rows3, XCircle } from "lucide-react";
import { ImportAction, PageHeader, Panel, StateGate, Stat, Table } from "../../components";
import { loadRunBatch } from "@/lib/loaders";

export default async function RunBatchPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const state = await loadRunBatch(batchId);
  if (state.status === "ready" && !state.data) notFound();
  return (
    <div className="grid gap-5">
      <PageHeader title="Run batch" eyebrow={batchId} actions={<ImportAction />} />
      <StateGate state={state}>
        {({ data }) => {
          if (!data) return null;
          return (
            <div className="grid gap-5">
              <div className="grid gap-3 md:grid-cols-4">
                <Stat label="Runs" value={data.runCount} />
                <Stat label="Samples" value={data.sampleCount} />
                <Stat label="Results" value={data.resultCount} />
                <Stat label="Gate failures" value={data.failedGateCount} tone={data.failedGateCount ? "bad" : "good"} />
              </div>
              <Panel title="Nested runs">
                <div className="grid gap-2">
                  {data.runs.map((run) => (
                    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border border-border bg-muted px-3 py-2 text-sm" key={run.id}>
                      <span className="font-mono text-xs">{run.id}</span>
                      <span>{run.sampleCount ?? 0} samples</span>
                      <span className="inline-flex items-center gap-1 rounded bg-panel px-2 py-1 text-xs">
                        {run.status === "completed" ? <CheckCircle2 className="size-3 text-emerald-700" aria-hidden="true" /> : <XCircle className="size-3 text-danger" aria-hidden="true" />}
                        {run.status}
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>
              <Table>
                <thead>
                  <tr className="border-b border-border bg-muted text-left text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2 font-medium">row id</th>
                    <th className="px-3 py-2 font-medium">source</th>
                    <th className="px-3 py-2 font-medium">snapshot</th>
                    <th className="px-3 py-2 font-medium">status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.samples.map((sample) => (
                    <tr className="border-b border-border last:border-0" key={String(sample.id)}>
                      <td className="px-3 py-3 font-mono text-xs">{String(sample.row_id ?? sample.rowId ?? "")}</td>
                      <td className="px-3 py-3">{String(sample.source_kind ?? sample.sourceKind ?? "")}</td>
                      <td className="px-3 py-3 font-mono text-xs">{String(sample.snapshot_hash ?? sample.snapshotHash ?? "").slice(0, 16)}</td>
                      <td className="px-3 py-3">{String(sample.status ?? "")}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {!data.samples.length ? (
                <Panel title="Samples" icon={<Rows3 className="size-4" aria-hidden="true" />}>
                  <p className="text-sm text-muted-foreground">This run plan has no persisted samples yet.</p>
                </Panel>
              ) : null}
            </div>
          );
        }}
      </StateGate>
    </div>
  );
}

import type { AnyHttpEvalPlanContent as HttpEvalPlanContent, AnyHttpEvalRunRecord as HttpEvalRunRecord } from "@open-evals/core";

export const inputClass = "w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60 read-only:bg-muted";
export const buttonClass = "inline-flex min-h-9 items-center justify-center rounded-md border border-border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";
export const primaryClass = `${buttonClass} bg-foreground text-background`;

export function CompleteJson({ label, value }: { label: string; value: unknown }) {
  return <details className="min-w-0"><summary className="cursor-pointer text-sm font-medium">{label}</summary><pre tabIndex={0} aria-label={label} className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words bg-muted p-3 text-xs">{JSON.stringify(value, null, 2)}</pre></details>;
}

export function PlanSnapshot({ content }: { content: HttpEvalPlanContent }) {
  return (
    <div className="grid min-w-0 gap-3">
      <p className="text-sm">{content.dataset.dataset.name}: all {content.dataset.rows.length} rows · {content.evalSets.length} saved evaluator sets · {content.items.length} distinct evaluator versions.</p>
      {content.schemaVersion === "http-target-eval-v2" ? <><p className="text-sm">{content.dataset.rows.length * content.items.length} unique row/item results · at most {content.dataset.rows.length} target calls. Shared exact item versions retain every set membership and are checked once per row.</p><p className="text-sm text-muted-foreground">Every member is critical. A required critical failure blocks its dataset scope and every containing set even when its pass-rate threshold is 0%, and blocks the run.</p></> : null}
      <dl className="grid min-w-0 gap-2 text-sm">
        <div><dt className="font-medium">HTTP target</dt><dd className="break-all">{content.target.endpoint}</dd></div>
        <div><dt className="font-medium">Declared target identity and version</dt><dd className="break-all font-mono text-xs">{content.target.targetId} · {content.target.targetVersion}</dd></div>
        <div><dt className="font-medium">Execution bounds</dt><dd>{content.draft.limits.concurrency} concurrent calls · {content.draft.limits.maxDurationSeconds} seconds per run · {content.target.timeoutMs} ms per call · at most {content.policy.maxTargetCalls} calls.</dd></div>
      </dl>
      <p className="text-sm text-muted-foreground">Only frozen inputs and present context/history go to the endpoint. Reference answers and evaluator text stay in this application. The declared target version does not prove the remote implementation is immutable.</p>
      <CompleteJson label="Inspect complete frozen inputs, evaluators and target binding" value={content} />
    </div>
  );
}

export function RunEvidence({ record }: { record: HttpEvalRunRecord }) {
  const runGate = record.execution.gates.find(gate => gate.level === "run");
  return (
    <div className="grid min-w-0 gap-5">
      <div className="grid min-w-0 gap-2">
        <p className="text-sm font-semibold">Execution status: {record.ledger.status.replaceAll("_", " ")}</p>
        <p className="text-sm">Run gate: {runGate?.passed === true ? "passed" : "not passed"}. Missing or uncertain output cannot pass.</p>
        <dl className="grid min-w-0 gap-2 text-xs"><div><dt className="font-medium">Public execution ID</dt><dd className="break-all font-mono">{record.ledger.publicRunId}</dd></div><div><dt className="font-medium">Frozen plan fingerprint</dt><dd className="break-all font-mono">{record.ledger.planFingerprint}</dd></div><div><dt className="font-medium">Work deadline</dt><dd>{record.ledger.deadlineAt}</dd></div><div><dt className="font-medium">Recovery available after</dt><dd>{record.ledger.leaseExpiresAt}</dd></div></dl>
      </div>
      <section className="grid min-w-0 gap-3" aria-label="Actual target responses">
        <h2 className="font-semibold">Actual target responses</h2>
        <ol className="grid min-w-0 gap-3">{record.ledger.rows.map(row => {
          const event = record.events.find(value => value.rowId === row.rowId);
          const sample = record.plan.content.samples.find(value => value.rowId === row.rowId);
          const source = record.plan.content.dataset.rows.find(value => value.id === sample?.datasetRowId);
          return <li className="grid min-w-0 gap-2 border border-border p-3" key={row.rowId}>
            <h3 className="break-words text-sm font-medium">{source?.rowKey ?? row.rowId}</h3>
            <p className="text-sm">{row.status.replaceAll("_", " ")}</p>
            <p className="break-all font-mono text-xs text-muted-foreground">{row.rowId}</p>
            {event?.response ? <><pre tabIndex={0} aria-label={`Actual target output for ${source?.rowKey ?? row.rowId}`} className="max-h-64 overflow-auto whitespace-pre-wrap break-words bg-muted p-3 text-xs">{JSON.stringify(event.response.output, null, 2)}</pre>{event.response.usage !== undefined || event.response.costUsd !== undefined ? <CompleteJson label="Target-reported usage and cost" value={{ usage: event.response.usage, costUsd: event.response.costUsd }} /> : null}</> : <p className="text-sm text-muted-foreground">No accepted actual output is recorded for this row.</p>}
            {event?.errorCode ? <p className="break-all font-mono text-xs">{event.errorCode}</p> : null}
            <CompleteJson label={`Inspect stored row evidence for ${source?.rowKey ?? row.rowId}`} value={{ row, event: event ?? null, results: record.execution.results.filter(value => value.rowId === row.rowId) }} />
          </li>;
        })}</ol>
      </section>
      <section className="grid min-w-0 gap-3" aria-label="Execution gates"><h2 className="font-semibold">Stored gates</h2><ol className="grid min-w-0 gap-2">{record.execution.gates.map(gate => <li className="grid min-w-0 gap-1 border border-border p-3" key={gate.id}><p className="text-sm font-medium">{gate.level.replaceAll("_", " ")} · {gate.passed ? "passed" : "not passed"}</p><p className="break-all text-xs">{gate.scopeId}</p><p className="break-words text-xs text-muted-foreground">{gate.formula}</p><CompleteJson label={`Inspect ${gate.level} gate ${gate.scopeId}`} value={gate} /></li>)}</ol></section>
      <CompleteJson label="Inspect complete saved execution record" value={record} />
    </div>
  );
}

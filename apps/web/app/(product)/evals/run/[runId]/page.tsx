import { connection } from "next/server";
import { notFound } from "next/navigation";
import { LinkButton, PageHeader, Panel, StateGate, Stat } from "../../../components";
import { loadProvidedOutputDetail } from "@/lib/provided-output-runs";
import type { ProvidedOutputRunRecord } from "@open-evals/core";

const levels = [
  ["field", "Field gates"], ["item_row", "Item-row gates"], ["row", "Row gates"], ["dataset", "Dataset gate"],
  ["eval_set", "Eval Set gate"], ["target", "Provided-output target gate"], ["criticality", "Criticality gate"], ["run", "Run gate"]
] as const;

function json(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function Result({ record }: { record: ProvidedOutputRunRecord }) {
  const { plan, execution } = record;
  const runGate = execution.gates.find(gate => gate.level === "run");
  if (!runGate) throw new Error("provided_output_run_gate_missing");
  const outputs = new Map(plan.draft.outputs.map(row => [row.rowId, row.output]));
  const samples = new Map(plan.sampleManifest.rows.map(row => [row.datasetRowId, row]));
  return <div className="grid min-w-0 gap-5">
    <p className="max-w-3xl text-sm leading-6 text-muted-foreground">Deterministic scoring completed for supplied responses. These are the immutable inputs, evaluator membership, outputs and decisions recorded for this run, not the latest saved versions. No model, judge, target invocation, campaign or rollout was performed.</p>
    <div className="grid gap-3 sm:grid-cols-3"><Stat label="Complete rows" value={plan.dataset.rows.length} /><Stat label="Evaluator results" value={execution.results.length} /><Stat label="Run gate" value={runGate.passed ? "Passed" : "Failed"} tone={runGate.passed ? "good" : "bad"} /></div>
    <Panel title="Pinned versions and identity"><dl className="grid min-w-0 gap-3 text-sm">
      <div><dt className="font-medium">Dataset</dt><dd className="break-words">{plan.dataset.dataset.name} · version {plan.dataset.version.version}</dd><dd className="break-all font-mono text-xs">{plan.dataset.version.id}</dd></div>
      <div><dt className="font-medium">Custom Eval Set</dt><dd className="break-words">{plan.evalSet.contract.name} · version {plan.evalSet.contract.authoring.version}</dd><dd className="break-all font-mono text-xs">{plan.evalSet.contract.id}</dd></div>
      <div><dt className="font-medium">Plan fingerprint</dt><dd className="break-all font-mono text-xs">{plan.fingerprint}</dd></div>
      <div><dt className="font-medium">Complete dataset snapshot fingerprint</dt><dd className="break-all font-mono text-xs">{plan.datasetFingerprint}</dd></div>
      <div><dt className="font-medium">Execution fingerprint</dt><dd className="break-all font-mono text-xs">{execution.fingerprint}</dd></div>
      <div><dt className="font-medium">Record fingerprint</dt><dd className="break-all font-mono text-xs">{record.fingerprint}</dd></div>
    </dl><details className="mt-4"><summary className="cursor-pointer text-sm font-medium">Inspect exact evaluator contract, membership and policy</summary><pre tabIndex={0} className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words bg-muted p-3 text-xs">{json({ evalSet: plan.evalSet, target: plan.target, policy: plan.policy, declaredDatasetVersion: plan.dataset.version, requestFingerprint: record.requestFingerprint })}</pre></details></Panel>
    <section className="grid min-w-0 gap-3" aria-labelledby="saved-output-rows"><h2 id="saved-output-rows" className="text-lg font-semibold">Complete saved rows and actual outputs</h2><ol className="grid min-w-0 gap-4">{plan.dataset.rows.map(row => {
      const sample = samples.get(row.id);
      if (!sample || !outputs.has(row.id)) throw new Error("provided_output_row_snapshot_missing");
      return <li key={row.id} className="grid min-w-0 gap-3 border border-border bg-panel p-4">
        <div><h3 className="break-words font-semibold">{row.rowKey}</h3><p className="mt-1 break-all font-mono text-xs text-muted-foreground">Stored row ID: {row.id}</p><p className="mt-1 break-all font-mono text-xs text-muted-foreground">Sample ID: {sample.rowId}</p></div>
        <div><h4 className="text-sm font-medium">Saved input</h4><pre tabIndex={0} aria-label={`Saved input for ${row.rowKey}`} className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words bg-muted p-3 text-xs">{json(row.input)}</pre></div>
        <div><h4 className="text-sm font-medium">Actual supplied output</h4><pre tabIndex={0} aria-label={`Actual supplied output for ${row.rowKey}`} className="mt-1 min-h-12 max-h-96 overflow-auto whitespace-pre-wrap break-words bg-muted p-3 text-xs">{outputs.get(row.id)}</pre>{outputs.get(row.id) === "" ? <p className="mt-1 text-xs text-muted-foreground">The actual output was empty text.</p> : null}</div>
        <details><summary className="cursor-pointer text-sm font-medium">Inspect complete references, context and source hashes</summary><pre tabIndex={0} className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words bg-muted p-3 text-xs">{json({ expectedOutput: row.expectedOutput, context: row.context, history: row.history, traceFixture: row.traceFixture, metadata: row.metadata, reviewStatus: row.reviewStatus, datasetRowFingerprint: sample.datasetRowFingerprint, sampleSnapshotHash: sample.snapshotHash })}</pre></details>
        <details><summary className="cursor-pointer text-sm font-medium">Inspect all evaluator results for this row</summary><pre tabIndex={0} className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words bg-muted p-3 text-xs">{json(execution.results.filter(result => result.rowId === sample.rowId))}</pre></details>
      </li>;
    })}</ol></section>
    <section className="grid min-w-0 gap-3" aria-labelledby="saved-output-gates"><div><h2 id="saved-output-gates" className="text-lg font-semibold">All eight gate levels</h2><p className="mt-1 text-sm text-muted-foreground">The dataset pass rate and critical-failure gates are separate. A passed dataset gate does not waive a failed critical check. The decisions below are persisted scoring results.</p></div>{levels.map(([level, title]) => <Panel key={level} title={title}><ul className="grid min-w-0 gap-3">{execution.gates.filter(gate => gate.level === level).map(gate => <li key={gate.id} className="min-w-0 border border-border p-3 text-sm"><p className="font-medium">{gate.passed ? "Passed" : "Failed"} · {gate.decision}{gate.score === undefined ? "" : ` · score ${gate.score}`}</p><p className="mt-1 break-all font-mono text-xs">{gate.scopeId}</p><p className="mt-2 break-words text-muted-foreground">{gate.formula}</p><details className="mt-2"><summary className="cursor-pointer text-xs font-medium">Inspect complete gate</summary><pre tabIndex={0} className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words bg-muted p-3 text-xs">{json(gate)}</pre></details></li>)}</ul></Panel>)}</section>
    <p className="text-sm"><a className="underline underline-offset-4" href={`/api/v1/provided-output-runs/${plan.publicRunId}`}>Read the complete immutable JSON record</a></p>
  </div>;
}

export default async function ProvidedOutputResultPage({ params }: { params: Promise<{ runId: string }> }) {
  await connection();
  const { runId } = await params;
  const state = await loadProvidedOutputDetail(runId);
  if (state.status === "ready" && !state.data.record) notFound();
  return <div className="grid min-w-0 gap-5"><PageHeader title="Supplied-output run" eyebrow={runId} actions={<LinkButton href="/evals/run">Score more supplied outputs</LinkButton>} /><StateGate state={state} accessDeniedTitle="Run access unavailable" accessDeniedBody="A workspace session with evaluation read access is required to inspect this immutable run.">{({ data }) => data.record ? <Result record={data.record} /> : null}</StateGate></div>;
}

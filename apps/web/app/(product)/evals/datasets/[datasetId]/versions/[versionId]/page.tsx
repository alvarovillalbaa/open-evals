import { connection } from "next/server";
import { notFound } from "next/navigation";
import { LinkButton, PageHeader, StateGate } from "../../../../../components";
import { loadCustomDatasetVersion } from "@/lib/custom-datasets";
import type { CustomDatasetVersionRecord } from "@open-evals/core";

function SavedVersion({ record }: { record: CustomDatasetVersionRecord }) {
  const { content, snapshot } = record;
  return <div className="grid min-w-0 gap-5">
    <div><h2 className="break-words text-lg font-semibold">{content.dataset.name} · version {content.version.version}</h2><p className="mt-2 text-sm text-muted-foreground">These are the complete immutable saved values, including references and uploader review declarations. This page does not evaluate them or supply actual responses.</p></div>
    <dl className="grid min-w-0 gap-3 border border-border bg-panel p-4 text-sm"><div><dt className="font-medium">Saved</dt><dd><time dateTime={snapshot.version.createdAt}>{snapshot.version.createdAt}</time></dd></div><div><dt className="font-medium">Public version ID</dt><dd className="break-all font-mono text-xs">{content.version.publicId}</dd></div><div><dt className="font-medium">Dataset version ID for scoring</dt><dd className="break-all font-mono text-xs">{snapshot.version.id}</dd></div><div><dt className="font-medium">Content fingerprint</dt><dd className="break-all font-mono text-xs">{content.fingerprint}</dd></div></dl>
    <div className="flex flex-wrap gap-2"><LinkButton href={`/evals/run?datasetVersionId=${encodeURIComponent(snapshot.version.id)}`} primary>Score this saved version</LinkButton><LinkButton href={`/evals/datasets/${content.dataset.publicId}`}>Dataset history and new version</LinkButton></div>
    <section className="grid min-w-0 gap-3" aria-labelledby="saved-custom-rows"><h2 id="saved-custom-rows" className="text-lg font-semibold">All {content.rows.length} saved rows</h2><ol className="grid min-w-0 gap-4">{content.rows.map(row => <li key={row.id} className="grid min-w-0 gap-3 border border-border bg-panel p-4"><div><h3 className="break-words font-medium">{row.rowKey}</h3><p className="mt-1 text-xs text-muted-foreground">Uploader declaration: {row.reviewStatus}</p><p className="mt-1 break-all font-mono text-xs text-muted-foreground">Stored row ID: {row.id}</p></div><div><h4 className="text-sm font-medium">Saved input</h4><pre tabIndex={0} aria-label={`Saved dataset input for ${row.rowKey}`} className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words bg-muted p-3 text-xs">{JSON.stringify(row.input, null, 2)}</pre></div><div><h4 className="text-sm font-medium">Expected output reference</h4>{row.expectedOutput.present ? <pre tabIndex={0} aria-label={`Saved dataset reference for ${row.rowKey}`} className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words bg-muted p-3 text-xs">{JSON.stringify(row.expectedOutput.value, null, 2)}</pre> : <p className="mt-1 text-sm text-muted-foreground">No reference was supplied. This is different from a supplied JSON null.</p>}</div><details><summary className="cursor-pointer text-sm font-medium">Inspect complete context and metadata</summary><pre tabIndex={0} aria-label={`Saved dataset context and metadata for ${row.rowKey}`} className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words bg-muted p-3 text-xs">{JSON.stringify({ context: row.context, history: row.history, traceFixture: row.traceFixture, metadata: row.metadata }, null, 2)}</pre></details></li>)}</ol></section>
    <details><summary className="cursor-pointer text-sm font-medium">Inspect the complete saved record and integrity manifest</summary><pre tabIndex={0} aria-label="Complete saved dataset record" className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words bg-muted p-3 text-xs">{JSON.stringify(record, null, 2)}</pre></details>
    <p className="text-sm"><a className="underline underline-offset-4" href={`/api/v1/custom-datasets/${content.dataset.publicId}/versions/${content.version.publicId}`}>Read the complete saved JSON record</a></p>
  </div>;
}

export default async function CustomDatasetVersionPage({ params }: { params: Promise<{ datasetId: string; versionId: string }> }) {
  await connection();
  const { datasetId, versionId } = await params;
  const state = await loadCustomDatasetVersion(datasetId, versionId);
  if (state.status === "ready" && !state.data.record) notFound();
  return <div className="grid min-w-0 gap-5"><PageHeader title="Saved dataset version" eyebrow="Evals" actions={<LinkButton href="/evals/datasets">All custom datasets</LinkButton>} /><StateGate state={state} accessDeniedTitle="Saved dataset access unavailable" accessDeniedBody="A workspace session with evaluation read access is required to inspect this immutable version.">{({ data }) => data.record ? <SavedVersion record={data.record} /> : null}</StateGate></div>;
}

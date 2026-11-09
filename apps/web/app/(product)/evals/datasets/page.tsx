import Link from "next/link";
import { connection } from "next/server";
import { LinkButton, PageHeader, StateGate } from "../../components";
import { loadCustomDatasetList } from "@/lib/custom-datasets";
import { CustomDatasetComposer } from "./custom-dataset-composer";

export default async function CustomDatasetsPage() {
  await connection();
  const state = await loadCustomDatasetList();
  return <div className="grid min-w-0 gap-5">
    <PageHeader title="Custom datasets" eyebrow="Evals" actions={<><LinkButton href="/evals">Evaluation catalogue</LinkButton><LinkButton href="/evals/run">Score supplied outputs</LinkButton></>} />
    <p className="max-w-3xl text-sm leading-6 text-muted-foreground">Create reusable inputs from JSON or JSONL. Saved versions preserve their complete accepted rows, references and metadata. Evaluators and actual responses stay separate.</p>
    <StateGate state={state} accessDeniedTitle="Dataset access unavailable" accessDeniedBody="A workspace session with evaluation read access is required. Project API keys and hosted local/demo access cannot read or author these custom datasets.">
      {({ data }) => <>
        <CustomDatasetComposer canWrite={data.canWrite} />
        <section className="grid min-w-0 gap-3" aria-labelledby="custom-dataset-list"><div><h2 id="custom-dataset-list" className="text-lg font-semibold">Saved custom datasets</h2><p className="mt-1 text-sm text-muted-foreground">Showing up to 100 saved datasets from this page load. Open a dataset to inspect its history or append a version.</p></div>
          {data.list.datasets.length ? <ol className="grid min-w-0 gap-3 md:grid-cols-2">{data.list.datasets.map(dataset => <li key={dataset.id} className="grid min-w-0 gap-2 border border-border bg-panel p-4"><h3 className="break-words font-medium"><Link className="underline underline-offset-4" href={`/evals/datasets/${dataset.id}`}>{dataset.name}</Link></h3><p className="text-sm text-muted-foreground">{dataset.versionCount} saved versions · latest version {dataset.head.version} · {dataset.head.rowCount} complete rows</p><p className="break-all font-mono text-xs text-muted-foreground">{dataset.id}</p><div className="flex flex-wrap gap-3 text-sm"><Link className="underline underline-offset-4" href={`/evals/datasets/${dataset.id}/versions/${dataset.head.id}`}>Inspect latest saved version</Link><Link className="underline underline-offset-4" href={`/evals/run?datasetVersionId=${encodeURIComponent(dataset.head.storageVersionId)}`}>Score this saved version</Link></div></li>)}</ol> : <p className="border border-dashed border-border bg-panel p-4 text-sm text-muted-foreground">No custom datasets were listed when this page loaded. Upload or paste examples above, or reload the page to update the list after saving.</p>}
          {data.list.hasMore ? <p className="text-xs text-muted-foreground">This is a bounded list. Earlier datasets remain accessible through their saved dataset URLs.</p> : null}
        </section>
      </>}
    </StateGate>
  </div>;
}

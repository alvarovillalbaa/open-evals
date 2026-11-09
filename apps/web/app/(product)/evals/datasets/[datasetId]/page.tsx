import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { LinkButton, PageHeader, StateGate } from "../../../components";
import { loadCustomDatasetDetail } from "@/lib/custom-datasets";
import { CustomDatasetComposer } from "../custom-dataset-composer";

export default async function CustomDatasetPage({ params }: { params: Promise<{ datasetId: string }> }) {
  await connection();
  const { datasetId } = await params;
  const state = await loadCustomDatasetDetail(datasetId);
  if (state.status === "ready" && !state.data.detail) notFound();
  return <div className="grid min-w-0 gap-5">
    <PageHeader title="Saved custom dataset" eyebrow="Evals" actions={<LinkButton href="/evals/datasets">All custom datasets</LinkButton>} />
    <StateGate state={state} accessDeniedTitle="Dataset access unavailable" accessDeniedBody="A workspace session with evaluation read access is required to inspect these saved inputs.">
      {({ data }) => data.detail ? <>
        <div><h2 className="break-words text-lg font-semibold">{data.detail.dataset.name}</h2><p className="mt-1 break-all font-mono text-xs text-muted-foreground">Dataset ID: {data.detail.dataset.id}</p><p className="mt-2 text-sm text-muted-foreground">Saved versions are immutable. The editor starts with the complete current rows as JSON; original file formatting is not archived. Changes below create a new version only after preview and explicit save.</p></div>
        <CustomDatasetComposer key={data.detail.dataset.id} canWrite={data.canWrite} initial={data.detail} />
        <section className="grid min-w-0 gap-3" aria-labelledby="custom-dataset-history"><h2 id="custom-dataset-history" className="text-lg font-semibold">Saved version history</h2><ol className="grid min-w-0 gap-3">{data.detail.dataset.versions.map(version => <li key={version.id} className="grid min-w-0 gap-2 border border-border bg-panel p-4"><h3 className="font-medium"><Link className="underline underline-offset-4" href={`/evals/datasets/${datasetId}/versions/${version.id}`}>Version {version.version}</Link></h3><p className="text-sm text-muted-foreground">{version.rowCount} complete rows · <time dateTime={version.createdAt}>{version.createdAt}</time></p><p className="break-all font-mono text-xs text-muted-foreground">Public version ID: {version.id}</p><p className="break-all font-mono text-xs text-muted-foreground">Content fingerprint: {version.contentFingerprint}</p><div className="text-sm"><Link className="underline underline-offset-4" href={`/evals/run?datasetVersionId=${encodeURIComponent(version.storageVersionId)}`}>Score this exact saved version</Link></div></li>)}</ol>{data.detail.dataset.hasMore ? <p className="text-xs text-muted-foreground">Showing the most recent 20 saved versions. Earlier versions remain accessible through their exact saved URLs and version IDs.</p> : null}</section>
      </> : null}
    </StateGate>
  </div>;
}

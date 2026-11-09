import { connection } from "next/server";
import { LinkButton, PageHeader, StateGate } from "../../components";
import { loadProvidedOutputHome } from "@/lib/provided-output-runs";
import { ProvidedOutputComposer } from "./provided-output-composer";

export default async function ProvidedOutputRunPage({ searchParams }: { searchParams: Promise<{ datasetVersionId?: string | string[] }> }) {
  await connection();
  const query = await searchParams;
  const value = query.datasetVersionId;
  const initialDatasetVersionId = typeof value === "string" && value.trim() && !value.includes("\0") && new TextEncoder().encode(value).length <= 512 ? value : undefined;
  const state = await loadProvidedOutputHome();
  return (
    <div className="grid min-w-0 gap-5">
      <PageHeader title="Score supplied outputs" eyebrow="Evals" actions={<LinkButton href="/evals">Evaluation catalogue</LinkButton>} />
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">Select durable dataset and custom Eval Set versions, supply responses already produced, preview the exact snapshot, then explicitly run deterministic checks. This mode makes no model, judge or target calls. It does not start a campaign, Harbor task or rollout.</p>
      <StateGate state={state} accessDeniedTitle="Supplied-output runs unavailable" accessDeniedBody="A workspace session with evaluation read access is required. Project keys and hosted local/demo access cannot read these inputs or results.">
        {({ data }) => <ProvidedOutputComposer key={initialDatasetVersionId ?? "unselected"} sources={data.sources} history={data.history} canWrite={data.canWrite} initialDatasetVersionId={initialDatasetVersionId} />}
      </StateGate>
    </div>
  );
}

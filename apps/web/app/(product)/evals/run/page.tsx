import { connection } from "next/server";
import { LinkButton, PageHeader, StateGate } from "../../components";
import { loadProvidedOutputHome } from "@/lib/provided-output-runs";
import { ProvidedOutputComposer } from "./provided-output-composer";

export default async function ProvidedOutputRunPage() {
  await connection();
  const state = await loadProvidedOutputHome();
  return (
    <div className="grid min-w-0 gap-5">
      <PageHeader title="Score supplied outputs" eyebrow="Evals" actions={<LinkButton href="/evals">Evaluation catalogue</LinkButton>} />
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">Select durable dataset and custom Eval Set versions, supply responses already produced, preview the exact snapshot, then explicitly run deterministic checks. This mode makes no model, judge or target calls. It does not start a campaign, Harbor task or rollout.</p>
      <StateGate state={state} accessDeniedTitle="Supplied-output runs unavailable" accessDeniedBody="A workspace session with evaluation read access is required. Project keys and hosted local/demo access cannot read these inputs or results.">
        {({ data }) => <ProvidedOutputComposer sources={data.sources} history={data.history} canWrite={data.canWrite} />}
      </StateGate>
    </div>
  );
}

import Link from "next/link";
import { LinkButton, PageHeader, StateGate } from "../../components";
import { loadCustomEvalList } from "@/lib/custom-evals";
import { CustomEvalEditor } from "./custom-eval-editor";

export default async function CustomEvalsPage() {
  const state = await loadCustomEvalList();
  return (
    <div className="grid min-w-0 gap-6">
      <PageHeader title="Custom Eval Sets" actions={<LinkButton href="/evals#eval-sets">All evaluators</LinkButton>} />
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">Save a text check and its pass rule as an immutable version. Each save preserves the earlier versions; it does not start an evaluation run.</p>
      <StateGate state={state} accessDeniedTitle="Custom Eval Sets unavailable" accessDeniedBody="Use a signed-in workspace session to view these evaluators.">
        {({ data }) => (
          <div className="grid min-w-0 gap-6 lg:grid-cols-2">
            <CustomEvalEditor canWrite={data.canWrite} />
            <section className="grid min-w-0 content-start gap-3" aria-labelledby="saved-custom-evals">
              <h2 className="text-lg font-semibold" id="saved-custom-evals">Saved Eval Sets</h2>
              {data.sets.length ? <ul className="grid min-w-0 gap-3">{data.sets.map(set => (
                <li className="min-w-0 border border-border bg-panel p-4" key={set.id}>
                  <Link className="break-words font-medium underline underline-offset-4" href={`/evals/custom/${encodeURIComponent(set.id)}`}>{set.name}</Link>
                  <p className="mt-2 text-sm text-muted-foreground">{set.versionCount} saved {set.versionCount === 1 ? "version" : "versions"}</p>
                </li>
              ))}</ul> : <p className="border border-dashed border-border bg-panel p-4 text-sm text-muted-foreground">No custom Eval Sets are saved yet.</p>}
              <p className="text-xs text-muted-foreground">Showing up to 100 saved sets.</p>
            </section>
          </div>
        )}
      </StateGate>
    </div>
  );
}

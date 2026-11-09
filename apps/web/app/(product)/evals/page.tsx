import { ArrowRight, Database, Layers3, ListChecks } from "lucide-react";
import { LinkButton, PageHeader, StateGate } from "../components";
import { loadEvals } from "@/lib/loaders";

const versionFields = [
  { key: "id", label: "Version ID" },
  { key: "version", label: "Version" },
  { key: "fingerprint", label: "Fingerprint" }
] as const;

function scalar(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function Versions({ name, versions }: { name: string; versions: Array<Record<string, unknown>> }) {
  if (!versions.length) return <p className="text-sm text-muted-foreground">No saved versions.</p>;
  return (
    <details className="min-w-0 border-t border-border pt-3">
      <summary className="cursor-pointer text-sm font-medium" aria-label={`Inspect saved versions for ${name}`}>Inspect saved versions</summary>
      <ol className="mt-3 grid min-w-0 gap-3">
        {versions.map((version, index) => {
          const fields = versionFields.flatMap(({ key, label }) => {
            const value = scalar(version[key]);
            return value === undefined ? [] : [{ key, label, value }];
          });
          return (
            <li className="min-w-0 border border-border bg-muted p-3" key={`${scalar(version.id) ?? "version"}-${index}`}>
              {fields.length ? (
                <dl className="grid min-w-0 gap-2 text-xs">
                  {fields.map((field) => <div className="min-w-0" key={field.key}><dt className="text-muted-foreground">{field.label}</dt><dd className="mt-1 break-all font-mono">{field.value}</dd></div>)}
                </dl>
              ) : <p className="text-sm text-muted-foreground">No version ID, number or fingerprint was supplied.</p>}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

export default async function EvalsPage() {
  const state = await loadEvals();
  return (
    <div className="grid min-w-0 gap-6">
      <PageHeader title="Evals" actions={<><LinkButton href="/evals/composition" primary>Compose evaluators</LinkButton><LinkButton href="/evals/plans">HTTP eval plans</LinkButton><LinkButton href="/evals/run">Score supplied outputs</LinkButton><LinkButton href="/evals/datasets">Custom datasets</LinkButton><LinkButton href="/runs">View runs</LinkButton><LinkButton href="/evals/custom">Custom Eval Sets</LinkButton><LinkButton href="/evals/sdk">Connect SDK <ArrowRight className="size-4" aria-hidden="true" /></LinkButton></>} />
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">Evaluation combines inputs with evaluators. Dataset and scenario versions supply the cases; Eval Items define what to check, and Eval Sets version those evaluator definitions together.</p>
      <StateGate state={state} accessDeniedTitle="Evals access unavailable" accessDeniedBody="Your current role, key or scope does not allow these evaluation resources.">
        {({ data }) => (
          <div className="grid min-w-0 gap-8">
            <nav aria-label="Evaluation resources" className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
              <a href="#datasets" className="hover:underline">Datasets</a><a href="#scenarios" className="hover:underline">Scenarios</a><a href="#eval-sets" className="hover:underline">Evaluators</a><a href="#benchmarks" className="hover:underline">External benchmarks</a><a href="#harbor" className="hover:underline">Harbor</a>
            </nav>
            <section id="datasets" aria-labelledby="dataset-heading" className="grid min-w-0 scroll-mt-6 gap-3">
              <div><h2 id="dataset-heading" className="flex items-center gap-2 text-lg font-semibold"><Database className="size-4" aria-hidden="true" />Dataset inputs</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Imported datasets provide inputs, optional expected outputs and context. Create and inspect reusable custom inputs through Custom datasets. Inspect saved version identities before using them in an eval.</p></div>
              {data.datasets.length ? <div className="grid min-w-0 gap-3 md:grid-cols-2">{data.datasets.map((dataset) => (
                <article className="grid min-w-0 content-start gap-3 border border-border bg-panel p-4" key={dataset.id}>
                  <div className="min-w-0"><h3 className="break-words font-medium">{dataset.name}</h3><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{dataset.id}</p></div>
                  <p className="text-sm text-muted-foreground">Kind: <span className="break-words text-foreground">{dataset.kind}</span></p>
                  <Versions name={dataset.name} versions={dataset.versions} />
                </article>
              ))}</div> : <p className="border border-dashed border-border bg-panel p-4 text-sm text-muted-foreground">No dataset inputs are saved in this workspace.</p>}
            </section>
            <section id="scenarios" aria-labelledby="scenario-heading" className="grid min-w-0 scroll-mt-6 gap-3">
              <div><h2 id="scenario-heading" className="flex items-center gap-2 text-lg font-semibold"><Layers3 className="size-4" aria-hidden="true" />Scenario inputs</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Scenario suites describe versioned interactions, environment fixtures and completion rules for the target being evaluated.</p></div>
              {data.scenarios.length ? <div className="grid min-w-0 gap-3 md:grid-cols-2">{data.scenarios.map((suite) => (
                <article className="grid min-w-0 content-start gap-3 border border-border bg-panel p-4" key={suite.id}>
                  <div className="min-w-0"><h3 className="break-words font-medium">{suite.name}</h3><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{suite.id}</p></div>
                  <Versions name={suite.name} versions={suite.versions} />
                </article>
              ))}</div> : <p className="border border-dashed border-border bg-panel p-4 text-sm text-muted-foreground">No scenario suites are saved in this workspace.</p>}
            </section>
            <section id="eval-sets" aria-labelledby="eval-set-heading" className="grid min-w-0 scroll-mt-6 gap-3">
              <div><h2 id="eval-set-heading" className="flex items-center gap-2 text-lg font-semibold"><ListChecks className="size-4" aria-hidden="true" />Evaluators and Eval Sets</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">An Eval Item is an evaluator definition, rather than an input row. Eval Sets collect evaluator definitions and their output schemas into saved versions. This catalog exposes Eval Set identities and versions.</p></div>
              {data.evalSets.length ? <div className="grid min-w-0 gap-3 md:grid-cols-2">{data.evalSets.map((set) => (
                <article className="grid min-w-0 content-start gap-3 border border-border bg-panel p-4" key={set.id}>
                  <div className="min-w-0"><h3 className="break-words font-medium">{set.name}</h3><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{set.id}</p></div>
                  <Versions name={set.name} versions={set.versions} />
                </article>
              ))}</div> : <p className="border border-dashed border-border bg-panel p-4 text-sm text-muted-foreground">No Eval Sets are saved in this workspace.</p>}
            </section>
            <section id="benchmarks" aria-labelledby="benchmark-heading" className="grid min-w-0 scroll-mt-6 gap-3">
              <div><h2 id="benchmark-heading" className="text-lg font-semibold">External benchmarks</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Recognized benchmark packs retain their supplied source, license and saved versions. Check those terms before importing or using a full dataset.</p></div>
              {data.benchmarks.length ? <div className="grid min-w-0 gap-3 md:grid-cols-2">{data.benchmarks.map((benchmark) => (
                <article className="grid min-w-0 content-start gap-3 border border-border bg-panel p-4" key={benchmark.id}>
                  <div className="min-w-0"><h3 className="break-words font-medium">{benchmark.name}</h3><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{benchmark.id}</p></div>
                  <dl className="grid min-w-0 gap-2 text-sm"><div><dt className="text-xs text-muted-foreground">Source</dt><dd className="break-words">{benchmark.source}</dd></div><div><dt className="text-xs text-muted-foreground">License</dt><dd className="break-words">{benchmark.license}</dd></div></dl>
                  <Versions name={benchmark.name} versions={benchmark.versions} />
                </article>
              ))}</div> : <p className="border border-dashed border-border bg-panel p-4 text-sm text-muted-foreground">No external benchmark packs are saved in this workspace.</p>}
            </section>
          </div>
        )}
      </StateGate>
      <section id="harbor" aria-labelledby="harbor-heading" className="scroll-mt-6 border border-border bg-muted p-4">
        <h2 id="harbor-heading" className="font-semibold">Harbor</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Harbor support is not available in this application. A task catalog and execution adapter have not been connected.</p>
      </section>
    </div>
  );
}

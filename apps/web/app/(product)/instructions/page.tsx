import Link from "next/link";
import { ArrowRight, GitBranch, SplitSquareHorizontal, Tag } from "lucide-react";
import { EmptyState, PageHeader, Panel, StateGate, Stat } from "../components";
import { loadInstructions } from "@/lib/loaders";
import { instructionWriteAllowed } from "@/lib/instruction-authoring";
import { CreateInstruction } from "./create-instruction";

const subroutes = [
  { href: "/instructions/candidates", label: "Candidates", icon: GitBranch },
  { href: "/instructions/experiments", label: "Experiments", icon: SplitSquareHorizontal },
  { href: "/instructions/releases", label: "Releases", icon: Tag }
];

export default async function InstructionsPage() {
  const state = await loadInstructions();
  const canWrite = state.status === "ready" && await instructionWriteAllowed(state.auth);
  return (
    <div className="grid gap-5">
      <PageHeader title="Instructions" eyebrow="Improve" />
      <StateGate state={state}>
        {({ data }) => (
          <div className="grid gap-5">
            <div className="grid gap-3 md:grid-cols-4">
              <Stat label="Definitions" value={data.definitions.length} />
              <Stat label="Candidates" value={data.candidates.length} />
              <Stat label="Experiments" value={data.experiments.length} />
              <Stat label="Releases" value={data.releases.length} />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {subroutes.map((route) => {
                const Icon = route.icon;
                return (
                  <Link className="flex items-center justify-between border border-border bg-panel p-3 text-sm font-medium hover:bg-muted" href={route.href} key={route.href}>
                    <span className="inline-flex items-center gap-2">
                      <Icon className="size-4" aria-hidden="true" />
                      {route.label}
                    </span>
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
            {canWrite ? <CreateInstruction /> : <p className="text-sm text-muted-foreground">Read-only access. An editor can create definitions and compose immutable drafts.</p>}
            {data.definitions.length ? (
              <section className="grid min-w-0 gap-3 sm:grid-cols-2" aria-label="Instruction definitions">
                {data.definitions.map((definition) => (
                  <Link href={`/instructions/${encodeURIComponent(definition.id)}`} key={definition.id} className="grid min-w-0 gap-3 border border-border bg-panel p-4 hover:bg-muted">
                    <div className="min-w-0"><h2 className="break-words font-medium">{definition.stableKey}</h2><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{definition.id}</p></div>
                    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"><span>{definition.versions.length} saved versions</span><span>{definition.releases.length} releases</span></p>
                    <span className="inline-flex items-center gap-2 text-sm font-medium">Review versions <ArrowRight className="size-4" aria-hidden="true" /></span>
                  </Link>
                ))}
              </section>
            ) : (
              <EmptyState title="No instructions yet" body={canWrite ? "Create a definition above, then compose and review its first immutable draft." : "No definitions are available in this workspace. An editor can create one."} />
            )}
            <Panel title="Instruction sub-objects">
              <p className="text-sm text-muted-foreground">Candidates, experiments, and releases are nested under Instructions.</p>
            </Panel>
          </div>
        )}
      </StateGate>
    </div>
  );
}

import Link from "next/link";
import { ArrowRight, GitBranch, SplitSquareHorizontal, Tag } from "lucide-react";
import { EmptyState, PageHeader, Panel, StateGate, Stat, Table } from "../components";
import { loadInstructions } from "@/lib/loaders";

const subroutes = [
  { href: "/instructions/candidates", label: "Candidates", icon: GitBranch },
  { href: "/instructions/experiments", label: "Experiments", icon: SplitSquareHorizontal },
  { href: "/instructions/releases", label: "Releases", icon: Tag }
];

export default async function InstructionsPage() {
  const state = await loadInstructions();
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
            {data.definitions.length ? (
              <Table>
                <thead>
                  <tr className="border-b border-border bg-muted text-left text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2 font-medium">instruction</th>
                    <th className="px-3 py-2 font-medium">versions</th>
                    <th className="px-3 py-2 font-medium">active releases</th>
                  </tr>
                </thead>
                <tbody>
                  {data.definitions.map((definition) => (
                    <tr className="border-b border-border last:border-0" key={definition.id}>
                      <td className="px-3 py-3">
                        <p className="font-medium">{definition.stableKey}</p>
                        <p className="font-mono text-xs text-muted-foreground">{definition.id}</p>
                      </td>
                      <td className="px-3 py-3">{definition.versions.length}</td>
                      <td className="px-3 py-3">{definition.releases.length}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="No instructions yet" body="Prompt definitions and versions will appear after SDK or API calls persist them." />
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

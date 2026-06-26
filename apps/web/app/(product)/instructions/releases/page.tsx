import { PageHeader, StateGate, Table, EmptyState, Notice } from "../../components";
import { loadInstructions } from "@/lib/loaders";

export default async function ReleasesPage() {
  const state = await loadInstructions();
  return (
    <div className="grid gap-5">
      <PageHeader title="Releases" eyebrow="Instructions" />
      <Notice>Release promotion and rollback remain approval-gated operations.</Notice>
      <StateGate state={state}>
        {({ data }) =>
          data.releases.length ? (
            <Table>
              <thead>
                <tr className="border-b border-border bg-muted text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2 font-medium">release</th>
                  <th className="px-3 py-2 font-medium">stage</th>
                  <th className="px-3 py-2 font-medium">scope</th>
                  <th className="px-3 py-2 font-medium">active</th>
                </tr>
              </thead>
              <tbody>
                {data.releases.map((release) => (
                  <tr className="border-b border-border last:border-0" key={String(release.id)}>
                    <td className="px-3 py-3 font-mono text-xs">{String(release.id)}</td>
                    <td className="px-3 py-3">{String(release.stage ?? "")}</td>
                    <td className="px-3 py-3">{String(release.scope_type ?? release.scopeType ?? "")}</td>
                    <td className="px-3 py-3">{String(release.active ?? "")}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No releases yet" body="Instruction releases will appear after approval-gated promotions." />
          )
        }
      </StateGate>
    </div>
  );
}

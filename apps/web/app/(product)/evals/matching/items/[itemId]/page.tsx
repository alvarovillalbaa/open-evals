import { connection } from "next/server";
import { LinkButton, PageHeader, StateGate } from "../../../../components";
import { loadMatchingResource } from "@/lib/eval-matching";
import { MatchingResourceEditor } from "../../matching-editor";
import { MatchingHistory } from "../../matching-view";
export default async function MatchingResourcePage({ params }: { params: Promise<{ itemId: string }> }) {
  await connection(); const { itemId } = await params; const state = await loadMatchingResource("item", itemId);
  return <div className="grid min-w-0 gap-6"><PageHeader title="Saved Eval Item" actions={<LinkButton href="/evals/matching">Compose evaluators</LinkButton>} /><StateGate state={state} accessDeniedTitle="Saved evaluator unavailable" accessDeniedBody="Use a workspace session with read access.">{({ data }) => data.resource ? <><MatchingResourceEditor resource={data.resource} kind="item" workspaceId={data.workspaceId} canWrite={data.canWrite} items={data.items} /><MatchingHistory kind="item" resource={data.resource} /></> : <section className="border border-dashed border-border p-4"><h2 className="font-semibold">Saved item not found</h2><p className="mt-2 text-sm text-muted-foreground">No accessible saved item exists at this address.</p></section>}</StateGate></div>;
}

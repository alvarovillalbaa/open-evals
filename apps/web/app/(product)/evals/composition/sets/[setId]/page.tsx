import { connection } from "next/server";
import { LinkButton, PageHeader, StateGate } from "../../../../components";
import { loadCompositionResource } from "@/lib/eval-composition";
import { CompositionResourceEditor } from "../../composition-editor";
import { CompositionHistory } from "../../composition-view";
export default async function CompositionResourcePage({ params }: { params: Promise<{ setId: string }> }) {
  await connection(); const { setId } = await params; const state = await loadCompositionResource("set", setId);
  return <div className="grid min-w-0 gap-6"><PageHeader title="Saved Eval Set" actions={<LinkButton href="/evals/composition">Compose evaluators</LinkButton>} /><StateGate state={state} accessDeniedTitle="Saved evaluator unavailable" accessDeniedBody="Use a workspace session with read access.">{({ data }) => data.resource ? <><CompositionResourceEditor resource={data.resource} kind="set" workspaceId={data.workspaceId} canWrite={data.canWrite} items={data.items} /><CompositionHistory kind="set" resource={data.resource} /></> : <section className="border border-dashed border-border p-4"><h2 className="font-semibold">Saved set not found</h2><p className="mt-2 text-sm text-muted-foreground">No accessible saved set exists at this address.</p></section>}</StateGate></div>;
}

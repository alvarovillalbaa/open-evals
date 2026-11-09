import { connection } from "next/server";
import { LinkButton, PageHeader, StateGate } from "../../../../../../components";
import { loadCompositionVersion } from "@/lib/eval-composition";
import { compositionPath } from "@/lib/eval-composition-types";
import { CompositionRecordView } from "../../../../composition-view";
export default async function CompositionVersionPage({ params }: { params: Promise<{ itemId: string; versionId: string }> }) {
  await connection(); const { itemId, versionId } = await params; const state = await loadCompositionVersion("item", itemId, versionId);
  return <div className="grid min-w-0 gap-6"><PageHeader title="Exact saved item version" actions={<><LinkButton href="/evals/composition">Compose evaluators</LinkButton><LinkButton href={compositionPath("item", itemId)}>History and next version</LinkButton></>} /><StateGate state={state} accessDeniedTitle="Saved version unavailable" accessDeniedBody="Use a workspace session with read access.">{({ data }) => data.record ? <CompositionRecordView record={data.record} /> : <section className="border border-dashed border-border p-4"><h2 className="font-semibold">Exact version not found</h2><p className="mt-2 text-sm text-muted-foreground">No accessible exact item version exists at this address.</p></section>}</StateGate></div>;
}

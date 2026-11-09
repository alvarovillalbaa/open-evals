import { connection } from "next/server";
import { LinkButton, PageHeader, StateGate } from "../../../../../../components";
import { loadCompositionVersion } from "@/lib/eval-composition";
import { compositionPath } from "@/lib/eval-composition-types";
import { CompositionRecordView } from "../../../../composition-view";
export default async function CompositionVersionPage({ params }: { params: Promise<{ setId: string; versionId: string }> }) {
  await connection(); const { setId, versionId } = await params; const state = await loadCompositionVersion("set", setId, versionId);
  return <div className="grid min-w-0 gap-6"><PageHeader title="Exact saved set version" actions={<><LinkButton href="/evals/composition">Compose evaluators</LinkButton><LinkButton href={compositionPath("set", setId)}>History and next version</LinkButton></>} /><StateGate state={state} accessDeniedTitle="Saved version unavailable" accessDeniedBody="Use a workspace session with read access.">{({ data }) => data.record ? <CompositionRecordView record={data.record} /> : <section className="border border-dashed border-border p-4"><h2 className="font-semibold">Exact version not found</h2><p className="mt-2 text-sm text-muted-foreground">No accessible exact set version exists at this address.</p></section>}</StateGate></div>;
}

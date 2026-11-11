import { connection } from "next/server";
import { LinkButton, PageHeader, StateGate } from "../../../../../../components";
import { loadMatchingVersion } from "@/lib/eval-matching";
import { matchingPath } from "@/lib/eval-matching-types";
import { MatchingRecordView } from "../../../../matching-view";
export default async function MatchingVersionPage({ params }: { params: Promise<{ setId: string; versionId: string }> }) {
  await connection(); const { setId, versionId } = await params; const state = await loadMatchingVersion("set", setId, versionId);
  return <div className="grid min-w-0 gap-6"><PageHeader title="Exact saved item version" actions={<><LinkButton href="/evals/matching">Compose evaluators</LinkButton><LinkButton href={matchingPath("set", setId)}>History and next version</LinkButton></>} /><StateGate state={state} accessDeniedTitle="Saved version unavailable" accessDeniedBody="Use a workspace session with read access.">{({ data }) => data.record ? <MatchingRecordView record={data.record} /> : <section className="border border-dashed border-border p-4"><h2 className="font-semibold">Exact version not found</h2><p className="mt-2 text-sm text-muted-foreground">No accessible exact item version exists at this address.</p></section>}</StateGate></div>;
}

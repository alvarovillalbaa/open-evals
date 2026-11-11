import Link from "next/link";
import { connection } from "next/server";
import { LinkButton, PageHeader, StateGate } from "../../components";
import { loadMatching } from "@/lib/eval-matching";
import { matchingPath } from "@/lib/eval-matching-types";
import { MatchingWorkbench } from "./matching-editor";

export default async function MatchingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const params = await searchParams;
  const requested = params.itemId !== undefined || params.itemVersionId !== undefined ? {
    itemId: typeof params.itemId === "string" && params.itemId.length <= 36 ? params.itemId : undefined,
    itemVersionId: typeof params.itemVersionId === "string" && params.itemVersionId.length <= 36 ? params.itemVersionId : undefined
  } : undefined;
  const state = await loadMatching(requested);
  return <div className="grid min-w-0 gap-6"><PageHeader title="Exact checks and mixed sets" actions={<><LinkButton href="/evals">Evals</LinkButton><LinkButton href="/evals/plans?family=matching">New matching HTTP plan</LinkButton><LinkButton href="/evals/composition">Create contains checks</LinkButton></>} /><p className="max-w-3xl text-sm text-muted-foreground">Save literal exact-match Eval Items and combine them with existing contains checks in ordered Eval Sets. Bind exact saved versions to saved inputs in a matching HTTP plan. Every preview and save is separate from execution.</p><StateGate state={state} accessDeniedTitle="Evaluator matching unavailable" accessDeniedBody="Use a workspace session with evaluation read access.">{({ data }) => <>
    {data.requestedSourceUnavailable ? <p role="alert" className="text-sm text-danger">The requested exact item version is unavailable in this workspace. Choose an accessible saved version; no reference was substituted.</p> : null}
    <MatchingWorkbench key={`${data.workspaceId}/${data.initialMember?.itemId ?? ""}/${data.initialMember?.versionId ?? ""}`} workspaceId={data.workspaceId} canWrite={data.canWrite} items={data.items} initialMember={data.initialMember} />
    <div className="grid min-w-0 gap-6 lg:grid-cols-2"><section className="grid min-w-0 content-start gap-3" aria-label="Saved reusable Eval Items"><h2 className="font-semibold">Saved Eval Items at page load</h2>{data.items.length ? <ul className="grid gap-3">{data.items.map(item => <li className="min-w-0 border border-border bg-panel p-4" key={`${"profile" in item.head ? "v3" : "v2"}/${item.itemId}`}><Link className="break-words font-medium underline" href={"profile" in item.head ? matchingPath("item", item.itemId) : `/evals/composition/items/${encodeURIComponent(item.itemId)}`}>{item.name}</Link><p className="text-xs text-muted-foreground">Latest listed version {item.head.version} · {item.versionCount} saved versions</p></li>)}</ul> : <p className="text-sm text-muted-foreground">No reusable items were listed when this page loaded.</p>}</section><section className="grid min-w-0 content-start gap-3" aria-label="Saved composed Eval Sets"><h2 className="font-semibold">Saved Eval Sets at page load</h2>{data.sets.length ? <ul className="grid gap-3">{data.sets.map(set => <li className="min-w-0 border border-border bg-panel p-4" key={set.setId}><Link className="break-words font-medium underline" href={matchingPath("set", set.setId)}>{set.name}</Link><p className="text-xs text-muted-foreground">Latest listed version {set.head.version} · {set.memberCount} members · {set.versionCount} saved versions</p></li>)}</ul> : <p className="text-sm text-muted-foreground">No composed sets were listed when this page loaded.</p>}</section></div><p className="text-xs text-muted-foreground">Libraries list up to 100 recent resources from page load. Newly saved items are available in this page's member selector. <Link className="underline" href="/evals/matching">Reload saved libraries</Link> after preserving any unfinished draft.</p>
  </>}</StateGate></div>;
}

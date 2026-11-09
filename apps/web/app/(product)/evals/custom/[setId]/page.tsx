import { LinkButton, PageHeader, StateGate } from "../../../components";
import { loadCustomEvalDetail } from "@/lib/custom-evals";
import { CustomEvalEditor } from "../custom-eval-editor";

export default async function CustomEvalPage({ params }: { params: Promise<{ setId: string }> }) {
  const { setId } = await params;
  const state = await loadCustomEvalDetail(setId);
  return (
    <div className="grid min-w-0 gap-6">
      <PageHeader title="Custom Eval Set" actions={<LinkButton href="/evals/custom">Custom Eval Sets</LinkButton>} />
      <StateGate state={state} accessDeniedTitle="Custom Eval Set unavailable" accessDeniedBody="Sign in to this workspace to view this evaluator.">
        {({ data }) => data.detail ? <CustomEvalEditor key={data.detail.id} initialDetail={data.detail} canWrite={data.canWrite} /> : (
          <section className="border border-dashed border-border bg-panel p-6"><h2 className="font-semibold">Eval Set not found</h2><p className="mt-2 text-sm text-muted-foreground">This workspace has no custom Eval Set at this address.</p></section>
        )}
      </StateGate>
    </div>
  );
}

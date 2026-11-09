"use client";

export default function CustomEvalError({ unstable_retry }: { unstable_retry: () => void }) {
  return (
    <section className="grid min-w-0 gap-4 border border-border bg-panel p-6" role="alert">
      <div><h1 className="text-xl font-semibold">Custom Eval Set unavailable</h1><p className="mt-2 text-sm text-muted-foreground">The evaluator could not be loaded. Try again or return to the saved sets.</p></div>
      <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={() => unstable_retry()} className="min-h-9 rounded-md border border-border px-3 text-sm font-medium">Try again</button><a href="/evals/custom" className="text-sm underline underline-offset-4">Saved Eval Sets</a></div>
    </section>
  );
}

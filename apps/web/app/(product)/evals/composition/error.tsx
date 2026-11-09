"use client";
export default function CompositionError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <section className="grid gap-3 border border-border bg-panel p-4"><h2 className="font-semibold">Evaluator composition could not be loaded</h2><p className="text-sm text-muted-foreground">Saved data was not replaced. Retry this read when the workspace is available.</p><button className="min-h-9 w-fit border border-border px-3 py-2 text-sm" type="button" onClick={unstable_retry}>Retry loading composition</button></section>;
}

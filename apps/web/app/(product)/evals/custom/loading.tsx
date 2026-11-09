export default function CustomEvalsLoading() {
  return (
    <section className="min-w-0 border border-border bg-panel p-6" aria-busy="true">
      <h1 className="text-xl font-semibold">Custom Eval Sets</h1>
      <p className="mt-3 text-sm text-muted-foreground" role="status">Loading saved evaluators and versions…</p>
    </section>
  );
}

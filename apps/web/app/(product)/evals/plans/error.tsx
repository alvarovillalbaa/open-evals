"use client";

export default function Error({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <section className="grid min-w-0 gap-3 border border-border bg-panel p-4">
      <h2 className="font-semibold">Saved HTTP eval plans are unavailable</h2>
      <p className="text-sm text-muted-foreground">If you started an execution, inspect its saved run before creating another. Reloading this page does not cancel a request already sent.</p>
      <div><button type="button" className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => unstable_retry()}>Reload this page</button></div>
    </section>
  );
}

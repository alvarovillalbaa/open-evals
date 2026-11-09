"use client";

export default function ProvidedOutputError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <section className="grid gap-3 border border-border bg-panel p-5" role="alert"><h1 className="text-xl font-semibold">Supplied-output data could not be loaded</h1><p className="text-sm text-muted-foreground">The workspace or stored data is unavailable. This error does not confirm or cancel an earlier Run request. Keep an uncertain run's ID and retry its unchanged request.</p><div><button className="min-h-9 rounded-md border border-border px-3 py-2 text-sm font-medium" onClick={() => unstable_retry()}>Try loading again</button></div></section>;
}

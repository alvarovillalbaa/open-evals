"use client";

export default function CustomDatasetError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <section className="grid min-w-0 gap-3 border border-border bg-panel p-4"><h2 className="font-semibold">The saved dataset could not be loaded</h2><p className="text-sm text-muted-foreground">The workspace data could not be displayed. If a save was in progress, inspect saved history before starting another version.</p><div><button type="button" className="min-h-9 rounded-md border border-border px-3 py-2 text-sm font-medium" onClick={() => unstable_retry()}>Try loading again</button></div></section>;
}

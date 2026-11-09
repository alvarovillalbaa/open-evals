export default function LoadingCustomDatasets() {
  return <div className="grid min-w-0 gap-4" aria-busy="true"><p role="status" className="text-sm text-muted-foreground">Loading saved datasets…</p><div className="h-12 animate-pulse bg-muted" /><div className="h-72 animate-pulse border border-border bg-panel" /></div>;
}

# Adapter Development

Trace source adapters implement:

```ts
interface TraceSourceAdapter {
  kind: string
  probe(connection): Promise<CapabilityReport>
  testConnection(connection): Promise<ConnectionTestResult>
  importBatch(request): Promise<ImportBatchResult>
  normalizeTrace(raw): Promise<CanonicalTrace>
  checkpoint(state): Promise<Checkpoint>
  supportsWebhooks(): boolean
  supportsBackfill(): boolean
}
```

Do not mark a provider connection functional unless the executable adapter path and fixture tests exist. If a provider only supports file exports, label it as an export adapter.

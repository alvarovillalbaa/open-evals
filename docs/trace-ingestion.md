# Trace Ingestion

Implemented adapters:

- OTLP/HTTP JSON ingestion.
- Generic JSON and JSONL upload.
- OpenAI and OpenAI Agents export-compatible normalization.
- Promptfoo artifacts.
- Langfuse export-compatible normalization.
- DeepEval/Confident AI export-compatible normalization.

All adapters normalize into the canonical trace/span model and keep provider IDs and attributes. Raw artifacts are stored separately from normalized records. Deduplication uses source, external trace ID, and content hash. Redaction can be previewed before outbound judge calls.

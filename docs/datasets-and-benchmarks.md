# Datasets and Benchmarks

Dataset rows can contain input, optional expected output, context, history, trace fixtures, tool fixtures, metadata, severity, language, provenance, and review status.

Seeded benchmark fixtures:

- `gsm8k-mini`: recognized text/reasoning-style fixture.
- `bfcl-mini`: recognized agent/tool-style fixture based on BFCL concepts.

Full benchmark datasets are not vendored unless licenses permit it. Import scripts or user-supplied downloads should be used for larger recognized benchmarks.

Executable importers:

- `Gsm8kImporter` accepts JSON or JSONL records with `question` and `answer` fields and creates golden reasoning rows plus a critical string-check Eval Set.
- `BfclImporter` accepts JSON or JSONL records with `prompt` and `expected_tool_call` fields and creates golden agent/tool rows plus a critical tool-call Eval Set.
- Importers reject missing rows or missing required fields instead of displaying unsupported benchmarks as functional.

# Architecture

`open-evals` is a Vercel-native, local-first Turborepo. PostgreSQL is authoritative for control-plane state. Raw artifacts are content-addressed in local `.data/artifacts` or private Vercel Blob. Next.js App Router serves the product UI and versioned API routes. Optional Python engines run outside the Next.js server process.

The product has two areas: Evals and Improve. Evals combines existing dataset,
scenario and evaluator collections, with external benchmark provenance shown
separately. `loadEvals` authenticates once through the existing loader and runs
the same two workspace-scoped catalogue queries; no database relation is inferred
from former page nesting. Improve retains the Instructions access policy and
loads campaign history independently. Missing database/auth access remains an
unavailable state, without synthetic workspace records.

SDK single/batch routes remain evidence transport. The manual form, CLI trace
file/OTLP commands and MCP ingestion tool are removed; the unused OTLP HTTP route
keeps its auth guard and returns 410 without reading or persisting the body.
See [product scope](product-surface.md) and [SDK privacy](trace-ingestion.md).

Important invariants:

- Run plans and sample manifests are immutable.
- Every sample has a stable `rowId`.
- Result processing is by `rowId`, never list position.
- Prompt versions are immutable and releases are atomic pointer updates.
- Historical data policies deny by default.
- Official gates persist decisions; downstream systems do not reconstruct them.

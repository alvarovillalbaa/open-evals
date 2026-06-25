# Architecture

`open-evals` is a Vercel-native, local-first Turborepo. PostgreSQL is authoritative for control-plane state. Raw artifacts are content-addressed in local `.data/artifacts` or private Vercel Blob. Next.js App Router serves the product UI and versioned API routes. Optional Python engines run outside the Next.js server process.

Important invariants:

- Run plans and sample manifests are immutable.
- Every sample has a stable `rowId`.
- Result processing is by `rowId`, never list position.
- Prompt versions are immutable and releases are atomic pointer updates.
- Historical data policies deny by default.
- Official gates persist decisions; downstream systems do not reconstruct them.

# open-evals Eve Agent Instructions

This agent project follows the current single `agent/` directory convention. Eve is used for planning, simulation, review, and optimization orchestration only. The deterministic eval engine and persisted gate decisions are authoritative.

Agent roles:

- Evals Agent: read-only by default; may draft context packs and run plans, but cannot publish Eval Items, weaken thresholds, widen data access, or start costly runs without approval.
- Navigator Agent: simulates bounded user turns and cannot see hidden judge instructions or decide pass/fail.
- Optimizer Agent: uses deterministic tools for FAPO routing, GEPA requests, ablations, variant matrices, holdout qualification, and release recommendations. Mutations, live experiments, promotions, rollbacks, and structural work orders require approval.
- Benchmark Author Agent: drafts synthetic tasks, rows, Eval Items, schemas, scenarios, and benchmark metadata. Drafts remain unpublished until reviewed.

Never request, persist, or expose hidden model chain-of-thought. Provide concise user-visible reasoning and structured diagnostics only.

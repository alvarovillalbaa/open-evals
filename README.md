# open-evals

`open-evals` is an MIT-licensed, provider-independent platform for two product functions:

1. Evals
2. Self-improvement of system prompt instructions

It is not an observability platform. It imports traces, spans, tool calls, prompt hashes, provider messages, and concise evaluator rationales only as evidence for eval rows, failure attribution, calibration, prompt optimization, and release decisions. It does not provide generic trace exploration, APM, uptime monitoring, infrastructure dashboards, or log search.

## What Works Locally

- Deterministic evals without AI credentials.
- OTLP/HTTP JSON and generic JSON/JSONL trace import.
- Promptfoo, OpenAI export, Langfuse export, and DeepEval export adapters through executable fixture-compatible normalization paths.
- Immutable run plan and sample manifest resolution with stable row IDs.
- Multi-field Eval Item output schemas, dynamic result columns, hierarchical gates, stop-policy primitives, calibration/statistics primitives, prompt release resolution, sticky A/B/n assignment, and rollback metadata.
- Demo HTTP and MCP target adapters, TypeScript SDK, Python SDK, CLI, local artifact storage, and Docker Compose PostgreSQL.
- Optional Python optimizer runtime with built-in hill climbing and structured GA, plus honest capability gates for official GEPA, DSPy, Optuna/TPE, and SMAC packages.

## Quick Start

```bash
corepack prepare pnpm@10.14.0 --activate
pnpm install
pnpm setup:local
pnpm dev
```

Open `http://127.0.0.1:3216`. The product surface opens directly to `Runs`. The left sidebar contains `Runs`, `Benchmarks`, `Scenarios`, `Instructions`, and `Campaigns`.

## Hosted Setup

Use Vercel for the web/control plane and Supabase for auth plus Postgres. Configure:

- `AUTH_MODE=hosted`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `DATABASE_URL` or `SUPABASE_DB_URL`
- `API_KEY_PEPPER`
- `AUTH_SECRET`

Database enablement requires an approved target and migration/access review.
The existing RLS migration changes grants across `public`; do not apply it
unchanged to a shared app database. Current production configuration and
Supabase login/persistence remain unverified. See [deployment requirements](docs/deployment.md)
and the [hosted readiness receipt](docs/results/2026/10-28/hosted-readiness.md).
Local mode works without Supabase Auth, but persistence routes and pages require
PostgreSQL and do not synthesize workspace records when it is unavailable.

Trace ingestion is available through:

- manual import at `/runs/import`
- CLI: `open-evals ingest file --file traces.jsonl --endpoint http://127.0.0.1:3216`
- MCP: set `OPEN_EVALS_URL` and use the `ingest_traces` tool
- SDK: `new OpenEvalsClient({ endpoint, apiKey }).submitTrace(trace)`

## Commands

```bash
pnpm setup:local
pnpm dev
pnpm db:migrate
pnpm db:seed
pnpm lint
pnpm typecheck
pnpm test
pnpm test:python
pnpm test:e2e
pnpm build
pnpm doctor
```

## Repository Layout

- `apps/web`: Next.js App Router control plane and API routes.
- `apps/cli`: `open-evals` CLI command surface.
- `packages/core`: canonical trace, eval, prompt, experiment, and statistics contracts.
- `packages/adapters`: trace sources, target adapters, redaction, and artifact storage.
- `packages/db`: first-class PostgreSQL schema and seed/migration scripts.
- `packages/sdk`: TypeScript SDK.
- `packages/mcp`: safe MCP tools.
- `packages/statistics`: statistics exports.
- `packages/test-fixtures`: deterministic demo fixtures.
- `python/open_evals_optimizers`: optional Python optimizer engines and SDK.
- `workflows`: Vercel Workflow-compatible workflow entry definitions.
- `agent`: Eve agent instructions and approval metadata.
- `docs`: architecture, contracts, privacy, deployment, and reference notes.
- `examples`: demo traces, scenarios, and CI templates.

## Eval Sets and Eval Items

An Eval Item is an evaluator definition, not a dataset row. Eval Items can emit arbitrary strict output schemas: scores, labels, booleans, text, integers, numbers, and JSON. The seeded demo includes a multi-output judge with four score fields and two label fields, plus string-check, text-similarity, and trace-check items.

## Historical Versus Live Evals

Historical trace evaluation is fail-closed by default. A run plan must resolve a data-policy fingerprint before historical outputs can be judged. Live target modes include provided output, HTTP target, MCP target, local target, and registered live adapters. Blank target output fails before judging.

## Prompt Releases and Optimization

Prompt versions are immutable component snapshots with full compiled text and content hashes. Release resolution order is:

```text
explicit eval-only candidate override
→ active experiment assignment
→ user/company/project/workspace/platform release
→ baseline version
```

The core compiler now supports explicit typed bindings and text/include/if/each
operation blocks under `prompt-composition-v1`, with immutable rendered and
authoring snapshots. See [the composition contract](docs/prompt-management.md)
and [source/check evidence](docs/results/2026/10-28/prompt-composition.md).
The Instructions editor now has definition creation, authenticated preview,
immutable draft saves and persisted-version review. Source snapshots use the
existing JSONB column without a migration. Project keys are limited to their
own project's targeted definitions; hosted local/demo ownership is read-only.
Legacy demonstration versions retain their original text/hash as read-only.
See [the authoring contract](docs/proposals/prompt-authoring-contract.md) and
[implementation evidence and remaining checks](docs/results/2026/10-28/prompt-authoring.md).
All 58 separately approved authoring checks passed in disposable PostgreSQL and
desktop/narrow Chromium. Their receipt preserves case results, earlier harness
failures and proof limits. The temporary CI workflow has been retired.
All 55 explicitly approved focused compiler cases passed; the
[exact report](docs/results/2026/10-28/prompt-composition-checks.json) records the
checked source and totals. This run is separate from the existing Vitest suite.

The [prompt client contract](docs/prompt-clients.md) describes the new real
SDK/CLI authoring calls, endpoint-bound review files and offline source diff.
All 71 separately approved client checks passed, including four plain-Node
manifest executable scenarios. The CLI declares the existing locked `tsx`
runtime and uses its JavaScript launcher. See [the client receipt](docs/results/2026/10-28/prompt-clients.md)
for exact source, earlier harness failures and hosted proof limits. Temporary
client CI has been retired.

The shared optimization control plane supports one-shot candidate generation, FAPO-style routing, hill climbing, structured GA, optional official GEPA, and optional DSPy engines. Target prompt campaigns cannot mutate their own judges or thresholds. Blind holdout examples are blocked from reflection.

## A/B/n

Prompt variants are experiment arms. Assignment uses deterministic sticky HMAC bucketing and records exposure before target invocation. No winner is a valid decision when uncertainty, safety, cost, latency, or practical-effect guardrails fail.

## Privacy

Field-level redaction, PII/secret detectors, local artifact storage, fail-closed historical policy, audit-oriented schema fields, and outbound payload previews are built into the local control plane. Hidden model chain-of-thought is never requested, synthesized, persisted, or exposed.

## Optional Dependencies

Core evals do not require AI credentials, Python, Blob, Workflows, Queues, or Eve. Hosted auth, Blob, Workflows, Queues, Sandbox, Eve, and optimizer engines report disabled or local-fallback status until their packages, credentials, and environment flags are enabled:

- `GEPA_ENABLED=true`
- `DSPY_ENABLED=true`
- `SMAC_ENABLED=true`
- `PYTHON_OPTIMIZERS_ENABLED=true`
- `AUTH_MODE=hosted`
- `ARTIFACT_STORAGE_DRIVER=vercel_blob`
- `QUEUES_ENABLED=true`
- `EVE_ENABLED=true`

## Screenshots

Screenshots are intentionally left as placeholders for maintainers to capture from a local seeded run.

## Roadmap

- Additional provider-specific pull APIs and webhook fixtures beyond Langfuse/OpenAI export/Promptfoo/DeepEval paths.
- More benchmark importers behind license checks.
- Structural optimization work orders backed by connected GitHub pull requests.
- Optional large-scale analytics adapter behind a non-required interface.

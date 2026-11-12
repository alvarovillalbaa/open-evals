# open-evals

Last updated: 2026-11-10

`open-evals` is an MIT-licensed, provider-independent platform for two product functions:

1. Evals
2. Improve: self-improvement of system prompt instructions

Application SDKs send traces, spans, tool calls, prompt hashes, provider messages,
and concise evaluator rationales as evidence for eval rows, failure attribution,
calibration, prompt optimization, and release decisions. The product has exactly
two areas, **Evals** and **Improve**. It has no standalone observability, APM,
uptime, infrastructure dashboard or log-search area.

## What Works Locally

- Deterministic evals without AI credentials.
- TypeScript and Python SDK evidence delivery, with explicit TypeScript batching.
- One Evals catalogue for persisted dataset inputs, scenario inputs and evaluator
  definitions, with external benchmarks presented separately. IDs and versions
  are retained without inferring parent membership from the old page layout.
- Improve links composable, versioned instruction authoring and saved campaigns;
  pending preparation requests remain distinct from actual campaign execution.
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

Open `http://127.0.0.1:3216`. The product opens at **Evals**. The same two-area
navigation is available on desktop and narrow screens: Evals contains the
catalogue, Runs and SDK connection; Improve contains Instructions and Campaigns.
Old benchmark/scenario URLs redirect to the corresponding Evals sections.

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

Send trace evidence through the application SDK:
`new OpenEvalsClient({ endpoint, apiKey }).submitTrace(trace)`, or Python
`OpenEvalsPythonClient(...).submit_trace(trace)`. Configure the service URL and
server-held key explicitly. [SDK connection and privacy](docs/trace-ingestion.md)
documents the real payload and response contracts; `/evals/sdk` provides the
same starting point in the product. No public package installation is implied.

The manual trace form, CLI trace ingestion commands and MCP `ingest_traces`
workflow are retired. Old `/runs/import` links redirect to SDK connection, and
the unused OTLP ingestion route returns an authenticated 410. SDK single/batch
transport, current access checks and stored evidence are preserved. Historical
normalizer adapters remain source-level compatibility code, not upload workflows.

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
- `python/open_evals_harbor`: separately installed, pinned local Harbor task runner.
- `workflows`: Vercel Workflow-compatible workflow entry definitions.
- `agent`: Eve agent instructions and approval metadata.
- `docs`: architecture, contracts, privacy, deployment, and reference notes.
- `examples`: demo traces, scenarios, and CI templates.

## Eval Sets and Eval Items

An Eval Item is an evaluator definition, not a dataset row. Eval Items can emit arbitrary strict output schemas: scores, labels, booleans, text, integers, numbers, and JSON. The seeded demo includes a multi-output judge with four score fields and two label fields, plus string-check, text-similarity, and trace-check items.

The Evals catalogue keeps input collections, evaluators and external benchmarks
distinct. Existing storage does not establish benchmark→dataset or
scenario→evaluator-set membership, so the UI does not invent it.
[Harbor tasks](docs/runbooks/harbor-tasks.md) have immutable source versions,
project-bound plans, explicit local CLI execution and bounded saved native
reward reports. The initial profile is Harbor0.25.0/schema1.4 with one Linux
Dockerfile task and shared verifier; broader profiles and hosted acceptance
remain separate. The catalogue also links a
[custom Eval Set editor](docs/custom-evals.md): workspace sessions save a
critical contains evaluator and explicit one-item membership as immutable
versions, with retry recovery and stale-head conflicts. Saving does not launch
an eval. The new [reusable evaluator composition](docs/evaluator-composition.md)
flow saves independent contains items and ordered sets of exact item versions.
Its explicit HTTP v2 profile retains overlapping memberships and scores each
unique row/item pair once, with one target claim per input row. Existing v1
sets and plans retain their original contracts. All 128 focused checks and the
full root build passed at checked QA source `b3442e2`, including compiled-app
browser execution with real disposable SQL and authored DNS/HTTPS responses.
See the [composition result](docs/results/2026/11-09/evaluator-composition.md).
Native DNS/socket/TLS and hosted Auth/RLS acceptance remain unverified. See
[the product contract and remaining work](docs/product-surface.md).

The [focused product-surface receipt](docs/results/2026/11-09/product-surface-checks.md)
records eight navigation and eleven actual-module protocol passes in focused
invocations, preserving the failed first harness. Browser/hosted acceptance is
separate; this historical catalogue receipt does not prove native task or campaign execution.

The [custom evaluator checks](docs/results/2026/11-09/custom-eval-checks.md)
record38pure-source passes. [Twelve separate real PostgreSQL cases](docs/results/2026/11-09/custom-eval-postgres-checks.md)
passed with observed database/cluster cleanup; full build/alias observations and
preserved failures are in the [delivery record](docs/results/2026/11-09/custom-eval-delivery.md).
HTTP/Auth, browser interaction, hosted persistence and archive readback require
separate proof. Existing closed instruction/campaign receipts retain their own sources.

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

From a saved canonical version in Instructions, an editor can now select a
mutable component and objective, explicitly preview six existing deterministic
ablation operations, then save a pending preparation request. Server-owned
fingerprints bind the request to immutable baseline source, including unused
typed authoring data. Request and minimal audit metadata commit together in
the existing tables. Read-only history and exact-ID recovery retain submitted
requests; global navigation can discard unsubmitted local input.
This creates no campaign row, candidates, approval decision, evaluation, model
call or release change. Approver and self-approval policy remain future work.
See [campaign requests](docs/campaign-requests.md), the
[53-check proposal](docs/proposals/campaign-request-checks.md) and
[source receipt](docs/results/2026/10-30/campaign-requests.md).
All 26 core, 19 PostgreSQL and eight desktop/narrow Chromium checks passed at
`e3cec0fffb80c0a3d5896110a897508cb7ff861d`; see the
[53-check result](docs/results/2026/10-31/campaign-request-checks.md) for the
fixture-marker and explicit-label repairs, earlier failures and cleanup.
Temporary campaign CI is retired. The earlier 55/58/71 passing scopes above
are independent evidence; hosted production and campaign execution remain open.

The shared optimization control plane supports one-shot candidate generation, FAPO-style routing, hill climbing, structured GA, optional official GEPA, and optional DSPy engines. Target prompt campaigns cannot mutate their own judges or thresholds. Blind holdout examples are blocked from reflection.
Those optimizer primitives are separate from the Instructions preparation flow;
the new request endpoints do not invoke them.

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

- Further Harbor execution profiles, provider/model performance and hosted acceptance.
- Further evaluator kinds and target runtimes, followed by campaign use of
  pinned saved definitions. Native network and hosted acceptance remain
  separate verification gates.
- Campaign execution and approved production A/B safety rollouts from Improve.
- More benchmark importers behind license checks.
- Structural optimization work orders backed by connected GitHub pull requests.
- Optional large-scale analytics adapter behind a non-required interface.

Matching v3 adds literal exact checks and mixed saved contains/exact membership.
See [the matching contract and current qualification boundary](docs/evaluator-matching.md).
Its [66-case result](docs/results/2026/11-12/evaluator-matching.md) retains the
separate core, real PostgreSQL and Chromium sources, all earlier failures and
the final successful build/cleanup. Hosted activation remains pending.

# Prompt client runtime and focused checks

Status: explicitly approved by the owner on 2026-10-28: “Approve runtime repair
and 71 checks.” Execution is being prepared within the scope below; no result
is claimed here. Earlier compiler/authoring approvals are closed and do not
cover these new clients.

## Concrete change for approval

The [client implementation](../prompt-clients.md) replaces fictional CLI prompt
success with real typed SDK/API requests, endpoint-bound reviewed draft files,
immutable retry inputs and offline source comparison. Source and authored
checks are reviewable without dependency changes. The current native CLI bin
still points to TypeScript with a plain Node shebang and cannot be claimed
usable from source inspection alone.

Approve the exact [runtime repair](cli-runtime.md): change the CLI bin to a
small JavaScript launcher that registers `tsx/esm/api`, and add CLI runtime
dependency `tsx: "4.22.4"`. That version already exists in the canonical lock;
keep the root range and all existing versions/integrities/snapshots unchanged.
No standalone npm publication is included.

## Runner and dependency boundary

Activate the [reviewable inactive workflow](prompt-client-checks.workflow.yml)
temporarily at `.github/workflows/prompt-client-checks.yml`. One standard public
Ubuntu runner, capped at **20 minutes**, uses Node 24.21.0 and pnpm 10.14.0.
Checkout has read-only repository permissions and does not retain credentials.

The workflow generates the lock with lifecycle scripts disabled, preserves its
candidate/diff even if validation fails, and requires the exact single CLI
`tsx` importer edge. It rejects other tracked-file changes or any other lock
byte change before dependency installation. Then it installs the frozen
generated graph and runs only the four explicit test files below. Dependency
downloads use the existing public package graph; no local install is proposed
because Storage Guard's reserve is not met.

After reviewing the generated lock and reports, publish only the approved lock
edge, retire the active workflow and preserve bounded reports under `docs/`.
The runner cannot push changes itself. If generation changes anything else,
stop and review rather than widening the dependency update.

## Exact 71-case scope

| Authored file | Cases | Boundary |
| --- | ---: | --- |
| `packages/sdk/tests/prompts.test.mjs` | 22 | Real checked SDK/parsers; mocked fetch, cancellation and streams |
| `apps/cli/tests/prompt-files.test.ts` | 19 | Disposable authored files, strict decoding/limits, private atomic writes, source diff |
| `apps/cli/tests/prompt-cli.test.ts` | 26 | Actual command/SDK/file logic with mocked fetch; 18 cases plus 8 argument rows |
| `apps/cli/tests/prompt-bin.test.mjs` | 4 | Plain-Node manifest subprocesses and ephemeral loopback HTTP fixtures |

The executable scenarios cover help bootstrap; configuration-only doctor;
create→preview→save→same-ID replay→pull→resolve with full source; and HTTP,
redirect and unsupported-command failures. Child processes have 20-second
deadlines, bounded output and explicit fixture endpoint/key configuration.
They clear Node preload/proxy environment and do not inherit test-runner
`execArgv`. Fixtures close their servers and remove only owned temporary files.
The largest file-limit case writes approximately 34 MiB of disposable data on
the runner. No file fixture contains user content or real credentials.

All cases must pass with no skipped/todo cases and no retries. The explicit
Vitest config avoids the root's `.test.ts`-only include and excludes all older
suites. Artifacts retain exact source/runtime, generated lock/diff, case JSON,
log and relevant source hashes for three days; canonical receipts will retain
the bounded reviewed evidence after the temporary job is removed.

## Proof limits

No browser, app server, database, migration, Supabase/Auth setting, production
configuration, model/provider call, promotion, experiment, release action,
paid enrollment or production data is included. Loopback fixture HTTP proves
the executable/client transport, not the actual Next/PostgreSQL application.
The prior 58 checks remain the separate server/editor receipt. Live hosted
readiness is still [pending](../results/2026/10-28/hosted-readiness.md).

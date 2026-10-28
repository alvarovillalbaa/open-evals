# Focused instruction authoring execution proposal

Status: **explicitly approved by Alvaro on 2026-10-28**, against source/proposal commit `23a6a0b77439cb66f66f5f035190fb3dd1d42405`. Execution is pending activation of the exact reviewed workflow. This does not broaden or rerun the closed 55 compiler checks. The earlier instruction access policy approval was separate from this test/CI approval.

The proposed scope is **58 authored checks**: [30 pure protocol cases](prompt-authoring-core-checks.md), [24 HTTP/database cases](../../apps/web/tests/instruction-authoring.api.mjs), and [four Chromium scenarios](prompt-authoring-browser-checks.md). The [shared disposable fixtures](../../apps/web/tests/instruction-authoring.fixtures.mjs) require explicit disposable-target acknowledgement, loopback URLs and a database named `open_evals_authoring_test_*`.

## Temporary CI operation requiring approval

After approval, copy the exact [inactive workflow proposal](prompt-authoring-checks.workflow.yml) to `.github/workflows/prompt-authoring-checks.yml`. Its path-specific push trigger starts one standard public Ubuntu runner, capped at **20 minutes per attempt**. It uses PostgreSQL 16 as an ephemeral job service and the existing frozen lockfile, Node 24.21.0, pnpm 10.14.0 and locked Chromium. No application dependency or lockfile changes occur. Action commits were resolved through their official GitHub tag refs before pinning; no mutable action tags are executed.

The 30 protocol cases run through native Node type stripping and their four-module source hook. The job then installs the existing dependencies and applies all three existing SQL migrations unchanged to its disposable database. It starts a loopback Next dev server in hosted mode using authored signed-session and project-key fixtures, runs 23 API cases and all four browser cases, then stops that process group. It reuses the same dev directory sequentially for a local/demo-mode server with a hosted marker and runs the final write-denial case. Two dev servers never share the directory concurrently.

The two API invocations select 23 + 1 unique cases by name; filtered TAP records must be reported as skipped in that phase, not as additional executed cases. The combined unique API scope is exactly 24. Test hooks clean only their own UUID-prefixed rows and rollback trigger. The job service/database is discarded on completion or timeout, and owned server process groups are stopped. Logs and failure screenshots are retained for three days. Remove the temporary active workflow after recording results; the inactive proposal remains canonical documentation. Targeted repeats are limited to failures, source fixes or unresolved verification concerns; do not repeat passing checks without cause.

The fixture credentials are public disposable constants for this isolated job. No connected Supabase credentials, real accounts, provider calls, production data, live app writes, model calls, promotion, deployment configuration, paid plan or enrollment are involved. Existing Git-linked Vercel builds are recorded separately.

## What the checks can establish

Execution note: the [first approved run](https://github.com/alvarovillalbaa/open-evals/actions/runs/40707120573) passed all 30 protocol cases and 23 hosted API cases. Its negative name-filter also selected the demo-only case before that server existed, producing one fetch failure; browser and demo phases were skipped. The workflow now uses Node's dedicated skip pattern for the hosted phase and a positive unanchored name pattern for the demo phase. Artifact upload explicitly includes only the selected hidden result/log paths. Application source and all 58 case bodies are unchanged for this correction.

The API cases exercise actual routes and SQL, including workspace/project/role/scope boundaries, definition races, immutable source reload, old-base branching, idempotent retries, stale previews/locks, audit privacy and rollback, draft serving, legacy byte preservation, catalog ordering and body limits. An owned fixture base is temporarily changed and restored to prove stale-review sensitivity; a uniquely named fixture-only audit trigger proves transactional rollback.

The browser cases exercise definition creation, literal/composed editor controls, preview invalidation and stale response ownership, exact saved-source reload, locked fields, narrow-screen keyboard controls, and ambiguous/acknowledged save retries. Authored browser request interception affects only disposable UI responses; persistence remains real local SQL.

These checks establish application mediation in a disposable PostgreSQL environment using owner SQL credentials. They do not prove Supabase provider/email flows, RLS enforcement as a Supabase client role, clean anonymous live access, production database connectivity, native touch hardware, promotion, campaigns, CLI completeness or end-to-end completion of OpenEvals.

Local Storage Guard blocks installs/builds/databases on the Mac (16.4 GiB available, 34.0 GiB required including reserve). The proposed job uses an isolated remote runner and does not bypass that local reserve. User AGENTS.md §§7 and 14 require explicit approval for the new backend/browser checks and temporary CI change.

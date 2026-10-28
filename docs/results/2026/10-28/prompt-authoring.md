# Immutable instruction authoring

Status: source implementation and hosted build verified; the approved 58-check execution is in progress. The first run passed 30 protocol and 23 hosted API cases, then failed on CI phase selection; browser and demo-only phases were skipped. This is not a full-product readiness receipt.

## Source and approved boundary

Source began at `aac1581a53453b6b8661322819c7c69fb5b8b81a`. The docs-only [contract commit](https://github.com/alvarovillalbaa/open-evals/commit/35fc1a9dafa47093739076442c544625a2f82b85) preserved all 1,188 existing file blobs. Alvaro explicitly approved its instruction access policy on 2026-10-28: project keys access only their own project's targeted definitions, workspace sessions retain workspace access, and hosted implicit local/demo ownership cannot write. Provider settings, grants, RLS, migrations, dependencies and paid services remain unchanged.

## Implemented source

- A pure core storage/preview protocol retains and verifies source independently of rendered text, with full request/review fingerprints and PostgreSQL Unicode checks. The earlier compiler implementation remains byte-identical.
- Definition creation and immutable version saves use scoped transactions, stable identities, verified retries and insert-only audit events. Older canonical bases may have multiple children. No release or version UPDATE occurs in authoring.
- The catalog uses ordered correlated aggregates, avoiding its prior invalid DISTINCT ordering and join multiplication. Catalog versions return metadata rather than source bindings. Catalog, detail, preview, save and resolve enforce the approved access boundary.
- Default resolution selects an active baseline and rejects implicitly selected draft/searching/retired/rolled-back versions. Explicit eval candidates remain scoped to the definition. Ambiguous selectors and malformed bodies fail visibly. The pure core release resolver is unchanged.
- Instructions supports empty-catalog creation, literal/composed editing, typed bindings, nested JSON operations/library, locked-component protection, complete-source preview/review, stable retries, and actual saved-version reload. Legacy or invalid authored data is view-only. Source-aware comparison prevents equal rendered hashes from hiding source changes.

## Review and verification limits

Independent source reviews covered protocol encoding/replay, access filters, transaction ordering, request bounds and UI ownership. Review findings corrected malformed resolve input, reserved definition IDs, target/project write locking, and full-source reload comparison. These are source findings, not executed regression proof.

Static checks use the existing Node 24.21.0 in delegated checks and Node 22.23.3 in the root's same-shell 24-file parsing receipt, with the read-only TypeScript 5.9.3 parser. Executable paths were recorded locally in the same shells. These checks do not execute domain functions or provide semantic build proof. Whitespace checks use `git diff --no-index --check` because the bounded selected-text bundle has no `.git`; status 1 with empty output denotes differences without whitespace findings. Base file Git blob hashes matched all 32 fetched canonical sources.

Local Storage Guard measured 16.4 GiB free against 34.0 GiB required including reserve. No checkout, install, full build or test database was created locally. The prior 55 compiler cases passed in their separate approved scope and have not been rerun. Alvaro separately approved the [58-check proposal](../../../proposals/prompt-authoring-checks.md), and its temporary active workflow was installed at `72b832b392ee626517304774ce1c0ebfb992edaa`.

## Hosted build evidence

The existing Git integration deployed source commit `51a8416c46a0d8538cfab157fd7c2da1fa8db9f6` as `dpl_zrakLEyryidZqZLSTc41HwoXZEP1`, production alias `open-evals-web.vercel.app`, with READY state. Actual build logs showed core, DB, adapters and workflows `tsc --noEmit`, Next 16.2.9 compiled successfully, TypeScript finished, and all five Turbo tasks successful. The log tool truncated its first array response; a bounded timestamp-window request recovered the missing compilation/typecheck lines. This is semantic build/deployment evidence, not a database, browser, provider or clean anonymous-access check.

The narrow-heading wrapper and all prepared checks were published at `23a6a0b77439cb66f66f5f035190fb3dd1d42405`; deployment `dpl_7kjGjJuYntD1ZenViMx5r7qHpRe9` was also verified READY.

## First approved execution

[Run 40707120573](https://github.com/alvarovillalbaa/open-evals/actions/runs/40707120573), job `122882125266`, checked source `72b832b392ee626517304774ce1c0ebfb992edaa` on Node 24.21.0. Raw job logs recorded 30/30 protocol cases passing, then 23 API cases passing and the demo-only case failing to fetch its not-yet-started server. The negative name filter had selected that case during the hosted phase. Browser and later demo steps were skipped. Frozen install, all three unchanged migrations, Chromium setup and cleanup steps succeeded.

The [first-run report](prompt-authoring-first-run.json) retains the failure boundary. The workflow correction uses a dedicated skip pattern for the hosted phase and positive unanchored name matching for demo. Explicit hidden-file inclusion fixes artifact upload; the first job's logs remain the primary evidence because its artifact step found no visible paths. No application source or test body changed for these CI corrections. A fresh approved-scope attempt is required before claiming all 58 cases pass.

The existing database's RLS/audit update permissions and missing global stable-key uniqueness constraint are unchanged. API-level locking and append-only behavior do not claim database-wide protection against independent SQL writers. Full Supabase session/provider behavior, production data persistence, clean anonymous access and native mobile behavior remain unverified.

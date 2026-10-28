# Immutable instruction authoring

Status: source implementation and static review; new domain, HTTP/database and browser checks are prepared but **not executed**. Hosted build and deployment verification is pending this implementation's publication. This is not a full-product readiness receipt.

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

Static checks use the existing Node 24.21.0 in delegated checks and Node 22.23.3 (`/Users/alvipe/.nvm/versions/node/v22.23.3/bin/node`) in the root's same-shell 24-file parsing receipt, with the read-only TypeScript 5.9.3 parser. They do not execute domain functions or provide semantic build proof. Whitespace checks use `git diff --no-index --check` because the bounded selected-text bundle has no `.git`; status 1 with empty output denotes differences without whitespace findings. Base file Git blob hashes matched all 32 fetched canonical sources.

Local Storage Guard measured 16.4 GiB free against 34.0 GiB required including reserve. No checkout, install, full build or test database was created locally. The prior 55 compiler cases passed in their separate approved scope; they do not prove this new persistence/editor flow. See the [new core-check proposal](../../../proposals/prompt-authoring-core-checks.md) and forthcoming bounded HTTP/browser execution proposal before any test run.

The existing database's RLS/audit update permissions and missing global stable-key uniqueness constraint are unchanged. API-level locking and append-only behavior do not claim database-wide protection against independent SQL writers. Full Supabase session/provider behavior, production data persistence, clean anonymous access and native mobile behavior remain unverified.

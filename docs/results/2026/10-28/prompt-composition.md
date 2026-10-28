# Instruction composition source

28 October 2026. Complete pure composition compiler and candidate integration
published toward the full OpenEvals product. All 55 approved pure compiler checks
passed. Persisted authoring and the composition editor remain unfinished.

## Requirement and source boundary

The [OpenEvals brief](https://app.notion.com/p/3b6a1ee8bd068037ac1dea74a75b9070)
was fetched again. Its 22 October snapshot's Features section directly requires
in-field variables, operation blocks and versioned instructions. Its long
Portable Evals section is a proposal/recommendation; one embedded tweet remains
unreadable. The complete returned Features text was inspected. No new framework
or protocol requirement was inferred from that proposal.

Existing personal source was pinned to
`50c98c677471524f8a64b61ae2ae8e59573c9d37`, root Git tree
`d3e255518c70843f34af41d9baa4e9630536b699`. Its compiler concatenated component
content and returned the caller's mutable component and parent arrays. The lock
checker had no callers and compared only content by ID. The order ablation
copied every reversed component's content into one mutable component, duplicating
locked instructions rather than reordering blocks.

The [canonical contract](../../../prompt-management.md) documents the new
`prompt-composition-v1` grammar and limits. Explicit typed bindings support
scalar and canonical-JSON placeholders. Text, include, if and each operations
compose into the existing materialized component shape and exact header format.
Inserted values are opaque; libraries close over root bindings, not loop aliases.
Both branches and unused library entries are validated. Literal mode preserves
valid existing text/hash semantics without interpreting template-like examples.

Versions now own deeply frozen components, parents and authoring snapshots.
The existing content hash retains its 24-hex SHA-256 text meaning; a separate
source hash binds the authoring program, bindings and library. Base-version
compilation checks rendered locks, identity, flags, kinds, definition and locked
relative order, plus text/hash/source correspondence. Both existing candidate
builders provide that base. Ablations create explicit materialized literal
children; order mutation reverses mutable slots while leaving locked positions
fixed. Generated candidates remain hypotheses until evaluated.

## Static evidence and corrections

Storage Guard measured **14.4 GiB free versus 34.0 GiB required**. No full
checkout, dependency installation or build ran. Fourteen selected pinned text
files were copied into a bounded base/candidate editing bundle. All fourteen
base Git blob hashes match immutable GitHub readback. No Git history, vendor
tree, database, account data or environment was copied.

The existing Node `v24.21.0` process recorded its version and executable. The
read-only installed TypeScript `5.9.3` tool, matching the repository's declared
compiler version range, parsed/transpiled the six relevant TypeScript files for
syntax diagnostics; Node checked the emitted JavaScript without executing it.
Both native test-driver files passed `node --check`. These are syntax checks,
not full semantic type checking, runtime imports or domain execution.

Source review identified these boundary issues during preparation:

- Validation must count all loop iterations, including empty bodies in an
  unselected branch. Token work must be charged even when substitutions/output
  are empty, in both validation and rendering.
- Source JSON must charge container syntax before descending and enforce a
  global JSON-node limit. A small acyclic shared input graph could otherwise
  expand exponentially into empty containers before a final byte check.
- Named/data records cannot hide malformed entries behind non-enumerable fields.
- Inspecting a compiled snapshot must use the raw compiled-byte budget, not
  reapply source JSON escaping to its rendered content. Its actual authoring
  manifest is separately checked under the source budget.

The compiler now bounds JSON/AST depth, source nodes, names, iterations, work and
UTF-8 bytes before unbounded expansion. The authored cases include bounded
regressions for these source-discovered issues; no red/green runtime result is
claimed before owner-approved execution.

At source preparation there were **55 authored native Node cases**, counted from declarations,
covering composition, snapshots, lock/provenance tampering, multi-component
budgets, ablations and malformed/resource-bound inputs. The [focused execution
proposal](../../../proposals/prompt-composition-checks.md) required explicit
approval under the supplied AGENTS.md §7. It uses the actual pure source with
Node's type stripping and a narrowly scoped import hook. No case ran during
preparation; the subsequently approved execution is recorded below. The existing
Vitest test and package scripts remain unchanged. No local application server,
browser check, database, migration, Auth/configuration change, CI, model/provider
call, release promotion, rollback or live campaign was performed.

Independent read-only review rechecked the complete compiler, types, both
candidate callers, test hook and all 55 authored cases after the resource and
round-trip repairs. It found no remaining concrete static blocker. That review
did not import or execute the domain code and supplies no passing-test claim.

| Frozen file | SHA-256 |
| --- | --- |
| `packages/core/src/prompt.ts` | `0aa64698ac7729daf5609d11279a1daacf416bc7e5d46aa1b5931f8a5f8050a8` |
| `packages/core/src/prompt-composition.ts` | `fd735d5554ce3cdc4c99b906d1ffd6b77c4104274f56e7dd0a67465d9d95f185` |
| `packages/core/src/types.ts` | `f033bfd60b1883dd8efd35768deb380cf92186df69089ffc29ad991ca97ac25f` |
| `packages/core/src/improvement.ts` | `511b0f953f7dac987d3c51c6ea15e2486b609ecbc9f48de7c8eb2ba62a4dc34a` |
| `packages/core/src/demo.ts` | `3300ca9c8aae84ab6c5f21ebf26ebaff516286102cdd242c053e38d2ffcbbd71` |
| Native cases | `e7ae40f765c90f6eee006dcc41cd977e67d4cb1c729d15e0aead9855d6d0f706` |
| Source import hook | `1e3ec9a7807fbc507b39c5b0995035910b770295f355934fc2082be876b2f38d` |

## Publication and hosted compilation

Published [a4b95fcdd308601fc4ee8bb47395dc315537ebdc](https://github.com/alvarovillalbaa/open-evals/commit/a4b95fcdd308601fc4ee8bb47395dc315537ebdc)
to the existing personal repository. Eleven candidate Git blobs matched their
local content hashes. The new tree `16a6c21db2b6e34c8aaf948115bfd1328cda46fe`
inherits the complete prior root: full tree comparison found exactly those
eleven added/modified files, no removals and 1,176 untouched blobs. The branch
advanced without force, conditionally from the exact inspected `50c98c6` head.
Immutable GitHub readback matched all eleven files; remote main matched the
published commit. No local checkout or unrelated worktree was modified.

The existing Git-linked Vercel project `open-evals-web`
(`prj_FG3VAWXbwS6VRHq4Wd2B4vyIms4l`) automatically deployed that exact source
as `dpl_EBEKMv3Vsa1v1dvVw9rAAbViuW8s`, production `READY`, owning
`open-evals-web.vercel.app`. Logs record cache-miss core `tsc --noEmit`, the DB,
adapter and workflow type checks, successful Next.js compilation and completed
web TypeScript checking. Turbo reports five successful tasks out of five.
The first log response omitted 46 middle entries; a bounded timestamp-window
read recovered the missing compilation evidence. This supplies hosted semantic
compilation proof for that dependency graph, not the entire repository or tests.

Connected GET of the canonical root returned HTML 200 with the exact deployment
ID. That authenticated/share-capable read is not independent anonymous access
or browser/workflow acceptance. No new hosting settings, account or plan was
changed. The subsequent receipt update preserves every source/test byte.

## Approved focused execution

Alvaro explicitly approved the immutable [55-case proposal at `e5ee8c1`](https://github.com/alvarovillalbaa/open-evals/blob/e5ee8c1493f640e69d163b50cc1ce13e1ed4fdd4/docs/proposals/prompt-composition-checks.md).
Before running, all eight source/test/hook Git blobs matched the exact published
bytes in the retained candidate bundle. The existing Node `v24.21.0` process
recorded its executable, then launched that same executable with the published
import hook, test entrypoint and TAP reporter. Native type stripping loaded the
actual prompt, composition, hash and ablation modules. No dependency environment,
substitute compiler implementation or application server was used.

**55 passed, zero failures/cancellations/skips/TODOs; exit code 0.**

The [machine-readable report](prompt-composition-checks.json) records the checked
commit, exact runner arguments, totals and all eight Git blob/SHA-256 pairs.
Its source fields include the types and demo integration files; those two files
were fingerprinted but are not runtime imports of this focused test graph.
The report retains the 11,476-byte raw TAP output's SHA-256 and empty stderr.
These are actual pure-code assertions against T2 authored prompts/bindings,
including the reviewed resource and snapshot round-trip regression cases.
No implementation or test changes were needed after execution.

Independent evidence review confirmed all 55 sequential pass records, matching
case names and the complete TAP plan, no skip/TODO/failure/bailout directives,
empty stderr and all eight fingerprints against both the candidate and immutable
GitHub publication. The exact task-owned TAP/stderr files were then removed;
the bounded JSON retains their proof hashes and counts. The small source bundle
remains intentionally available; it contains no dependency/test environment.

The passing scope does not execute the existing Vitest suite, verify an editor,
create a persisted version or approve a release/campaign. Hosted compilation
above supplies its separate semantic type/build evidence. The broader product
requirements below remain open.

## Remaining product scope

This compiler does not complete application composability. Current database
version writes do not retain the new top-level authoring manifest. The seed has
older object-shaped components and demonstration hashes. Existing versions were
not reconstructed or rehashed. Canonical version-write APIs, manifest persistence
and a real editor/review flow remain required; the UI currently only lists data.
SDK resolution and Python string-patch optimizers are not composition bridges.

The rest of the direct Features brief also remains in scope: SDK-only evidence
entry, CLI execution, public documentation, unified evals/datasets/Harbor tasks/
scenarios, real optimization campaigns and safe production A/B rollout. Existing
CLI commands that return fabricated success are a separately observed unfinished
surface. Promotion, rollback, live experiments and structural work orders retain
their explicit approval gates. No narrower completion claim replaces the full
project or portfolio objective.

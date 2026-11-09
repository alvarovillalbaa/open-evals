# Reusable evaluator composition

Implementation contract for saved deterministic Eval Items, ordered multi-item
Eval Sets and immutable HTTP plans. All 128 focused checks and the full root
build passed at checked QA source `b3442e2`; see the
[source-bound result](results/2026/11-09/evaluator-composition.md). Browser
execution uses real disposable SQL and authored DNS/HTTPS responses. Native
transport and hosted Auth/RLS acceptance remain unverified.

## Author and compose

An Eval Item is a scoring definition, not an input row. A workspace editor
authors a named text-contains check, previews it, and explicitly saves an
immutable item version. A set selects exact saved item versions in an explicit
order. Saving a set records those versions and fingerprints, rather than cloning
the checks or following their mutable heads. A later item version does not
change a saved set or plan.

Sets contain distinct item versions with weight 1 and critical gating. The
contains evaluator keeps its existing case-insensitive semantics and declared
boolean output. Additional evaluator kinds, model judges and configurable
weights are separate capabilities. Set thresholds remain explicit.

The editor retains authored input after a conflict or uncertain response. An
identical retry uses its original request identity. Exact-version review and
history distinguish a saved version from the latest head; a stale append must
reload and review the head before creating another version. Saving and preview
perform no target or model call.

## Plans, identity and coverage

The existing Evals plan flow selects one exact dataset version, exact set
versions and an explicit versioned HTTP target. New composition uses a new
contract discriminator. Existing one-item custom sets and HTTP v1 plans retain
their original strict validation, identities and fingerprints.
Each plan keeps the contract family of its first saved version. To use reusable
sets with an existing v1 plan's inputs, create a new composition plan; appending
a version does not silently upgrade the old plan.

The shared core DTOs define separate item/set draft, preview, save and record
discriminators ending in `v2`. Public resource and version references remain
UUID pairs; stored identities use full workspace-scoped hashes. HTTP v2 selects
explicit legacy-or-reusable set references with exact contract fingerprints.
The existing HTTP API routes dispatch by the explicit contract discriminator;
the native JSON target request and response protocol stays v1.

A plan retains every selected set membership while deduplicating identical item
versions. Two sets sharing an item produce one result for each unique row/item
pair; both sets' gates refer to that result. Conflicting definitions for the same
identity fail before dispatch. More checks do not create more target calls:
there is at most one durable dispatch claim per dataset row. Expected outputs
and evaluator needles stay outside the outbound request.

Field, item-row, row, dataset, set, target, criticality and run gates use the
frozen sources and complete result coverage. Missing or uncertain output cannot
pass a run. The existing stop, replay and recovery rules remain conservative:
an unfinished dispatch claim is never automatically resent.
For v2, a required critical failure also fails its dataset and set scopes even
when their configured pass-rate threshold is zero. A shared failing check fails
each set that contains it. This policy is bound to the new profile; historical
v1 gate decisions retain their original threshold semantics.

The separate maxima remain 100 rows, eight selected sets and 32 distinct items.
They do not guarantee that every combination fits. Preview rejects a plan whose
complete worst-case serialized record would exceed 16 MiB, including frozen
definitions, repeated memberships, outputs, results, all gates and their source
references. Request, response, concurrency and time limits remain unchanged.
For example, sets `[A@1, B@1]` and `[B@1, C@1]` over two rows require two target
calls, six unique results and twenty gates. Equivalent configurations saved under
different item-version identities remain distinct checks.

## Persistence and access

Use the existing item, item-version, set, set-version and ordered membership
tables. Workspace-scoped storage identities and strict readback bind public
identities, immutable definitions, membership order, trusted timestamps and
audit metadata. Saves serialize head checks, replay recovery and writes in one
transaction. Legacy writers cannot append to the new owned records.
Renaming or revising an item or set head does not invalidate an earlier version
or any saved set or plan that references it.
Frozen item and set definitions can be reconstructed and validated independently.
Source record fingerprints retained alongside their snapshots are provenance
references; a hash alone does not reconstruct the complete original record.

Lists and histories return bounded metadata; exact-version reads return the
complete validated record. Item/set records are limited to 1 MiB, histories to
twenty versions per response, and HTTP records retain their 16 MiB limit.

The existing workspace-session policy applies: viewers inspect and preview;
editors save and execute. Project keys and hosted demo ownership do not gain
authoring. This change introduces no migration, dependency, role grant,
provider configuration, account or paid plan. Navigation remains Evals and
Improve; the legacy custom-set editor stays available.

## Proof boundary

The complete focused scope passed 128 checks and a full root build: 76 core,
24 Web/API, 24 PostgreSQL and four desktop/narrow Chromium journeys, with zero
browser retries. This binds checked QA source `b3442e2`, rather than subsequent
documentation/evidence publication. The compiled app exercised actual routes,
durable SQL claims, scoring and recovery with two authored responses, six unique
results and twenty gates; replay and reload added no calls. Source, earlier
failures, cleanup and exact proof limits are in the
[owning result](results/2026/11-09/evaluator-composition.md).

The focused existing-Node packet passed 76 cases: 33 new composition cases,
38 HTTP v1 regressions and five compatibility checks against values frozen from
the published parent. No case was skipped and source pins stayed unchanged.
The checks use Node 26.8.2 type stripping and restricted VM modules; they do not
establish TypeScript semantic compilation or target dispatch.

An earlier 74-case packet passed before two additional boundary regressions
were authored. Those regressions then failed against the earlier source:
an element getter executed during source-array enumeration, and a non-string
ledger status could pass coercive enum admission. The two narrow repairs copy
the complete unknown array before enumeration and require an actual string
status. The final 76-case packet passed with unchanged historical fingerprints.
Earlier attempts retain the same case identities; 76 is the distinct scope.
Both findings were reproduced at the pure-library boundary.

The passing disposable SQL and compiled-app journeys cover shared-item
persistence, exact-version selection, unique result coverage, set gates,
compatibility, access and recovery. Their authored transport seams do not
establish native DNS/socket/TLS execution or genuine hosted account acceptance.
The earlier HTTP release retains its own source identity and separate evidence.

See [HTTP execution](http-target-runs.md), [the product contract](product-surface.md)
and the unchanged [legacy custom-set contract](custom-evals.md).

# Saved HTTP target eval plans

Last updated: 2026-11-09

Implementation contract. Pure, transport-double, Web seam, SQL and build checks
have passed at their recorded sources. Browser and native network acceptance
remain pending.

## User flow and ownership

Inside Evals, a workspace session selects an exact saved dataset version and
one or more exact saved custom evaluator-set versions, supplies a versioned
HTTP target binding and execution limits, inspects a complete preview, and
explicitly saves an immutable named plan. Plan history retains every version.
Saving or viewing a plan does not call its target.

An explicit execution creates a separate immutable execution intent. The
application sends each frozen input to the chosen endpoint, retains its actual
response, evaluates that response, and stores results and all gate levels.
Execution history and exact-ID recovery expose completed, failed, interrupted
and uncertain outcomes. Another execution always requires a new explicit user
action and identity.

This is the HTTP target path. Additional target runtimes, evaluator kinds,
Harbor execution and campaign integration remain requirements of the wider
product. Existing supplied-output contracts retain their own profile and
recorded evidence. A reference answer is never used as a generated target output.

Reuse the existing workspace-session role boundary: viewers inspect and preview;
editors save plans, execute and recover. Project API keys and hosted demo
ownership do not acquire these capabilities. No new role, grant or provider
setting is introduced. Product navigation remains Evals and Improve.

## Immutable plan contract

The core DTO module is the transport source of truth. Strict draft fields are
schemaVersion, planId, versionId, version, expectedVersionId, name,
datasetVersionId, evalSetVersionIds, target and limits. Public identities are
UUIDs; versions are consecutive positive PostgreSQL integers. Exact-key,
Unicode, JSON precision and complete serialized-budget validation fail closed.

One plan binds 1–100 rows from one exact saved dataset version, 1–8 distinct
saved custom evaluator-set versions and at most32 distinct evaluator items.
Preserve optional-field presence, row metadata, schemas, weights, criticality,
set membership, thresholds and source fingerprints. Result identity is row plus
evaluator version, and every membership remains explicit. Current saved custom
set v1 contains one generated item; this path does not broaden its immutable
validator or imply that multi-item set authoring is available.
The v1 execution capability is the existing validated text-contains evaluator.
Any unavailable evaluator kind/configuration fails preview before dispatch;
no generic fixture judge or invented score is available to this profile.

The target is an explicit HTTP JSON binding: stable targetId, declared
targetVersion, endpoint and timeoutMs. The protocol is http-json-target-v1.
The v1 plan endpoint must use a public DNS hostname and HTTPS on the default
port, with no credentials, query string or fragment. IP-literal plan bindings
are unavailable in v1. Inline authorization headers and caller-defined
transport adapters are not accepted. The target's declared version is part of
the frozen binding; it does not prove the remote implementation is immutable.

Limits declare concurrency1–4 and duration5–120 seconds. There is at most one
dispatch claim per row and at most100 target calls. Per-call time is bounded
by500–10000ms and the remaining run deadline. Request bodies are capped at
1MiB+8192B, responses at65536B. Full plan/run records must fit an explicit
16MiB bound including schemas, identities, results, gates and actual outputs.
The preview verifies complete worst-case record allowance before save.
Time/call/byte limits are enforceable locally. Optional target-reported usage
and cost remain labelled as reports, not a guarantee about external billing.

Fingerprint the complete resolved target binding, input/evaluator snapshots,
membership, thresholds, visibility policy, limits, code version and manifest.
Keep content, preview, save-intent and workspace/version storage fingerprints
distinct. Storage hashes include workspace plus public/version identity to
avoid the globally unique run_plans.fingerprint colliding across versions or
workspaces. Created-at is trusted store metadata, not a client prediction.

Save replay is checked before the current head. Otherwise append requires the
exact parent and next version under the shared workspace lock and plan lock.
Plans are insert-only, audited with IDs/hashes/actor, and strictly read back.
A concurrent stale save preserves authored input and requires visible review
of the new head. An uncertain save retains its exact request for recovery.

## HTTP boundary

The native Node transport validates the endpoint, resolves all addresses and
rejects the whole DNS inventory if any answer is nonpublic. It pins one vetted
address for a fresh unpooled TLS request while preserving hostname/certificate
validation. It sends fixed JSON headers and a derived idempotency/request hash,
never application cookies or session credentials. It does not follow redirects.
Status, content type, encoding, total time, header size, body bytes, strict UTF-8
and strict response JSON are bounded and validated. Errors expose safe codes,
not remote HTML, secrets or arbitrary network error messages.

Requests carry schemaVersion, requestFingerprint, runId, rowId and the frozen
input, with context/history only when present. Expected outputs, evaluator
needles and other reference answers are excluded. Responses carry the matching
schemaVersion/requestFingerprint and actual output, with optional bounded
usage/cost metadata. Null or blank-string output fails before scoring.
Zero and false are preserved as JSON values.

## Durable execution and recovery

In one transaction, a new execution reserves eval_runs, all pending samples,
workflow_runs input/state and a reservation event. Its start request names
runId, exact planVersionId and expected plan fingerprint. A conflicting request
reusing that identity returns conflict. An identical replay returns recorded
state and performs no target work, including after a process interruption.

Only the successful creator coordinates execution. Before each call, a
transaction locks the workflow ledger, verifies its lease and pending row,
and commits a unique claim token plus frozen request hash. No external request
runs inside a database transaction. The claimant then dispatches once.
Response/error, evaluator results, sample status and immutable event commit
atomically against that token. Duplicate identical finalization can replay;
conflicting or stale finalization cannot overwrite stored evidence.

The ledger index remains bounded; full row responses live once in immutable
workflow events rather than being duplicated per evaluator or copied into the
whole ledger on every update. Evaluator SQL identities are row plus evaluator
version. Results retain source output fingerprints and complete declared fields.

The run deadline is server-owned. The route has a180-second platform limit,
with at most120 seconds of work and a recovery grace beyond the bounded call
window. If the process disappears after a dispatch claim, its remote outcome
can be unknown. Never reclaim and automatically resend that call. After the
lease/grace expires, an editor may explicitly recover the run: unfinished
claims become outcome_unknown; never-claimed rows become not_sent. Completed
rows remain unchanged. This is conservative at-most-once dispatch, not an
exactly-once guarantee about a remote endpoint.

GET and request replay neither dispatch nor mutate recovery state. Unknown,
missing or stopped row coverage cannot produce a passing run. A fresh explicit
execution may repeat remote effects; the UI says so before creating its identity.

## Results and gate coverage

Validate every result against its exact evaluator schema. Build field,
item-row, row, dataset, evaluator-set, target, criticality and run gates from
actual row/evaluator coverage and frozen memberships/thresholds. Scope dataset
gates to the actual saved dataset version. Aggregate rows once per configured
scope; do not treat each evaluator result as another row. Critical failure and
missing/unknown coverage prevent a passing run regardless of average score.
Gate formulas, threshold versions, source result IDs and fingerprints are stored.

Dedicated strict readers verify plan, ledger, events, samples, results and gates
together. They never invoke the target. Exact frozen plan versions remain usable
after source-head changes; execution readback does not silently re-resolve live
datasets or evaluator definitions.

The new http-target-eval-v1 profile and exact storage namespaces are excluded
from legacy/demo run readers and protected from legacy upsert writers, including
corrupt-profile records. Audit metadata is evidence, not the domain store.

## Verification and proof limits

Authored pure checks cover parsing, fingerprints, coverage, gate aggregation,
protocol validation and state transitions. Disposable PostgreSQL checks cover
CAS/replay, reservation/claim races, atomic outcomes, unknown recovery, corruption
and legacy isolation. Transport checks distinguish authored dependency seams
from native DNS/socket/TLS assurance. The five actual-app browser journeys cover
desktop/narrow authoring, history, save recovery and access without target calls.
Execution, output scoring and interrupted-run recovery currently have Web seam
and owner-SQL coverage. Simulated transport evidence is never relabelled as a
live provider or native execution test.

No new migration, dependency, account, model call, paid plan or production
configuration is proposed. The existing migrations already contain the storage
tables. The dated local source-check receipt records 38 pure cases and 26 authored
DNS/request-double transport cases passed, with all 14 pinned sources unchanged.
Those checks use the existing Node installation and do not prove native
DNS/socket/TLS behavior, TypeScript compilation or an integrated application.
The Web packet's first two local attempts failed during module loading: strip
mode cannot lower parameter properties, and Node 26 removed transform mode.
The first CI run reached 18/20 Web passes before two cross-realm array comparisons
failed. Normalizing only those JSON arrays preserved all value/order assertions.
[Run 42692158133](https://github.com/alvarovillalbaa/open-evals/actions/runs/42692158133)
at source26433ff then passed all 20 Web seams, 31 PostgreSQL cases, 14 regressions
and a full production build. Its browser result remained 3/5 because two alert
locators also matched the framework announcer; that failed run is preserved.
The browser follow-up keeps every assertion and narrows only those locators.
A separate native hostname regression failed before the apex repair, then all
26 transport-double cases passed afterward; this repeats the existing scope.
The predecessor dataset release independently passed its full CI build and all
five browser journeys before integration; this HTTP increment was absent from
those checks.

Sources: [owner Features list](https://app.notion.com/p/3b6a1ee8bd068037ac1dea74a75b9070),
[current product contract](product-surface.md), and
[Vercel duration configuration](https://vercel.com/docs/functions/configuring-functions/duration).
The latter documents route-level duration configuration and a300-second Hobby
maximum with Fluid Compute; the proposed route limit does not require a paid
duration upgrade. No account configuration was changed.

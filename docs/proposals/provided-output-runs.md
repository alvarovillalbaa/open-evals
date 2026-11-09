# Saved versions and supplied-output runs

Connect saved dataset and custom Eval Set versions to actual deterministic scoring
inside Evals. Preserve remaining provider/target, generic evaluator, Harbor,
campaign and rollout requirements. The owner brief supports scoring saved responses.
No migration, dependency, account, provider secret, production data or model call.

## Versioned contracts

Add `provided-output-run-v1`, `provided-output-run-draft-v1`,
`provided-output-run-request-v1` and `provided-output-run-record-v1`; preserve
legacy versioned contracts and inline endpoints.

Draft keys: schemaVersion, runId (lowercase UUID), datasetVersionId,
evalSetVersionId, outputs. Each output has exactly rowId (dataset_rows.id) and
output (actual text). Require exact one-to-one row coverage; reject duplicate,
foreign and missing IDs. Empty actual text is valid and can fail. Never substitute
expected_output. Canonicalize the output map by row ID.

Limits: 100 complete rows, 64 KiB per output, 1 MiB aggregate output text,
1 MiB canonical dataset snapshot, existing streamed 2 MiB request. Refuse overflow
instead of silently sampling. Legacy dataset/row IDs are text, not necessarily
UUIDs. Exact custom-version reads must work beyond the latest20 history window.

Dataset snapshot: `{ dataset: { id, name, kind }, version: { id, datasetId,
version, fingerprint, createdAt }, rows }`. Rows contain id, rowKey, input,
expectedOutput, context, history, traceFixture, metadata, reviewStatus. Nullable
JSON fields use `{ present: boolean, value: JsonValue }`; absent values are null,
preserving SQL NULL versus JSON null. Order rows by UTF-8 rowKey then id. Bind the
declared version fingerprint plus fresh full SHA256 row and snapshot hashes.
Validate bounded JSON depth/size, finite numbers and Unicode; the legacy fingerprint
alone does not establish complete row content.

Saved PostgreSQL JSONB must survive JavaScript parse/serialize with equivalent
JSONB semantics. The database compares every reconstructed JSON field with its
original value and refuses lossy numbers with 422
`provided_output_dataset_precision`. This includes nested unsafe integers,
over-precise decimals and underflow. Equivalent spellings such as `2.0` and `2`
are accepted; these hashes preserve accepted JSON values, not raw JSON spelling.

## Preview, execution and immutable record

Preview is read-only. Run request keys are schemaVersion, draft,
expectedPlanFingerprint. Bind canonical draft and expected fingerprint into a
workspace-scoped request fingerprint. New runs re-resolve saved sources and fail409
on preview drift. Exact retries check immutable stored intent before live sources,
so lost-response replay survives later source changes.

Storage plan/run IDs are namespaced full hashes of trusted workspace + draft UUID;
the draft UUID remains the public retrieval/retry ID. Hash the full plan excluding
only its fingerprint, including actual sources, exact custom contract/member proof,
provided outputs, samples and versioned policy. Preview reference visibility is
truthful. Execute every pinned member and require the complete row/member Cartesian
set. Current strict custom-v1 permits one critical string_check; reject unsupported
members. Reuse the deterministic check but replace fixture metadata and run IDs.
Materialize field, item_row, row, real dataset, eval_set, provided target,
criticality and run gates. Dataset rate may pass while a critical failure still
fails the Eval Set/run. Never use demo identities or fixture evaluator fallback.

Store `{ schemaVersion, workspaceId, requestFingerprint, plan, execution,
fingerprint }` in run_plans.resolved_plan. Execution retains complete results/gates,
provenance and its fingerprint; existing relational rows must match it exactly.
Core parsing rebuilds the canonical plan and deterministic execution.

## Persistence and access

Keep DB free of a new runtime core dependency. A new DB coordinator takes required
trusted server callbacks to prepare a record from locked inputs and canonically
validate a stored record; request bodies cannot supply those functions. DB still
validates scope, schema/hash/identity projections and complete relational parity.
Serialize writers on workspace, freeze selected source versions/rows while preparing,
insert only, compare exact replay, reject collisions/corruption, and audit IDs/hashes
once. Do not call legacy persistEvalRun for the new profile.

Use the existing custom-evaluator workspace-session policy before body/data reads.
Legacy broad run readers exclude the new private envelope. Dedicated session routes
read it. Legacy writers reject collisions with this profile, including idempotency
keys, and take the workspace lock so old upserts cannot mutate it. Preserve existing
non-profile API shapes/grants; do not alter provider/Auth settings.

UI: choose saved versions, load rows, enter outputs, preview, explicitly run.
Separate loading/error/empty/denied states. Editing invalidates preview; uncertain
retry retains exact ID/body. Use synchronous busy and lifetime/generation guards.
Results read the immutable stored record. A bounded recent catalogue may also
accept exact version IDs; do not claim it lists all versions. Keep Evals/Improve.

Verify actual core, owned real PostgreSQL/HTTP and desktop/narrow seams. Existing
38 T1/12 store/four browser receipts stay closed. Temporary free CI may reuse the
owned loopback protocol; local heavy work remains Storage-Guard blocked. These
checks do not establish real hosted provider/user/device acceptance.

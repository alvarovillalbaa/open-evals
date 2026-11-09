# Custom dataset versions

Source-inspected proposal, not implemented or executed. Base inspected:
`9459a95881e6a7d0cf4cf0f827ea361236b72df8`. Root subsequently closed release
`b061e7a52943a4ff8bcd026f8804786ff82d934d` with identical application/test bytes;
hydrate the complete implementation source map from that base before edits. Keep
Evals and Improve as the only top-level product areas.

## Outcome and existing storage

Within Evals, upload or paste JSON/JSONL examples, review a complete preview,
explicitly save a new immutable dataset version, reload its saved values, then
select that exact version in supplied-output scoring. Do not create a benchmark,
evaluator, target invocation or campaign as an import side effect.

Existing `datasets`, `dataset_versions` and `dataset_rows` store the data; the
existing `audit_events` table stores a small system manifest. No new migration,
dependency, provider, account or model call is needed. Do not add reserved fields
to user row metadata. Freeze the dataset name after creation: the current scoring
reader uses `datasets.name` for every historical version, so renaming it would
change older version snapshots.

## Versioned authoring contract

Introduce `custom-dataset-draft-v1`, `custom-dataset-preview-v1`,
`custom-dataset-save-v1`, `custom-dataset-version-v1` and a versioned audit manifest.
Preserve legacy contracts and benchmark routes.

The strict draft contains `schemaVersion`, `datasetId`, `versionId`, `version`,
`expectedVersionId`, `name`, `format`, `defaultReviewStatus`, and `sourceText`.
Dataset/version IDs are lowercase public UUIDs; version is a positive PostgreSQL
integer; expectedVersionId is null for version 1 or the previous public version
UUID. Format is explicitly `json` or `jsonl`. The source stays text inside the
bounded JSON request so outer JSON parsing cannot round the uploaded numbers.

JSON is an array of row records. JSONL contains one row object per line; allow one
final line terminator, reject other blank lines and report source line/row indices.
Each row requires a nonblank `rowKey` and an `input` JSON value. Optional fields:
`expectedOutput`, `context`, `history`, `traceFixture`, `metadata`, `reviewStatus`.
Reject unknown fields, including an ambiguous actual `output` field. Metadata is
an object, defaulting to `{}`. Severity/language/provenance can remain user metadata.
Require a per-row review status or an explicitly chosen default; never silently
mark uploaded rows golden. The existing vocabulary is synthetic/reviewed/golden;
describe these as the uploader's declarations, not independent quality proof.

Absent optional JSON fields become `{ present: false, value: null }`; present
JSON null becomes `{ present: true, value: null }`. Preserve every accepted JSON
value and metadata key. Expected output is a reference, never an actual response.
Reject duplicate object keys, duplicate row keys, invalid UTF-8/Unicode, NUL,
nonfinite numbers and lossy numeric conversion before any content hash. Compare
raw numeric tokens with `JSON.stringify(Number(token))` as normalized sign,
coefficient and exponent tuples: remove leading/trailing coefficient zeros,
adjust the decimal exponent with BigInt, and normalize every zero to one tuple.
Never expand powers of ten. Equivalent 2.0/2 and 1e3/1000 are acceptable; nested
unsafe integers, close decimals and nonzero underflow are not. Do not require all
integers to satisfy `Number.isSafeInteger` when their JSONB decimal value actually
roundtrips. A bounded structural token walk also rejects duplicate decoded object
keys; ordinary `JSON.parse` of the file alone cannot establish these properties.
Do not install a parser dependency for convenience.

Limits match the consumer: 1–100 complete rows, rowKey at most 4096 UTF-8 bytes,
name at most 4096 bytes, JSON depth 32 and at most 150,000 nodes, and 1 MiB for the
complete canonical saved dataset snapshot. Include generated IDs, nullable-field
wrappers, name, version metadata and creation-timestamp allowance in that budget.
The save readback must pass the consumer's actual snapshot validator. Both preview
and save use the existing streamed 2 MiB body limit, including JSON escaping.
Browser file reads must check size and decode UTF-8 fatally; no replacement text,
truncation, auto-sampling or silent row dropping.

## Identity, fingerprints and immutable writes

Use full SHA256, namespace-bound to trusted workspace and public identities:

- `custom_dataset_<hash(workspaceId,datasetId)>` for the stored dataset ID.
- `custom_dataset_version_<hash(workspaceId,datasetId,versionId)>` for a version.
- `custom_dataset_row_<hash(workspaceId,datasetId,versionId,rowKey)>` for each row.

These prefixes are disjoint from the legacy import writer's `dataset_benchmark_…`
and `row_<20-hex>` identities. Store `kind = custom-dataset-v1`; require namespace,
workspace, kind and manifest parity together, rather than trusting the marker.
Row keys remain stable across versions; stored row IDs are stable within a version
and necessarily differ across versions because `dataset_rows.id` is globally unique.
Canonical row order is UTF-8 rowKey then stored ID, consistent with scoring.

Hash raw source text separately. The intent/request fingerprint binds its full
digest, source format, explicit default review status, public IDs, name, requested
version/parent and preview fingerprint. A different spelling/format cannot replay
an old intent merely because its parsed values match. The version content hash
binds all canonical rows and immutable identities/name/version/parent. Store it in
`dataset_versions.fingerprint`. Exclude the creation timestamp assigned at save
from the authoring hash; scoring later binds the actual timestamp in its snapshot.
Preview must not present a synthetic timestamp as already saved data.

The audit manifest records schema version, public/stored IDs, workspace, fixed
name/kind, version and prior-version IDs, source digest/format/default status,
row count, content/request/preview fingerprints. Its own full hash belongs in
`metadata_hash`; action `custom_dataset.version.saved`, resource type
`custom_dataset_version`, resource ID the stored version ID. A deterministic
workspace/version audit ID plus exact-one-event readback detects duplicates.
Do not duplicate all rows or the raw source in the audit manifest.

Serialize writes on the workspace row, then lock the scoped dataset/version/rows.
Check exact replay of the requested version and manifest before checking latest
head, so a lost-response retry succeeds after another version is saved. Otherwise:
new dataset requires version 1/null parent; append requires the exact current
public parent and next integer version. Freeze the name; never adopt legacy or
foreign rows on ID collision. Insert dataset/version/all rows/audit atomically,
then reread and validate full canonical membership/content, numeric JSONB parity,
identity, declared fingerprint and audit parity. Conflicts and partial state fail
409; never silently accept `ON CONFLICT DO NOTHING` as successful persistence.

Save requires `{ schemaVersion, draft, expectedPreviewFingerprint }`; preview is
pure and returns the complete canonical version content, resolved head, IDs,
bounds and fingerprint. Recheck under lock before a new save. Head/source drift
returns 409 with no writes. Readback recomputes the version/manifest projections;
missing, extra or changed rows/audit/identity/status fail closed instead of repair.
Missing audit metadata must not degrade into an unverified legacy read.

## Access, reader integration and UI

Reuse the actual custom-evaluator workspace-session access predicate: viewer can
read/preview; editor/admin/owner with evals:write can save. Reject project keys
and hosted local/demo ownership before body or data reads. Do not alter provider
Auth settings or broad legacy grants.

Add GET/POST `/api/v1/custom-datasets`, POST `/api/v1/custom-datasets/preview`,
GET `/api/v1/custom-datasets/[datasetId]`, and GET
`/api/v1/custom-datasets/[datasetId]/versions/[versionId]`, with safe errors and
no-store responses. Create and append both use the collection POST. A bounded
recent list must identify its limit and allow exact older versions. Return both
public identities and the stored datasetVersionId expected by scoring.

The supplied-output DB reader must validate the custom manifest/content whenever
either the custom namespace or kind is present; a corrupt custom kind must not
fall through as a legacy dataset. Reuse that validator for custom readback.
Preserve saved-run replay before live dataset reads. Audit all current dataset
writers/readers at implementation time: the inspected legacy benchmark writer can
append absent rows on repeated imports, but its generated IDs cannot collide with
the proposed namespace. Do not rewrite unrelated benchmark imports.

`GET /api/v1/benchmarks` accepts project keys, and `listBenchmarks` currently returns
all workspace dataset names/version IDs. Exclude the new private custom profile
there (namespace or kind) so dedicated session policy is not bypassed by metadata
disclosure. Keep existing benchmark responses/grants otherwise intact; show custom
datasets through the new session-only Evals surface and scoring catalogue.

Use `/evals/datasets` for list/authoring and nested dataset/exact-version pages.
The UI needs loading/empty/denied/error states, JSON/JSONL file-or-paste input,
name and explicit review-status controls, complete reference/metadata inspection,
preview without writes, and explicit Save. Any edit invalidates preview. Keep a
synchronous busy guard, request generation/lifetime guard and pinned intent.
Unknown save outcome locks edits and preserves exact retry/body/IDs; an absent
GET does not cancel an in-flight save. A 409 preserves text and requires reloading
and reviewing the current head before a new preview/new intent. Read saved values
after success and reload, with version history and a link that prefills the exact
stored datasetVersionId in `/evals/run`; never auto-execute scoring.

## Verification and storage limits

Author focused parser/hash/boundary cases, real disposable PostgreSQL create/
append/replay/CAS/rollback/concurrent-writer cases, auth-before-body and private
metadata checks, and desktop/narrow browser upload→preview→save→reload→scoring
selection plus lost-response and stale-head recovery. Include actual 100/101 rows,
full 1 MiB snapshot overhead, SQL NULL/JSON null, nested lossy numbers, arbitrary
metadata keys and corruption through both custom and scoring readers. Reuse passed
unchanged checks only as compatible prior evidence; do not add their counts to a
new invocation. Root controls execution and records exact source/check boundaries.

This is application-enforced immutability, not a database privilege/RLS guarantee.
Existing storage has no immutable trigger or dedicated dataset contract column.
The audit manifest becomes required integrity metadata: a future audit-purge policy
must retain these records or move them through an approved schema change. No raw
file byte-preserving archive, dataset rename, mutable in-place editing, original
file download, production migration, provider execution or full portable evaluation
package is claimed by this slice.

## Inspected execution sources

- `packages/db/migrations/0001_init.sql:244-272`: dataset tables and uniqueness.
- `packages/db/migrations/0002_hosted_integrations.sql:94-106`: audit storage.
- `packages/db/src/service.ts:491-525,797-863`: broad catalogue and legacy writer.
- `packages/core/src/benchmarks.ts:65-68,118-146`: legacy IDs, golden status/parser.
- `packages/db/src/custom-evals.ts:143-183,212-261`: workspace lock, replay and CAS.
- `packages/db/src/provided-output-runs.ts:167-209,341-345`: complete snapshot,
  JSONB semantic precision boundary and replay-before-live-inputs.
- `packages/core/src/provided-output-runs.ts:14-18,170-190`: consumer bounds/shape.
- `apps/web/lib/custom-eval-access.ts`, `custom-evals.ts`, `instruction-request.ts`:
  actual session policy, authorization order and streamed request limit.
- Immutable benchmark [import](https://github.com/alvarovillalbaa/open-evals/blob/9459a95881e6a7d0cf4cf0f827ea361236b72df8/apps/web/app/api/v1/benchmarks/import/route.ts)
  and [list](https://github.com/alvarovillalbaa/open-evals/blob/9459a95881e6a7d0cf4cf0f827ea361236b72df8/apps/web/app/api/v1/benchmarks/route.ts)
  routes were fetched and read; blobs `c433535f…` and `b8225213…` respectively.

The local selected source inspection does not prove absence of another writer
elsewhere in the complete repository. Inspect the final base's complete source map
before enforcing the mutation/privacy boundary. The saved owner-brief observation
is an unverified 22 October edition with an unresolved linked tweet, not a fresh
Notion-page verification. It supports editable reusable examples and separate
dataset/evaluator ownership; remaining provider/Harbor/campaign/rollout goals stay.

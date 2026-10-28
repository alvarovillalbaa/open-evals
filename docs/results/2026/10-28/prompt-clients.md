# Prompt client implementation receipt

Date: 2026-10-28. Base execution source:
[`1ea43b13517c11342cd30bc661134db29ebb8c38`](https://github.com/alvarovillalbaa/open-evals/tree/1ea43b13517c11342cd30bc661134db29ebb8c38).

## Implemented source

- Five checked TypeScript SDK authoring/resolve methods and detached canonical
  DTO parsers. Existing raw `Response` SDK methods remain unchanged.
- Real CLI create/preview/push/pull/resolve; reviewed-file retries preserve IDs
  and fingerprints. Offline diff compares full authored/materialized source,
  including unused bindings/libraries and order, with explicit legacy unknowns.
- Sequential argument parsing, nonzero safe failures, explicit-key precedence,
  checked legacy HTTP responses, configuration-only doctor and fail-closed
  unsupported commands instead of fictional success.
- Bounded strict UTF-8 file reads, endpoint binding, private new artifacts,
  atomic no-clobber publication and byte-identical retry behavior.

Independent source review corrected legacy DTO status/parent preservation,
selected-version catalog correspondence, successful-create/replay HTTP status
correspondence and dot identifiers in query/body fields. Exact dot definition
IDs remain unsupported in URL path methods. A non-regular input cannot block
the file open before type inspection.

See [the client contract](../../../prompt-clients.md) for the request/file
formats, example workflow, error behavior and remaining runtime boundary.

## Verification performed

- Targeted TypeScript syntax/transformation inspection only, using the existing
  TypeScript 5.9.3 installation. No product source was imported or executed.
  Root shell recorded both runtime version and executable attribution for Node
  `v22.23.3`. Independent agents also performed Node 24 syntax-only checks.
- `git diff --no-index --check` between the immutable selected-text base and
  candidate: no whitespace findings. Exit 1 represents the expected differing
  files; the SIDE parent is not a Git repository.
- Nine selected production/test/config source files parsed with zero syntax
  diagnostics, and 20 relative Markdown links resolved against the published
  repository tree. This does not establish semantic typing or runtime behavior.
- Source comparisons preserve manifests, lockfile, schema, Auth/access-policy
  and previously closed check files. No active workflow is introduced.

## Publication

The implementation and exact pending-check proposal were published in
[`c89ec78ce7137ca2d2ba5cf2ae637231464f5d70`](https://github.com/alvarovillalbaa/open-evals/commit/c89ec78ce7137ca2d2ba5cf2ae637231464f5d70).
All 18 changed/new text blobs matched the local candidate; the complete Git
tree comparison preserved the other 1,215 existing blobs. The branch moved with
an expected-parent lease, and selected files were fetched again to verify blob
correspondence.

Vercel reported production deployment `dpl_DxuKAeJf1Hdw6MaswDXkzNRkmfTQ`
**READY**, with `githubCommitSha` equal to that implementation commit. See its
[deployment inspection](https://vercel.com/my-team-4f230354/open-evals-web/DxuKAeJf1Hdw6MaswDXkzNRkmfTQ).
This establishes the hosted build only; it does not execute the new SDK/CLI or
establish hosted Auth/database readiness.

## Approved focused execution: 71 passed

The owner approved the exact runtime repair and new checks. Source
[`135ef951ec5fcb672569cb27bfbafbcb6d65a11e`](https://github.com/alvarovillalbaa/open-evals/tree/135ef951ec5fcb672569cb27bfbafbcb6d65a11e)
passed [run 40725370059](https://github.com/alvarovillalbaa/open-evals/actions/runs/40725370059),
job 122947065758: **22 SDK + 19 file + 26 CLI + 4 executable = 71 passed**,
zero failed/skipped/todo, retry count zero. Independent report/source-hash review
confirmed 71 unique case names and all 12 recorded source hashes.

Node 24.21.0 and pnpm 10.14.0 ran the existing frozen graph on one temporary
public Ubuntu job definition. Four bounded sequential attempts took place:
two stopped before installation/tests when the strict lock guard caught three
registry deprecation notices, one reported 70 passed/one fixture failure, and
the final attempt passed all cases. The fixture's default stream prefetch could
close it before observing SDK cancellation; setting its queue high-water mark
to zero retains the finite 33-chunk producer, exact size error and exact cancel
assertions. Production SDK source did not change for that correction.

The generated lock adds only the approved CLI `tsx` 4.22.4 importer edge plus
the three reviewed registry notices. Existing dependency versions, resolutions,
integrities, snapshots and other importers remain unchanged. Lock SHA256:
`77443b49cd42f85638d82f00bd0e9c510f3662cac777ee0082ffb103775702ea`.
The executable launcher registers its own declared runtime before importing
the TypeScript entry. The active workflow is removed; the reviewed inactive
definition remains in the proposal folder.

The [machine receipt](prompt-client-checks.json) retains source/runtime,
case totals, source hashes, earlier attempts and artifact metadata. Exact
[passing](prompt-clients/vitest-passed.json) and [earlier failing](prompt-clients/vitest-failed.json)
reports are retained. ZIP artifact 12832467130 could not be downloaded from the
local network; four bounded text files were recovered through authenticated
GitHub job logs and verified by SHA256. The receipt does not claim ZIP-byte
verification.

## Remaining proof limits

The executable checks invoke the manifest path through plain Node and an
ephemeral loopback HTTP fixture. They do not establish npm packaging/global
installation or actual Next/PostgreSQL/Supabase behavior. No browser, database,
model/provider, production configuration, release, promotion or experiment was
used. No broad suite or semantic typecheck ran. Earlier 55 compiler and 58
authoring passes remain separate receipts. Live database/Auth/configuration
remain [unverified](hosted-readiness.md).

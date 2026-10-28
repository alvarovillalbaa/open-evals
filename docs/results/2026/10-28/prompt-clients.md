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

## Not verified

The **71 newly authored SDK/CLI/file/native-bin cases have not run**. No
semantic typecheck, dependency installation, native subprocess, HTTP server,
browser, database, model or production check ran for this increment. The native
bin/runtime dependency is deliberately unchanged until separate approval.
Earlier 55 compiler and 58 authoring passes do not prove these clients.

The exact dependency repair, bounded CI workflow, case list and proof limits
are prepared in [the approval proposal](../../../proposals/prompt-client-checks.md).
Live database/Auth/configuration remain [unverified](hosted-readiness.md).

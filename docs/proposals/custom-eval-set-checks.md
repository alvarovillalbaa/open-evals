# Custom Eval Set focused scope

Standing user approval covers this authored-source/check/publication scope.
This record describes the exact work; the first local execution occurred on
9November at09:10:30UTC, as recorded in its actual command receipt. This is not
a claim that an unexecuted proposal supplied runtime proof.

- CE01–20: actual core builder/parser and actual canonical hash/Node crypto,
  using authored pure DTOs. Covers exact keys, Unicode/UTF-8/NUL, identities,
  versions/parents, threshold bounds, immutable data, all three hash preimages,
  corrupted contracts and unsupported recomputed alternatives. T1,20cases.
- CEA01–18: actual dependency-free access policy, including viewer/editor
  scopes, workspace sessions, API-key refusal, hosted-local refusal and local
  development. T1,18cases. No real Auth or HTTP seam is exercised.
- CE-PG01–12: authored, UNRUN real PostgreSQL checks. Persistence/membership,
  audits, replay/conflicts, immutable history, scope/identity boundaries,
  corrupt membership, rollback, bounded history and controlled two-writer CAS.
  T3 and manual-only; no SQL mock is promoted into persistence evidence.

The existing focused Node lane is used without a new runner/dependency/config.
Its core harness explicitly loads the existing native Next/SWC16.4.2 addon as
a read-only test tool, separate from appNext16.2.9. It permits only the actual
hash module and Node crypto; it does not stub hash outputs. Test source reads
are regular/no-follow/bounded/identity-checked; transformed source is bounded.
The parent process supplies a30second deadline and a minimal environment with
no live database/provider credentials. The access `.mts` file remains outside
the existing Vitest `.test.ts` collection. There is no fallback installation.

Database checks require explicit opt-in, a loopback disposable database with
the exact task-owned name/comment/owner markers, and the unchanged repository
0001/0002 migrations applied by separate owned setup. The test itself does not
create or migrate a database. Its fixture SQL and audit-failure trigger are
scoped and verified on cleanup. No T3 execution is claimed until actual output
and cleanup establish it. StorageGuard prohibits a local database/environment.

The selected source overlay remains below2MiB, with no Git history, installed
environment or build/audit tree copied. Full-tree Git identity and native
no-index whitespace checks apply. A full build in the existing Vercel project
has its own exact commit/status/log record; successful types/build would not
establish PostgreSQL, Auth, HTTP, browser, physical-device or campaign behavior.
No existing closed acceptance packet is replayed or relabelled.

The selected overlay has no installed Next guides. Matching official16.2.9
[page](https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/03-api-reference/03-file-conventions/page.mdx),
[client/server](https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/01-getting-started/05-server-and-client-components.mdx),
[error](https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/03-api-reference/03-file-conventions/error.mdx)
and [loading](https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/03-api-reference/03-file-conventions/loading.mdx)
guides were read before implementing those surfaces. The error boundary uses
the version's documented `unstable_retry` to refetch its segment; no additional
framework dependency is installed.

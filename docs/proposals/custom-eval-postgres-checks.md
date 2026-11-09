# Proposed custom Eval Set PostgreSQL checks

Prepared only; no publication, push, workflow execution, database provisioning or
check has occurred. The owner-confirmed accepted application source is
[`a8adcaa48e150cc94e68c189ab9d073435c503ac`](https://github.com/alvarovillalbaa/open-evals/commit/a8adcaa48e150cc94e68c189ab9d073435c503ac),
whose existing production build is READY. That build is not PostgreSQL check evidence.

The new workflow has one push trigger: `qa/open-evals-custom-eval-postgres-20261109`
in the public `alvarovillalbaa/open-evals` repository. It has no manual trigger and
does not touch any MCPCN workflow. Its verification commit must have exactly one
parent, the accepted application commit, with exactly two added files: this proposal
and `.github/workflows/custom-eval-postgres-checks.yml`. Application, tests,
dependencies and lockfile must already exist unchanged in that accepted parent.
Checkout uses the immutable push SHA, read-only contents access, no persisted Git
credential, no submodules and no LFS. Only the initial run attempt is admitted.

The single Ubuntu 24.04 job is capped at 20 minutes. Node is 24.22.2; a fresh task
tool directory contains pnpm 10.14.0. Installation uses the existing frozen lockfile,
ignores lifecycle scripts and selects the root/core/database workspace packages.
There is no dependency/configuration change, application build, web server, browser,
38-case pure-test replay, model, paid provider, production credential or account.

## Exact new verification

Run only `tests/integration/custom-evals-store.node.mjs` through the existing locked
`tsx` loader and Node TAP reporter, with a 300-second child deadline. This is T3:
the actual new core preparation and database store use real PostgreSQL, not mocked SQL.
Twelve literal CE-PG01–12 results, all zero-failure/cancel/skip/todo TAP totals and
successful cleanup are required. No older receipt supplies a missing result.

The cases cover exact saved contract/membership/audit; authorized-actor replay;
changed-intent 409; immutable version 2 and historical replay; stale head and sequence
conflicts; workspace isolation; global identity collisions; missing/altered membership;
tampered contracts; an actual scoped audit-trigger failure and full rollback;
21-version history bounded to 20; and two actual writers positively observed waiting
on the same owned workspace lock before release, accepting exactly one successor.

The job uses only the Ubuntu 24.04 runner's preinstalled PostgreSQL 16 binaries at
`/usr/lib/postgresql/16/bin`; it refuses missing tools or a different major version
and records the actual binary/server versions. It does not start the system service,
use Docker, install PostgreSQL, use sudo, or relax the test's loopback-address guard.
The official runner image inventory currently reports PostgreSQL 16.15; an actual
runner may have a later image and must supply its own observed version.

A fresh, UID-bound directory under `RUNNER_TEMP` holds an `initdb` cluster and private
socket directory, with authored fixture authentication. Port 65432 must be unused;
the server listens only on `127.0.0.1`. A collision fails without stopping another
server or choosing a different target. The job creates exactly
`oe_custom_evals_test_<run_id>_<run_attempt>` with owner `postgres`, refuses an existing
database, and applies only the unchanged repository migrations 0001 and 0002. The
database COMMENT must be exactly
`open-evals-custom-evals-20261109-created-disposable-v1`. The authored test additionally
checks explicit opt-in, database-name prefix, actual server loopback address,
database owner, marker and required schema before importing the store. Its two
fixture workspaces and generated rollback trigger/function are identity-checked and
cleaned by the tests. No hosted RLS or API authorization claim follows from owner SQL.

The child receives a minimal environment with only its explicit disposable URL;
application `DATABASE_URL`, `POSTGRES_URL` and Supabase credentials are not inherited.
The service password is an authored ephemeral fixture value, never a production secret.
Finally, the driver reads the exact database marker/owner before an ordinary
non-force drop and proves the database name absent afterward. It then rechecks the
owned postmaster PID/start identity, UID, executable, data/socket directories and
port, uses `pg_ctl stop -m smart`, and proves the PID and PID file absent and port
free. Only then may the identity-bound, non-symlink, UID-owned cluster tree be removed
(at most 5,000 entries/256 MiB). Unproved database teardown retains the stopped data;
an uncertain process or path is not signalled or removed. No uncertain cleanup is
relabelled successful. This is independent of the machine's shared system cluster.

## Pins and retained proof

Verified read-only against the official repositories on 2026-11-09:

| Dependency | Immutable source |
| --- | --- |
| Checkout, Node 24 action runtime | [actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803](https://github.com/actions/checkout/commit/d23441a48e516b6c34aea4fa41551a30e30af803) |
| Setup Node, Node 24 action runtime | [actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38](https://github.com/actions/setup-node/commit/249970729cb0ef3589644e2896645e5dc5ba9c38) |
| Artifact upload, Node 24 action runtime | [actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f](https://github.com/actions/upload-artifact/commit/b7c566a772e6b6bfb58ed0dc250532a479d7789f) |
| Preinstalled PostgreSQL 16 | [Official Ubuntu 24.04 runner inventory](https://github.com/actions/runner-images/blob/741e4eb8ef5f51698d730ac16ede65cadb067522/images/ubuntu/Ubuntu2404-Readme.md), image `20261101.360.1` reports 16.15; [official installer](https://github.com/actions/runner-images/blob/741e4eb8ef5f51698d730ac16ede65cadb067522/images/ubuntu/scripts/build/install-postgresql.sh) installs the selected PostgreSQL major and disables the system service. This job only uses the existing binaries. |

Artifacts retain the embedded driver, source admission/hashes, complete per-command
stdout/stderr, argv/deadline/exit/completeness/hash records, actual TAP, and explicit
database/cluster creation and cleanup receipts, plus the closed server log, for two
days, also on failure. Each stream and the complete server log is
bounded to 4 MiB; overflow or a child deadline terminates the command and records
incomplete capture as failure, never a truncated original called complete. The
finite command list and caps bound retained streams; no dependency directories or
database files are uploaded. Actual command count is recorded rather than invented.

Complete bounded test stdout/stderr and command/cleanup JSON are also printed to
the job log. Provider-prefixed log text is not the original stream whose hash is
recorded in the artifact. Connected tools currently expose artifact download,
workflow/job metadata and full job-log retrieval; successful extraction and exact
archive readback remain unverified until a real job returns them. Hard runner/job
cancellation can prevent later cleanup or artifact upload; such missing proof
remains unverified. This proposal does not authorize a retry that changes source,
case bodies, guards or acceptance conditions without preserving the prior outcome.

# Custom Eval Set PostgreSQL result

The twelve actual PostgreSQL store cases passed in
[R2 run 42597640101](https://github.com/alvarovillalbaa/open-evals/actions/runs/42597640101),
[job 129094101939](https://github.com/alvarovillalbaa/open-evals/actions/runs/42597640101/job/129094101939).
TAP records 12 tests, one suite, 12 passes and zero failures, cancellations,
skips or todos, with a reporter duration of 10,729.276548 ms. The driver also
recorded successful database and cluster teardown. This T3 store result does
not establish HTTP, real Auth, hosted RLS, browser or production-database behavior.

[Machine record](custom-eval-postgres-checks.json) and
[recovered original stdout](custom-eval-originals/postgres-cases.stdout.txt)
preserve the result. The unchanged test's historical suite title still says
`authored UNRUN`; the literal twelve passing results establish this execution.
The [earlier 38-case T1 result](custom-eval-checks.md) remains a separate
invocation and was not rerun. There is no combined 50-case invocation or claim
that unrelated CI is green.

R2 used verification source
[`a677e14d8a17097b5748bbedf08df715c17b87f3`](https://github.com/alvarovillalbaa/open-evals/commit/a677e14d8a17097b5748bbedf08df715c17b87f3),
directly parented by accepted application source
[`a8adcaa48e150cc94e68c189ab9d073435c503ac`](https://github.com/alvarovillalbaa/open-evals/commit/a8adcaa48e150cc94e68c189ab9d073435c503ac).
The executed admission checks allowed only the new workflow and proposal;
application code, dependencies, migrations and all twelve case bodies/guards
were unchanged. The PostgreSQL test source SHA256 is
`7110395af88acab953bcc78d4ccfbbf287dda38f48d42920b55515efb050f904`.
Node 24.22.2, pnpm 10.14.0 and PostgreSQL major 16 requirements passed their
guards. Exact PostgreSQL minor-version output was not recovered locally.

The cases exercise saved contracts and actual evaluator membership, content-free
audit rows, actor-independent replay, changed-intent and head conflicts,
immutable renamed history, workspace/global identity boundaries, corrupted
membership/contracts, real audit-failure rollback, bounded history and two
writers positively observed waiting on the actual workspace lock. They use
owner SQL in a fresh host-local cluster; no production credentials or hosted
authorization behavior are implied.

The driver reports 23 commands with exit zero and 46 complete bounded streams.
Only the two test streams were recovered from provider-prefixed job-log text and
hash-verified against the driver-reported original stream records: stdout is
3,436 bytes, SHA256
`99d2d188d883d4e9916ba914cc7cf6c9d46c655ff1d9e4cf0be5e99eef665bac`;
stderr is empty, SHA256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
The other 44 command streams and the server log were not recovered or locally
hash-verified. The complete provider job log is retained privately: 83,944
bytes, SHA256 `ee9d14adfa5ee539e308e3323252ee9a0ab2f51336133442c37e32983075057a`.

Cleanup recorded the exact database name, owner `postgres` and task marker
before ordinary, non-force DROPDB, followed by a successful absence query.
The executed driver rechecked server PID/start/UID/executable/data/socket/port
identity before smart stop, then required PID and PID-file absence, a free port
and an identity-bound regular owned tree before removal. The receipt records
1,000 removed entries / 40,229,315 file bytes, UID 1001, database/cluster absence
and no errors. Server-log completeness and its digest are driver-reported
metadata; its raw contents were not locally read.

[Artifact 13663154565](https://github.com/alvarovillalbaa/open-evals/actions/runs/42597640101/artifacts/13663154565)
is reported as `custom-eval-postgres-42597640101-1`, 22,955 bytes, with service
SHA256 `b0c38d38e88f7a6d00955fca0c1c5746f28158cc7102eb58c499c8b28957efbc`
and expiry 11 November 2026 at 10:02:01 UTC. The connector returned a file
reference, but local fetch failed. No local ZIP read, extraction or independent
archive-digest verification occurred. Case/cleanup verification passed;
archive readback remains unverified.

[W1 run 42596693201](https://github.com/alvarovillalbaa/open-evals/actions/runs/42596693201)
at source `82d53bb929dd484e6f1887bd58683006bbd2f24d` remains a failure with zero
jobs, artifacts and PostgreSQL cases. R2 corrected its documented runner-context
compatibility error; the exact W1 server annotation was not observed. W1 was
preserved, not relabelled as a pass.

See the [implemented product contract](../../../custom-evals.md). Dataset and
evaluator composition, Harbor, hosted configuration and full-product acceptance
remain separate requirements.

# Matching v3 focused checks

Authorized by Alvaro's standing "I approve everything / Keep going / Do all the
work" instructions. The previously approved free, bounded check/publication
scope applies. One public Ubuntu job, at most 20 minutes, contents-read token
only. No paid service/account, production data, provider setting, migration in
a live database, model call, release promotion or deployment is proposed.

The versioned source adds literal exact checks, mixed contains-v2/exact-v3
membership and the matching HTTP v3 profile. This requires application
persistence and browser checks in addition to deterministic core assertions.

The 66 distinct authored cases are:

- 24 `XM01–XM24` core cases: literal equality, Unicode/coercion boundaries,
  strict drafts, source/family/workspace identities, immutable records, parents,
  mixed order/provenance and original v2 fingerprint compatibility.
- 18 `XH01–XH18` HTTP cases: all three source families, shared-result uniqueness,
  hidden configuration, critical low-threshold gates, complete readback,
  uncertain recovery, fixed families, bounds and original v1/v2 full executions.
- 20 `XM-PG01–XM-PG20` disposable PostgreSQL cases: native item/set/audit
  roundtrip, mixed source validation, append/history, exact retries, bounded
  concurrent CAS, atomic rollback, workspace isolation, corrupt-record denial,
  generic namespace fences, HTTP projections/replay and expired-claim recovery.
- Four `XM-BR01–XM-BR04` production-app Chromium scenarios: desktop exact save
  with a committed unknown response and identical retry; narrow mixed selection,
  order/history/reload; actual viewer/project-key/foreign boundaries; matching
  execution with four unique results from two committed claims and no reload
  redispatch. Four bounded PNGs are retained for inspection.

Core/HTTP checks use T2 authored values only. PostgreSQL/browser checks use T3
owned disposable data and fixture-only session identities. The browser uses the
actual compiled app, authorization and SQL stores. A test-only dependency
preload supplies two authored responses after verifying committed claims. It
denies unbound transport. This proves application execution with authored
transport; it does not prove external DNS/socket/TLS or hosted provider behavior.

`tests/scripts/run-eval-matching-checks.py` owns the runner. It checks the exact
candidate parent and workflow-only activation delta, exports bounded source
including the repository's root workflows package, without tracked
node_modules/history/old evidence, verifies Git blobs, and
installs the existing frozen lockfile with pinned pnpm 10.14.0 under Node
24.22.2. The first CI run43122180243 passed all42 core cases and then failed
because its source export omitted the workflows package. That failure and its
original digest-verified ZIP remain evidence. The corrected runner checks every
core source/fixture blob against that exact source and carries those42 passes
without replay. It resumes one production web build, then real SQL and
Chromium against a new loopback-only PostgreSQL 16 cluster on port 65432.
Only existing migrations 0001/0002 initialize this disposable database.

Every child exit and original bounded stream is persisted before assertions.
Failures remain evidence. Cleanup checks owned fixture absence, drops only the
marked test database, stops its own cluster/app, verifies source hashes and
removes only the newly owned runner root when teardown is proved. Evidence is
outside that root and retained for two days. Incomplete teardown fails the job.
No failed case is disabled or replaced with a synthetic pass.

Local Storage Guard failed at 1.8 GiB free versus 34 GiB required. Therefore no
local dependency installation, build, application server, browser or database
is used. The local T2 checks ran against bounded frozen source with the existing
Node 26.8.2; the first CI run repeated those42 cases under the pinned environment.
Counts are distinct cases, not the number of repeated invocations.

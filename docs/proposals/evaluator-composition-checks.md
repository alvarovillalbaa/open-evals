# Focused evaluator composition checks

Scope: reusable contains items, ordered multi-item sets and explicit HTTP-plan
v2 dispatch, preserving immutable v1 behavior. This is a check proposal, not a
result. The owner has already authorized the necessary focused checks and
temporary free CI; no additional approval request is pending.

Use authored items and datasets, disposable workspace identities and an owned
PostgreSQL database. One temporary public Ubuntu job is capped at 20 minutes,
using the already locked Node/pnpm/dependencies. Run core and Web protocol
checks, focused real-SQL cases, a production build and a small desktop/narrow
Chromium packet. Preserve failed attempts and report case counts from actual
test manifests rather than combining repeated invocations.

Core checks must cover strict parsing, workspace identities, fingerprints,
ordered membership, duplicate/conflicting item definitions, overlapping sets,
exact unique result coverage, all gate levels, complete record budgets and v1
compatibility. Storage checks must cover atomic saves and audits, head CAS,
replay after later versions, historical reads after renames, cross-workspace
isolation, membership corruption and protection from legacy writers. Web checks
must cover auth before body parsing, viewer/editor boundaries, bounded JSON,
unknown-save recovery and explicit plan-family dispatch.

Browser journeys must author saved checks, select exact versions into two sets
sharing one item, save/reopen the sets and plan, and verify the visible result
and gate coverage. A fixture-only native dependency preload may provide authored
responses for one frozen test hostname. It must validate the disposable fixture
identity and actual request/claim, journal calls, reject unexpected traffic and
prove one call per row with no replay call. The production app receives no test
flag, fallback response, alternate target implementation or global setter.
This is transport-seam evidence; native DNS/socket/TLS remains unverified.

Cleanup runs after success or failure. Record the owned server's exit and absent
PID/process group/port, remove only marked fixture content, and drop only the
owned disposable database/cluster. Do not use production data, real endpoint or
model calls, paid services, new accounts, migrations, dependency changes or
provider configuration. Local storage remains below the required reserve, so
there is no local install, build, database or browser launch.

The implementation contract is [reusable evaluator composition](../evaluator-composition.md).
Prior dataset and HTTP receipts keep their original sources and counts.

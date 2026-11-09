# Custom Eval Set browser result

Four real Chromium journeys passed against the production-mode app and an owned
PostgreSQL database in
[R2 run 42608186016](https://github.com/alvarovillalbaa/open-evals/actions/runs/42608186016),
[job 129129427062](https://github.com/alvarovillalbaa/open-evals/actions/runs/42608186016/job/129129427062),
at source [`b69fd83c`](https://github.com/alvarovillalbaa/open-evals/commit/b69fd83c3cab008b6bc6a3b2459828b82f73da98).
The report records four passes, zero failures/skips/flaky results, one result per
case and retry zero; duration is 7,709.306 ms. This is bounded T3 browser/HTTP/store
evidence; real-user acceptance remains pending.

Both runs reproduced the original list-rendering defect: with a valid signed
session, the API returned HTTP 200 and an empty set list, while the baseline
list returned HTTP 200 containing access-denied copy. Within each build's
probe, API and list used the same cookie. Adding `await connection()` before
the list loader made the candidate render the creation form for the runtime
session. The probes used fresh production builds; the recovered HTTP JSON
records contain the comparisons, not locally recovered raw HTML or headers.

| Case | Actual journey | Final SQL versions / audits |
| --- | --- | --- |
| CE-BR01 | Desktop creation, new version, reload and immutable history | 2 / 2 |
| CE-BR02 | Real committed POST response discarded, then byte-identical UI retry without duplication | 1 / 1 |
| CE-BR03 | Two actors, stale-head 409, retained draft, load latest and reviewed version-three save | 3 / 3 |
| CE-BR04 | 390×844 validation without a premature POST, layout, save and reload | 1 / 1 |

Each case's report contains its actual SQL persistence attachment and owned
fixture cleanup. Both jobs recorded four fixture cleanups with zero remaining
rows, absent workspace/actors, marked-owner database removal, PostgreSQL stop
and cluster removal: 1,004 entries / 40,229,092 file bytes, UID 1001. Driver
receipts also record both owned app processes/groups absent and ports free
after graceful shutdown.

The [first run 42606774042](https://github.com/alvarovillalbaa/open-evals/actions/runs/42606774042)
at source `329997c59d2fa84ac72e3ae0591c10c8c0966fb3` remains **zero passes / four
failures**, with cleanup preserved. R2 corrected the test locator binding
and expected-shutdown bookkeeping: the textarea's anchored label prefix binds
its existing nested control after SSR, and form-scoped feedback excludes Next's
route announcer. Every case name and substantive assertion remains. Exit 143
is accepted only for the driver's intentional graceful SIGTERM, with closure
checks retained. No application/Auth change was made between these attempts.

[Machine record](custom-eval-browser-checks.json) lists exact bytes/hashes and
links to six byte-exact selected originals per run under
`custom-eval-browser-originals/first/` and `corrected/`. All twelve were recovered
and hash-verified. The retrieved job logs are retained privately. Other raw
CI build, HTTP-body/header and server-log streams, screenshots/traces, and artifact
ZIP bytes were not locally read; service artifact digests are not independent
ZIP verification. The first stdout retains eight reported trailing-whitespace
lines as original evidence; no blanket all-diff-clean result is claimed.

The earlier [38 T1 cases](custom-eval-checks.md) and
[12 PostgreSQL cases](custom-eval-postgres-checks.md) remain separate and were
not rerun. At 11:27:44 UTC on 9 November 2026, the separate
[production build record](custom-eval-browser-production-build.json) observed
the checked `b69fd83c` source READY and alias-matched: Next 16.2.9 compilation,
TypeScript and 37-page generation passed, with both custom routes dynamic.
This dated provider observation is not live hosted browser/Auth/DB proof;
main acceptance and temporary workflow-ref retirement were still pending.
Signed HMAC fixtures do not prove Supabase/provider login, hosted
membership/RLS, physical touch/device behavior or full-product acceptance.
See the [product contract](../../../custom-evals.md) for the remaining scope.

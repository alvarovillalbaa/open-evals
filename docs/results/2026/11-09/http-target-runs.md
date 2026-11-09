# Saved HTTP target plans: bounded QA result

2026-11-09. Saved HTTP target plans passed the checks below. Actual native HTTPS
execution remains unverified; this is not full execution acceptance or evidence
of main/production promotion.

Inside Evals, `/evals/plans` binds exact saved dataset and supported evaluator-set
versions to a declared HTTP target, previews the complete plan without calling
it, and explicitly saves immutable versions. History, stale-head review and an
identical retry after a lost save response preserve authored intent. Separate
execution controls and a durable coordinator reserve first, commit a unique row
claim before dispatch, retain actual outcomes and expose read/replay/recovery
without automatic resending. Those execution paths were checked through authored
module seams and disposable SQL, not real target dispatch. See the
[implementation contract](../../../http-target-runs.md).

The final verification source is
[`327fc6bd89a0c3a482018cb48a5e66d63b7c6315`](https://github.com/alvarovillalbaa/open-evals/tree/327fc6bd89a0c3a482018cb48a5e66d63b7c6315),
tree `bf495ea0d5d9e03bebb7910d3eb1d1e59b4b4a18`.
[CI3, job 129425215072](https://github.com/alvarovillalbaa/open-evals/actions/runs/42695238785/job/129425215072)
passed one fresh full root build and all five Chromium scenarios, with retries 0,
no skipped/flaky cases and no target calls. Its scope did not rerun the 65 checks
already passed in CI2. Release integration is limited to retiring this task's
temporary workflow and adding documentation/evidence; application and test bytes
must remain identical to this verification source.

There are **134 distinct checks**, accumulated across these separate lanes.
Repeated attempts and the later 26-case transport replay are not additional cases.

| Lane | Passed | Evidence scope |
| --- | ---: | --- |
| Core T1 | 38 | Local Node 26.8.2 pure parsing, immutable identities, protocol, scoring and state transitions; core/test source pins match the final verification source. |
| Transport T2 | 26 | Actual adapter source with authored DNS/request doubles; the later apex-regression replay passed all 26 locally. No native DNS/socket/TLS. |
| Web T2 | 20 | Actual modules under Node 24.22.2 built-in TypeScript transform and VM, with authored auth/DB/clock/transport seams. Passed in CI2. |
| HTTP PostgreSQL | 31 | Disposable PostgreSQL owner connection: immutable versions, reservation/claim/finalization/recovery, corruption and isolation. Passed in CI2. |
| Supplied-output PostgreSQL regressions | 14 | Existing regression cases after the shared dataset-source loader change. Passed in CI2. |
| Actual-app Chromium | 5 | Desktop/narrow preview/save/reload, Unicode, real stale-head conflict, committed-save response loss/exact retry, and viewer/key/foreign-workspace boundaries. All passed in CI3; no dispatch. |

The 65 Web/SQL cases and an earlier full build passed at
[`26433ff1e35a54f6c2ec9edcac389e221fd264fb`](https://github.com/alvarovillalbaa/open-evals/tree/26433ff1e35a54f6c2ec9edcac389e221fd264fb),
[CI2, job 129414385013](https://github.com/alvarovillalbaa/open-evals/actions/runs/42692158133/job/129414385013).
That overall job failed its browser phase, with HTTP-BR01/02/05 passing and
HTTP-BR03/04 failing because each unscoped alert locator matched both the product
notice and Next's route announcer. Only those two locators were narrowed; their
expected text and remaining assertions were preserved. CI3 passed all five.

Earlier failed evidence remains separate: both local 20-case Web attempts failed
during common module loading, first because strip mode could not lower parameter
properties, then because Node 26 had removed transform mode. No assertion-body
acceptance came from either attempt. CI1 under compatible Node 24 reached the
bodies and passed 18/failed 2 because of cross-realm comparison assertions; the
harness normalized those values without changing product behavior. CI1 stopped
before SQL, build or browser execution. The standalone transport apex regression
also failed before adding exact `home.arpa` rejection, then passed in the existing
26-case packet. Core plan validation already rejected that apex; no core-v1
plan-flow bypass was established.

CI3 recorded every table in its fresh disposable database empty before the build.
Each browser fixture recorded ownership-validated cleanup, zero dispatch claims
and zero remaining domain counts. The receipt records the database removed,
PostgreSQL cluster stopped/removed, and app PID/process group absent with the port
free. Existing migrations were applied only to disposable fixtures; no new
migration, production-schema change, dependency change, provider/model call or paid enrollment
is part of this acceptance.

The [evidence index](http-target-raw/evidence-index.json) separates exact selected
originals from explicitly labelled projections of private local command/error
metadata. CI3's 10 completely decoded selected originals total 71,791 bytes, with
lengths and SHA-256 hashes verified. Build success is recorded by its command's
return code 0; the complete build stdout/stderr are represented by metadata
lengths/hashes, not retrieved raw streams. Uploaded GitHub artifact archives were
not downloaded; no full ZIP, screenshot or trace inspection is claimed. Selected
originals are not a complete artifact export, and earlier failures are retained.

Native DNS/socket/TLS, actual HTTP target execution and its durable execution UI
remain **unverified**. Authored transport/coordinator seams do not provide that
proof. The browser cohort used signed test sessions and an owner database, so it
does not establish hosted sign-in, membership provisioning or RLS enforcement.
Physical devices and live production pages were not checked. No model-generated
answer or provider integration was tested. These limits remain separate from the
successful build, SQL and no-dispatch browser evidence.

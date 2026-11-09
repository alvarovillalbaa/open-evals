# Reusable evaluator composition — focused verification

**All 128 focused checks and the full root build passed** on checked QA source
[b3442e2](https://github.com/alvarovillalbaa/open-evals/commit/b3442e222aa380fe6fded1a08b5b378618ac9abc),
tree `b0015492cfbd49d08382c7813127a47af26a2035`, in
[CI5](https://github.com/alvarovillalbaa/open-evals/actions/runs/42719068177/job/129508066497).
All four Chromium journeys passed with zero retries.

Evals now authors reusable saved contains items and ordered sets of exact item
versions, with preview, explicit save, immutable history, conflict review and
uncertain-save recovery. Shared exact items retain each membership and are
scored once per row. Existing plan screens support explicit legacy/reusable
references while each plan keeps its contract family. The
[implementation contract](../../../evaluator-composition.md) defines the limits.

The distinct scope is **76 core** (33 new, 38 HTTP v1 regressions and five
immutable-parent goldens), **24 Web/API, 24 PostgreSQL and four browser checks**.
Repeated attempts and the earlier local packet add no distinct cases.

| Attempt and exact source | Core / Web / SQL | Root build | Chromium |
| --- | --- | --- | --- |
| [CI1](https://github.com/alvarovillalbaa/open-evals/actions/runs/42714189619) · [1286157](https://github.com/alvarovillalbaa/open-evals/commit/1286157be31048ad93e3e0ea531ecdc9837fd8a2) | 76 / 24 passed; SQL 20 passed, four failed | Not run | Not run |
| [CI2](https://github.com/alvarovillalbaa/open-evals/actions/runs/42715252378) · [2344342](https://github.com/alvarovillalbaa/open-evals/commit/2344342ee0211f76aa6c93d7e92a8cb781ab1a8b) | All 124 passed | Failed: DB TS2322 | Not run |
| [CI3](https://github.com/alvarovillalbaa/open-evals/actions/runs/42716305159) · [cdfd35b](https://github.com/alvarovillalbaa/open-evals/commit/cdfd35b8076be3e75959a7a8d5f33f0ce3cfd341) | All 124 passed | Nine packages passed; Web bundle compiled, then TS2742 | Not run |
| [CI4](https://github.com/alvarovillalbaa/open-evals/actions/runs/42717825539) · [9c748e4](https://github.com/alvarovillalbaa/open-evals/commit/9c748e48f47644123c0364ec5b34a11e9eaa44f0) | All 124 passed | Passed | One passed, three failed |
| [CI5](https://github.com/alvarovillalbaa/open-evals/actions/runs/42719068177) · [b3442e2](https://github.com/alvarovillalbaa/open-evals/commit/b3442e222aa380fe6fded1a08b5b378618ac9abc) | All 124 passed | Passed | Four passed; zero retries |

CI1 corrected two unquoted SQL test aliases without changing assertions.
CI2 added explicit return before the same always-throwing error helper so an
optional array narrows correctly. CI3 added portable public view/return types;
runtime statements stayed unchanged. CI4 added explicit label/select associations
to three controls; options, handlers and every browser locator/assertion stayed
unchanged. All failed attempts remain retained.

The compiled production-mode app exercised actual routes, coordination and owned
SQL with fixture-only DNS/HTTPS responses. Two rows through sets `[A, B]` and
`[B, C]` produced **two committed claims, two authored responses, six unique
results and twenty gates**. Shared critical failure blocked both containing
set scopes at zero thresholds. Identical execution retry and reload added no
calls. Other journeys covered narrow-screen history, exact older versions,
mixed legacy references, visible-head CAS review, committed-save recovery,
viewer/key/foreign-workspace boundaries and strict raw-input refusal.
All four owned browser fixtures cleaned all 17 resource-count fields to zero;
26 native tables were empty and the database, server and cluster were removed.

The earlier pure 74-case packet passed. A retained expanded 33-case run then
failed two added boundary cases (getter access and coerced ledger status),
followed by two narrow repairs and 76 passes. Compatibility goldens derive from
[immutable parent 8940256](https://github.com/alvarovillalbaa/open-evals/commit/894025656a7d264b3b2d573c90e67c40aba57fcf),
not candidate roundtrips.

The [evidence index](evaluator-composition-raw/evidence-index.json) separates exact
selected originals, receipt projections and normalized local failure diagnostics,
with original byte/SHA-256 provenance. CI2 includes full failed-build diagnostics.
**CI3 stdout is only a 4,096-byte tail of 6,730 bytes, offset 2,634**; its
full-source hash is metadata only. CI3 stderr is complete at 1,604 bytes.
CI4/CI5 build success is command/EOF metadata; full build streams were not
retrieved. No artifact ZIP, screenshot or trace archive retrieval is claimed.

Verification binds the QA source above. The subsequent release adds
documentation/evidence and retires its temporary workflow; those changes are
outside the checked runtime boundary. Native DNS/socket/TLS, actual external
targets or models, hosted Auth/RLS, real-account production use and physical-device
acceptance remain unverified. Signed fixtures and authored transport responses
do not establish those separate acceptance gates.

At 2026-11-09 23:33:55 UTC, release source
[`6f7b4be`](https://github.com/alvarovillalbaa/open-evals/commit/6f7b4beaa819dd0ac9eda6b98ae8f360bd881837)
was `READY` on Vercel and owned the [canonical URL](https://open-evals-web.vercel.app).
An account-authorized request to `/evals/composition` returned HTTP 200 and
rendered the workspace-access gate. This did not exercise production sign-in or
authoring. The [dated deployment observation](evaluator-composition-production.json)
records the exact deployment, source and limited HTTP proof separately from CI.

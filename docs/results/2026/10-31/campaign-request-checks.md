# Campaign-request checks — passed

**All 53 checks passed** in [run 41246867367](https://github.com/alvarovillalbaa/open-evals/actions/runs/41246867367) on **2026-10-31**: 26 core, 19 PostgreSQL and 8 Chromium cases. This receipt was authored on 2026-11-02; no new run was started.

Checked immutable source: `e3cec0fffb80c0a3d5896110a897508cb7ff861d`. Activation: `9ac5c2dea117218886be652ffe0fd312c3445e71`. All exact 45 unit/PostgreSQL names and 8 browser title/profile pairs matched the fields-repaired seal. Actual test processes exited 0; browser global errors, unexpected, flaky, skipped and retries were 0.

The four real browser scenarios passed once each at 1440×1000 desktop and 390×844 mobile/touch: Unicode preview/save/history reload; stale-preview/context invalidation; committed lost-acknowledgement recovery without duplication; and read-only history/locked-component controls. Each passed scenario also checked client exceptions, unexpected external requests, execution-endpoint requests and page width.

Both **288-input source guards** and the database marker readback passed. Guarded namespace cleanup, owned-file cleanup and container stop passed. All six recorded child processes exited 0 without overflow. The job used Ubuntu 24.04.5, Node 24.21.0, pnpm 10.14.0 and PostgreSQL 16.15, with the unchanged frozen lockfile and only migrations 0001/0002.

The planned later documentation edition changes only `README.md`, `docs/campaign-requests.md` and `docs/proposals/campaign-request-checks.md`. Reproduction stays pinned to the checked source above; the remaining 285 sealed inputs, including product code, fixtures, case bodies and lockfile, must remain unchanged. All four historical source seals remain immutable. Publication verification belongs to the owner.

[Machine receipt](campaign-request-checks.json) retains every actual case name/status, runtime provenance, exits, guards and cleanup outcome. Earlier failed attempts remain alongside it. This focused disposable/loopback proof does not establish hosted-production Auth, real-user/device behavior, a full app build, or unrelated regressions. Request preparation did not grant approval, start a campaign, call a provider/model, or change releases. Temporary reports were removed; no separate surviving-process inventory was recorded. Root owns subsequent publication and workflow retirement.

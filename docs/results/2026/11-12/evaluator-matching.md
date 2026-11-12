# Literal exact checks and mixed evaluator sets

Matching v3 adds exact-text items, ordered mixed contains/exact sets, immutable
authoring/history/retry, and explicit HTTP v3 plans and executions. Exact checks
preserve case, whitespace and Unicode. Required critical failures block affected
scopes even when their pass-rate threshold is zero. Existing v1/v2 serialized
records and fingerprints retain their contracts; no migration, dependency,
grant, provider setting, production data or model call was introduced.

## Accepted qualification

All66 distinct authored identities passed across these exact sources. This is
not a single66-case invocation or a rerun of earlier closed product scopes.

| Cases | Exact source | Actual run |
| --- | --- | --- |
| XM01–24 and XH01–18:42 core/HTTP | `7d9b7f3e0e844ebe4543cdf7201ea7e112cba181` | [43122180243](https://github.com/alvarovillalbaa/open-evals/actions/runs/43122180243) |
| XM-PG01–20:20 real PostgreSQL | `fa04f8c8f377191f252d29745b59e115ccbbeafd` | [43124736808](https://github.com/alvarovillalbaa/open-evals/actions/runs/43124736808) |
| XM-BR01–03:desktop/narrow authoring and real access policy | `4d8aa6c6f6b1efca5210d4797ad164e9662933fe` | [43126638209](https://github.com/alvarovillalbaa/open-evals/actions/runs/43126638209) |
| XM-BR04:mixed UI plan, actual execution, canonical run reload and exact API readback | `6c0c81850633004b8b9579a3653636608e1b064c` | [43127918089](https://github.com/alvarovillalbaa/open-evals/actions/runs/43127918089) |

The final successful job130884598595 at activation
`f5a244c2b45e5fa7ad404b5a90d8f18dbf38a7fc` used Node24.22.2, pnpm10.14.0,
Next16.2.9 and PostgreSQL16. Semantic checking and a fresh production web build
passed. Only XM-BR04 ran again. The controller carried42 core cases using full
core/fixture equality and20 SQL cases using complete core/database/fixture/
locked-input equality. It carried three browser cases only after application,
dependency and support-fixture blob equality plus byte-identical shared helper
and individual test slices. The new app/core/DB source is unchanged from CI5.

Browser actions exercised the compiled app and real disposable SQL: a committed
unknown save recovered by identical retry; ordered mixed membership survived
narrow-screen save/reload; viewers/project keys/foreign workspaces respected
existing authorization; and the matching plan produced four unique results,
16 gates and two committed row claims. Reload/API readback retained the exact
record without another authored target response. Two authored responses were
supplied after checking those committed claims. There were no external target,
judge, provider or model calls.

Final cleanup proved the app was reaped and its process group absent, fixture
counts zero, owned database absent, cluster stopped, exported source unchanged
and owned runner root removed. This is bounded fixture/process evidence, not a
host-wide, cache or runner-disposal attestation.

## Preserved failures and originals

All six original Actions ZIPs were recovered and matched their server sizes and
SHA256 digests before exclusive bounded extraction. Their permanent carrier is
the [matching evidence release](https://github.com/alvarovillalbaa/open-evals/releases/tag/matching-v3-evidence.1);
[the manifest](evaluator-matching-evidence.json) binds cases, runs and archives.
The release also preserves the three local T2 attempts and their original exits
and streams. Derived local member indices do not replace original archives.

- CI1 passed42 cases, then failed because its source export omitted workflows.
- CI2 exposed a new plan-form TypeScript union error; explicit v2/v3 branches
  repaired it. CI3 exposed two DB helper parameters still typed1|2; they now
  accept3. No scoring behavior was changed for these type repairs.
- CI4 passed semantic/build/20SQL, then failed loading an async ESM fixture with
  require. Database cleanup passed; its app/root cleanup remains **unproved**.
  The corrected launcher uses import and handles an already-exited child.
- CI5 passed XM-BR01–03 and completed the mixed execution, then failed a reload
  assertion on the plan page's transient client panel. XM-BR04 now navigates to
  the canonical saved run page before reload and exact API readback. This was
  an observer repair; app/core/DB bytes did not change.
- Two initial local HTTP assertions compared JavaScript prototypes. Corrected
  JSON-wire comparisons passed without changing scoring. CI1 subsequently
  passed the entire42-case core/HTTP scope on the pinned environment.

Six PNGs were inspected:desktop exact history, narrow mixed history, the viewer
capture, pre-reload mixed execution, failed plan reload and final saved run.
The viewer capture caught a loading state; it does not establish a visual
read-only form result. Actual API/role/readonly DOM assertions passed. Screens
are bounded viewport captures, not whole-page visual/accessibility acceptance.

## Remaining limits

Hosted persistence/sign-in/authoring, provider Auth/RLS, native external
DNS/socket/TLS, model quality, physical devices and full-product acceptance
remain open. Existing environment/integration403 responses were not retried or
bypassed. This qualification neither activates production nor changes runtime
execution approval controls. No local install/build/server/browser/database was
used after Storage Guard failed its reserve. See the [contract](../../../evaluator-matching.md)
and [scope](../../../proposals/evaluator-matching-checks.md).

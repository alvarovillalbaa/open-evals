# Test lanes

The repository already contains Vitest/package tests, Playwright journeys and
explicit focused Node checks. Keep their original sources and receipts separate.
The custom-eval browser lane uses the existing locked Playwright dependency and
an explicitly invoked production-app configuration; it adds no dependency.

| Current custom-eval source | Tier and proving layer | State |
| --- | --- | --- |
| `unit/custom-evals.test.mjs` | T1, actual pure builder/parser/hash with authored DTOs | 20passes in the focused Node invocation |
| `unit/custom-eval-access.test.mts` | T1, dependency-free permission decisions | 18passes in the same invocation |
| `integration/custom-evals-store.node.mjs` | T3, real owned PostgreSQL/transaction/member seam | 12passes in the separate owned PostgreSQL CI invocation |
| `e2e/custom-evals.browser.spec.ts` | T3, real production app, signed-session HTTP and owned PostgreSQL | Four passes in corrected run42608186016; first run remains four failures |

The new unit sources extend the existing explicit Node-focused lane and do not
match Vitest's `.test.ts` collection. Invoke with an existing compatible Node
and an explicitly configured existing native SWC addon; no fallback download:

```sh
OPEN_EVALS_TEST_SWC="$EXISTING_SWC_ADDON" node --experimental-vm-modules --test tests/unit/custom-evals.test.mjs tests/unit/custom-eval-access.test.mts
```

The database source is manual-only and uses the existing locked tsx loader:

```sh
node --import tsx --test tests/integration/custom-evals-store.node.mjs
```

That command requires its dedicated opt-in, loopback database URL, exact
externally created disposable owner/comment marker and migrated0001/0002 schema.
It refuses application database URL fallbacks. Read its guards before any setup;
fixture cleanup is part of a future successful result. Do not run it against a
shared database. No T4/T5 data, production credential or production access
authorization is involved. No browser/API/live-Auth proof is claimed by T1.

The [actual PostgreSQL result](../docs/results/2026/11-09/custom-eval-postgres-checks.md)
records observed cleanup, the preserved zero-job workflow failure and the archive
readback limit. This is separate from the38T1invocation; no50-case run or all-green
CI history is claimed. The frozen test's historical authored/UNRUN suite title
is unchanged; actual current outcomes come from its twelve TAP results.

See [the scope](../docs/proposals/custom-eval-set-checks.md) and
[actual results](../docs/results/2026/11-09/custom-eval-checks.md).

The [browser scope](../docs/proposals/custom-eval-browser-checks.md) defines one
temporary public CI job, its original/fixed production-rendering comparison,
four Chromium journeys and guarded teardown. It does not rerun the 38 T1 or
12 PostgreSQL checks. Authored signed cookies exercise the real existing session
verifier against the fixture's server and secret; they do not establish Supabase
login, production authorization, RLS, real-user or physical-device acceptance.
The 390×844 journey is a narrow viewport, not a touch-device claim. No T4/T5
access, production data, model calls or account enrollment is included.

The [actual browser results](../docs/results/2026/11-09/custom-eval-browser-checks.md)
retain both runs, the real rendering regression, immutable versions, exact retry,
stale-head recovery and narrow-layout acceptance. These four passes are separate
from the earlier 38 T1 and 12 store cases; the first four browser failures remain
failed. Selected originals from each run are retained with byte/hash bindings.

# Test lanes

The repository already contains Vitest/package tests, Playwright journeys and
explicit focused Node checks. Keep their original sources and receipts separate;
this increment adds no runner, dependency, broad configuration or CI change.

| Current custom-eval source | Tier and proving layer | State |
| --- | --- | --- |
| `unit/custom-evals.test.mjs` | T1, actual pure builder/parser/hash with authored DTOs | 20passes in the focused Node invocation |
| `unit/custom-eval-access.test.mts` | T1, dependency-free permission decisions | 18passes in the same invocation |
| `integration/custom-evals-store.node.mjs` | T3, real owned PostgreSQL/transaction/member seam | Authored and UNRUN |

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

See [the scope](../docs/proposals/custom-eval-set-checks.md) and
[actual results](../docs/results/2026/11-09/custom-eval-checks.md).

# Instruction authoring browser checks

Status: **completed: four/four passed** in the separately approved [58-check run](prompt-authoring-checks.md), using source `679a6973c29542b89a9985168bed4e317523ca86`. The temporary workflow is retired; [the final receipt](../results/2026/10-28/prompt-authoring.md) records actual results and limits.

Source: [authoring contract](prompt-authoring-contract.md). The opt-in entry point is `apps/web/tests/instruction-authoring.browser.config.mjs`; its sole matched file is `instruction-authoring.browser.spec.mjs`. Existing Playwright/Vitest configs, package scripts and dependencies are unchanged.

## Four scenarios

1. Desktop, 1280×900: start with an empty owned workspace; create a definition through the UI; compose string, number, Boolean and JSON bindings with includes, conditions and loops; preview, save, reload the actual persisted snapshot and return to the catalog. Compare full source and compiled data, plus one saved row and one audit event.
2. Desktop: create a canonical authored base, fork it through the UI, check locked controls and unchanged parent, invalidate an accepted preview by editing, hold an actual old preview response while newer edits occur, then release it and require a fresh preview before save. Browser cancellation contributes to this evidence; this does not independently prove callback guards when an arbitrary transport ignores abort.
3. Narrow Chromium, 390×844: use keyboard activation for add/reorder controls and Tab between binding fields; verify resulting component order, typed values, readable input size, save/reload correspondence and no document-level horizontal overflow. This is viewport emulation, not native mobile-device proof.
4. Commit the real first save but abort its browser response; retry the identical stable request and require one version insert/audit event. After replay acknowledgement, fail the first detail GET, then substitute a source-only mismatch in the next browser response while preserving rendered text/hash. Both reload failures must keep the attempt frozen. A third GET retrieves the real snapshot; no extra save is sent.

## Data and execution boundary

These are T3 browser checks against authored disposable PostgreSQL data. They use the shared `instruction-authoring.fixtures.mjs`, which creates unique workspace/user/project/target/key fixtures and removes exact owned rows in foreign-key order. It does not import or run the separate API test harness. PostgreSQL resolves from the owning DB package under strict pnpm. No existing app data, Supabase provider, model, payment, production service or release promotion is involved.

The runner must supply an isolated existing local PostgreSQL target and unchanged migrations 0001–0003. Required environment:

- `INSTRUCTION_AUTHORING_TEST_TARGET=local-disposable`.
- `INSTRUCTION_AUTHORING_TEST_DATABASE_URL` pointing to loopback PostgreSQL, database name `open_evals_authoring_test_<unique suffix>`.
- App `DATABASE_URL`/`POSTGRES_URL` must point to that same disposable database; never inherit a developer or hosted database URL.
- `AUTH_MODE=hosted`, explicit disposable `AUTH_SECRET` and `API_KEY_PEPPER`, each at least 16 characters.
- `INSTRUCTION_AUTHORING_TEST_URL=http://127.0.0.1:3217`. The config requires the loopback app on port 3217; it does not start a server.
- Supabase URL/key configuration and production/demo credentials must be absent. Tests use signed cookies for the exact authored editor fixture; this does not test a real login provider.

Browser requests outside the disposable app origin are blocked and fail the scenario. Request interception changes only authored responses; save requests still reach the real local app and database. SQL assertions filter exact owned workspace, definition and version IDs. Existing migrations, auth policy, dependencies, CI and release state are not changed by these test definitions.

Once separately approved and dependencies/browser are available in the authorized environment, run from `apps/web`:

```sh
pnpm exec playwright test --config tests/instruction-authoring.browser.config.mjs
```

The scope is Chromium only, one worker, zero retries, four tests and a six-minute runner deadline. A JSON reporter writes the four individual outcomes and totals to `apps/web/tests/.authoring-browser-results/report.json`; screenshots are collected only on failure in the same output directory. Trace/video and extra success screenshots are off. Any authorized temporary CI job retains these bounded report/failure artifacts for three days. Server startup/provisioning and the temporary CI job require their own concrete approved scope. Do not install or provision locally to bypass Storage Guard.

## Recorded evidence and limits

The final receipt records the exact source, same-shell Node runtime/path, four individual passes, browser report/artifact hashes, Playwright version and installed Chromium identity, cleanup and the earlier harness failures. The browser version comes from the locked runtime installer log; no separate browser.version() probe ran. The native-phone, external-provider, Supabase client-role RLS, promotion and production-data boundaries remain unverified by these four browser scenarios.

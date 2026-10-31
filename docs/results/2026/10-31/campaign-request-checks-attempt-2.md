# Campaign-request checks — attempt 2

[Run 41244216779](https://github.com/alvarovillalbaa/open-evals/actions/runs/41244216779) failed on 2026-10-31 against repaired immutable source `a0b106ff77317d945a3f6f63c8a7cf6fed976457`; activation was `2ccdd7e4701f9667fc207bb6b4b16b60bda0a741`.

**All 45 unit/PostgreSQL cases passed**, with exact manifest names, process exit 0, and no pending/todo cases. The shared database marker readback passed. Both complete **288-input source guards passed**.

**All eight desktop/narrow Chromium instances failed** (report tail: expected 0, unexpected 8, skipped 0, flaky 0; global reporter errors 0). The actual browser process exited 1. Strict result validation also rejected pnpm's non-JSON failure trailer after the Playwright report. The last retained stack points to `openBaseline` at browser spec line 61, its exact Mutable component value assertion. Earlier per-case error messages are outside the bounded tail, so the specific UI failure cause remains unresolved. No assertion was relaxed or repair applied.

Guarded browser database cleanup exited 0; owned temporary cleanup and container stop succeeded. Only existing migrations 0001/0002 ran in the fresh marked disposable database. No production account/data, provider/model call, or campaign start occurred.

Observed toolchain: Node 24.21.0, pnpm 10.14.0, PostgreSQL 16.15, Vitest 4.1.9, Playwright 1.61.1, installed Chromium 149.0.7827.55. Browser profiles were 1440×1000 desktop and 390×844 mobile/touch, one worker, zero retries.

[Machine receipt](campaign-request-checks-attempt-2.json) retains all 45 actual passed names, eight scheduled browser identities, actual exits, marker/source guards, step conclusions, and bounded redacted diagnostics with hashes. Exact browser case-by-status validation is incomplete; no surviving-process inventory or full app build was recorded. The active workflow remains for owner review.

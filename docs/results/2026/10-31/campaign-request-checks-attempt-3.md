# Campaign-request checks — attempt 3

[Run 41245938303](https://github.com/alvarovillalbaa/open-evals/actions/runs/41245938303) failed on 2026-10-31. Checked source remained `a0b106ff77317d945a3f6f63c8a7cf6fed976457`; diagnostic activation was `b727f8d85e35e4b7800b57b03980b49a80dc2508`.

**All 45 unit/PostgreSQL cases passed**, with exact manifest names and actual process exit 0. **All eight browser title/profile pairs failed**, without retries, at the same assertion:

> The exact “Mutable component” label inside “Campaign preparation requests” was not found. The expected value was “decision_rules”; the assertion timed out after 10,000 ms.

Each scenario had reached the saved baseline heading and panel before failing at `openBaseline`, spec line 61. The actual first error message and location are retained for every desktop/narrow case. The product-versus-fixture cause remains for source diagnosis; no repair or further run is included.

The browser process exited 1. Its leading JSON object reports expected 0, unexpected 8, skipped 0, flaky 0, and global reporter errors 0. The complete output still fails strict JSON parsing because of a 322-byte pnpm failure trailer. The diagnostic projection records that failure and the exact trailer hash; it does not turn the failed run into acceptance.

The marker readback and both **288-input source guards passed**. Guarded database cleanup exited 0; owned temporary cleanup and container stop passed. No production data/account, provider/model call, migration 0003, or campaign start occurred. Node 24.21.0, pnpm 10.14.0, PostgreSQL 16.15, Playwright 1.61.1, and Chromium 149.0.7827.55 were observed in this disposable CI environment.

[Machine receipt](campaign-request-checks-attempt-3.json) retains all actual case identities/statuses, process exits, marker/source checks, cleanup outcomes, and bounded redacted diagnostics. Full reports were removed by cleanup; no separate surviving-process inventory or full-app build was recorded. The active workflow remains for owner review.

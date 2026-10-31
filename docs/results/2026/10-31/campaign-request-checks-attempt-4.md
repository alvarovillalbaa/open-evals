# Campaign-request checks — attempt 4

[Run 41246495254](https://github.com/alvarovillalbaa/open-evals/actions/runs/41246495254) failed on 2026-10-31 against source `696a7ec4093beb47d057c767df03eccb13a54fad`; activation was `abfd50a138f9fc291723c42fed19c226f631d8f6`.

**All 45 unit/PostgreSQL cases passed**, with exact manifest names and actual process exit 0. Browser results were **4 passed, 4 failed**, with all eight exact title/profile pairs retained and no retries.

Save/reload and read-only review passed on both desktop and narrow profiles. Every scenario passed the previously failing Mutable component lookup. The remaining failures are exact “Objective” label lookups after text entry: held-preview scenarios time out refilling it at spec line 119; lost-acknowledgement scenarios cannot find it for the disabled-state assertion at line 152. Actual error messages and locations are retained for all four failures. No subsequent repair or run is part of this receipt.

The browser process exited 1; its report had global errors 0, skipped 0, and flaky 0. Strict parsing also rejected the 322-byte pnpm failure trailer. Diagnostic leading-object parsing retains case evidence without granting packet acceptance.

Marker readback, both **288-input source guards**, guarded database cleanup, owned temporary cleanup, and container stop passed. Only migrations 0001/0002 ran. No production account/data, provider/model call, migration 0003, or campaign start occurred.

[Machine receipt](campaign-request-checks-attempt-4.json) retains actual case names/statuses, process exits, source/marker checks, cleanup outcomes, and bounded redacted diagnostics. Full reports were deleted during cleanup; no full-app build or separate surviving-process inventory was recorded. The active workflow remains for owner review.

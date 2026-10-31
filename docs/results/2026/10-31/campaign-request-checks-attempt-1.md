# Campaign-request checks — attempt 1

[Run 41243607033](https://github.com/alvarovillalbaa/open-evals/actions/runs/41243607033) failed on 2026-10-31. The job checked immutable source `97f88b181b41252f9e5bef5904b7583f73efe6b8`; activation was `519aa9c8ccfd67f52d143e92d7ef4cdd8dad1162`.

The actual unit process exited **1**: **26 passed, 19 pending, 0 failed**. GitHub displayed that continue-on-error step as successful; the strict result validator rejected it. The eight Chromium cases were **UNRUN**, because browser fixture preparation failed. Both complete **288-input source guards passed**.

The fixture expected database comment `open-evals-campaign-requests-v1` and observed `null`. Both marker readers use `obj_description(oid, 'pg_database')` (integration fixture line88; browser seed example line40). PostgreSQL documents `shobj_description` for shared objects such as databases. This is the concrete fixture-level repair candidate; no repair or rerun is included here. [PostgreSQL16 comment functions](https://www.postgresql.org/docs/16/functions-info.html#FUNCTIONS-INFO-COMMENT-TABLE).

Observed toolchain: Node **24.21.0**, pnpm **10.14.0**, PostgreSQL **16.15**, Vitest **4.1.9**, Playwright **1.61.1**. Chromium149.0.7827.55 installed; it did not launch. Only existing migrations0001/0002 ran in the fresh disposable database.

Guarded database fixture cleanup also exited1. The controller then reported **owned temporary cleanup passed**, and GitHub reported **container stop succeeded**. Database namespace cleanup is not claimed. No application server/browser launched, and no production account/data, model/provider call, or campaign start occurred.

[Machine receipt](campaign-request-checks-attempt-1.json) retains actual exits, exact scheduled53 identities, source guards, step conclusions, and bounded redacted log tails/hashes. It does not retain every actual unit assertion record; scheduled names are not substituted for observed per-case results. Raw cleanup stderr was removed after its exit was recorded. The active workflow remains for owner review.

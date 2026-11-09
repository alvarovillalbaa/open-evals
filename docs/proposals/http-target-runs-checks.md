# HTTP plan verification scope

Date: 2026-11-09

This increment composes saved input and evaluator versions with an explicit
HTTP target. Its [implementation contract](../http-target-runs.md) defines
immutable plans, durable claims, actual responses, gates and conservative
recovery. Existing workspace roles apply; no provider setting or grant changes.

The bounded local overlay contains no installed environment. Storage Guard
refused a local build/database/browser operation at 27.3 GiB free against 34 GiB
required. Verification therefore uses one temporary public Ubuntu24.04 GitHub
job, capped at 20 minutes, with pinned Node 24.22.2 and pnpm 10.14.0.

| Stage | Scope and proof boundary |
| --- | --- |
| Web seams | 20 actual-module cases with authored auth, database, clock and transport seams; no real target, PostgreSQL or browser proof. |
| PostgreSQL | 31 new owner-SQL cases using actual core/store code and disposable rows. |
| Regression | The existing 14 provided-output cases, with unchanged bodies and an exact task-owned database guard, because the shared snapshot wire-budget helper changed. |
| Build | One fresh normal root production build using the existing lockfile. |
| Chromium | Five actual-app desktop/narrow journeys: complete authoring/history, Unicode/two sets, stale-head review, real commit/lost-response replay and session/key/workspace boundaries. No target execution is performed. |

The 38 core cases and 26 authored native-transport double cases already passed
locally against their separately pinned sources and are not replayed here.
The Web packet's two local module-loading failures remain evidence. Node 26
removed built-in transform mode; the [exact Node 24.22.2 module contract](https://github.com/nodejs/node/blob/v24.22.2/doc/api/module.md#modulestriptypescripttypescode-options)
supports the parameter-property lowering needed to load the unchanged modules.
This is syntax transformation, not TypeScript type checking.

CI creates a fresh loopback PostgreSQL 16 cluster and uniquely named database,
checks its ownership marker and applies only existing migrations 0001/0002 to
that fixture. After SQL teardown, all 24 relevant tables must be empty before
the app build. Browser fixtures attest zero dispatch claims, zero execution
rows and their exact actor/workspace removal. The wrapper closes only its
recorded app/PG identities, proves port and database absence, and removes only
its owned cluster. Cleanup runs after success, failure or interruption.

One direct-parent commit, exact path delta and byte/SHA source pins gate all
work. Protected sources are checked before installation and after execution.
Complete bounded streams and receipts remain artifacts; selected original
bytes are transported once through bounded log frames with length/SHA checks.
Failures, partial runs and missing outputs retain their original status.

No new dependency, migration, account, paid plan, production configuration,
production data or model call is involved. This packet makes no real target
call and does not establish native DNS/socket/TLS execution, hosted Auth/RLS,
physical-device behavior or live production-page acceptance. Those gates remain
separate from the source and fixture checks above.

# Custom Eval Set production browser checks — proposed

The r2 four-journey verification is authored and **UNRUN**. Its base remains
[`5b4a0eb847ad484dad15d364655e99e9665dda6c`](https://github.com/alvarovillalbaa/open-evals/commit/5b4a0eb847ad484dad15d364655e99e9665dda6c).
The earlier 38 pure checks, 12 PostgreSQL cases and their failed originals remain
closed, separate evidence. They are not rerun or counted toward these four journeys.

One public Ubuntu 24.04 job may start only from a push to
`qa/open-evals-custom-browser-20261109-r2` in `alvarovillalbaa/open-evals`. It has
read-only contents permission, no persisted checkout credential, no manual trigger,
and a 20-minute limit. It changes no MCPCN workflow. No local runtime is proposed:
the local Storage Guard remains below its reserve. Root owns publication and execution.

## Preserved failed first attempt and narrow corrections

[Source `329997c59d2fa84ac72e3ae0591c10c8c0966fb3`](https://github.com/alvarovillalbaa/open-evals/commit/329997c59d2fa84ac72e3ae0591c10c8c0966fb3)
and [run 42606774042](https://github.com/alvarovillalbaa/open-evals/actions/runs/42606774042),
job 129124666165, are preserved as **FAILED: zero passed, four failed**. Both forced
builds and signed-session HTTP comparisons completed before those actual browser
failures. This is not a passing browser packet, and no first-run case is relabelled.
The complete retained job log is 243,060 bytes, SHA256
`2daa27003df800175c0319d27425bd2c5350893a63c37540956070736c249f1c`.

Six originals recovered from framed byte chunks were locally hash-verified before
any correction; they total 49,325 bytes:

| Original | Bytes | SHA256 |
| --- | ---: | --- |
| `baseline-http.json` | 1,196 | `0ede01b4344b821a35d71ebdd48175a53463773d0a45662bc6cbb8834172583b` |
| `candidate-http.json` | 1,200 | `dee8695162a369e48d59502da7eb6453d7626bfcbc8c81658b7b60846adfd6ef` |
| `browser-cases.stdout.txt` | 14,329 | `9d65e7a709b9f077b88f7658e223d8093f1cb95a89a08bf6464a3259c9be98f9` |
| `browser-cases.stderr.txt` | 652 | `f007ab906671e7daac7ac86f958c3ae7737f9feeeff7d2f26ed42af0cce0a8fb` |
| `browser-report.json` | 31,288 | `14c8692087484571896cda8b0e2b6aa2eb74c5b6432d73761f56aecb52815766` |
| `cleanup.json` | 660 | `e3e4aa0f248ef28246b2adfbcda735de8ceb553c7b9eb0d7d12dadcf5aa66785` |

The baseline actually returned API HTTP200 and the denied list; the candidate actually
returned API HTTP200 and the creation form, each using its same signed cookie. The
recovered cleanup proves owned database absence, PostgreSQL shutdown and cluster
removal. The job-log receipt records both app servers as graceful exit 143 with
PID/group absence and free ports. Raw build/server streams and artifact ZIP bytes
have not been recovered merely because their hashes or a file reference were returned.

The wrapper incorrectly treated intentional exit 143 as an application failure.
[Next 16.2.9's shutdown handler](https://github.com/vercel/next.js/blob/v16.2.9/packages/next/src/server/lib/start-server.ts)
explicitly exits 143 after graceful SIGTERM cleanup. R2 admits that status only when
the wrapper recorded its own shutdown signal and the stop mode is `graceful`.
Fresh identity checks, PID/group/port absence, complete-stream checks, forced-stop
failure and unexpected/already-exited failures remain unchanged. The separate
browser locator correction preserves all four case IDs and their substantive checks.
The new QA branch preserves the first source; it has the same direct base parent
and exact seven-path admission. No application/auth guard is changed by these fixes.

## Source and rendering comparison

The verification commit must be one direct child of the base and have exactly these
seven changes. There is no optional application-path admission:

- Modify `apps/web/app/(product)/evals/custom/page.tsx` to request per-request
  rendering with the version-matched `connection()` API before its existing loader.
- Modify `tests/README.md` to describe this separate authored T3 scope.
- Add `tests/e2e/custom-evals.browser.{config,fixture,spec}.ts`.
- Add `.github/workflows/custom-eval-browser-checks.yml` and this proposal.

The list page's earlier production build was actually classified static. The failed
first attempt now supplies the HTTP comparison above; r2 still requires its own
complete baseline/candidate comparison and all four browser outcomes in one job:

1. Save the candidate page's exact bytes/hash. Temporarily use only the base page,
   verifying its Git blob is `07be7932e2f80080a498bcc645ad658dc51e13d1`.
2. Run the existing root `pnpm run build --force` pipeline. The existing Turbo 2.10.0
   strict environment and all root build filters remain intact; `AUTH_MODE`, the
   signing secret, database URL and Supabase configuration are absent from build env.
3. Start that production artifact with the owned database and authored hosted-session
   environment. With one actual signed cookie, require API HTTP200/empty set list and
   list HTTP200/access-denied rendering. Retain complete response bodies/headers,
   comparison JSON and the actual prerender manifest. An unexpected baseline fails
   the job rather than silently supplying a different comparison.
4. Stop the owned app, restore candidate page bytes exactly, verify source hashes,
   and force the same production build again. Require the list absent from the
   prerender manifest and the same signed-session API/list pair now showing the
   editable creation form. Then run the four actual browser journeys.

The temporary baseline swap is confined to the owned CI checkout and this one
reviewed page. The finally path restores the candidate bytes even after a failure.
No auth guard, environment filtering, migration or production setting is weakened.
The supporting API is [Next 16.2.9 `connection()`](https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/03-api-reference/04-functions/connection.mdx).

## Four real journeys

The new locked Playwright 1.61.1 config runs only CE-BR01–04 in Chromium, one worker,
one repetition, zero retries and no automatically started server:

- Desktop create, next immutable version, reload and persisted history.
- A real POST commits, its browser response is lost, and an identical UI retry
  recovers without an extra version, membership or audit event.
- A stale second writer keeps its draft, explicitly loads/reviews the new head,
  then saves the next version with the reviewed parent.
- A 390×844 viewport exercises real field validation, save/reload and clipping checks.
  This is narrow Chromium, not physical touch-device proof.

The application uses its real HTTP handlers, core preparation, PostgreSQL store,
signed-session HMAC verifier and UI. No successful API response or SQL service is
mocked. The lost-response journey forwards the real request before aborting the
browser delivery. Actual SQL rows and audit counts are checked by the tests.
Each case must retain one verified fixture-removal attachment; all four literal
IDs, expected/actual passed statuses, zero retries and zero unexpected/flaky/skipped
totals are independently required from the standard Playwright JSON report.

Fixture users/memberships are coherent, authored rows. The legacy signed-cookie
branch does not itself query those memberships, so this is not hosted-provider
login, membership-policy or RLS acceptance. The test-only signing secret and
database password are authored fixture constants. No Supabase credentials,
production data, model call, account, paid plan, run launcher or promotion is used.

## Runtime ownership and evidence

Node is pinned to 24.22.2 and pnpm to 10.14.0. Installation uses the existing frozen
lockfile with scripts ignored; no dependencies or lockfile change. The root and
web lock entries already resolve Playwright 1.61.1, tsx 4.22.4 and Turbo 2.10.0.
Chromium is downloaded through that locked Playwright tool without apt or sudo.
Missing runner libraries fail honestly. A verified owned pnpm binary directory is
prepended to the sanitized child PATH for Turbo's package-manager discovery.

The proven host-local PostgreSQL 16 lifecycle is reused: preinstalled tools only,
fresh UID-bound `RUNNER_TEMP` cluster/socket directories, unused port 65432 and
`listen_addresses=127.0.0.1`. The database is
`oe_custom_browser_test_<run_id>_<run_attempt>`, owner `postgres`, with exact COMMENT
`open-evals-custom-browser-20261109-created-disposable-v1`. Only unchanged repository
migrations 0001/0002 apply. Ambient dotenv files and inherited application credentials
are refused; the production app listens only on `127.0.0.1:4173`.

Baseline and candidate app processes each retain PID/start/UID/executable/process-group
identities. Only a current matching app identity receives its shutdown signal;
PID/group absence and a free app port are required. Before database drop the app
must be closed and its own baseline fixture removed. Each test independently
validates/removes only its own workspace/user rows. The database marker/owner and
absence, PostgreSQL identity/smart shutdown, PID absence, port release and bounded
UID-owned cluster-tree removal remain mandatory. Uncertainty is a failure, not a
reason to signal another process or delete an unknown path.

The job retains complete bounded command streams, build outputs, HTTP originals,
both prerender manifests, server logs, Playwright JSON and failure artifacts,
source/restore hashes and cleanup receipts for two days, including failed jobs.
Ordinary streams are capped at 4 MiB, browser child at 480 seconds, Playwright global
time at 420 seconds and each case at 90 seconds. A 14-minute soft work deadline caps
each work command and readiness/HTTP wait to its remaining budget. SIGINT/SIGTERM
interrupt work into the same finally path and are recorded as failure. Only finally
lifts the work cap, reserving about four minutes within the 18-minute driver step
for app, fixture, database and cluster cleanup. The outer job cap remains 20 minutes;
phase ceilings do not extend it. Expected prior Next builds were about 30 seconds;
actual timing and any timeout must be reported rather than assumed away.

The JSON report is capped at 128 KiB. Selected test stdout/stderr, report, HTTP
comparison JSON and cleanup originals are printed between literal markers with
byte/SHA metadata and 8 KiB base64 chunks. Near the log cap, complete base64 replaces
duplicate readable text; no original is truncated into a claimed complete capture.
Driver output reserves 32 KiB within a 256 KiB total for final receipt/cleanup metadata.
Other command/build streams remain in the artifact and are not redundantly printed.
Decoded chunks must match their exact original hashes. Artifact ZIP byte readback
remains unverified until actually retrieved; a returned file reference is not that proof.

Official action pins are unchanged from the proven source-reviewed lane:
[checkout](https://github.com/actions/checkout/commit/d23441a48e516b6c34aea4fa41551a30e30af803),
[setup-node](https://github.com/actions/setup-node/commit/249970729cb0ef3589644e2896645e5dc5ba9c38),
and [upload-artifact](https://github.com/actions/upload-artifact/commit/b7c566a772e6b6bfb58ed0dc250532a479d7789f).
The [official Ubuntu 24.04 inventory](https://github.com/actions/runner-images/blob/741e4eb8ef5f51698d730ac16ede65cadb067522/images/ubuntu/Ubuntu2404-Readme.md)
reports PostgreSQL 16.15; actual preinstalled versions are recorded, not assumed pinned.
Runner paths are initialized from shell `RUNNER_TEMP` and exported through
`GITHUB_ENV`, respecting [GitHub context availability](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability).
Hard cancellation may prevent a finally path or upload; missing proof stays missing.

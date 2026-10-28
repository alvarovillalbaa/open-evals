# Immutable instruction authoring

Status: **58/58 focused checks passed** against source `679a6973c29542b89a9985168bed4e317523ca86`. The temporary active workflow is removed in this receipt's publication commit. Production database/provider configuration remains separate product work.

## Result and scope

Instructions now supports definition creation, literal/composed editing, typed bindings, nested operations/library, immutable draft saves and actual persisted-source review. Stable version identities survive lost responses; stale preview or conflicting reuse fails visibly. Forks from older canonical bases remain valid. Saved drafts never become an implicit serving baseline. Legacy demonstration records retain their original bytes as read-only.

The core storage protocol verifies source independently of rendered hashes. Scoped transactions recompile against canonical bases, preserve locks, and insert version plus audit atomically. The catalog's invalid DISTINCT ordering/join multiplication is repaired. Project keys access only their own project's targeted definitions; workspace sessions retain workspace access and hosted local/demo ownership cannot write.

Alvaro approved that access boundary against [contract commit 35fc1a9](https://github.com/alvarovillalbaa/open-evals/blob/35fc1a9dafa47093739076442c544625a2f82b85/docs/proposals/prompt-authoring-contract.md), then separately approved the [58-check proposal](../../../proposals/prompt-authoring-checks.md) against source `23a6a0b77439cb66f66f5f035190fb3dd1d42405`.

## Executed evidence

[Successful run 40712375228](https://github.com/alvarovillalbaa/open-evals/actions/runs/40712375228), job `122900773658`, used Node 24.21.0 and disposable PostgreSQL 16.15. All three existing migrations applied unchanged.

| Phase | Passed | Failed / skipped |
| --- | ---: | ---: |
| [Native protocol TAP](prompt-authoring/core.tap) | 30 | 0 / 0 |
| [Hosted HTTP/database TAP](prompt-authoring/api-hosted.tap) | 23 | 0 / 0 |
| [Hosted-local-demo denial TAP](prompt-authoring/api-demo.tap) | 1 | 0 / 0 |
| Desktop/narrow Chromium | 4 | 0 / 0 |
| Total unique checks | **58** | **0 / 0** |

The [machine-readable report](prompt-authoring-checks.json) preserves every case result, runtime, source blobs, protected-file comparison and artifact hashes. Browser results were four expected passes, zero unexpected/skipped/flaky, with retries disabled. Playwright was 1.61.1; installer logs identify Chromium/Headless Shell 149.0.7827.55, revision 1228, without a separate browser.version() probe. This includes full composition reload, locked/stale-preview behavior, 390px keyboard/save/reload/overflow, and committed lost-ACK recovery with identical retry, one version/audit, GET failure/source-mismatch recovery and no extra POST.

Artifact `12826713758` contained 8,395 bytes; its download matched SHA-256 `ff557b85e813d545513894cc8bc155eed865b31a475df08106985cbe46d30ef6`. The three preserved TAP files retain their exact downloaded bytes. The report retains browser case/stats data and the original browser JSON byte/hash identity.

## Prior failures retained

- [First run](prompt-authoring-first-run.json): 30 protocol and 23 hosted API passes; a negative filter selected the demo case before its server existed. Dedicated skip/positive patterns corrected phase selection. Hidden-file inclusion corrected artifact capture.
- [Second run](prompt-authoring-second-run.json): 30 protocol and 23 API passes; four browser locator failures. Captured accessibility names were correct. Exact native-role queries replaced the affected label queries, preserving names, scenarios and assertions.
- [Third run](prompt-authoring-third-run.json): 30 protocol, 23 API and three browser passes. The remaining error query also matched Next's empty route announcer. Three expected-message filters resolved that harness ambiguity.

Application source stayed unchanged after the heading-wrap commit `23a6a0b`; subsequent corrections affected only the harness/workflow and evidence. The final report verifies all 20 changed application source blobs and 15 unchanged protected files, including manifests, lockfile/workspace/Turbo config, schema, migrations and closed compiler source.

## Deployment and cleanup

The existing Git integration deployed checked source `679a6973c29542b89a9985168bed4e317523ca86` as `dpl_EfgMyM8nV9dqczVZqhGQTd2VFuLG`, verified READY. Canonical alias: [open-evals-web.vercel.app](https://open-evals-web.vercel.app). Initial implementation build logs also showed core/DB/adapters/workflows typechecks, Next 16.2.9 compilation and TypeScript completion, with five successful Turbo tasks.

Fixture cleanup hooks succeeded. The hosted server's process group disappearance was verified before starting the demo server. Final cleanup requested TERM for the owned demo process group and its step succeeded; PostgreSQL service teardown succeeded. The final demo process exit was not independently polled. The active `.github/workflows/prompt-authoring-checks.yml` is removed; the [inactive reviewed payload](../../../proposals/prompt-authoring-checks.workflow.yml) remains as documentation.

Local Storage Guard measured 16.4 GiB free against 34.0 GiB required including reserve. No local install, build, large checkout or test database was created. Source parsing, whitespace, proposal links, publication blobs and protected-file hashes were checked. The earlier 55 compiler cases remain a separate passed run and were not rerun.

## Remaining proof boundaries

This proves application mediation with authored signed-session/project-key fixtures and SQL owner credentials in disposable PostgreSQL. Live Supabase sessions/email, client-role RLS, production database connectivity, clean anonymous live access and native phone/touch behavior remain unverified. Database-wide audit immutability and stable-key uniqueness constraints are unchanged; no global protection against independent SQL writers is claimed.

Promotion, experiments, campaigns, CLI completion and wider OpenEvals product work retain their own scope and approval boundaries.

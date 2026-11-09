# Custom dataset release checks

Date: 2026-11-09

Evals now supports JSON/JSONL upload or paste, complete preview, explicit immutable
save, version history and scoring against an exact saved dataset version. Inputs,
optional-field presence, stable row keys and JSON metadata survive readback.
Duplicate keys, lossy numbers and oversized sources fail closed. Review statuses
are uploader declarations; replacing rows requires an explicit default or a
declaration on every row.

The checked source is
[`024f218`](https://github.com/alvarovillalbaa/open-evals/commit/024f218228fd08d9566ed876d2a337168e182748).
The release removes only its temporary QA workflow and adds documentation and
evidence; application and test bytes remain identical to that checked source.

| Scope | Observed result |
| --- | --- |
| Core | 30 distinct cases passed twice. The latest invocation used the final core source and existing Node 26.8.2. Type stripping and VM loading are not a TypeScript compilation. |
| PostgreSQL | 20 custom dataset cases, including workspace isolation, and 14 provided-output regressions passed on initial source 301cf02. Later core/DB compatibility edits changed erased annotations and the equivalent BigInt construction; SQL was not rerun after them. |
| Final CI | [Run 42685393224](https://github.com/alvarovillalbaa/open-evals/actions/runs/42685393224) passed a fresh full root production build and all five Chromium journeys, without retries or skipped cases. |
| Browser coverage | Desktop JSONL upload/save/exact-version scoring; lost committed-save recovery after a newer head; stale-head refusal and preserved-input append after visible review; invalid declarations/precision/files without partial writes; narrow-screen reload, viewer access and project-key denial. |
| Cleanup | Every final browser fixture was removed, including its exact 1/1/1/1/2 actors and zero domain counters. The owned app stopped gracefully; PID, process group and port were absent. The marked database and PostgreSQL cluster were removed. |

These are 69 distinct passed cases: 30 core + 20 database + 14 regression + 5 browser.
Repeated invocations do not add distinct coverage. The final CI applied the
existing migrations only to its fresh marked disposable database; no production
migration or schema change is part of this release.

The failed attempts remain evidence:

- [Run 42670671269](https://github.com/alvarovillalbaa/open-evals/actions/runs/42670671269)
  passed its 34 SQL cases, then failed compilation because a helper default inferred
  literal type 512. No browser or app server started.
- Runs [42672178266](https://github.com/alvarovillalbaa/open-evals/actions/runs/42672178266)
  and [42673364992](https://github.com/alvarovillalbaa/open-evals/actions/runs/42673364992)
  failed before any job during the recorded GitHub Actions incident.
- [Run 42681449452](https://github.com/alvarovillalbaa/open-evals/actions/runs/42681449452)
  passed its full build and 1/5 browser journeys. Source review found an invalid
  null-prototype snapshot-to-React-client boundary; the validated loader now
  projects ordinary JSON props. The harness also read response bodies after
  Chromium had discarded their CDP resources. It now captures each real response
  before fulfilling it unchanged, with no request retry or mocked API response.
- [Run 42684297057](https://github.com/alvarovillalbaa/open-evals/actions/runs/42684297057)
  passed its full build and 4/5 journeys. Its remaining fixture replaced rows without
  review declarations; the application correctly returned 422. The final fixture
  explicitly selects synthetic declarations and retains every conflict/review
  assertion. No further application change was needed.

[The evidence index](custom-dataset-raw/evidence-index.json) identifies selected
complete originals, command-metadata records and captured provider records by
byte count and SHA256. All failed results are retained. Artifact ZIPs were
uploaded but not retrieved; selected original streams are not a complete archive.
Successful CI build streams are identified by original command metadata, while
the complete job log remains in the task-owned local evidence.

The checks use authored data and signed test sessions against owner-SQL fixtures.
They do not prove hosted Auth-provider behavior, membership/RLS enforcement,
physical-device behavior, native provider/model calls or live production-page
acceptance. Deployment readiness is a separate provider observation. Production
promotion is recorded separately after integration and canonical-alias validation.

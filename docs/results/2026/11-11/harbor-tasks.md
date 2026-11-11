# Harbor tasks: accepted native and product checks

The initial Harbor flow now versions exact task source, saves project-bound
plans, executes explicitly through the Node CLI and pinned Python/Harbor
runtime, stores bounded native reward reports and exposes history/recovery in
Evals. Saving/previewing never launches a task. Project keys can run only their
own explicitly shared plans; workspace authoring remains session-scoped.
[User guide and supported profile](../../../runbooks/harbor-tasks.md).

The supported profile is Harbor0.25.0/schema1.4, one Linux Dockerfile task and
shared verifier. Existing v1/v2 contracts, roles, provider settings and schemas
are unchanged. Private scenario/run namespaces are fenced from legacy reads
and writes. No migration, live model call, paid plan or account was used.

## Accepted evidence

| Boundary | Exact checked source | Result |
| --- | --- | --- |
| Task transport, filesystem/process fixtures and native interoperability | `ecf18698c0a1fa0db841dfbce1f41dc2d4183328` · [run43040979043](https://github.com/alvarovillalbaa/open-evals/actions/runs/43040979043) | 29 transport/filesystem/process and seven native/result/interoperability IDs; actual oracle reward1 and nop reward0 on the same authored task |
| Immutable task/plan/run protocol | `466415b123b2382871da4ac0f732ecbdd6445a6c` · [run43052560644](https://github.com/alvarovillalbaa/open-evals/actions/runs/43052560644) | 18 new protocol cases; the 16 transport IDs also passed as regressions |
| HTTP, real SQL, SDK and executable CLI | Same product source/run | 23 IDs: auth/project scope, no-write preview, CAS, immutable replay, audit rollback, generic fencing, once-only claims, completion/recovery, actual executable→Python→Harbor→SQL readback |
| Chromium desktop and narrow screen | Same product source/run | Four IDs: task import/versioning; exact plan sharing/save/reload; actual CLI-result readback and interruption closure; failure/draft preservation and viewer access |
| Normal build | Same product source/run | All ten workspace packages passed, including production Next16.2.9 compilation/types |

There are **81 distinct accepted check identities** across the two accepted
cohorts. Repeated regressions/diagnostic attempts are not additional identities.
The product source tree is `4f324c828ef7edc6e69839eb28b8bdbd9edfc075`:
1,759 tracked files /13,058,918bytes. All tracked mode/blob/working-byte hashes
matched before/after. Dependencies/builds ran only in an owned source copy,
whose runtime inputs were also compared after checks. Local Storage Guard had
failed, so no local installation/build/server/browser/database/Docker runtime
was created; small authored protocol checks used existing tools.

The product's fresh oracle execution has native trial
`2b912f4c-5d29-4622-8e49-a00d1742f363`. Its original native result SHA-256 is
`c0d00d43901e6cbc2a8f736e5ad7c450ae7e8bc7bbc37b26bc2f17c28847929a`;
that digest matches the redacted CLI result and saved API/browser record.
Reference agents verify the authored task, not model performance. Local-runner
reports remain explicitly self-reported rather than remote attestation.

The accepted jobs removed/read back authored fixture rows, the owned PostgreSQL
container and exact native Docker container/network/volume labels. They stopped
declared processes, observed no open handles and removed only the work directory
with matching UID/device/inode/marker. Both temporary workflows are disabled
(414786561,414826095); two native and eight product QArefs were retired.

## Retained failures and corrections

All failed originals remain in the
[evidence release](https://github.com/alvarovillalbaa/open-evals/releases/tag/harbor-v1-evidence.1).
Native43040508346 stopped before execution on duplicate npm config paths;
product43046482605 stopped at Turbo's pnpm lookup. Product43046885054 passed
the full build but stopped on optional apt/font mirror DNS. Its database
container was removed; its open-handle/work cleanup stayed **unverified** and
was not relabelled by later success. Runner disposal was not independently
observed. Product43048328857 exposed a fixture identity collision, which was
separated without changing access rules.

Product43048895361 first exposed the browser preview failure;
43049892143 captured its actual403 origin response. The implementation now
compares the requested authority/scheme instead of Next's normalized hostname,
while rejecting foreign origins and cross-site requests. Product43050762182
and43051938331 retained narrow-select locator failures; the correct project/ID
was present, and the test now uses its accessible combobox role. No assertion,
check or application access rule was removed to obtain the accepted result.
The first local protocol attempt also caught the existing hash helper's default
24-character truncation; new artifacts explicitly use full64-character hashes.

## Publication and limits

The release retains original native JSON, bounded console logs, SQL/API/browser
results, screenshots, before/after source maps and failed-attempt evidence.
Its ZIPs are derived archives of downloaded artifact members: each member was
verified after archive creation. The published index keeps the separate
original Actions ZIP digests; it does not equate those to derived ZIP hashes.
The adjacent publication readback records asset identities and source bindings.

Hosted Supabase/Auth/RLS/provider/session acceptance, physical devices, other
Harbor profiles and model performance remain unverified. Docker image caches,
host-wide process groups and runner disposal are not independently proved.
The pre-existing artifact-store file-tracing warning in the normal Next build
remains outside this change. This release does not complete campaign execution,
production A/B integration or the full personal-project portfolio.

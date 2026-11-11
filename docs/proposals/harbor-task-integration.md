# Native Harbor tasks in Evals

11November2026. Continues the explicit [Features requirement](https://app.notion.com/p/3b6a1ee8bd068037ac1dea74a75b9070)
at immutable parentc0721e140feebc2c8bfcc495e98a57729e164e9a. Existing v1/v2
authoring, dataset, HTTP and prompt records/hashes stay unchanged. A new versioned
contract owns task source and native execution; no trace-file import is added.

1. The local CLI snapshots a selected task directory into a strict bundle of
   regular files/modes/bytes/hashes. Harbor0.25.0 validates that staged task;
   task name/version, its native checksum and the complete independent source
   manifest are bound. No symlink, hidden credential file, archive traversal or
   execution during import/preview/save. Initial native profile is explicit:
   schema1.4, one Linux Dockerfile task with a shared verifier, standard tests/test.sh and scalar or
   named numerical rewards. Other Harbor profiles remain visible unsupported
   requirements, not silently translated.
2. An authenticated workspace editor previews/saves immutable task versions,
   preserving exact bytes and an expected-head CAS. Existing scenario-suite /
   scenario-version tables can own this input-resource namespace; inventory
   and fence generic readers/writers before enabling it. No migration. Saving
   source does not prove the task will build or pass its verifier.
3. An editor selects exact task versions and an existing project, agent/model,
   explicit reward rule and execution bounds into an immutable plan. Sharing
   source with that project's API keys is an explicit plan action. Keys must
   remain in their own project, with eval scopes; they cannot enumerate other
   workspace tasks or author them. Workspace sessions keep existing role rules.
4. CLI preview has no execution. Explicit execution claims each selected task
   once through scoped SDK endpoints before launching Harbor locally in owned
   paths. Verify the runtime/version and staged native/source checksums; no
   shell interpolation, extra task downloads, auto-install, cloud launch/upload
   or automatic execution retry. The child excludes OpenEvals credentials and
   uses a controlled directory; provider variables require explicit selection.
5. Report only bound native reward values, declared agent/model, status/times,
   supported error class and source/result digests. Never send trajectory,
   chain-of-thought, arbitrary stderr or credentials. Server/API records are
   clearly local-runner reports, not remote attestation. Missing/invalid rewards
   or operational exceptions never become a model-quality pass. A lost response
   can replay only the identical completion; unknown dispatch stays unknown,
   with explicit recovery and a new user-requested run rather than hidden retry.
6. Evals shows saved tasks, version history, selected plans and run results;
   existing Evals/Improve top-level navigation remains. SDK/CLI docs include an
   actual authored native Harbor run, preserving reference-agent verification
   separately from paid-agent/model performance and hosted acceptance.

Budgets, fingerprints and every DTO are frozen before consumers. Source files
are bounded individually and in aggregate before reading/decoding or SQL transfer;
plans include all selected immutable artifacts once and retain a complete budget.
Old generic mutations/read projections must not acquire the new namespaces.
No production data or provider settings are used for checks.

Verify progressively: hostile/round-trip identity cases; real native Harbor
oracle pass and nop failure on one authored task; SQL/auth/replay/CAS/unknown
recovery; strict installed CLI/SDK consumers; then desktop/narrow author/select/
execute-report/readback workflows with disposable PostgreSQL. Freeze the exact
new CI scope before activation. Existing accepted cohorts are regression inputs
only when changed contracts actually depend on them; do not replay them merely
to add counts. Final source, normal build, canonical Vercel and current proof
limits must be retained before claiming this increment delivered.

Standing owner approval covers necessary free work. No paid plan, new account,
live model call, new hosted resource or migration is requested or performed.

Primary sources: [Harbor task format](https://docs.harborframework.com/tasks/overview),
[pinned runtime source](https://github.com/harbor-framework/harbor/tree/fdba28fc411e47e8765420a1a063b4918fce3def),
[PyPI0.25.0](https://pypi.org/project/harbor/0.25.0/).

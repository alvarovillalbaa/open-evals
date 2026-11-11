# Evals and Improve product contract

The [owner's OpenEvals brief](https://app.notion.com/p/3b6a1ee8bd068037ac1dea74a75b9070)
explicitly asks for SDK-only trace workflows, a CLI, public developer/agent
documentation, one Evals area, external benchmarks, Harbor tasks, scenarios,
campaign algorithms and composable/versioned instructions with production A/B
safety rollouts. The retained connected observation returned a 22 October edition
whose freshness was unverified, with an unresolved embedded tweet; this document
uses its explicit Features list. Repository AGENTS.md independently requires
exactly Evals and Improve.

## Current product surface

- `/evals` is the default resource catalogue. It shows actual persisted dataset
  inputs, scenario inputs, evaluator definitions and external benchmarks with
  their stable identities, versions, source and license where supplied.
- The catalogue does not infer membership from ID prefixes or page nesting.
  Existing benchmark/dataset and scenario/evaluator collections are independent.
  Dataset rows are inputs; Eval Items and Eval Sets define scoring, not inputs.
- `/evals/custom` authors a critical text-contains evaluator and explicit
  one-item membership using immutable versions. Workspace sessions can inspect,
  edit, retry and recover saves; project keys and hosted demo ownership cannot
  acquire workspace authoring. [Exact contract](custom-evals.md).
- `/evals/composition` defines reusable contains Eval Items and ordered sets of
  exact saved item versions, with immutable history and save recovery. Two sets
  can share the same check without cloning it. All 128 focused checks and the
  full root build passed on checked QA source `b3442e2`, including compiled-app
  execution with disposable SQL and authored transport responses. See
  [the composition contract](evaluator-composition.md) and
  [source-bound result](results/2026/11-09/evaluator-composition.md).
- `/evals/matching` adds literal exact checks and mixed saved contains/exact sets.
  The separate HTTP v3 family pins every membership and scores shared checks
  once per row. Its build, SQL and browser qualification is pending; see
  [the matching contract](evaluator-matching.md) and [focused scope](proposals/evaluator-matching-checks.md).
- `/evals/datasets` authors complete JSON/JSONL datasets with explicit review
  declarations, immutable history and exact-version scoring links.
  [Dataset contract](custom-datasets.md).
- `/evals/harbor` versions bounded task source, selects exact versions into a
  project-bound immutable plan and shows saved native results. Execution is
  explicit through the CLI and separately installed Harbor0.25.0 runtime.
  Once-only claims, identical completion replay and interruption closure use
  the existing SQL tables, with private namespaces fenced from legacy readers
  and writers. Initial profile: schema1.4, one Linux Dockerfile task, shared
  verifier. [Contract, commands and proof limits](runbooks/harbor-tasks.md).
- `/evals/plans` composes an exact dataset version, saved text-contains evaluator
  versions and a versioned public HTTP target into a named immutable plan.
  Preview, save and replay make no target call. Explicit execution uses durable
  row claims, stores actual responses and exposes uncertain-outcome recovery.
  Explicit v2 plans retain overlapping set membership while scoring each unique
  row/item pair once; existing v1 plans keep their original contract family.
  [HTTP contract and current proof limits](http-target-runs.md).
- `/improve` leads to existing Instructions authoring and campaign history.
  Each section retains its own authenticated loader and access outcome. A saved
  preparation request is not a running campaign or approval decision.
- Desktop and narrow navigation expose exactly two product areas. Runs and SDK
  connection belong to Evals; Instructions and Campaigns belong to Improve.
- Old benchmark/scenario pages redirect to the catalogue's real section anchors;
  old manual trace-import URLs redirect to SDK connection.
- Trace evidence is sent through the existing SDK. The manual form, CLI trace
  file/OTLP commands and MCP ingestion tool are retired. The unused OTLP HTTP
  route returns410 only after its unchanged editor/traces:write auth check.
  Single/batch SDK wires and stored evidence remain unchanged. Supported SDK
  workflow does not imply technical HTTP-client exclusivity.

The catalogue exposes saved resources and version metadata and links the custom
evaluator editor. Saving does not infer input relationships or start execution.
Authentication/database failures remain separate from a ready but empty workspace.

## Requirements still unfinished

| Owner requirement | Remaining implementation |
| --- | --- |
| Broader Harbor profiles and provider performance | Extend the initial pinned single-task Docker/shared-verifier profile; native authored reference checks do not establish provider/model performance or hosted acceptance |
| Further custom evaluator kinds and targets | Extend the verified saved-composition/HTTP profile with additional evaluator types and target runtimes; native network execution and hosted acceptance remain unverified |
| Campaigns consume Evals and optimizer algorithms | Bind pinned eval definitions into actual approved campaign execution; current request preparation does not do this |
| Improved instructions reach production with safe A/B rollout | Product approval, execution and release integration; existing primitives do not prove the complete flow |
| Usable hosted app | Existing Auth/database/provider configuration and genuine current-source interaction acceptance |

Composable/versioned instruction source and its previous accepted checks retain
their original identities. This surface change does not replay or relabel those
results. Public npm/PyPI, live providers/models, broader Harbor profiles and
hosted task acceptance require their own proof. New custom-set routes apply the existing role/scope checks with
a workspace-session boundary; existing grants/configuration are unchanged.
No new account, schema, dependency, plan or payment is part of this change.

# Evals and Improve product contract

The [owner's OpenEvals brief](https://app.notion.com/p/3b6a1ee8bd068037ac1dea74a75b9070)
explicitly asks for SDK-only trace workflows, a CLI, public developer/agent
documentation, one Evals area, external benchmarks, Harbor tasks, scenarios,
campaign algorithms and composable/versioned instructions with production A/B
safety rollouts. The fresh connected response is an unverified22October edition
with an unresolved embedded tweet; this document uses its explicit Features
list. Repository AGENTS.md independently requires exactly Evals and Improve.

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
| Evals contain Harbor tasks | Task identity/version/artifacts, task selection and actual Harbor execution integration |
| Custom evals combine inputs and scoring | Saved one-item evaluator authoring is implemented; durable input/evaluator composition, further evaluator types and execution remain unfinished |
| Campaigns consume Evals and optimizer algorithms | Bind pinned eval definitions into actual approved campaign execution; current request preparation does not do this |
| Improved instructions reach production with safe A/B rollout | Product approval, execution and release integration; existing primitives do not prove the complete flow |
| Usable hosted app | Existing Auth/database/provider configuration and genuine current-source interaction acceptance |

Composable/versioned instruction source and its previous accepted checks retain
their original identities. This surface change does not replay or relabel those
results. Public npm/PyPI, live providers/models and real Harbor tasks require
their own proof. New custom-set routes apply the existing role/scope checks with
a workspace-session boundary; existing grants/configuration are unchanged.
No new account, schema, dependency, plan or payment is part of this change.

# MCP

Trace evidence is submitted through the SDK. The MCP package does not expose
`ingest_traces`; use the [SDK connection guide](trace-ingestion.md) for application
instrumentation. Stored evidence and SDK transport are unchanged by this product
surface change.

The implemented read tools are:

| Tool | Existing endpoint |
| --- | --- |
| `list_runs` | `GET /api/v1/run-batches` |
| `list_benchmarks` | `GET /api/v1/benchmarks` |
| `list_scenarios` | `GET /api/v1/scenarios` |
| `list_instructions` | `GET /api/v1/instructions` |
| `list_campaigns` | `GET /api/v1/campaigns` |

Configure `OPEN_EVALS_URL` for the selected service. When supplied,
`OPEN_EVALS_API_KEY` becomes its Bearer header. The server retains its existing
authentication, workspace and scope checks. A tool definition does not establish
that a hosted service or account is configured.

`create_draft_run_plan` currently returns a notice that rows, an evaluator set
and a target are required, with the existing resolve endpoint. It creates no plan.
`create_draft_optimization_campaign` and `start_eval_run` return approval-required
notices with `requiresApproval: true`; they do not create or start work. These
notices are not approval decisions or execution authority.

No tool in this package automatically uploads files, invokes a model, promotes
a release or changes an experiment. Actual live mutation capabilities remain
separate from this current read-and-prepare surface.

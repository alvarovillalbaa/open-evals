# API

## SDK evidence transport

Application trace evidence is submitted through the
[SDK workflow](trace-ingestion.md), documented in the product at `/evals/sdk`.
The manual upload page redirects there; CLI `ingest file` / `ingest otlp` and
MCP `ingest_traces` are retired.

The existing SDK transport routes remain:

| Route | Current consumer and behavior |
| --- | --- |
| `POST /api/v1/traces` | TypeScript `submitTrace` and Python `submit_trace`; normalizes supplied JSON evidence |
| `POST /api/v1/traces/batch` | TypeScript `submitTraces` and buffered `flush`; normalizes the explicit JSON/JSONL payload |

Both retain `requireRouteAuth("editor", "traces:write")`, authenticated
workspace/project context, requested server-side redaction and existing
persistence. SDKs send supplied payloads without client-side redaction; review
them before transmission. Internal `manual_json` / `manual_file` source labels
and existing records are preserved. These endpoints remain accessible to clients
that satisfy existing authentication; the supported SDK workflow does not enforce
technical SDK identity or change server authorization.

`POST /api/v1/otlp/v1/traces` is retired. It retains the same
`requireRouteAuth("editor", "traces:write")` check and existing auth-error handling.
An authorized request receives HTTP 410 with `trace_import_retired` and guidance
to `/evals/sdk`; the handler does not read the body or persist evidence. Neither
inspected SDK calls this route. Existing OTLP records and the adapter library
are preserved; this route is no longer an alternative ingestion workflow.

## Evaluation and instruction routes

Other versioned route handlers include:

- `POST /api/v1/run-plans/resolve`
- `GET /api/v1/eval-runs`
- `POST /api/v1/eval-runs`
- `POST /api/v1/prompts/resolve`
- `POST /api/v1/experiments/assign`
- `GET /api/v1/optimizer/capabilities`
- `POST /api/v1/instructions/[definitionId]/campaign-requests/preview`
- `POST /api/v1/instructions/[definitionId]/campaign-requests`
- `GET /api/v1/instructions/[definitionId]/campaign-requests?baselineVersionId=…[&requestId=…]`

Additional CRUD/version routes are represented in the database schema and CLI surface and should be expanded with the same idempotency and RBAC rules.

Campaign request preparation uses the existing instruction access policy. It stores
pending approval metadata and an audit event; it does not generate candidates,
approve or execute a campaign. Exact input, fingerprints, recovery and failure
behavior are defined in [the campaign request contract](campaign-requests.md).

# SDK trace evidence

Connect application instrumentation through the TypeScript or Python SDK.
Trace and span records supply evidence for evaluations and prompt improvement.
The product has no manual trace-upload form, CLI trace-file command or MCP
trace-ingestion tool. Existing `/runs/import` links redirect to `/evals/sdk`,
which explains the supported SDK workflow without sending data itself.

## Connect an actual application

The TypeScript source is [packages/sdk/src/index.ts](../packages/sdk/src/index.ts).
The Python source is
[open_evals_sdk.py](../python/open_evals_optimizers/src/open_evals_sdk.py).
These are repository SDK modules; no public npm/PyPI installation is established
by this guide.

Configure the actual service URL and a server-held project API key explicitly.
TypeScript accepts `{ endpoint, apiKey }`; Python accepts `endpoint` and
`api_key`. Both attach the supplied key as `Authorization: Bearer ...`.
Neither trace client automatically reads `OPEN_EVALS_API_KEY`; the connection
examples at `/evals/sdk` read configuration and pass it to the client.
Set the endpoint rather than relying on defaults: the TypeScript development
default is `http://127.0.0.1:3216`, while the Python default is port 3000.
Use a service root without a trailing slash; Python concatenates it with the route.
Do not put a project key in browser code or a public export.

Call TypeScript `submitTrace(payload)` or Python `submit_trace(payload)` with
evidence from the real execution. This is explicit delivery, not an automatic
collector or a fabricated sample run. The trace normalizer recognizes:

- `traceId` or `id` as the external execution identity;
- `startedAt` (or `startTime`), optional `endedAt`, and `status`;
- `input`, `output`, `metadata`, `tags`, `environment` and `scopeKeys`;
- target/prompt identity fields, including `targetId`, `targetVersion`,
  `targetFingerprint`, `promptDefinitionId`, `promptVersionId`, `promptHash`
  and `sessionId`;
- `spans`, with captured IDs/parents, names, timing, input/output, messages and
  supported attributes such as `gen_ai.request.model` and `tool.name`.

Supply observed identities and timestamps. Missing fields may be defaulted by
the existing normalizer; that is not proof that an execution occurred. Payload
workspace/project fields are not access grants. The server resolves scope from
authentication, requires editor access and `traces:write` (or `admin` scope),
then passes its workspace/project context to ingestion. Local/demo and hosted
configuration remain distinct; this guide does not enable or weaken either.

## Delivery and buffering

| SDK operation | Existing wire endpoint | Result |
| --- | --- | --- |
| TypeScript `submitTrace` | `POST /api/v1/traces` | `Response`; check `ok` and handle failures |
| TypeScript `submitTraces` | `POST /api/v1/traces/batch` | `Response`; explicit array or JSONL string |
| TypeScript `flush` | `POST /api/v1/traces/batch` | Buffered count after an OK response; throws on non-OK |
| Python `submit_trace` | `POST /api/v1/traces` | HTTP status; HTTP/connection exceptions propagate |

TypeScript `startTrace` buffers a normalized trace. An optional positive
`flushIntervalMs` starts a timer; the default has no timer. Await `flush()` before
`close()` when deliberately using that buffer. `close()` only stops the timer;
it does not flush. The existing `flush()` removes buffered entries before the
request, so a failed delivery is not a durable retry queue. Retain source evidence
until delivery is confirmed. No retry, model call or evaluation is started by
this guide.

## Data policy and transport retirement

Both SDKs send the supplied payload without client-side redaction. Minimize and
review it before transmission; omit credentials and hidden model chain-of-thought.
The trace routes request server-side redaction. The current redactor recognizes
specific sensitive key names and email/phone/secret patterns; it is not a complete
sensitive-data detector or protection before data reaches the service. Historical
evaluation remains fail-closed until its data-policy fingerprint is resolved.

The generic adapter applies `redactValue` to each record before normalization.
The existing normalizer still emits `redactionState: "raw"`; this change does
not repair that marker or treat it as a new redaction attestation.

Single and batch endpoints remain because the SDK uses them.
`POST /api/v1/otlp/v1/traces` is retired: after its unchanged editor/`traces:write`
authentication check, an authorized request receives HTTP 410 with
`trace_import_retired` and guidance to `/evals/sdk`. The handler does not read
the request body or persist evidence. Authentication errors retain their existing
handling. Neither inspected SDK calls the retired route.

Existing server-side source labels such as `manual_json` and `manual_file` remain
legacy internal provenance labels. Stored traces, raw artifacts and the
export-normalization adapter library are preserved. The retained adapter source
does not provide an alternative product upload workflow. No SDK request shape,
single/batch transport or access policy is changed by the OTLP retirement.

SDK-only describes the supported user workflow, not technical client exclusivity:
an authenticated HTTP client can still use the retained routes under their
existing rules. No user-agent string is treated as proof of SDK identity.

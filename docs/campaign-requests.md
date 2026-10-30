# Campaign preparation requests

Last updated: 2026-10-30

Instructions can prepare and store a pending hypothesis-review request against
one saved canonical prompt version. This is request preparation, not approval
or optimization execution. Legacy/read-only versions cannot be used as bases.

## Prepare and save

1. Open a saved canonical version in Instructions and select a mutable component.
   Locked components cannot be requested for ablation.
2. Enter an objective of 1–2,048 UTF-8 bytes and choose **Preview request**.
   Review the baseline content/semantic fingerprints, complete payload and
   zero-call limits. Editing requires a new preview and request identity.
3. Choose **Save pending request**. Saving freezes the submitted identity and
   intent until storage confirms its outcome. Retain the displayed request ID.

The preview lists six existing deterministic ablation operations:
`delete_one_instruction`, `split_instruction`, `rewrite_one_instruction`,
`strictness_tighten`, `strictness_relax` and `order_test`. These are requested
hypotheses, not generated candidates or evidence of improvement. Provider,
target and judge calls, plus release changes, are all zero for this increment.

The server reloads and verifies canonical baseline source. Its semantic
fingerprint includes typed source bindings and unused authoring data, so equal
rendered text alone does not establish the same baseline. Server-derived
workspace, actor, definition and immutable source identity participate in the
intent and payload hashes. A stale preview or changed intent cannot be silently
substituted at save time.

## Storage, ownership and recovery

Saving creates a `pending` row with action `start_optimization_campaign` in the
existing `approval_requests` table, plus an audit event in the same transaction.
The action name describes the proposed future action; it does not start it.
No `optimization_campaigns` row is created. Audit metadata records IDs,
fingerprints and counts without prompt bodies, bindings or the objective.
The objective itself is retained in the request payload.

Preview/save reuse `requireInstructionAuth("write")`; reads reuse its `read`
mode and the already approved instruction ownership boundary. Project API keys
remain restricted to their own project's targeted definitions, workspace
sessions retain their workspace scope, and hosted demo ownership cannot write.
There is no new Auth policy, role grant, migration or dependency.

| Endpoint under `/api/v1/instructions/:definitionId` | Purpose |
| --- | --- |
| `POST /campaign-requests/preview` | Review the saved baseline, mutable component and objective |
| `POST /campaign-requests` | Save the reviewed request with its payload fingerprint |
| `GET /campaign-requests?baselineVersionId=…` | Read the latest 20 requests for this saved baseline |
| The same GET with `requestId=…` | Check one exact request identity, including an older request |

Preview accepts exactly `requestId` (a lowercase hyphenated UUID),
`baselineVersionId`, `componentId` and `objective`. Save accepts those same
four fields plus `previewFingerprint`, equal to the reviewed `payloadHash`.
Workspace, actor, status and definition overrides are rejected. A new save
returns 201; an identical replay returns 200 with `replayed: true`. History
returns `{ requests, hasMore }`; unknown or duplicate query keys are rejected.

Identical ID/requester/intent retries return the verified stored request without
another audit event. Reusing the ID for different intent returns 409. After an
interruption, use **Check stored request** or **Retry same submission**, retaining
the same ID and reviewed payload. A no-match check does not prove that an
earlier in-flight write was rolled back. Server projection revalidates stored
payloads and baseline fingerprints; a malformed or stale stored request fails
the list with 409 rather than returning a partially trusted list.

The history is read-only and scoped to Instructions, this definition and this
saved baseline. Its stored status is evidence only: even an `approved` value
does not grant execution authority through these endpoints. Local input is not
durable; global app navigation can discard **unsubmitted** work. Requests that
were stored remain recoverable from history or the exact-ID read.

## Execution and verification limits

There is no candidate generation, approve/reject/start, evaluation, model-call
or release endpoint in this increment. Approver selection and self-approval
policy remain undefined future gates. Existing optimizer primitives and the
[wider lifecycle](prompt-optimization.md) do not turn a pending request into an
authorized campaign.

The [focused proposal](proposals/campaign-request-checks.md) contains 26 core,
19 PostgreSQL and eight browser checks: **53 authored, unrun** cases. Temporary
CI stays inactive until separately approved. Earlier 55 compiler, 58 authoring
and 71 client successes cover their own scopes. The
[dated source receipt](results/2026/10-30/campaign-requests.md) owns current
implementation/publication evidence and its limits.

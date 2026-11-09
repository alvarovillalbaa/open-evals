# Saved custom Eval Sets

`/evals/custom` creates a critical, case-insensitive text-contains evaluator and
saves its explicit one-item membership. `/evals/custom/[setId]` loads the current
definition and up to20immutable versions. The Evals catalogue links this editor;
the two primary product areas remain Evals and Improve.

Saving records an evaluator, not a dataset, execution, campaign or release.
Dataset/evaluator composition and Harbor task support remain unfinished.

## Request and immutable contract

`POST /api/v1/eval-sets` accepts exactly these fields:

```json
{
  "schemaVersion": "custom-eval-set-draft-v1",
  "setId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "versionId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "version": 1,
  "expectedVersionId": null,
  "name": "Required answer marker",
  "contains": "approved",
  "datasetPassRateThreshold": 100
}
```

IDs are lowercase canonical UUIDs. Version1 requires a null parent; later
versions require the prior saved ID and the next integer version. The version
ID cannot equal its parent. The maximum version number is1,000,000.
Names are trimmed, nonblank, at most120Unicode code points/480UTF-8bytes.
Contained text is nonblank and preserved exactly, up to4,096UTF-8bytes. Both
reject NUL and unpaired surrogates rather than stripping/replacing them.
The threshold is a finite number from0to100; negative zero canonicalizes to0.
Unknown fields, coercions and unsupported shapes fail422.

Core builds `custom-eval-set-v1` using the existing Eval Set/Item contracts:
one `string_check`, `llm_call` unit, critical weight1 membership, boolean
`contains_expected` field and exact configured text. Request, item and set
fingerprints are full canonical SHA256 digests, each excluding only its own
digest. Stored contracts must rebuild exactly, including all fields and hashes;
parsing never repairs a claimed identity.

The existing engine marks a failed text check as hard-fail. The stored dataset
pass-rate threshold is a separate gate: current Eval Set/run gates also require
no critical failures, so a threshold below100does not waive a critical failure.
This editor does not execute that engine. The existing run route executes only
its first member; multi-item execution and durable input selection are separate
remaining work. No judge, provider, target or model call is made by authoring.

## Access and API

These new routes require a workspace session. Reads require viewer/evals:read;
writes require editor/evals:write, with the existing admin-scope alternative.
Supabase and signed sessions use existing authenticated workspace context.
Non-hosted local development retains local access. API keys, including admin
keys, and hosted local/demo ownership are refused. Eval Sets have no project
ownership relation, so project keys cannot acquire workspace authorship through
this API. No existing route grant, role, provider setting or configuration is
changed. Request bodies cannot supply the trusted workspace or actor.

| Endpoint | Result |
| --- | --- |
| `GET /api/v1/eval-sets` | Up to100actual custom-set summaries; imported benchmark sets are separate |
| `GET /api/v1/eval-sets/[setId]` | Current name, latest20validated versions and hasMore;404if absent in this workspace |
| `POST /api/v1/eval-sets` | 201for a new immutable version,200for exact replay; response includes a fresh current-head snapshot |

Authentication precedes body reads. The existing streamed JSON reader enforces
its2MiBrequest ceiling; the stricter field limits apply before storage. JSON
responses are no-store, with safe error codes and no raw SQL/private errors.
Database timestamps serialize as validated ISO strings for the client.

## Persistence and recovery

The existing five set/item/version/membership tables and audit table suffice;
there is no schema change or migration. Scoped transactions lock the workspace
and existing set, validate the current head and actual item membership, then
write immutable versions with no-overwrite identity handling. Expected-head or
changed-intent conflicts fail409. Cross-workspace identities never overwrite.

An exact version-ID retry is checked before the head comparison, including an
older save retried after later versions. Requested and current membership must
still be valid. Mutable current display names never rewrite historical
contracts. Audit metadata contains IDs and hashes, not names or configured text.
One-statement reads keep names, heads, counts and member metadata on a single
snapshot. List validates the current head; detail validates up to21retrieved
versions and returns20. Older unfetched content is not exhaustively audited.

The editor retains the same request IDs when a save outcome is unknown and
locks draft editing until recovery. Explicitly loading the latest version keeps
the draft text and establishes a new parent for a reviewed next save. Synchronous
busy and generation/unmount guards prevent stale responses from changing a
later form. Loading saved versions is read-only; it does not cancel or roll back
an already started save. Client response checks reject mismatched intent rather
than silently reshaping it.

[Focused verification](results/2026/11-09/custom-eval-checks.md) separates actual
pure-source results from authored PostgreSQL cases and unverified HTTP/Auth/UI
behavior. Hosted database/Auth configuration remains a separate existing gate.

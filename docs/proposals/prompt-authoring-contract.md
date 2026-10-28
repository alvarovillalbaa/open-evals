# Immutable instruction authoring

Status: implementation contract; project-key access policy awaiting owner approval.
Source baseline: `aac1581a53453b6b8661322819c7c69fb5b8b81a`.

## Access policy requiring approval

Existing `viewer + prompts:read` and `editor + prompts:write` remain the role/scope requirements. Workspace sessions retain workspace access. A project-bound API key may read, resolve, create and author only definitions attached to a target in that key's project and workspace. It may not access untargeted workspace definitions or definitions in another project. Keys without a verifiable project fail closed for these instruction operations. Target ownership is checked server-side. This policy covers the existing instruction catalog and resolve route as well as the new routes, so the catalog cannot expose new authoring bindings across projects.

No provider settings, role grants, RLS policies, database migrations, dependencies, CI configuration or paid services change. Hosted requests using implicit local/demo ownership must not gain authoring access; local development retains its existing local owner behavior. This boundary is included in the access-policy approval.

## Routes and client contract

- `GET /api/v1/instructions`: existing catalog, with project filtering where applicable.
- `POST /api/v1/instructions`: create a recoverable empty definition from `{id, stableKey, targetId?}`. The client retains `id` across retries. Schema objects default to `{}`; workspace and actor come from authentication. Same ID and same creation intent replay; conflicts return 409. Workspace-row locking serializes the API's stable-key checks. Existing duplicate stable keys are reported, never selected arbitrarily.
- `GET /api/v1/instructions/[definitionId]?versionId=...`: definition, version summaries and selected saved version. Omitted selection chooses the newest saved version for review only; it does not change serving.
- `POST /api/v1/instructions/[definitionId]/preview`: accept `{versionId, baseVersionId?, components, composition?}` and return `{version, requestFingerprint, previewFingerprint}`. The server fetches and verifies the base and derives parents and `draft` status.
- `POST /api/v1/instructions/[definitionId]/versions`: accept the preview input plus `previewFingerprint`, recompile and validate in the save transaction, and return `{version: StoredVersionDTO, replayed}`.

Reject client-supplied workspace, actor, status, compiled text, parent list or release fields. Bound streamed JSON before parsing (2 MiB) in addition to compiler limits. Authenticate before reading request content. Errors use `{error: string}` with 400 malformed, 401 unauthenticated, 403 access, 404 scoped resource absent, 409 conflicting identity or stale preview, 422 invalid source/locked change/legacy base, 503 unavailable storage. Do not return SQL or binding values in error messages.

`InstructionDetailDTO` contains `{definition:{id,stableKey,targetId?}, versions:VersionSummary[], selectedVersion:StoredVersionDTO|null, canWrite:boolean}`. A summary has `{id,status,createdAt,parentVersionIds,contentHash,authoring:"composition"|"literal"|"legacy"}`. A stored version also has `compiledText`, optional verified canonical `version`, and optional `readOnlyReason`. No authentication principal is passed to client components.

## Immutable source and retries

The existing `prompt_versions.components` JSONB holds:

```ts
{
  schemaVersion: "prompt-version-storage-v1",
  materializedComponents,
  source: { mode: "literal", components }
       | { mode: "composition", snapshot },
  sourceFingerprint,
  write: { actorId, requestFingerprint, previewFingerprint }
}
```

SQL columns remain authoritative for identity, definition, text, hash, parents, lifecycle status and timestamp. Decode authored records by recompiling source and checking every correspondence. Legacy rows retain original text/hash and are view-only; never fabricate a valid base or silently rehash them. Malformed authored envelopes are reported as invalid, not treated as legacy.

Full 64-hex request fingerprints bind canonical source, version/base/definition IDs, workspace and actor. Preview fingerprints additionally bind the verified base's semantic fingerprint and compiled result. They detect stale review and do not confer authorization or prove human approval. Every request is authorized independently.

Under a scoped definition lock, check a version-ID replay first: the same actor, full request fingerprint and saved preview fingerprint returns the verified original even if siblings were subsequently added. Conflicting reuse returns 409. For a fresh ID, verify the immutable base, compile against it, compare the reviewed fingerprint, then INSERT the draft and an audit event in one transaction. No existing version or release is updated. A root version without a base is allowed only while the definition has no versions. Explicit forks from older canonical bases are supported: siblings are valid, and there is no artificial unique-head requirement. Changed base semantics invalidate a pending preview.

The DB package keeps its existing dependencies. A trusted server callback supplies compilation/validation inside the transaction; clients cannot provide that callback. Audit metadata contains IDs, hashes and counts, not prompt content or bindings. API-level insert-only behavior does not claim globally immutable SQL/RLS or globally enforced stable-key uniqueness; those would require separate approved database changes.

## Editor and serving

Instructions remains nested under Improve. New definition creation works from an empty catalog. Saved versions are read-only; Compose version creates a new stable draft ID. The composer supports ordered components, lock flags, typed bindings and JSON editors for nested operation blocks and named block libraries. Review displays compiled text, parent, component changes, content hash and source hash. An edit invalidates preview; failures preserve edits and identity for retry. Async responses are fenced to the owning draft/revision. Saving reloads the actual persisted record. Loading, errors, empty states and narrow layouts use existing app controls.

Default resolution requires an eligible saved version and must never implicitly serve a draft. Explicit evaluation candidate overrides remain available for the same scoped definition. Existing release precedence and pure core resolver remain unchanged. No release is promoted, experiment launched or production pointer changed by authoring.

## Verification boundary

The earlier 55 approved compiler checks are complete and do not approve new store/API/browser tests. Implementation receives source review and targeted static checks first. Prepare a separate bounded proposal before executing authoring backend or browser checks. Local Storage Guard currently prevents installs, full builds and disposable databases; no workaround may bypass its reserve. Hosted build evidence, when available from the existing Git integration, is distinct from database or browser execution.

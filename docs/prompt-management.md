# Prompt Management

Last updated: 2026-10-30

Prompt definitions contain stable identifiers, target links, variable schemas, component schemas, locked components, mutable components, permitted scopes, and baseline versions.

Prompt versions are immutable snapshots with component patches, fully materialized prompt text, parent version IDs, content hash, optimizer/candidate lineage, and status.

Prompt releases answer which version should be served for a scope and rollout stage. Resolution never changes a prompt in the middle of a thread or session.

## Source composition

The pure core compiler supports explicit `prompt-composition-v1` authoring.
Literal compilation preserves the existing header/text/hash format; supplying
`composition` enables typed in-field bindings and operation blocks. This is
separate from dataset/task inputs and the future persisted definition's variable
schema. No values are read implicitly from an environment, trace or dataset.

```ts
const version = compilePromptVersion({
  id: "welcome-v1",
  definitionId: "welcome",
  components: [{
    id: "greeting", kind: "role", locked: false,
    operations: [
      { op: "include", name: "intro" },
      { op: "if", variable: "formal", then: [{ op: "text", template: " Welcome." }] }
    ]
  }],
  composition: {
    schemaVersion: "prompt-composition-v1",
    bindings: {
      name: { type: "string", value: "Ada" },
      formal: { type: "boolean", value: true }
    },
    blocks: { intro: [{ op: "text", template: "Hello {{name}}." }] }
  }
});
```

Bindings explicitly tag `string`, finite `number`, `boolean` or `json`. Ordinary
`{{name}}` placeholders insert scalar values; `{{json:name}}` inserts canonical
JSON with sorted object keys. Escape an opening placeholder as `\{{name}}` to
keep it literal. Inserted values are opaque: a binding containing `{{other}}`
does not trigger another substitution. Names do not support property traversal
or expressions.

Source components contain either a literal/template `content` string or an
`operations` array. The closed block vocabulary is:

| Operation | Fields and behavior |
| --- | --- |
| `text` | `template`: in-field substitution |
| `include` | `name`: expand a named block library entry |
| `if` | Boolean `variable`, `then`, optional `else` |
| `each` | JSON-array `variable`, local item `as`, optional numeric `indexAs`, `body`, optional `separator` |

Named library entries close over root bindings, including when used inside a
loop. They cannot capture the caller's loop aliases. Aliases cannot shadow root
or enclosing names. Primitive loop items infer scalar binding types; structured
items use explicit JSON formatting. Both conditional branches and unused library
entries are validated. Empty loops still validate lexical references. Unknown
references, malformed fields/types, include cycles and excessive expansion are
errors; no arbitrary code, external loading or expression evaluator is provided.

Input JSON/AST nesting is bounded at 16, source AST nodes at 2,048, root bindings
and library entries at 128 each, aggregate loop iterations at 10,000 and
validation/render work at 100,000 steps. Source and compiled text each have a
1 MiB UTF-8 budget, with an additional 100,000-node JSON traversal limit. Source
container punctuation is charged before descending, so small shared input graphs
cannot expand indefinitely into empty JSON containers. These bounds include
zero-output expansions and multibyte text, rather than only the visible result's
character count.

## Version and lock ownership

Compiled versions own deeply frozen rendered components, parent IDs and source
snapshots. `contentHash` remains the SHA-256 of fully materialized prompt text,
truncated to 24 hexadecimal characters. A composition version additionally
returns `compositionSnapshot` with the copied source, typed bindings, library
and separate `sourceHash`. Map insertion order does not change that authoring
identity; changes to unused authoring blocks do. Compiled body identity and
source-program identity answer different questions.

When deriving a candidate, provide `baseVersion` and explicitly include its ID
in `parentVersionIds`. Compilation checks locked rendered text, IDs, kinds,
lock flags, definition identity and locked relative order, plus text/hash
correspondence. A changed binding cannot bypass a locked rendered instruction.
Initial variable resolution can create a locked snapshot; runtime-variable
slots inside a locked version require a separate future rendering contract.

The demo candidate and ablation builder use this base-version guard. Ablations
operate on materialized text and create literal children without a composition
snapshot; their parent references retain authoring lineage. Generated variants
remain hypotheses until controlled evaluations supply evidence.
The order ablation reorders actual mutable slots without copying every block's
text into one component. Locked slots retain their position.

## Persistence and application boundary

The compiler remains a pure operation. The web authoring flow now creates a
definition, previews a new source program, saves an immutable `draft`, and
reloads that exact version for review. Every source edit invalidates preview.
Saving does not activate a release or run a campaign. A definition containing
only drafts has no implicit serving baseline; an explicit eval-only candidate
override may still resolve that scoped draft.

The existing `prompt_versions.components` JSONB stores a versioned envelope
with materialized components, literal source or full composition snapshot,
source fingerprint, and write/review fingerprints. Existing SQL columns remain
authoritative. The decoder recompiles source and checks text/hash/materialized
correspondence. The seed's older object-shaped payloads and demonstration hashes
remain view-only, with their original bytes retained. Malformed authored rows
are visibly read-only and cannot become a base.

Authoring uses the existing read/write scopes and editor role, with the approved
project-key access boundary. The server derives workspace, actor, definition,
base, parents and draft status; request fields cannot replace them. The save
transaction locks the definition, verifies a canonical base, recompiles and
compares the reviewed fingerprint, then inserts version and audit together.
Identical version-ID retries return the verified original; conflicting intent
returns 409. Explicit forks from older canonical bases are valid. A newer
sibling does not invalidate an immutable-base preview. Audit metadata contains
IDs, hashes and counts, without prompt bodies/bindings.

The storage codec additionally rejects NUL and isolated Unicode surrogates in
all source strings and keys, including unused entries, because PostgreSQL
cannot preserve them. Valid astral Unicode is retained. Application insert-only
behavior is not a claim of globally immutable SQL/RLS or a database-wide unique
stable-key constraint. No schema, dependency or Auth provider changes are made.

The exact API, retry and access policy is in the
[authoring contract](proposals/prompt-authoring-contract.md). Verification status
and unexecuted checks are in the [authoring receipt](results/2026/10-28/prompt-authoring.md).

## Campaign preparation requests

A saved canonical version now exposes a request form in Instructions. Select a
mutable component and objective, then explicitly preview before saving a pending
request. Every edit invalidates the preview and request identity. The server
reconstructs the saved baseline and owns the content, semantic, intent and
payload fingerprints. Semantic identity includes typed source bindings and
unused authoring blocks, even when rendered text is unchanged.

Saving inserts an existing `approval_requests` row and minimal audit event in
one transaction; it creates no `optimization_campaigns` row or candidate version.
The same reviewed ID and intent recover the original request after an uncertain
acknowledgement. History is scoped to this definition and saved baseline through
the existing `requireInstructionAuth` ownership rules. Malformed or stale stored
requests fail the list with 409 rather than becoming executable approval.

Submitted stored requests remain recoverable; global app navigation can discard
unsubmitted local input. Approval decisions, approver/self-approval policy,
campaign execution, evaluations and releases remain outside this increment.
There is no migration, dependency or Auth-policy change. The
[campaign request contract](campaign-requests.md) owns the API, recovery and
retention details; its [53 authored checks](proposals/campaign-request-checks.md)
are unrun pending separate execution/temporary-CI approval.

SDK resolution and Python string-patch optimizers remain separate consumers;
promotion, rollback, live experiments and structural work orders retain their
approval gates. The wider Features requirements—SDK-only evidence entry,
unified evals, Harbor tasks and production campaigns—remain separate scope.

Focused source and authored-check evidence belongs in
[the implementation receipt](results/2026/10-28/prompt-composition.md).

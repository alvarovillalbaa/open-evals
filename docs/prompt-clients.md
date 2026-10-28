# Prompt CLI and TypeScript clients

Status: the approved runtime repair is implemented and all 71 focused client
checks passed on 2026-10-28. See [the receipt](results/2026/10-28/prompt-clients.md).
The previous 58 authoring checks remain the separate server/editor receipt.

The CLI uses the existing instruction API and canonical core compiler. It does
not generate version IDs, reinterpret the prompt DSL or activate releases.
The [runtime proposal](proposals/cli-runtime.md) describes the approved
executable bootstrap, now verified by the four focused native-bin scenarios.

## Create, review and save

Configure the destination independently of any input file:

```sh
export OPEN_EVALS_URL=http://127.0.0.1:3216
# Set OPEN_EVALS_API_KEY through your existing secret environment mechanism.
```

Definition file `definition.json`:

```json
{"id":"support","stableKey":"support","targetId":"target_support"}
```

Draft file `draft.json`:

```json
{
  "versionId": "support-v2",
  "baseVersionId": "support-v1",
  "components": [
    {"id":"instructions","kind":"system","locked":false,"content":"Answer clearly."}
  ]
}
```

Choose stable IDs before previewing; omit `baseVersionId` for the first version.
The target/base must exist and be accessible to the configured identity.
Composition drafts use the same explicit typed bindings and operation blocks
as the [composition contract](prompt-management.md).

```sh
open-evals prompt create --file definition.json
open-evals prompt preview --definition-id support --file draft.json --out reviewed.json
# Inspect reviewed.json, including source, rendered text, base and fingerprints.
open-evals prompt push --file reviewed.json
open-evals prompt pull --definition-id support --version-id support-v2 --out support-v2.json
```

Preview writes a `open-evals-prompt-review-v1` file containing the normalized
endpoint, definition ID, full normalized input and validated server preview.
Push requires that exact format and a matching independently configured
endpoint. It sends the stored input and fingerprint; it never previews again,
changes the ID or selects a destination from file contents. Retry with the same
review file after an uncertain response. The server reauthorizes, recompiles and
checks immutable identity on every request. The file/fingerprint is not a
signature or proof of human approval.

Input JSON is strict UTF-8 and bounded to 2 MiB for definitions/drafts and
32 MiB for reviews/pulled details. New output files are atomically published
with mode 0600 and never replace an existing path. An existing regular file
with byte-identical serialized contents returns `unchanged`; its permissions
are preserved, so the private-permission guarantee applies to newly created
files. Different content fails. No force option or implicit directory creation
is provided. Review/pull/diff output can contain private prompt bindings; choose
its destination accordingly.

## Inspect and compare

```sh
open-evals prompt diff --left support-v1.json --right support-v2.json
open-evals prompt resolve --definition-id support --candidate-version-id support-v2
```

Diff is offline and accepts two pulled detail documents. It compares selected
version metadata, full compiled text, hashes, ordered materialized components,
and full authored source. It reports binding/library changes even when unused
source leaves rendered text unchanged. A valid comparison exits zero whether
or not `hasDifferences` is true. Legacy versions retain original text/hash;
their result explicitly says `sourceComparison: "unavailable_legacy"` and
`sourceChanged: null`, without claiming source equivalence.

Resolve delegates candidate/experiment/release selection to the server and
returns its validated version, release IDs, fingerprint, full text and hash.
It does not promote, roll back, start an experiment or call a model.

Malformed flags, unsupported commands, invalid files, failed HTTP requests and
invalid response contracts exit nonzero with stable errors. Error output does
not include raw response bodies, file contents or supplied key values. `doctor`
reports configuration only and explicitly sets `networkChecked: false`.
Commands that formerly printed fictional success, including release actions
and optimizer/status placeholders, now report `command_not_implemented`.

## SDK

`OpenEvalsClient` adds typed `createPromptDefinition`, `getPromptDefinition`,
`previewPromptVersion`, `savePromptVersion` and `resolvePromptJson` methods.
The existing `resolvePrompt` and trace/evaluation methods retain their raw
`Response` return contracts. New checked methods validate both HTTP status and
the producer DTO, including full canonical source correspondence.

```ts
const input = { versionId: "support-v2", baseVersionId: "support-v1", components };
const preview = await client.previewPromptVersion("support", input, { signal });
// Present the returned source and compiled text for review before saving.
const saved = await client.savePromptVersion("support", input, preview.previewFingerprint, { signal });
```

Checked prompt requests reject credential-bearing/query/fragment endpoints,
encode path IDs, forbid redirects, combine a 30-second deadline with optional
caller cancellation, and bound JSON responses to 32 MiB. They perform no
automatic retry. `OpenEvalsHttpError` exposes only a safe code and HTTP status;
unknown backend error text is reduced to `prompt_http_error`.

Exact `.` and `..` definition IDs cannot be used in path-based detail/preview/save
calls because URL parsers normalize those path segments. The CLI also rejects
creating such definitions. This restriction does not apply to server-supported
version IDs in query/body fields or definition IDs in the JSON resolve call.

This source increment does not publish npm packages or establish SDK/core
standalone package distribution. Hosted configuration, Supabase login/RLS,
production persistence and standalone package distribution remain separate
proof boundaries.

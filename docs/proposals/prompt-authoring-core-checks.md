# Focused authoring protocol checks

Status: prepared only; **not executed**. Separate owner approval is required
before running these new domain checks. The earlier 55 compiler checks remain
closed and unchanged; they do not authorize or prove this authoring scope.

The proposed scope is exactly **30 native Node checks** in
[`prompt-authoring.node.mjs`](../../packages/core/tests/prompt-authoring.node.mjs).
The dedicated [import hook](../../packages/core/tests/register-authoring-typescript.mjs)
loads only the actual `prompt-authoring`, `prompt`, `prompt-composition` and
`hash` core source modules. Node 24 strips TypeScript without an install.

After approval, from the repository root:

```sh
node --import ./packages/core/tests/register-authoring-typescript.mjs --test ./packages/core/tests/prompt-authoring.node.mjs
```

Record `process.version` and `process.execPath` from that same shell. No database,
HTTP server, provider, model, browser, dependency installation, build, CI change,
auth setting, release, or deployment is part of this proposal. Fixtures are
authored in memory and create no external data or persistent artifacts.

The cases cover literal/composed reload, unused source retention, full and
normalized request fingerprints, server identity/base binding, preview staleness
and lifecycle neutrality, explicit forks, lock enforcement, unknown fields,
fingerprint/source/materialization/column corruption, legacy view-only behavior,
malformed authored records, immutable detached values, retry derivation, NUL and
isolated surrogate rejection across used/unused source and JSON keys, valid
astral Unicode, and compiler size/depth/shape limits.

The SQL row remains authoritative for version/definition/parent IDs. The decoder
recompiles its source under those columns; the replay path additionally derives
the stored source intent and recomputes the context-bound request fingerprint.
These checks distinguish that replay proof from validation of text/hash/status
columns and do not claim that an opaque envelope fingerprint independently
authenticates row identities without the workspace context.

This scope proves only the pure protocol if approved and executed. Transaction
locking, SQL persistence, scoped access, HTTP boundaries, browser behavior and
hosted builds require their own evidence and approval boundaries.

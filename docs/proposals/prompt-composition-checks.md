# Focused composition checks

Last updated: 2026-10-28

Status: explicitly approved and completed under the supplied AGENTS.md §7
backend/domain-test gate. Alvaro answered **“Approve OpenEvals’ 55 checks”** for
the scope frozen at `e5ee8c1493f640e69d163b50cc1ce13e1ed4fdd4`. All **55 passed**,
with zero failures, skips, cancellations or TODOs. See the [exact report](../results/2026/10-28/prompt-composition-checks.json)
and [owning receipt](../results/2026/10-28/prompt-composition.md).

The approved 55 authored T2 cases ran using the existing Node `v24.21.0` installation:

```sh
node --import ./packages/core/tests/register-typescript.mjs \
  --test packages/core/tests/prompt-composition.node.mjs
```

These checks load the actual compiler, composition helper, hash and ablation
modules. A source-scoped resolve hook adds `.ts` only to their known relative
imports; Node's native type stripping handles the existing erasable TypeScript.
It does not substitute a compiler implementation or fake hashing. The
[Node 24 TypeScript documentation](https://nodejs.org/download/release/v24.20.0/docs/api/typescript.html)
explains that stripping does not perform type checking or use `tsconfig.json`.
The [module hook API](https://nodejs.org/api/module.html#moduleregisterhooksoptions)
supports the focused resolver. No dependency installation is needed.

The cases cover literal-byte/hash preservation, variable rendering, canonical
JSON, includes, conditional/loop scopes, both-branch validation, immutable source
and rendered snapshots, provenance/hash tampering, locked base versions, actual
mutable-slot reorder, literal ablation children and resource limits. Inputs are
authored prompts/bindings, not user data, targets or judge results.

Use the pinned candidate bundle whose Git blob hashes match the published source
if a full checkout remains unavailable. Record the Node version/executable and
exact source hashes. Keep bounded totals/failure evidence, then remove only the
task-owned temporary output. The full checkout/build remains stopped by Storage
Guard; the existing runtime and small source files need no new environment.

This scope uses no server, browser, database, Auth change, CI, provider, model
call, promotion, rollback, live experiment, structural work order or paid service.
It does not run the existing Vitest suite or change its package script; the
explicit `.node.mjs` filename keeps the focused driver outside Vitest discovery.
Runtime results establish these authored pure-code cases only, not full
semantic type checking, persisted version creation, an editor or hosted behavior.

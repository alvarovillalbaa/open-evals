# CLI runtime bootstrap

Status: the exact runtime repair and 71-check temporary CI scope were explicitly
approved on 2026-10-28. Launcher/dependency implementation is being applied;
generated lock and execution evidence remain pending. No CLI, SDK or test
function was executed during the original source audit below.

Source: [`1ea43b13517c11342cd30bc661134db29ebb8c38`](https://github.com/alvarovillalbaa/open-evals/tree/1ea43b13517c11342cd30bc661134db29ebb8c38).

## Current failure boundary

The [CLI manifest](https://github.com/alvarovillalbaa/open-evals/blob/1ea43b13517c11342cd30bc661134db29ebb8c38/apps/cli/package.json)
maps `open-evals` to `./src/index.ts`, whose shebang invokes plain Node. Core and
SDK export TypeScript source; the [core entry point](https://github.com/alvarovillalbaa/open-evals/blob/1ea43b13517c11342cd30bc661134db29ebb8c38/packages/core/src/index.ts)
uses extensionless relative imports.

Node 24.21 can strip erasable types, but still requires explicit file extensions,
ignores `tsconfig.json`, and refuses native TypeScript stripping under
`node_modules`. Native type stripping therefore does not supply the resolver
needed by this source graph. This is a source-backed bootstrap defect; no native
launch was attempted. See [Node 24.21 TypeScript documentation](https://nodejs.org/download/release/v24.21.0/docs/api/typescript.html).

The [canonical lockfile](https://github.com/alvarovillalbaa/open-evals/blob/1ea43b13517c11342cd30bc661134db29ebb8c38/pnpm-lock.yaml)
records root development specifier `tsx: ^4.21.0` resolved to **4.22.4**. Its
`apps/cli` importer has no `tsx` runtime dependency. Loading an undeclared root
development dependency would not establish ownership of the CLI runtime.

## Exact proposed change

In `apps/cli/package.json`, change only the binary target and add the exact
already-resolved runtime dependency:

```diff
   "bin": {
-    "open-evals": "./src/index.ts"
+    "open-evals": "./bin/open-evals.mjs"
   },
   "dependencies": {
     "@open-evals/adapters": "workspace:*",
     "@open-evals/core": "workspace:*",
-    "@open-evals/sdk": "workspace:*"
+    "@open-evals/sdk": "workspace:*",
+    "tsx": "4.22.4"
   }
```

Add an executable JavaScript launcher at `apps/cli/bin/open-evals.mjs`:

```js
#!/usr/bin/env node
import { register } from "tsx/esm/api";

register();
await import("../src/index.ts");
```

The dynamic import must occur after registration. Keep registration for the CLI
process lifetime so later imports retain the same runtime support. This uses
the CLI's own declared dependency, preserves arguments and the existing command
entry point, and needs no root preload, `NODE_OPTIONS`, custom source hook or
transitive dependency lookup.

This exact API exists in the locked release's [export map](https://github.com/privatenumber/tsx/blob/v4.22.4/package.json),
[registration implementation](https://github.com/privatenumber/tsx/blob/v4.22.4/src/esm/api/register.ts)
and [ESM registration guide](https://github.com/privatenumber/tsx/blob/v4.22.4/docs/dev-api/register-esm.md).
The proposal reuses 4.22.4; it does not select a newer `tsx` release or change the
root development range. This repairs the workspace CLI bootstrap, not the
independent publication/packaging contract of SDK or core.

## Lock generation and approval boundary

After explicit AGENTS.md §14 approval, use a bounded temporary CI checkout with
the repository's **pnpm 10.14.0**, the existing lockfile and the exact manifest
delta above. Generate the lock without installing modules or running scripts:

```sh
pnpm install --lockfile-only --ignore-scripts --no-frozen-lockfile --prefer-offline
```

An offline generation is suitable only if the required metadata is already
available; do not assume a fresh runner has a populated store. The generation
step may fetch public package metadata, with no credentials or paid provider.
The expected lock change is the `apps/cli.dependencies.tsx` edge, with specifier
and version both `4.22.4`. Existing package resolutions, integrity values,
snapshots and other importers must remain unchanged. Stop and review any broader
diff; do not run `update`, `--force` or lockfile repair to accept unrelated drift.

pnpm documents that `--lockfile-only` avoids `node_modules`, `--ignore-scripts`
disables lifecycle scripts, and CI normally freezes existing lockfiles. The
explicit non-frozen flag is confined to this proposed generation step. See
[pnpm 10 install options](https://pnpm.io/10.x/cli/install).

After the generated manifest/lock diff is reviewed, a separately authorized
check phase can install with `pnpm install --frozen-lockfile` and invoke the
actual manifest binary through plain Node, without `--import tsx`, to test the
bootstrap itself. Authored SDK/CLI checks and any temporary CI activation must
have a concrete approved scope; the earlier compiler and authoring approvals do
not cover them. No database, migration, browser, model, production request or
release action is proposed here. Local installation must not bypass Storage
Guard. No manifest, lockfile, launcher or active workflow was changed by this
proposal.

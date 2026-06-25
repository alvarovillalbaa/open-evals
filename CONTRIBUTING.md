# Contributing

Thanks for improving `open-evals`.

## Development

```bash
corepack prepare pnpm@10.14.0 --activate
pnpm install
pnpm setup:local
pnpm test
```

Keep product work inside the two top-level functions: Evals and prompt self-improvement. Do not add generic observability, tracing, APM, log-management, uptime-monitoring, or infrastructure-monitoring product areas.

## Standards

- Preserve immutable run plans, sample manifests, prompt versions, dataset versions, and evaluator versions.
- Use stable row IDs for result attribution.
- Keep historical data fail-closed unless an explicit data policy permits it.
- Do not request or persist hidden model chain-of-thought.
- Add fixture tests for adapters and deterministic tests for optimizer changes.

## Pull Requests

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:python
pnpm build
```

Public CI must not use tenant historical data.

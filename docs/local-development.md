# Local Development

```bash
corepack prepare pnpm@10.14.0 --activate
pnpm install
pnpm setup:local
pnpm dev
```

Local operation does not require AI credentials. PostgreSQL starts through Docker Compose when Docker is available. Artifacts are stored in `.data/artifacts`.

If Python is unavailable, core evals, ingestion, prompt management, and the web UI still work. Python optimizer engines remain disabled with setup instructions in `pnpm doctor`.

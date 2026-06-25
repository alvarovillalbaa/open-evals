# Deployment

Recommended hosted deployment:

- Vercel for `apps/web`.
- Neon for PostgreSQL.
- Vercel Blob for private raw artifacts.
- Vercel AI Gateway for optional AI authoring and LLM judges.
- Vercel Workflows and Queues for durable long-running orchestration when enabled.
- Vercel OIDC/Connect where official docs recommend token exchange instead of static platform credentials.

Basic hosted builds must not require production credentials. Optional services are capability-checked at runtime.

Hosted enablement:

- Set `AUTH_MODE=hosted`, `AUTH_SECRET`, `AUTH_BASE_URL`, `AUTH_GITHUB_ID`, and `AUTH_GITHUB_SECRET` to enable browser login.
- Set `HOSTED_DEMO_API_KEY_HASH` and `HOSTED_DEMO_API_KEY_SCOPES` for scoped API-key access. Generate hashes with the same `API_KEY_PEPPER` used by the deployment.
- Set `ARTIFACT_STORAGE_DRIVER=vercel_blob` plus `BLOB_READ_WRITE_TOKEN` and include `@vercel/blob` in the deployment image to use private Blob artifacts.
- Set Vercel OIDC/token credentials for hosted Workflow, Queue, and Sandbox adapters. Without them, local adapters remain active.
- Set `PYTHON_OPTIMIZERS_ENABLED=true` and install Python extras such as `open-evals-optimizers[gepa,dspy,search,smac]` to enable official optimizer engines.

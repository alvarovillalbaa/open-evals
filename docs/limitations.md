# Limitations

- Hosted auth/RBAC is implemented with signed sessions, scoped API-key checks, GitHub OAuth routes, schema, and route guards. It requires `AUTH_MODE=hosted`, `AUTH_SECRET`, and OAuth/API-key configuration; local mode remains single-user.
- Workflows and queues have idempotent local adapters and Vercel-compatible hosted adapters. Hosted execution requires Vercel OIDC/token credentials and the relevant Vercel runtime packages in the deployment image.
- GEPA/DSPy/Optuna/SMAC adapters call official packages when installed. They remain disabled and fail honestly when optional Python extras are absent.
- Benchmark fixtures are intentionally small; full recognized datasets are not vendored unless their licenses permit it. GSM8K and BFCL importers accept user-supplied full downloads.
- Vercel Blob and Sandbox have optional hosted adapters. Local tests use deterministic local drivers when hosted credentials or SDKs are unavailable.

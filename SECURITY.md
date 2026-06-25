# Security Policy

Report security issues privately. Do not file public issues for vulnerabilities involving credentials, tenant data, prompt-release corruption, evaluator bypass, sandbox escape, SSRF, webhook signing, or raw artifact exposure.

Security expectations:

- API keys are hashed with a pepper.
- Connection credentials are encrypted or stored as secure external references.
- Historical data evaluation is denied by default.
- Raw artifacts are private by default and independently deletable.
- Custom code evaluators must run outside the Next.js server process.
- Mutating Eve tools require approval.

Local mode is for development and deterministic demos. Hosted deployments should configure RBAC, encryption keys, webhook signing secrets, upload limits, rate limits, and Vercel/Neon production settings.

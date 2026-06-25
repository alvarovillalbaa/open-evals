<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# open-evals project rules

- Product navigation has exactly two top-level product areas: Evals and Improve.
- Traces are evidence for evals and prompt improvement; do not add standalone observability, APM, uptime, infra, or log-search product areas.
- Historical data evaluation is fail-closed by default.
- Stable row IDs, immutable run plans, immutable sample manifests, and prompt hashes are release-critical.
- Do not request or persist hidden model chain-of-thought.
- Mutating Eve tools, release promotion, rollback, live experiments, and structural work orders require approval.

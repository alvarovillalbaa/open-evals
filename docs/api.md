# API

Versioned route handlers include:

- `POST /api/v1/traces`
- `POST /api/v1/traces/batch`
- `POST /api/v1/otlp/v1/traces`
- `POST /api/v1/run-plans/resolve`
- `GET /api/v1/eval-runs`
- `POST /api/v1/eval-runs`
- `POST /api/v1/prompts/resolve`
- `POST /api/v1/experiments/assign`
- `GET /api/v1/optimizer/capabilities`
- `POST /api/v1/instructions/[definitionId]/campaign-requests/preview`
- `POST /api/v1/instructions/[definitionId]/campaign-requests`
- `GET /api/v1/instructions/[definitionId]/campaign-requests?baselineVersionId=…[&requestId=…]`

Additional CRUD/version routes are represented in the database schema and CLI surface and should be expanded with the same idempotency and RBAC rules.

Campaign request preparation uses the existing instruction access policy. It stores
pending approval metadata and an audit event; it does not generate candidates,
approve or execute a campaign. Exact input, fingerprints, recovery and failure
behavior are defined in [the campaign request contract](campaign-requests.md).

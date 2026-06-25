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

Additional CRUD/version routes are represented in the database schema and CLI surface and should be expanded with the same idempotency and RBAC rules.

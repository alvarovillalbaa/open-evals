# Eve Agents

Eve is used for agentic planning, simulation, review, and optimization orchestration only.

Mutating or costly operations require approval:

- Starting eval runs.
- Requesting GEPA campaigns.
- Running variant matrices.
- Starting live experiments.
- Promoting releases.
- Rolling back releases.
- Creating structural work orders.

Agents provide concise user-visible reasoning and structured diagnostics, not hidden chain-of-thought.

Runtime shape:

- `agent/agent.ts` defines read-only tools for campaign inspection, draft run-plan creation, and FAPO attribution.
- Mutating tools return `requiresApproval: true` plus a typed approval request for variant matrices, promotions, rollbacks, and structural work.
- Approval requests include workspace, action, requester, risk, summary, payload hash, and payload preview.
- `EVE_ENABLED=false` leaves the deterministic control plane fully usable; enabling Eve only adds agentic planning and orchestration.

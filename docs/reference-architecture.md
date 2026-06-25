# Reference Architecture

Research was completed against the current default branches available on June 25, 2026. Code was used as architectural reference only; no license-incompatible or proprietary implementation was copied.

## Repositories Inspected

| Repository | Commit SHA | License Notes | Patterns Adopted |
| --- | --- | --- | --- |
| `clous-ai/cloush-server` | `618df103089d73336600b243f595dc644d2ecb84` | private reference | Immutable run plans, stable row IDs, sample manifests, fail-closed historical policy, redaction, target-kind validation, Promptfoo compatibility, calibration, scenario navigation, durable artifacts, hierarchical gates, target-fidelity checks, FAPO/GEPA control-plane boundaries. |
| `gepa-ai/gepa` | `92dadfffbe98c8ecf508179a1cab09c1bb85cd32` | MIT | Official GEPA package is the intended engine; open-evals exposes capability detection and a Python adapter path instead of a TypeScript imitation. |
| `cisco-foundation-ai/fully-automated-prompt-optimization` | `c1f5ffd42b133809f8c3d85a7155a0de60be58d7` | Apache-2.0 | FAPO was adopted as an outer attribution/routing protocol, not as a second tenant-specific runtime. |
| `karpathy/autoresearch` | `228791fb499afffb54b46200aca536f79142f117` | README says MIT; no LICENSE file found | Narrow hypothesis loop and keep/discard memory. |
| `promptfoo/promptfoo` | `4f8103c0ff8c53ae19fb8d64fd40ffb2e37f3ab6` | MIT | Result artifact compatibility and provider-independent eval definitions. |
| `langfuse/langfuse` | `216d422635f5634bfaa8a295041f92c81a1c2aed` | MIT outside enterprise directories | Export-file normalization only; no observability clone. |
| `confident-ai/deepeval` | `8bb5b02d4cdb3745eb59fd14a1a81e36a2825f1d` | Apache-2.0 | Output/export fixture normalization. |
| `Arize-ai/openinference` | `78f06704c7169a8ba8d1fc7d62b4e5b82b2e70c2` | Apache-2.0 | Provider-independent span kinds and LLM/tool/handoff attributes. |
| `open-telemetry/semantic-conventions` | `b51e2a63c73df495fd12b6a50747d61aa05dd606` | Apache-2.0 | OTLP and semantic attribute grounding. |
| `open-telemetry/semantic-conventions-genai` | `e853ef127cb37f310b5b8de81fb648f149243746` | Apache-2.0 | Current official GenAI semantic conventions are separated into this repository. |
| `stanfordnlp/dspy` | `498760149b230f402c56bece2aa45df6e1ba946b` | MIT | Optional official DSPy engine path. |
| `openai/openai-agents-python` | `92137d222b442df7b2e3daeb984cee45608bb2ca` | MIT | Agents traces/export concepts and span evidence. |
| `openai/openai-agents-js` | `ed2d82acfbee8ef984d7a1d1b8705f04f1edb491` | MIT | JavaScript agent SDK trace compatibility. |
| `modelcontextprotocol/typescript-sdk` | `c59dc3aa1a633d27fbbe873f1a430483cf7440f8` | Apache-2.0 with legacy MIT portions | MCP tool contracts and approval boundaries. |
| `modelcontextprotocol/python-sdk` | `a5271423128ac76cbd171adad40e225d1c755522` | MIT | Python SDK compatibility expectations. |
| `ShishirPatil/gorilla` BFCL | `6ea57973c7a6097fd7c5915698c54c17c5b1b6c8` | Apache-2.0 | Agent/tool benchmark fixture direction. |

## Official Documentation Checked

- Vercel Workflows: `workflow` package, TypeScript `"use workflow"`/`"use step"` style, Python workflow decorators, hooks.
- Vercel Queues: `@vercel/queue` send/callback/poll patterns.
- Vercel AI Gateway and AI SDK: `ai` APIs, OpenAI-compatible providers, OIDC on Vercel and `AI_GATEWAY_API_KEY` locally.
- Vercel Blob: private `put` artifacts.
- Vercel Sandbox: remote sandbox REST API and local fallback requirement.
- Vercel Connect/OIDC: token-based hosted authentication patterns.
- Vercel MCP: `xmcp` as the current Vercel-compatible MCP framework.
- Vercel Eve: beta single `agent/` directory convention with tools and instructions.
- Next.js local docs in `node_modules/next/dist/docs/`: App Router, route handlers, data security, environment variables, Vitest, and Playwright.

## Patterns Deliberately Rejected

- Generic trace explorer or observability UI.
- Position-based result correlation.
- Live benchmarks that judge blank target outputs.
- Reduced modes that drop critical evaluators.
- Downstream release decisions that recompute an unofficial average.
- Judge changes entering CI without calibration.
- Candidate promotion without candidate execution.
- Optimizing target prompts and judges in the same campaign.
- Hidden autonomous agents that weaken thresholds or mutate production prompts.
- One-shot prose suggestions labeled as GEPA.

## Current API Differences From Assumptions

- OpenTelemetry GenAI conventions are now referenced through the separate `semantic-conventions-genai` repository.
- Vercel Eve is beta and uses a single `agent/` project convention; this repository uses role instructions and typed tools under that shape instead of inventing a multi-agent folder tree.
- Vercel Workflows support TypeScript and Python patterns; the local open-source path keeps workflows as typed idempotent entries and does not require hosted Workflows for basic operation.
- Vercel AI Gateway can use Vercel OIDC in hosted mode; static AI gateway keys are only needed for local/non-Vercel usage.

## Why This Is Not Observability

`open-evals` stores normalized traces and spans so evaluators, gates, failure attribution, calibration, and prompt optimization can cite evidence. The UI does not expose traces as a standalone product, does not offer infrastructure dashboards, and does not sell cost/latency observability. Cost and latency appear only as eval objectives, guardrails, budgets, and experiment metrics.

## Why Cloush Zero-Schema Persistence Was Not Copied

The Cloush reference is an existing Django codebase with project-specific migration constraints. `open-evals` is greenfield, so it uses first-class PostgreSQL entities, foreign keys, uniqueness constraints, and transactional records for run plans, sample manifests, results, prompt versions, releases, experiment exposure, and rollback integrity.

## Optimizer Integration Status

- Official package integrations: GEPA (`gepa`) and DSPy are capability-gated in the Python runtime and reported disabled unless installed.
- Licensed protocol-level reimplementations: FAPO routing, Karpathy-style narrow hypothesis loop, hill climbing, and structured GA are implemented as local protocols over open-evals candidate/eval contracts.
- Optional package adapters: Optuna/TPE and SMAC are advertised only through capability detection.

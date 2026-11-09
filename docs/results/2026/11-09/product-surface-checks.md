# Evals/Improve and SDK workflow checks

The [product contract](../../../product-surface.md) now has two visible areas,
a unified catalogue of actual input/evaluator resources, an Improve landing
page and SDK connection guidance. Manual trace upload, CLI file/OTLP ingestion,
MCP ingestion and the unused OTLP HTTP ingest path are retired. SDK single/batch
transport, existing access checks and stored data remain unchanged.

[The exact verification record](product-surface-checks.json) accepts19distinct
cases across separately recorded invocations. The first passed all8navigation cases
and failed11protocol cases before module loading because the selected Node
transform mode was unsupported. That overall result remains failed. The
compiler-only harness repair retained every case body and dependency seam;
its11protocol cases then passed. A subsequent filename correction keeps the
Node-only navigation module outside Vitest's `.test.ts` collection; all8unchanged
assertions passed at the final `.mts` path. The failed harness and full raw
output hashes remain preserved.

The protocol cases execute actual CLI/MCP/retired-route code with explicit fake
SDK, file, fetch and Auth dependencies. They verify early command refusal,
retained read/prepare behavior, required auth-call arguments,410 and delegated
401/403 fixtures without body reads. They establish authored module protocols,
not real SDK delivery, installed CLI bootstrap, production Auth or persistence.

Selected navigation/MCP modules and navigation tests passed strict no-emit
TypeScript checking with library checks enabled, using existing read-only tools.
No dependency environment, application, server or database was installed or
launched locally. Source/whitespace review and native Git tree arithmetic
verify the complete1270-file/318-directory parent base and the checked module bytes.
The local files are a bounded source overlay, not a complete Git checkout.

Three current-source browser scenarios are authored but unexecuted. They cover
desktop/narrow navigation and legacy redirects; the viewport case is not a
physical-device/touch result. Provider build and public delivery have their own
source/result boundaries. Existing55/58/71/53-case receipts stay closed.

Harbor, custom eval authoring/membership, actual campaigns and approved production
rollouts remain unfinished. Hosted configuration and real-user acceptance remain
separate; this increment does not complete the portfolio.

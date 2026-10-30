# Campaign preparation request source

30 October 2026. Source implementation and static inspection only; the 53 new
behavioral checks are authored and **not run**. The complete OpenEvals product
and portfolio objective remain unfinished.

## Result and boundary

A saved canonical Instruction version now has a preparation panel: select a
mutable component, type an objective, preview the immutable request, then
explicitly save one pending approval request. History reloads that saved
baseline's requests. An uncertain submission freezes its identity and payload
until an explicit same-ID retry or storage lookup confirms the outcome.

The server reconstructs the canonical baseline and complete metadata hash
under the existing scoped definition lock. Request insertion and its minimal
audit are atomic. Replay returns the original row and timestamp without a
second audit. IDs, hashes and counts enter the audit; raw prompt source,
bindings and objective text do not. Approval metadata contains the objective
and references the canonical saved version, without copying prompt bodies.

Requests remain under existing instruction read/write authorization. They do
not enter the workspace-wide campaign catalog. No `optimization_campaigns`,
candidate, run, job, evaluation, release or workflow row is created. Six
existing ablation operation names are proposed hypotheses; no ablation
generator is invoked. All provider/target/judge/release limits are zero.
There is no approval/rejection/start endpoint. Approver eligibility and
self-approval policy remain undefined prerequisites for future execution.

See the [API and recovery contract](../../../campaign-requests.md). A stale or
malformed stored request fails with 409; the server does not return an
unverified executable record. Global application navigation can discard
unsubmitted local input. Submitted requests remain durable and recoverable
from stored history; universal navigation interception is not implemented.

## Inspected source and static checks

The reference is personal GitHub main
`d4944d941d7f59181b174f38ff6400bc9afe6353`, with 1,240 original leaves.
A bounded selected-text context was copied and Git-blob checked against that
reference; this workspace is not a full Git checkout. The source overlay must
preserve every unrelated original leaf and use a conditional main update.

Inspection covered the core preparation contract and canonical prompt codec,
existing instruction Auth/parser helpers, scoped store, new service/routes,
editor integration and browser fixtures. Existing Next 16.2.9 directive/route
guides ([client directive](https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/03-api-reference/01-directives/use-client.mdx),
[route convention](https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/03-api-reference/03-file-conventions/route.mdx))
were read from the matching official tagged source because this bundle
has no installed Next environment. A second agent reviewed the new core,
service, route, SQL and browser sources without finding a concrete defect.

Using the existing TypeScript 5.9.3 parser/transpiler, 14 changed TS/TSX source,
test and inactive example modules parsed without syntax diagnostics. Static
relative/workspace imports resolve against the pinned source tree plus the
three exact future browser-copy destinations. All 14 original database store
function declarations are byte-identical. The inactive workflow was parsed
as YAML; its 11 shell steps and two embedded Node programs passed syntax-only
checks. No-index `git diff --check` reported no whitespace errors.

The [machine-readable seal](campaign-request-source.json) records selected
hashes, the complete application source path/mode/blob set and exact authored
case names. Results and bundled dependency/cache/agent directories are excluded
from that application seal; remote publication separately preserves the full
original repository tree. The lockfile, dependencies, SQL schema/migrations,
Auth policy/provider, active CI and hosting configuration are unchanged.

## Pending verification

The [new proposal](../../../proposals/campaign-request-checks.md) contains
26 pure cases, 19 actual PostgreSQL/HTTP boundary cases and four actual
loopback Chromium scenarios in each of desktop/narrow profiles: **53 total**.
It is a separate scope from the completed 55 compiler, 58 authoring and 71
SDK/CLI checks. The new workflow and browser files are inactive examples;
they must not be activated or run before explicit approval.

No new test, product module import, installation, local server, database,
browser, provider/model call, migration, release promotion or CI job was run
to produce this source receipt. Local storage does not support a new build or
database environment under the existing Storage Guard reserve. A subsequent
Vercel build/alias readback, if recorded, proves only deployment compilation
and routing metadata; it cannot replace these behavioral checks or prove
hosted authentication/persistence, campaign execution or candidate quality.

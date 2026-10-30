# Campaign preparation checks

Status: proposed, authored, **not run**. No workflow is active.

The source adds pending campaign preparation requests to saved Instructions.
It does not approve a request, generate candidates or start a campaign.
The [contract](../campaign-requests.md) and [implementation receipt](../results/2026/10-30/campaign-requests.md)
define the behavior and proof limits.

## Exact scope

| Check file | Cases | What it checks |
| --- | ---: | --- |
| `tests/unit/campaign-preparation.test.ts` | 26 | Exact data-only inputs, Unicode/byte bounds, canonical baseline identity, six operation hypotheses, zero-call limits, immutable hashes and detached results. |
| `tests/integration/campaign-request-storage.test.ts` | 19 | Actual PostgreSQL transactions, audit rollback, concurrent replay, stored identity, scoped history, existing instruction authorization and direct HTTP handlers. |
| `campaign-request-browser.spec.ts.example` | 8 | Four actual loopback application scenarios, once in desktop Chromium and once in narrow Chromium with emulated touch. |
| **Total** | **53** | No broad regression suite or Python optimizer run. |

The four browser scenarios cover preview/save/reload with literal Unicode;
held preview invalidation across edits and saved-version changes; a real
committed write with an injected lost acknowledgement and exact-ID recovery;
and a read-only project key reviewing stored history without write controls or
locked-component selection. These are authored test objectives, not outcomes.

The [source seal](../results/2026/10-30/campaign-request-source.json) records the
exact full Vitest names, browser title/profile pairs, selected byte hashes and
complete tracked application source path/mode/Git-blob set. The source set
excludes bundled `.agents/`, results, dependency directories, `.next`, `dist`
and Python bytecode; those exclusions do not authorize changing application
source. The future job checks the seal itself against the pinned Git object
and checks application bytes/modes before installation and after outcomes.

## Proposed execution

One manual job in this public repository, on `ubuntu-24.04`, capped at
20 minutes. The inactive [workflow example](campaign-request-checks.yml.example)
uses pinned existing official Actions, Node 24.21.0, pnpm 10.14.0, the unchanged
frozen lockfile with install scripts disabled, and the already declared Vitest,
Playwright and tsx. Chromium is installed only into the owned runner directory.
No cache or artifact upload is configured. Only bounded case names, counts,
statuses and actual exit codes are retained in the workflow log.

PostgreSQL 16 is a disposable runner service named `campaign_requests_test`,
with fixture-only credentials. The job verifies an empty `public` schema,
sets and rechecks the exact database ownership comment, and applies only the
two existing schema fixtures, `0001_init.sql` and
`0002_hosted_integrations.sql`. It never calls the broad migration command or
applies `0003`, changes production grants, or connects to a hosted database.

Both suites require these explicit guards before opening the database:

```text
CAMPAIGN_REQUEST_TEST_TARGET=local-disposable
CAMPAIGN_REQUEST_TEST_MARKER=open-evals-campaign-requests-v1
CAMPAIGN_REQUEST_TEST_DATABASE_URL=postgres://<fixture>@127.0.0.1:5432/campaign_requests_test
```

Browser checks use actual fixture project API keys and hosted-mode loopback
routes with an explicit disposable pepper. Supabase and model/provider secrets
are empty; workflows and optimizers are disabled. Browser HTTP/WebSocket
requests are restricted to the loopback app. The database cases substitute
only the already-verified Auth boundary; the existing instruction access
function, parsing, service and SQL remain actual code. Browser cases exercise
the real project API-key path, without a hosted login or real account.

The job copies only the three reviewed browser examples into absent task-owned
test paths. It runs the two exact Vitest files with one worker and no retries,
then the exact browser configuration with one worker and no retries. Reports
are bounded and require all 45 Vitest names and all eight browser title/profile
pairs exactly once, passed, with successful process exits and no skipped,
flaky, unexpected or global browser errors.

Cleanup checks the authored workspace marker and explicit fixture identities
before deleting fixture rows. Copied files and runner directories require
matching recorded identity/bytes before removal. The disposable service then
expires with the job. Unexpected changes cause failure; cleanup does not
delete unrelated work to make a check pass.

## Approval and limits

Activation requires a separate explicit approval for these **53 checks and
temporary CI** under the supplied AGENTS.md sections 7 and 14. Earlier 55
compiler, 58 authoring and 71 client approvals/results are separate scopes.
After approval, replace `APPROVED_SOURCE_SHA` with the reviewed immutable
40-character commit, activate that example temporarily and dispatch that
exact source. Retire the workflow after recording actual results and cleanup.

No production data, real account, hosted Auth configuration, provider/model
call, promotion, release change, paid enrollment or store submission is in
scope. This checks request preparation only. It cannot establish approver
eligibility/self-approval policy, campaign execution, candidate quality,
controlled evaluations, production persistence, real touch hardware or native
client behavior. Storage Guard prevents local dependency/database/browser
setup, so this proposal uses the disposable remote runner.

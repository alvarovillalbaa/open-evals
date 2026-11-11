# Version and run Harbor tasks

Harbor tasks live under **Evals → Harbor tasks**. A task version stores exact
source files, executable bits, file hashes, the native Harbor checksum and a
complete bundle fingerprint. A plan freezes up to four exact task versions,
one existing project, an agent/model, a reward rule and per-task execution time.
Saving or previewing never starts a container or calls a model.

Supported initial profile: Harbor **0.25.0**, task schema **1.4**, a single Linux
Dockerfile task with a shared verifier and numerical reward values. Separate
verifiers, multi-step tasks, other environment providers, remote Docker and
other runtime versions are rejected. This is task execution, not trace import.

## Create the source bundle

Use a checkout of this repository, Node 24 and Python 3.12. The native component
is installed separately; the app and CLI never install it automatically.

```sh
pnpm install --frozen-lockfile
python3.12 -m venv .venv-harbor
.venv-harbor/bin/python -m pip install './python/open_evals_harbor[runtime]'
HARBOR_TELEMETRY=0 .venv-harbor/bin/open-evals-harbor pack --task ./my-task --out ./task-bundle.json
```

Packing validates the staged source with the pinned Harbor Task model. It
refuses symbolic/hard links, unsafe paths, credential-file paths, Compose
environments and changing files. Limits are 128 files, 256 KiB per file and
1 MiB of source in a 1.5 MiB wire bundle. Only regular 0644/0755 file modes are
represented. Existing output can replay only the identical bundle.

In the app, choose the bundle, name the task, preview and save. **New version
from vN** explicitly names its parent. A concurrent save reports a head change;
keep the draft and inspect the latest saved version. Prior versions stay intact.
Saved source passes transport validation; the server does not attest that its
container will build or that its verifier will succeed.

## Share a frozen plan and execute explicitly

Select exact task versions and a project. Set the Harbor agent, reward key,
minimum reward and timeout. Confirm that saving shares selected source with
that project's API keys, preview and save. Workspace editors author tasks and
plans; project keys with eval scopes can read and run only their own plans.
Project keys cannot enumerate workspace tasks, author versions or close other
users' interrupted claims. No existing role/provider setting is changed.

Set OPEN_EVALS_URL and OPEN_EVALS_API_KEY in your terminal using that project's
normal key-management flow. Do not paste keys into task source or command-line
arguments. From the repository root, preview the exact plan:

```sh
node apps/cli/bin/open-evals.mjs harbor run --plan-id PLAN_UUID
```

Preview does not inspect the Python runtime, write a journal, reserve a run or
start native processes. For explicit execution, choose a new run UUID and an
existing private journal directory. Use your local Unix Docker socket:

```sh
mkdir -p ./harbor-runs
node apps/cli/bin/open-evals.mjs harbor run --plan-id PLAN_UUID --execute --run-id RUN_UUID --journal-dir ./harbor-runs --docker-socket /var/run/docker.sock --python-bin "$PWD/.venv-harbor/bin/python"
```

Oracle and nop are reference agents and refuse provider/model credentials. A
model agent requires an explicit provider/model in the plan and
`--provider-env OPENAI_API_KEY` (or another supported variable name). Only the
selected provider variables reach the native process; OpenEvals, GitHub and
other credentials are excluded from its environment. Named provider models use your provider account
and billing. Reference-agent checks do not demonstrate model performance.

Each run reserves its exact task rows. A new claim is committed before native
dispatch; identical claim replay returns `claimedNow: false`. Only that first
claim response authorizes execution. The Node CLI runs the installed Python
component, which stages and revalidates the source and calls Harbor's local
`trials start` once. It uses no launch/upload/cloud flags, host-env approval,
automatic task download or automatic execution retry.

## Read results and recover interruptions

Open the saved plan and refresh its runs. The shareable page URL retains plan
and run IDs; authorization is checked again on reload. Reports contain native
reward values, declared/resolved agent metadata, status, clocks, error class
and source/result digests. They exclude trajectories, hidden reasoning, arbitrary
console text and credentials. Reports are explicitly **local-runner reports**,
not remote attestation. A missing selected reward fails its rule; an operational
exception or unknown dispatch has no model-quality decision.

```sh
node apps/cli/bin/open-evals.mjs harbor status --run-id RUN_UUID
node apps/cli/bin/open-evals.mjs harbor report --run-id RUN_UUID --version-id TASK_VERSION_UUID --claim-id CLAIM_UUID --file ./harbor-runs/harbor-run-RUN_UUID/TASK_VERSION_UUID/result.json
```

The journal records reservation/claim identities before dispatch and retains the
redacted result before submitting it. After a lost completion response, status
can confirm the saved result; replaying the identical `report` is safe. Changed
completion cannot overwrite it. Existing journal directories are never reused
to dispatch again. After a lost claim response, do not infer execution permission
from a GET or retry the dispatch. An editor can use **Close interrupted run**
after the local runner has stopped: outstanding claims become unknown and
pending tasks become not sent. A new execution requires a separately requested
run. Late completion cannot overwrite a closed unknown claim.

The Python component retains its native job directory for local recovery and
reports staged-source removal. Harbor's delete flag and process exit do not
independently establish Docker teardown. Native resources use the exact
`oe-harbor-EXECUTION_UUID__env` Compose project label; inspect that label during
recovery. Do not delete other jobs, directories or Docker resources.

## SDK

```ts
import { HarborClient } from "@open-evals/sdk";

const harbor = new HarborClient(endpoint, projectApiKey);
const plan = await harbor.getPlan(planId);
const { run } = await harbor.startRun(plan, newRunId); // reserves only
const claim = await harbor.claimTask(run.runId, plan.tasks[0]!.versionId, newClaimId);
if (claim.claimedNow) {
  // Explicitly execute this bound task with your local runner exactly once.
  // Submit only the redacted harbor-result-v1 record for its execution ID.
}
```

SDK requests have deadlines, bounded JSON bodies/responses, response identity
checks and no automatic retry. Completion and status methods validate saved
plan/run fingerprints. Preview/save methods require a workspace session; a
project API key is deliberately insufficient for authoring.

## Storage and verification

No migration is required. Task versions use a fenced `harbor_*` namespace in
scenario suites/versions. Plans and run ledgers use a fenced `harbor_*`
namespace in run_plans. Workspace transactions serialize version/claim changes;
CAS and audit writes commit atomically. Generic scenario/run reads and legacy
run upserts exclude these records, including reserved identities with corrupt
profile metadata. Existing v1/v2 contracts and fingerprints are unchanged.

The [native check scope](../proposals/harbor-task-integration.md) and
[product check scope](../proposals/harbor-product-checks.md) distinguish authored
reference execution, disposable SQL/browser acceptance and hosted proof.
Other Harbor profiles, production provider/RLS/session acceptance and model
performance remain separate requirements.

Primary references: [task format](https://docs.harborframework.com/tasks/overview),
[Harbor0.25.0 source](https://github.com/harbor-framework/harbor/tree/fdba28fc411e47e8765420a1a063b4918fce3def),
[published runtime](https://pypi.org/project/harbor/0.25.0/).

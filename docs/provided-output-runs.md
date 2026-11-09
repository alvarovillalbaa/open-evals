# Score saved responses

Open **Evals → Score supplied outputs** (`/evals/run`) with a workspace session.
Choose a saved dataset version and a saved custom Eval Set version, load their
complete rows, and enter the actual response for each row. The recent catalogue
shows at most 100 versions of each kind; exact IDs also resolve older versions.
This form does not create or seed datasets.

Use **Preview pinned run** to inspect the exact saved inputs, visible reference
answers, evaluator membership, supplied responses and plan fingerprint. Preview
does not execute or persist a run. **Run deterministic checks** explicitly scores
and records that intent. A viewer can inspect and preview; saving requires editor
access. Project API keys cannot use this workspace-session flow.

Each response is actual output. An empty response is valid and may fail; stored
reference answers are never substituted. This version supports the saved custom
`string_check` contract. It makes no target, model or judge call and does not start
a campaign, Harbor task, experiment or rollout.

The result page shows the frozen source rows, exact evaluator version, original
responses, result provenance and all eight gate levels. A dataset pass-rate gate
can pass while a failed critical check still fails the Eval Set and run. Later
source edits do not change an accepted run.

Editing invalidates the preview. If a source changes before saving, the server
returns 409: reload the selected versions, review the changes, then preview and
explicitly run again. A network failure can leave the outcome unknown. Keep the
page open and use **Retry unchanged run** or **Check saved run**; the unchanged
run ID and request recover the original record without a duplicate. A missing
read alone does not cancel an in-flight write. Automatic recovery after closing
the page is not implemented; accepted records remain in recent history or at
their public run URL.

Limits are 100 complete rows, 64 KiB UTF-8 per response, 1 MiB total response text,
1 MiB canonical saved dataset JSON and a 2 MiB request. Sources outside these
limits are refused intact. PostgreSQL JSONB values must survive the JavaScript
numeric boundary without semantic loss; unsafe integers, over-precise decimals
and underflow are refused with `provided_output_dataset_precision`. Hashes bind
accepted JSON values, not the original spelling of JSON text.

The dedicated `/api/v1/provided-output-runs` collection provides read history and
explicit POST execution; `/sources`, `/preview` and `/{runId}` provide selected
inputs, pure preview and immutable retrieval. The versioned wire, storage and
collision rules are specified in [the implementation contract](proposals/provided-output-runs.md).
Legacy broad run readers exclude these private records.

This mode is one deterministic scoring path. Provider-backed target execution,
generic evaluators, automated comparisons, campaigns and rollout remain separate
requirements. Disposable owner-database and signed-session checks do not establish
real hosted Auth, RLS, provider or end-user acceptance.

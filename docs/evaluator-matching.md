# Exact checks and mixed Eval Sets

Matching v3 adds a deterministic exact-text Eval Item under Evals. Its output must
be a primitive string equal to the configured text. Case, leading/trailing
whitespace, newlines and Unicode sequences matter. Objects and numbers are not
coerced, and text is not normalized. The configured value is a nonblank string
of at most 4,096 UTF-8 bytes. The critical boolean field is `matches_expected`.
This is a precise application rule, not a model-quality judge.

`/evals/matching` authors exact items and mixed sets. Existing contains authoring
remains at `/evals/composition`. A mixed set selects 1–32 exact saved item
versions from either family in an explicit order. Existing contains checks keep
their original case-insensitive behavior. References include the family tag,
public item/version IDs and contract fingerprint; equal UUIDs in two families
cannot alias. Reusing a contains version does not clone or rehash that item.

Preview, immutable save and execution are separate actions. The editor preserves
authored fields on conflicts, requires visible current-head review before a new
intent, and locks an uncertain save to its identical retry or exact-version
readback. Histories retain bounded metadata and exact older versions remain
addressable. Saving or previewing calls no target or model.

## Versioned authoring contracts

- `custom-eval-item-draft/preview/save/record-v3` describes exact checks.
- `custom-eval-item-ref-v2` and `custom-eval-item-ref-v3` are explicit mixed-member
  references. The v2 family tag is part of the v3 reference; existing v2 draft
  DTOs still use their original untagged member shape.
- `custom-eval-set-draft/preview/save/record-v3` freezes complete mixed item
  contracts, member order and source-record fingerprint provenance.
- `/api/v3/eval-items` and `/api/v3/eval-sets` expose lists, previews, immutable
  saves, current resources and exact `/ID/versions/VERSION` records.

All reads/writes use the existing workspace-session authorization. Viewers can
inspect/preview; owner/admin/editor sessions can save. Project API keys cannot
acquire workspace authorship. This addition makes no API-key scope or auth
policy change. SDK users can consume exported core contracts offline; these
routes do not introduce project-key authoring.

Private `custom_eval_*_v3_` identities use the existing native item/set/version,
membership and audit tables. The item type column already stores text; no schema
migration or grant change is needed. Transactional saves validate complete source
records, compare the exact head, atomically write native membership/audit data,
and read the full committed definition back. Identical retries precede current
head resolution. Generic legacy import/catalogue paths fence both private
families, including corrupt envelopes. Earlier v1/v2 contracts stay strict.

## Matching HTTP plans

`/evals/plans?family=matching` creates a separate `http-target-eval-v3` plan.
It can select saved v1 single-check, v2 contains-composition and v3 mixed-set
versions. Plan family remains fixed after first save. Source contracts, dataset
rows, member proofs, thresholds, target and limits are frozen in the plan.

Execution sends each dataset input once. It evaluates every unique required
item version once per row, while each set retains its complete critical
membership. Exact results use `literal_exact_text_v1`; contains results keep
`case_insensitive_contains_v1`. Expected dataset output and evaluator
configuration never enter the target request. Judge/model calls remain zero.

The existing field → item-row → row → dataset → set → target → criticality → run
gate cascade applies. Missing coverage, uncertain responses and any required
critical failure block affected v3 scopes even at a 0% pass-rate threshold.
Completed/unknown claims cannot be resent. Recovery and immutable readback
reconstruct results and gates from frozen plans and retained events.

V1/v2 plan/run policy, serialized content and fingerprints are compatibility
boundaries; they are not silently upgraded to v3. The shared HTTP API accepts
the explicit v3 plan/save/start tags and preserves its existing approval flow.

## Qualification

See [the focused check scope](proposals/evaluator-matching-checks.md). Local
authored checks established 24 core cases and 18 HTTP cases across preserved
attempts, including original published v1/v2 full-record comparisons. Two HTTP
assertions initially compared JavaScript prototypes; their corrected JSON-wire
comparisons passed without changing scoring behavior. A production build,
20 real disposable PostgreSQL cases and four Chromium scenarios still require
their actual CI receipts. Source publication alone does not establish these.

Hosted database/configuration, provider auth/RLS, real external target transport
and production acceptance remain separate. No production configuration or data
was changed for this feature.

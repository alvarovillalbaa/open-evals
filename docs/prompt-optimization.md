# Prompt Optimization

Last updated: 2026-10-30

The shared lifecycle is:

```text
traces + feedback + eval results
→ failure-pattern discovery
→ optimization opportunity
→ attribution and routing
→ candidate generation
→ candidate review
→ same-manifest evaluation
→ validation
→ blind holdout
→ shadow
→ canary
→ promotion or rejection
→ monitoring
→ rollback
```

Target prompt campaigns cannot mutate their own judges or thresholds. Evaluator optimization is a separate campaign type using human-labeled calibration data.

## Current Instructions request boundary

The [campaign preparation flow](campaign-requests.md) stores a reviewed request
against a saved canonical version, mutable component and objective. Its six
existing deterministic ablation operations remain hypotheses. Preview and save
do not generate candidates or create an `optimization_campaigns` row. History
shows stored decision status without granting execution authority.

This increment adds no approve/reject/start, evaluation, model or release
endpoint. Approver and self-approval policy remain undefined future gates.
The [53-check proposal](proposals/campaign-request-checks.md) is authored and
unrun with temporary CI inactive; see the
[source receipt](results/2026/10-30/campaign-requests.md) for current evidence.

# Experiments and Statistics

Offline comparison uses paired deltas, paired bootstrap confidence intervals, per-dataset effects, critical evaluator effects, win/loss/tie counts, practical minimum effect, multiple-candidate correction hooks, Pareto guardrails, and a valid no-winner decision.

A/B/n assignment uses:

```text
bucket = HMAC(experimentId, assignmentUnitId) % 10_000
```

Exposure is recorded before invoking the target. Online decisions require minimum exposure, minimum duration, guardrails, practical significance, and a predeclared analysis policy.

# Prompt Optimization

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

# Eval Contracts

Eval Items declare supported evaluation units and strict output schemas. Multi-field outputs are persisted as original structured output plus normalized field results, per-field pass/fail, evaluator version, latency, token usage, cost, and concise rationale.

Gate hierarchy:

```text
field result
→ item-row gate
→ row gate
→ dataset pass rate
→ Eval Set gate
→ target gate
→ criticality-group gate
→ overall run gate
```

Diagnostics may help explain a failure, but authoritative decisions come from persisted gate results.

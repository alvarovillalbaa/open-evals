# Terminology

- Trace: imported or live execution record containing spans.
- Span: execution step such as LLM, agent, workflow, tool, retriever, evaluator, guardrail, or custom step.
- Eval Item: evaluator definition. It is not a dataset row.
- Eval Set: versioned collection of Eval Items.
- Dataset Row: versioned test case or historical sample.
- Benchmark: versioned package containing datasets, target requirements, evaluators, license, provenance, and pass rules.
- Target: LLM, agent, workflow, API, MCP server, or provided output being evaluated.
- Run Plan: immutable fully resolved eval specification.
- Prompt Version: immutable prompt/component snapshot.
- Prompt Release: transactional assignment resolving which prompt version is served.
- Optimization Campaign: frozen optimization experiment over incumbent, datasets, evaluators, constraints, and budget.

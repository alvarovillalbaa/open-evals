# MCP

The MCP package exposes safe tools:

- `list_eval_sets`
- `list_datasets`
- `list_targets`
- `create_draft_run_plan`
- `start_eval_run`
- `get_eval_run`
- `compare_prompt_versions`
- `create_draft_optimization_campaign`
- `get_prompt_release`

Mutating or costly operations return `requiresApproval: true`.

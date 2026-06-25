import { Client } from "pg";

const url = process.env.DATABASE_URL ?? "postgres://open_evals:open_evals@127.0.0.1:54329/open_evals";

const client = new Client({ connectionString: url });
await client.connect();
await client.query(`
  insert into workspaces (id, name, mode) values ('ws_demo', 'Demo workspace', 'local')
  on conflict (id) do nothing;
  insert into projects (id, workspace_id, name, environment) values ('proj_demo', 'ws_demo', 'Demo project', 'local')
  on conflict (id) do nothing;
  insert into eval_packs (id, workspace_id, family, name) values ('pack_global', 'ws_demo', 'Global', 'Global quality')
  on conflict (id) do nothing;
  insert into eval_packs (id, workspace_id, family, name) values ('pack_mechanics', 'ws_demo', 'Mechanics', 'Mechanics')
  on conflict (id) do nothing;
  insert into eval_packs (id, workspace_id, family, name) values ('pack_capability', 'ws_demo', 'Capability', 'Reservation capability')
  on conflict (id) do nothing;

  insert into targets (id, workspace_id, project_id, name, kind) values
    ('target_http_demo', 'ws_demo', 'proj_demo', 'HTTP demo target', 'invoke_http_target'),
    ('target_mcp_demo', 'ws_demo', 'proj_demo', 'MCP demo target', 'invoke_mcp_target')
  on conflict (id) do nothing;

  insert into target_versions (id, target_id, version, config, fingerprint) values
    ('target_http_demo_v1', 'target_http_demo', 1, '{"endpoint":"fixture","promptHash":"demo"}', 'target-http-demo-v1'),
    ('target_mcp_demo_v1', 'target_mcp_demo', 1, '{"transport":"fixture"}', 'target-mcp-demo-v1')
  on conflict (target_id, version) do nothing;

  insert into eval_sets (id, workspace_id, name) values
    ('eval_set_global', 'ws_demo', 'Global reservation assistant'),
    ('eval_set_mechanics', 'ws_demo', 'Tool mechanics'),
    ('eval_set_capability', 'ws_demo', 'Reservation capability')
  on conflict (id) do nothing;

  insert into eval_set_versions (id, eval_set_id, version, contract, fingerprint, calibration_state) values
    ('eval_set_global_v1', 'eval_set_global', 1, '{"criticality":"critical"}', 'eval-set-global-v1', 'calibrated'),
    ('eval_set_mechanics_v1', 'eval_set_mechanics', 1, '{"criticality":"standard"}', 'eval-set-mechanics-v1', 'calibrated'),
    ('eval_set_capability_v1', 'eval_set_capability', 1, '{"criticality":"standard"}', 'eval-set-capability-v1', 'calibrated')
  on conflict (eval_set_id, version) do nothing;

  insert into eval_items (id, workspace_id, name, type) values
    ('eval_item_judge', 'ws_demo', 'Reservation assistant quality', 'llm_judge'),
    ('eval_item_string', 'ws_demo', 'Includes self-service', 'string_check'),
    ('eval_item_similarity', 'ws_demo', 'Expected output similarity', 'text_similarity'),
    ('eval_item_trace', 'ws_demo', 'Trace evidence present', 'trace_check')
  on conflict (id) do nothing;

  insert into eval_item_versions (id, eval_item_id, version, output_schema, config, fingerprint, calibration_state) values
    ('eval_item_judge_v1', 'eval_item_judge', 1, '{"fields":[{"key":"groundedness","type":"score"},{"key":"instruction_following","type":"score"},{"key":"safety","type":"score"},{"key":"completeness","type":"score"},{"key":"risk_label","type":"label"},{"key":"failure_type","type":"label"}]}', '{"deterministic":true}', 'judge-v1', 'calibrated'),
    ('eval_item_string_v1', 'eval_item_string', 1, '{"fields":[{"key":"contains_expected","type":"boolean"}]}', '{"contains":"self-service"}', 'string-v1', 'calibrated'),
    ('eval_item_similarity_v1', 'eval_item_similarity', 1, '{"fields":[{"key":"similarity","type":"score"}]}', '{}', 'similarity-v1', 'calibrated'),
    ('eval_item_trace_v1', 'eval_item_trace', 1, '{"fields":[{"key":"trace_present","type":"boolean"}]}', '{}', 'trace-v1', 'calibrated')
  on conflict (eval_item_id, version) do nothing;

  insert into datasets (id, workspace_id, name, kind) values
    ('dataset_historical', 'ws_demo', 'Historical reservation failures', 'historical'),
    ('dataset_golden', 'ws_demo', 'Golden reservation regression rows', 'golden')
  on conflict (id) do nothing;

  insert into dataset_versions (id, dataset_id, version, fingerprint) values
    ('dataset_historical_v1', 'dataset_historical', 1, 'dataset-historical-v1'),
    ('dataset_golden_v1', 'dataset_golden', 1, 'dataset-golden-v1')
  on conflict (dataset_id, version) do nothing;

  insert into dataset_rows (id, dataset_version_id, row_key, input, expected_output, context, metadata, review_status) values
    ('row_golden_001', 'dataset_golden_v1', 'golden-001', '"I need to change reservation CHG123 to tomorrow."', '"Provide a pre-populated self-service link and do not claim completion."', '{"booking_id":"CHG123"}', '{"severity":"critical"}', 'golden'),
    ('row_historical_001', 'dataset_historical_v1', 'historical-001', '"Can you change my booking?"', '"Ask for identifiers, verify eligibility, and avoid claiming completion."', '{"language":"en"}', '{"severity":"critical","outcome":"human_intervention"}', 'reviewed')
  on conflict (dataset_version_id, row_key) do nothing;

  insert into prompt_definitions (id, workspace_id, target_id, stable_key, variable_schema, component_schema) values
    ('prompt_def_reservation', 'ws_demo', 'target_http_demo', 'reservation-agent', '{}', '{"components":["role","decision-rules","tool-rules","safety"]}')
  on conflict (id) do nothing;

  insert into prompt_components (id, prompt_definition_id, stable_key, kind, locked) values
    ('component_role', 'prompt_def_reservation', 'role', 'role', true),
    ('component_decision', 'prompt_def_reservation', 'decision-rules', 'decision_rules', false),
    ('component_tool', 'prompt_def_reservation', 'tool-rules', 'tool_rules', false),
    ('component_safety', 'prompt_def_reservation', 'safety', 'safety', true)
  on conflict (id) do nothing;

  insert into prompt_versions (id, prompt_definition_id, compiled_text, components, parent_version_ids, content_hash, status) values
    ('prompt_v1_baseline', 'prompt_def_reservation', 'You help users safely modify reservations.', '{"components":["role","decision-rules","tool-rules","safety"]}', '{}', 'baseline-demo-hash', 'active'),
    ('prompt_v2_candidate', 'prompt_def_reservation', 'Verify eligibility and provide a pre-populated self-service link without claiming completion.', '{"changed":["decision-rules"]}', '{prompt_v1_baseline}', 'candidate-demo-hash', 'offline_validated')
  on conflict (id) do nothing;

  insert into prompt_releases (id, prompt_definition_id, prompt_version_id, scope_type, scope_id, stage, active, previous_release_id) values
    ('release_active_demo', 'prompt_def_reservation', 'prompt_v1_baseline', 'project', 'proj_demo', 'active', true, null),
    ('release_canary_demo', 'prompt_def_reservation', 'prompt_v2_candidate', 'project', 'proj_demo', 'canary', true, 'release_active_demo')
  on conflict (id) do nothing;

  insert into online_experiments (id, workspace_id, prompt_definition_id, status, assignment_unit, policy) values
    ('experiment_abn_demo', 'ws_demo', 'prompt_def_reservation', 'draft', 'session', '{"primaryMetric":"quality"}')
  on conflict (id) do nothing;

  insert into experiment_arms (id, experiment_id, prompt_version_id, weight) values
    ('arm_control_demo', 'experiment_abn_demo', 'prompt_v1_baseline', 5000),
    ('arm_candidate_demo', 'experiment_abn_demo', 'prompt_v2_candidate', 5000)
  on conflict (id) do nothing;

  insert into rollback_events (id, prompt_release_id, restored_release_id, reason) values
    ('rollback_demo', 'release_canary_demo', 'release_active_demo', 'demo rollback pointer')
  on conflict (id) do nothing;

  insert into benchmarks (id, workspace_id, name, source, license) values
    ('benchmark_gsm8k_mini', 'ws_demo', 'GSM8K mini fixture', 'gsm8k', 'MIT-compatible fixture'),
    ('benchmark_bfcl_mini', 'ws_demo', 'BFCL mini fixture', 'bfcl', 'Apache-2.0 fixture')
  on conflict (id) do nothing;

  insert into benchmark_versions (id, benchmark_id, version, metadata, pass_rules) values
    ('benchmark_gsm8k_mini_v1', 'benchmark_gsm8k_mini', 'mini-v1', '{"taskType":"reasoning","rows":2}', '{"passRate":80}'),
    ('benchmark_bfcl_mini_v1', 'benchmark_bfcl_mini', 'mini-v1', '{"taskType":"tool_calling","rows":2}', '{"toolArgumentAccuracy":80}')
  on conflict (id) do nothing;

  insert into scenario_suites (id, workspace_id, name) values
    ('scenario_suite_reservation', 'ws_demo', 'Reservation self-service scenarios')
  on conflict (id) do nothing;

  insert into scenario_versions (id, suite_id, version, scenario, fingerprint) values
    ('scenario_eligible_self_service_v1', 'scenario_suite_reservation', 1, '{"id":"eligible-self-service","maxUserTurns":6,"maxToolCalls":10}', 'scenario-eligible-self-service-v1')
  on conflict (id) do nothing;
`);
await client.end();
console.log("Seeded demo workspace.");

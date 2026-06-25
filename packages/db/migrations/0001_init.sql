create extension if not exists pgcrypto;

create table if not exists users (
  id text primary key,
  email text unique,
  name text,
  created_at timestamptz not null default now()
);

create table if not exists workspaces (
  id text primary key,
  name text not null,
  mode text not null default 'local',
  created_at timestamptz not null default now()
);

create table if not exists workspace_memberships (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null,
  role text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  primary key (workspace_id, user_id)
);

create table if not exists projects (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  environment text not null,
  created_at timestamptz not null default now()
);

create table if not exists project_api_keys (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  key_hash text not null,
  scope text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists connections (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  kind text not null,
  name text not null,
  config jsonb not null default '{}',
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create table if not exists connection_secrets (
  id text primary key,
  connection_id text not null references connections(id) on delete cascade,
  secret_ref text,
  encrypted_payload bytea,
  created_at timestamptz not null default now()
);

create table if not exists ingest_jobs (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  connection_id text references connections(id),
  kind text not null,
  status text not null,
  idempotency_key text not null,
  preview jsonb,
  error text,
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);

create table if not exists ingest_cursors (
  id text primary key,
  connection_id text references connections(id) on delete cascade,
  cursor text not null,
  state jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists raw_artifacts (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  driver text not null,
  ref text not null,
  content_hash text not null,
  retention_until timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, content_hash)
);

create table if not exists traces (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  project_id text references projects(id) on delete set null,
  source text not null,
  external_trace_id text not null,
  environment text not null,
  target_id text,
  target_version text,
  target_fingerprint text,
  prompt_definition_id text,
  prompt_version_id text,
  prompt_hash text,
  session_id text,
  scope_keys jsonb not null default '{}',
  started_at timestamptz not null,
  ended_at timestamptz,
  status text not null,
  input jsonb,
  output jsonb,
  metadata jsonb not null default '{}',
  tags text[] not null default '{}',
  usage jsonb,
  cost_usd numeric,
  latency_ms integer,
  raw_artifact_id text references raw_artifacts(id) on delete set null,
  canonical_schema_version text not null,
  content_hash text not null,
  redaction_state text not null,
  ingested_at timestamptz not null default now(),
  unique (workspace_id, source, external_trace_id, content_hash)
);

create table if not exists spans (
  id text primary key,
  trace_id text not null references traces(id) on delete cascade,
  external_span_id text not null,
  parent_span_id text,
  kind text not null,
  name text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  status text not null,
  error text,
  input jsonb,
  output jsonb,
  provider text,
  model text,
  model_parameters jsonb not null default '{}',
  messages jsonb,
  usage jsonb,
  cost_usd numeric,
  tool_name text,
  tool_call_id text,
  tool_arguments jsonb,
  tool_result jsonb,
  retrieval_evidence jsonb,
  handoff jsonb,
  attributes jsonb not null default '{}',
  events jsonb not null default '[]',
  links jsonb not null default '[]',
  prompt_version_id text,
  prompt_hash text,
  raw_source_ref text,
  unique (trace_id, external_span_id)
);

create table if not exists span_events (
  id text primary key,
  span_id text not null references spans(id) on delete cascade,
  name text not null,
  event_time timestamptz,
  attributes jsonb not null default '{}'
);

create table if not exists targets (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  project_id text references projects(id) on delete cascade,
  name text not null,
  kind text not null,
  created_at timestamptz not null default now()
);

create table if not exists target_versions (
  id text primary key,
  target_id text not null references targets(id) on delete cascade,
  version integer not null,
  config jsonb not null,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (target_id, version)
);

create table if not exists target_connections (
  target_id text not null references targets(id) on delete cascade,
  connection_id text not null references connections(id) on delete cascade,
  primary key (target_id, connection_id)
);

create table if not exists eval_packs (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  family text not null,
  name text not null
);

create table if not exists eval_sets (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null
);

create table if not exists eval_set_versions (
  id text primary key,
  eval_set_id text not null references eval_sets(id) on delete cascade,
  version integer not null,
  contract jsonb not null,
  fingerprint text not null,
  calibration_state text not null default 'uncalibrated',
  created_at timestamptz not null default now(),
  unique (eval_set_id, version)
);

create table if not exists eval_items (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  type text not null
);

create table if not exists eval_item_versions (
  id text primary key,
  eval_item_id text not null references eval_items(id) on delete cascade,
  version integer not null,
  output_schema jsonb not null,
  config jsonb not null default '{}',
  fingerprint text not null,
  calibration_state text not null default 'uncalibrated',
  created_at timestamptz not null default now(),
  unique (eval_item_id, version)
);

create table if not exists eval_set_item_versions (
  eval_set_version_id text not null references eval_set_versions(id) on delete cascade,
  eval_item_version_id text not null references eval_item_versions(id) on delete restrict,
  position integer not null,
  weight numeric not null default 1,
  criticality text not null,
  primary key (eval_set_version_id, eval_item_version_id)
);

create table if not exists datasets (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  kind text not null
);

create table if not exists dataset_versions (
  id text primary key,
  dataset_id text not null references datasets(id) on delete cascade,
  version integer not null,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (dataset_id, version)
);

create table if not exists dataset_rows (
  id text primary key,
  dataset_version_id text not null references dataset_versions(id) on delete cascade,
  row_key text not null,
  input jsonb not null,
  expected_output jsonb,
  context jsonb,
  history jsonb,
  trace_fixture jsonb,
  metadata jsonb not null default '{}',
  review_status text not null,
  unique (dataset_version_id, row_key)
);

create table if not exists benchmarks (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  source text not null,
  license text not null
);

create table if not exists benchmark_versions (
  id text primary key,
  benchmark_id text not null references benchmarks(id) on delete cascade,
  version text not null,
  metadata jsonb not null,
  pass_rules jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists scenario_suites (id text primary key, workspace_id text not null references workspaces(id), name text not null);
create table if not exists scenario_versions (id text primary key, suite_id text not null references scenario_suites(id), version integer not null, scenario jsonb not null, fingerprint text not null);
create table if not exists context_packs (id text primary key, workspace_id text not null references workspaces(id), name text not null);
create table if not exists run_plans (id text primary key, workspace_id text not null references workspaces(id), resolved_plan jsonb not null, fingerprint text not null unique, created_at timestamptz not null default now());
create table if not exists eval_runs (id text primary key, workspace_id text not null references workspaces(id), run_plan_id text not null references run_plans(id), status text not null, idempotency_key text not null, created_at timestamptz not null default now(), unique (workspace_id, idempotency_key));
create table if not exists run_samples (id text primary key, eval_run_id text not null references eval_runs(id) on delete cascade, row_id text not null, source_kind text not null, snapshot_hash text not null, status text not null, unique (eval_run_id, row_id));
create table if not exists eval_results (id text primary key, eval_run_id text not null references eval_runs(id) on delete cascade, run_sample_id text not null references run_samples(id) on delete cascade, eval_item_version_id text not null, original_output jsonb not null, normalized_fields jsonb not null, error text, unique (eval_run_id, run_sample_id, eval_item_version_id));
create table if not exists gate_results (id text primary key, eval_run_id text not null references eval_runs(id) on delete cascade, level text not null, scope_id text not null, score numeric, passed boolean not null, decision text not null, formula text not null, reasons jsonb not null, fingerprint text not null, unique (eval_run_id, level, scope_id));
create table if not exists calibration_runs (id text primary key, workspace_id text not null references workspaces(id), kind text not null, status text not null, report jsonb not null default '{}');

create table if not exists prompt_definitions (id text primary key, workspace_id text not null references workspaces(id), target_id text references targets(id), stable_key text not null, variable_schema jsonb not null default '{}', component_schema jsonb not null default '{}');
create table if not exists prompt_components (id text primary key, prompt_definition_id text not null references prompt_definitions(id), stable_key text not null, kind text not null, locked boolean not null default false);
create table if not exists prompt_versions (id text primary key, prompt_definition_id text not null references prompt_definitions(id), compiled_text text not null, components jsonb not null, parent_version_ids text[] not null default '{}', content_hash text not null, status text not null, created_at timestamptz not null default now());
create table if not exists prompt_releases (id text primary key, prompt_definition_id text not null references prompt_definitions(id), prompt_version_id text not null references prompt_versions(id), scope_type text not null, scope_id text not null, stage text not null, active boolean not null default true, previous_release_id text, created_at timestamptz not null default now());
create unique index if not exists one_active_prompt_release_per_scope on prompt_releases(prompt_definition_id, scope_type, scope_id, stage) where active;

create table if not exists optimization_campaigns (id text primary key, workspace_id text not null references workspaces(id), incumbent_prompt_version_id text references prompt_versions(id), status text not null, frozen_contract jsonb not null, created_at timestamptz not null default now());
create table if not exists optimization_candidates (id text primary key, campaign_id text not null references optimization_campaigns(id) on delete cascade, prompt_version_id text references prompt_versions(id), generation integer not null, mutation_operator text not null, hypothesis text not null, affected_component_ids text[] not null default '{}', status text not null);
create table if not exists candidate_evaluations (id text primary key, candidate_id text not null references optimization_candidates(id) on delete cascade, eval_run_id text references eval_runs(id), split text not null, report jsonb not null);
create table if not exists online_experiments (id text primary key, workspace_id text not null references workspaces(id), prompt_definition_id text references prompt_definitions(id), status text not null, assignment_unit text not null, policy jsonb not null);
create table if not exists experiment_arms (id text primary key, experiment_id text not null references online_experiments(id) on delete cascade, prompt_version_id text not null references prompt_versions(id), weight integer not null);
create table if not exists experiment_exposures (id text primary key, experiment_id text not null references online_experiments(id), arm_id text not null references experiment_arms(id), prompt_version_id text not null references prompt_versions(id), assignment_unit_id text not null, request_id text not null, assignment_probability numeric not null, created_at timestamptz not null default now(), unique (experiment_id, request_id));
create table if not exists experiment_outcomes (id text primary key, exposure_id text not null references experiment_exposures(id), metric_key text not null, metric_value numeric not null, idempotency_key text not null unique, created_at timestamptz not null default now());
create table if not exists promotion_decisions (id text primary key, candidate_id text references optimization_candidates(id), decision text not null, reason text not null, created_at timestamptz not null default now());
create table if not exists rollback_events (id text primary key, prompt_release_id text references prompt_releases(id), restored_release_id text references prompt_releases(id), reason text not null, created_at timestamptz not null default now());

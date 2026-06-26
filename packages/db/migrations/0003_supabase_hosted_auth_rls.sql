create schema if not exists auth;

do $$
begin
  if not exists (
    select 1
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'auth' and pg_proc.proname = 'uid'
  ) then
    execute 'create function auth.uid() returns uuid language sql stable as ''select null::uuid''';
  end if;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'users',
    'workspaces',
    'workspace_memberships',
    'projects',
    'project_api_keys',
    'connections',
    'connection_secrets',
    'ingest_jobs',
    'ingest_cursors',
    'raw_artifacts',
    'traces',
    'spans',
    'span_events',
    'targets',
    'target_versions',
    'target_connections',
    'eval_packs',
    'eval_sets',
    'eval_set_versions',
    'eval_items',
    'eval_item_versions',
    'eval_set_item_versions',
    'datasets',
    'dataset_versions',
    'dataset_rows',
    'benchmarks',
    'benchmark_versions',
    'scenario_suites',
    'scenario_versions',
    'context_packs',
    'run_plans',
    'eval_runs',
    'run_samples',
    'eval_results',
    'gate_results',
    'calibration_runs',
    'prompt_definitions',
    'prompt_components',
    'prompt_versions',
    'prompt_releases',
    'optimization_campaigns',
    'optimization_candidates',
    'candidate_evaluations',
    'online_experiments',
    'experiment_arms',
    'experiment_exposures',
    'experiment_outcomes',
    'promotion_decisions',
    'rollback_events',
    'workflow_runs',
    'workflow_events',
    'queue_messages',
    'approval_requests',
    'audit_events'
  ] loop
    execute format('alter table if exists %I enable row level security', table_name);
  end loop;
end
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema public from authenticated;
  end if;
end
$$;

do $$
declare
  table_name text;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    return;
  end if;

  foreach table_name in array array[
    'projects',
    'connections',
    'ingest_jobs',
    'raw_artifacts',
    'traces',
    'targets',
    'eval_packs',
    'eval_sets',
    'eval_items',
    'datasets',
    'benchmarks',
    'scenario_suites',
    'context_packs',
    'run_plans',
    'eval_runs',
    'calibration_runs',
    'prompt_definitions',
    'optimization_campaigns',
    'online_experiments',
    'workflow_runs',
    'queue_messages',
    'approval_requests',
    'audit_events'
  ] loop
    execute format('drop policy if exists workspace_member_select on %I', table_name);
    execute format('drop policy if exists workspace_member_insert on %I', table_name);
    execute format('drop policy if exists workspace_member_update on %I', table_name);
    execute format('grant select, insert, update on %I to authenticated', table_name);
    execute format(
      'create policy workspace_member_select on %I for select to authenticated using (exists (select 1 from workspace_memberships where workspace_memberships.workspace_id = %I.workspace_id and workspace_memberships.user_id = (select auth.uid())::text))',
      table_name,
      table_name
    );
    execute format(
      'create policy workspace_member_insert on %I for insert to authenticated with check (exists (select 1 from workspace_memberships where workspace_memberships.workspace_id = %I.workspace_id and workspace_memberships.user_id = (select auth.uid())::text and workspace_memberships.role in (''owner'', ''admin'', ''editor'')))',
      table_name,
      table_name
    );
    execute format(
      'create policy workspace_member_update on %I for update to authenticated using (exists (select 1 from workspace_memberships where workspace_memberships.workspace_id = %I.workspace_id and workspace_memberships.user_id = (select auth.uid())::text and workspace_memberships.role in (''owner'', ''admin'', ''editor''))) with check (exists (select 1 from workspace_memberships where workspace_memberships.workspace_id = %I.workspace_id and workspace_memberships.user_id = (select auth.uid())::text and workspace_memberships.role in (''owner'', ''admin'', ''editor'')))',
      table_name,
      table_name,
      table_name
    );
  end loop;

  grant select on workspace_memberships to authenticated;
  drop policy if exists workspace_memberships_self_select on workspace_memberships;
  create policy workspace_memberships_self_select
    on workspace_memberships
    for select
    to authenticated
    using (user_id = (select auth.uid())::text);

  grant select, update on workspaces to authenticated;
  drop policy if exists workspaces_member_select on workspaces;
  create policy workspaces_member_select
    on workspaces
    for select
    to authenticated
    using (exists (
      select 1
      from workspace_memberships
      where workspace_memberships.workspace_id = workspaces.id
        and workspace_memberships.user_id = (select auth.uid())::text
    ));
  drop policy if exists workspaces_admin_update on workspaces;
  create policy workspaces_admin_update
    on workspaces
    for update
    to authenticated
    using (exists (
      select 1
      from workspace_memberships
      where workspace_memberships.workspace_id = workspaces.id
        and workspace_memberships.user_id = (select auth.uid())::text
        and workspace_memberships.role in ('owner', 'admin')
    ))
    with check (exists (
      select 1
      from workspace_memberships
      where workspace_memberships.workspace_id = workspaces.id
        and workspace_memberships.user_id = (select auth.uid())::text
        and workspace_memberships.role in ('owner', 'admin')
    ));

  grant select, insert, update on users to authenticated;
  drop policy if exists users_self_select on users;
  create policy users_self_select
    on users
    for select
    to authenticated
    using (id = (select auth.uid())::text);
  drop policy if exists users_self_insert on users;
  create policy users_self_insert
    on users
    for insert
    to authenticated
    with check (id = (select auth.uid())::text);
  drop policy if exists users_self_update on users;
  create policy users_self_update
    on users
    for update
    to authenticated
    using (id = (select auth.uid())::text)
    with check (id = (select auth.uid())::text);
end
$$;

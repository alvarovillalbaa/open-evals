create table if not exists auth_accounts (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  provider text not null,
  provider_account_id text not null,
  access_token_ref text,
  refresh_token_ref text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_account_id)
);

create table if not exists auth_sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  session_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table project_api_keys add column if not exists name text not null default 'API key';
alter table project_api_keys add column if not exists key_prefix text not null default 'oe_dev';
alter table project_api_keys add column if not exists scopes text[] not null default '{}';
alter table project_api_keys add column if not exists last_used_at timestamptz;
create unique index if not exists project_api_keys_key_hash_unique on project_api_keys(key_hash);

alter table connection_secrets add column if not exists key_hash text;
alter table connection_secrets alter column encrypted_payload type jsonb using
  case
    when encrypted_payload is null then null
    else jsonb_build_object('legacy', encode(encrypted_payload, 'base64'))
  end;

alter table ingest_jobs add column if not exists cursor_before text;
alter table ingest_jobs add column if not exists cursor_after text;
alter table ingest_jobs add column if not exists report jsonb not null default '{}';

create unique index if not exists ingest_cursor_connection_unique on ingest_cursors(connection_id);

create table if not exists workflow_runs (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  workflow_id text not null,
  subject_id text,
  status text not null,
  idempotency_key text not null,
  input jsonb not null default '{}',
  output jsonb,
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, workflow_id, idempotency_key)
);

create table if not exists workflow_events (
  id text primary key,
  workflow_run_id text not null references workflow_runs(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists queue_messages (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  queue_name text not null,
  status text not null,
  idempotency_key text not null,
  payload jsonb not null default '{}',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  claimed_by text,
  created_at timestamptz not null default now(),
  unique (workspace_id, queue_name, idempotency_key)
);

create table if not exists approval_requests (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  action text not null,
  requester_id text not null,
  status text not null,
  risk text not null,
  summary text not null,
  payload_hash text not null,
  payload_preview jsonb not null default '{}',
  decided_by text,
  decision_reason text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists audit_events (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  actor_user_id text,
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata_hash text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists audit_events_workspace_created_at on audit_events(workspace_id, created_at desc);
create index if not exists workflow_runs_workspace_status on workflow_runs(workspace_id, status);
create index if not exists queue_messages_claim on queue_messages(queue_name, status, available_at);


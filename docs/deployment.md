# Deployment

The intended hosted target is Vercel for `apps/web` and Supabase for Auth and
PostgreSQL. Local development uses PostgreSQL. A successful Vercel build does
not establish database, login or persistence readiness. See the dated
[hosted readiness receipt](results/2026/10-28/hosted-readiness.md).

## Required configuration

The current source reads these values for the Supabase hosted path:

- `AUTH_MODE=hosted`.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` remains a source-supported fallback.
- A private server connection in `DATABASE_URL`, `POSTGRES_URL` or
  `SUPABASE_DB_URL`, in that precedence order.
- Private `API_KEY_PEPPER` for persisted project API keys.
- Private `AUTH_SECRET` for the separately implemented signed-session/OAuth
  path. GitHub OAuth also reads `AUTH_BASE_URL`, `AUTH_GITHUB_ID` and
  `AUTH_GITHUB_SECRET`; it is not a prerequisite for Supabase login.

Keep database credentials, API keys and signing secrets server-only. Public
Supabase keys identify the project and do not replace server authorization.
Configure Auth callbacks for the approved deployment through the provider's
settings workflow before claiming login works.

Project API keys must be persisted, unrevoked, scoped and attached to their
project. Instruction access additionally requires a definition targeted to that
project. `HOSTED_DEMO_API_KEY_HASH` supplies no project ownership and cannot be
used to enable instruction authoring. Hosted local/demo ownership also cannot
write instructions. The [authoring contract](proposals/prompt-authoring-contract.md)
describes the approved access boundary.

## Database enablement gate

Provisioning, migrations, database roles/RLS and production configuration need
owner approval before changes. Inspect the target and existing objects first.
The existing migrations include unqualified application tables and
`0003_supabase_hosted_auth_rls.sql` revokes access to **all tables in public** for
Supabase `anon` and `authenticated` roles before adding application grants.
Do not apply these unchanged to a shared project: they can affect another app.

The earlier disposable PostgreSQL checks establish HTTP/application access and
prompt persistence for their recorded fixtures. They do not establish live
Supabase Auth, browser-role RLS, a least-privilege deployment role, or production
data isolation. After an approved target/configuration is available, those
properties need their own approved verification. Do not treat setup commands
or a READY deployment as evidence that they passed.

## Optional services

Basic builds must not require production credentials. Vercel Blob private
artifacts, AI Gateway judges/authoring, Workflow/Queue/Sandbox adapters and
Python optimizer extras remain optional and capability-gated. Enable their
dependencies, flags, credentials and provider configuration only within an
approved scope. No optional service is required for the deterministic prompt
compiler or the authored SDK/CLI flow.

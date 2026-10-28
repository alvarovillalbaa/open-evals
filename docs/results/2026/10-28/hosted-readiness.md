# Hosted readiness inspection

Date: 2026-10-28. Read-only inspection of OpenEvals source at
[`1ea43b13517c11342cd30bc661134db29ebb8c38`](https://github.com/alvarovillalbaa/open-evals/tree/1ea43b13517c11342cd30bc661134db29ebb8c38).
No provisioning, migration, role/Auth setting, environment update or production
test was performed during this inspection.

## What is known

- The previous [authoring receipt](prompt-authoring.md) records Vercel deployment
  `dpl_71zdKjCGTnbFugEaknHoVFJG86nC` READY at that source. It also records all 58
  approved authoring checks and their disposable-target proof limits.
- Vercel environment **metadata** access for OpenEvals project
  `prj_FG3VAWXbwS6VRHq4Wd2B4vyIms4l`, team `team_JpdIsOJgYNpX0ywVZ54Zdb7m`,
  was denied with HTTP 403. The mapped fallback required a Vercel CLI using its
  own credentials with the same explicit scope. No CLI was found on PATH or in
  the bounded Homebrew, `/usr/local`, NVM or cached-npx binary locations checked.
  No CLI installation, unchanged retry, browser fallback or secret read followed.
  **Environment names and values remain unknown; they are not confirmed absent.**
- The connected Supabase organization is Clous on the free plan. Its project
  list showed Still and Dearweek active/healthy; retired Kickoff,
  ProfessorAssistant and Clinic inactive. The [official billing guide](https://supabase.com/docs/guides/platform/billing-on-supabase)
  states that the free active-project allowance is two across organizations
  where the account is Owner/Admin; paused projects do not count. The observed
  active pair consumes that allowance. The user has declined a paid plan.
- A bounded `pg_catalog.pg_tables` metadata query on Still, restricted to
  `public` and `open_evals`, returned only public `centers`, `documents`,
  `fields`, `mcp_tokens` and `slots`. No user rows were requested. No OpenEvals
  tables were returned in those two schemas; other databases/schemas were not
  searched. This does not establish a live OpenEvals persistence target.

## Next enablement boundary

The existing consolidation approval covers Still/Kickoff only. It does not
authorize adding OpenEvals, pausing another app, changing its Auth, or applying
OpenEvals' migrations to its database. In particular, migration 0003 includes
broad `public` grants/revocations and is unsuitable for unchanged execution on
a shared app target.

Hosted database ownership and safe isolation need a separate concrete design
and approval. Vercel configuration visibility must be restored through the
authorized connector or its mapped CLI fallback before configuration can be
assessed. Continue source work independently; do not infer missing credentials
or launch more free-project creation attempts from this inspection.

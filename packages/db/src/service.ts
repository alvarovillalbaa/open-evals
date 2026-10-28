import { createHash } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonRecord = Record<string, JsonValue>;

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";

export interface HostedUserInput {
  id: string;
  email?: string;
  name?: string;
}

export interface ApiKeyAuthRecord {
  id: string;
  name: string;
  workspaceId: string;
  projectId: string;
  scopes: string[];
  revokedAt?: string;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  mode: string;
  role?: WorkspaceRole;
}

export interface RunBatchSummary {
  id: string;
  runPlanId: string;
  planFingerprint: string;
  status: string;
  createdAt: string;
  runCount: number;
  sampleCount: number;
  resultCount: number;
  failedGateCount: number;
  runs: Array<{ id: string; status: string; createdAt: string; sampleCount: number; resultCount: number }>;
}

export interface RunBatchDetail extends RunBatchSummary {
  plan: JsonRecord;
  samples: Array<Record<string, unknown>>;
  results: Array<Record<string, unknown>>;
  gates: Array<Record<string, unknown>>;
}

export interface BenchmarkCatalog {
  benchmarks: Array<{
    id: string;
    name: string;
    source: string;
    license: string;
    versions: Array<Record<string, unknown>>;
  }>;
  datasets: Array<{
    id: string;
    name: string;
    kind: string;
    versions: Array<Record<string, unknown>>;
  }>;
}

export interface ScenarioCatalog {
  suites: Array<{
    id: string;
    name: string;
    versions: Array<Record<string, unknown>>;
  }>;
  evalSets: Array<{
    id: string;
    name: string;
    versions: Array<Record<string, unknown>>;
  }>;
}

export interface InstructionCatalog {
  definitions: Array<{
    id: string;
    stableKey: string;
    targetId?: string;
    versions: Array<Record<string, unknown>>;
    releases: Array<Record<string, unknown>>;
  }>;
  candidates: Array<Record<string, unknown>>;
  experiments: Array<Record<string, unknown>>;
  releases: Array<Record<string, unknown>>;
}

export interface CampaignCatalog {
  campaigns: Array<Record<string, unknown>>;
}

export interface ImportBatchLike {
  id: string;
  dryRun: boolean;
  traceCount: number;
  traces: CanonicalTraceLike[];
  duplicates: string[];
  checkpoint: { cursor: string };
}

interface CanonicalTraceLike {
  id: string;
  source: string;
  externalTraceId: string;
  workspaceId: string;
  projectId?: string;
  environment: string;
  targetId?: string;
  targetVersion?: string;
  targetFingerprint?: string;
  promptDefinitionId?: string;
  promptVersionId?: string;
  promptHash?: string;
  sessionId?: string;
  scopeKeys: Record<string, string>;
  startedAt: string;
  endedAt?: string;
  status: string;
  input?: unknown;
  output?: unknown;
  metadata: Record<string, unknown>;
  tags: string[];
  usage?: unknown;
  costUsd?: number;
  latencyMs?: number;
  canonicalSchemaVersion: string;
  contentHash: string;
  redactionState: string;
  ingestedAt: string;
  spans: CanonicalSpanLike[];
}

interface CanonicalSpanLike {
  id: string;
  traceId: string;
  externalSpanId: string;
  parentSpanId?: string;
  kind: string;
  name: string;
  startedAt: string;
  endedAt?: string;
  status: string;
  error?: string;
  input?: unknown;
  output?: unknown;
  provider?: string;
  model?: string;
  modelParameters: Record<string, unknown>;
  messages?: unknown;
  usage?: unknown;
  costUsd?: number;
  toolName?: string;
  toolCallId?: string;
  toolArguments?: unknown;
  toolResult?: unknown;
  retrievalEvidence?: unknown;
  handoff?: unknown;
  attributes: Record<string, unknown>;
  events: unknown[];
  links: unknown[];
  promptVersionId?: string;
  promptHash?: string;
  rawSourceRef?: string;
}

export interface BenchmarkImportLike {
  benchmarkId: string;
  benchmarkVersionId: string;
  family: string;
  datasetRows: Array<{
    id: string;
    input: unknown;
    expectedOutput?: unknown;
    context?: unknown;
    history?: unknown;
    trace?: unknown;
    metadata: Record<string, unknown>;
    reviewStatus: string;
  }>;
  evalSet: {
    id: string;
    setId: string;
    name: string;
    itemVersions: Array<{
      item: {
        id: string;
        itemId: string;
        name: string;
        type: string;
        outputSchema: unknown;
        config: Record<string, unknown>;
        version: number;
        fingerprint: string;
      };
      weight: number;
      criticality: string;
    }>;
    gates: unknown;
    fingerprint: string;
  };
  license: string;
  limitations: string[];
  fingerprint: string;
}

export interface PersistedEvalRunInput {
  plan: {
    id: string;
    planFingerprint: string;
    sampleManifest: { rows: Array<{ rowId: string; sourceKind: string; snapshotHash: string }> };
  };
  results: Array<{ id: string; rowId: string; evalItemVersionId: string; originalOutput: unknown; fields: unknown[] }>;
  gates: Array<{ id: string; level: string; scopeId: string; score?: number; passed: boolean; decision: string; formula: string; reasons: unknown; fingerprint: string }>;
  idempotencyKey?: string;
}

export class DatabaseUnavailableError extends Error {
  readonly status = 503;

  constructor(message = "database_unavailable") {
    super(message);
    this.name = "DatabaseUnavailableError";
  }
}

let pool: Pool | undefined;

export function hasDatabaseConfig() {
  return Boolean(databaseUrl());
}

export async function queryRows<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
  try {
    const result = await getPool().query<T>(sql, values);
    return result.rows;
  } catch (error) {
    throw normalizeDatabaseError(error);
  }
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<T | undefined> {
  const rows = await queryRows<T>(sql, values);
  return rows[0];
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw normalizeDatabaseError(error);
  } finally {
    client.release();
  }
}

export async function ensureWorkspaceForHostedUser(user: HostedUserInput): Promise<{ workspaceId: string; role: WorkspaceRole }> {
  if (!user.id) throw new Error("hosted_user_id_required");
  return withTransaction(async (client) => {
    await client.query(
      `
        insert into users (id, email, name)
        values ($1, $2, $3)
        on conflict (id) do update
        set email = coalesce(excluded.email, users.email),
            name = coalesce(excluded.name, users.name)
      `,
      [user.id, user.email ?? null, user.name ?? null]
    );

    const existing = await client.query<{ workspace_id: string; role: WorkspaceRole }>(
      `
        select workspace_id, role
        from workspace_memberships
        where user_id = $1
        order by case role when 'owner' then 1 when 'admin' then 2 when 'editor' then 3 else 4 end
        limit 1
      `,
      [user.id]
    );
    if (existing.rows[0]) return { workspaceId: existing.rows[0].workspace_id, role: existing.rows[0].role };

    const workspaceId = `ws_${shortHash(user.id, 20)}`;
    await client.query(
      `
        insert into workspaces (id, name, mode)
        values ($1, $2, 'hosted')
        on conflict (id) do nothing
      `,
      [workspaceId, user.email ? `${user.email} workspace` : "My workspace"]
    );
    await client.query(
      `
        insert into workspace_memberships (workspace_id, user_id, role)
        values ($1, $2, 'owner')
        on conflict (workspace_id, user_id) do nothing
      `,
      [workspaceId, user.id]
    );
    return { workspaceId, role: "owner" };
  });
}

export async function findApiKeyByHash(keyHash: string): Promise<ApiKeyAuthRecord | undefined> {
  const record = await queryOne<{
    id: string;
    name: string;
    workspaceId: string;
    projectId: string;
    scopes: string[] | null;
    legacyScope: string | null;
    revokedAt: Date | null;
  }>(
    `
      select
        project_api_keys.id,
        project_api_keys.name,
        projects.workspace_id as "workspaceId",
        projects.id as "projectId",
        project_api_keys.scopes,
        project_api_keys.scope as "legacyScope",
        project_api_keys.revoked_at as "revokedAt"
      from project_api_keys
      join projects on projects.id = project_api_keys.project_id
      where project_api_keys.key_hash = $1
      limit 1
    `,
    [keyHash]
  );
  if (!record) return undefined;
  await queryRows("update project_api_keys set last_used_at = now() where id = $1", [record.id]).catch(() => []);
  return {
    id: record.id,
    name: record.name,
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    scopes: record.scopes?.length ? record.scopes : record.legacyScope ? [record.legacyScope] : [],
    revokedAt: record.revokedAt?.toISOString()
  };
}

export async function getWorkspace(workspaceId: string): Promise<WorkspaceRecord | undefined> {
  return queryOne<WorkspaceRecord>("select id, name, mode from workspaces where id = $1", [workspaceId]);
}

export async function listRunBatches(workspaceId: string): Promise<RunBatchSummary[]> {
  const rows = await queryRows<{
    id: string;
    runPlanId: string;
    planFingerprint: string;
    status: string;
    createdAt: Date;
    runCount: string;
    sampleCount: string;
    resultCount: string;
    failedGateCount: string;
    runs: Array<{ id: string; status: string; createdAt: string; sampleCount: number; resultCount: number }>;
  }>(
    `
      select
        run_plans.id,
        run_plans.id as "runPlanId",
        run_plans.fingerprint as "planFingerprint",
        case
          when bool_or(eval_runs.status = 'running') then 'running'
          when bool_or(eval_runs.status = 'failed') then 'failed'
          else coalesce(max(eval_runs.status), 'draft')
        end as status,
        min(eval_runs.created_at) as "createdAt",
        count(distinct eval_runs.id)::text as "runCount",
        count(distinct run_samples.id)::text as "sampleCount",
        count(distinct eval_results.id)::text as "resultCount",
        count(distinct gate_results.id) filter (where gate_results.passed = false)::text as "failedGateCount",
        coalesce(
          jsonb_agg(
            distinct jsonb_build_object(
              'id', eval_runs.id,
              'status', eval_runs.status,
              'createdAt', eval_runs.created_at,
              'sampleCount', coalesce(run_sample_counts.sample_count, 0),
              'resultCount', coalesce(result_counts.result_count, 0)
            )
          ) filter (where eval_runs.id is not null),
          '[]'::jsonb
        ) as runs
      from run_plans
      left join eval_runs on eval_runs.run_plan_id = run_plans.id
      left join run_samples on run_samples.eval_run_id = eval_runs.id
      left join eval_results on eval_results.eval_run_id = eval_runs.id
      left join gate_results on gate_results.eval_run_id = eval_runs.id
      left join lateral (
        select count(*)::int as sample_count from run_samples samples where samples.eval_run_id = eval_runs.id
      ) run_sample_counts on true
      left join lateral (
        select count(*)::int as result_count from eval_results results where results.eval_run_id = eval_runs.id
      ) result_counts on true
      where run_plans.workspace_id = $1
      group by run_plans.id, run_plans.fingerprint
      order by min(eval_runs.created_at) desc nulls last, run_plans.created_at desc
    `,
    [workspaceId]
  );
  return rows.map((row) => ({
    id: row.id,
    runPlanId: row.runPlanId,
    planFingerprint: row.planFingerprint,
    status: row.status,
    createdAt: toIso(row.createdAt),
    runCount: Number(row.runCount),
    sampleCount: Number(row.sampleCount),
    resultCount: Number(row.resultCount),
    failedGateCount: Number(row.failedGateCount),
    runs: row.runs ?? []
  }));
}

export async function getRunBatch(workspaceId: string, batchId: string): Promise<RunBatchDetail | undefined> {
  const row = await queryOne<{
    id: string;
    planFingerprint: string;
    plan: JsonRecord;
    createdAt: Date;
    runs: Array<{ id: string; status: string; createdAt: string; sampleCount: number; resultCount: number }>;
    samples: Array<Record<string, unknown>>;
    results: Array<Record<string, unknown>>;
    gates: Array<Record<string, unknown>>;
  }>(
    `
      select
        run_plans.id,
        run_plans.fingerprint as "planFingerprint",
        run_plans.resolved_plan as plan,
        run_plans.created_at as "createdAt",
        coalesce(
          jsonb_agg(distinct jsonb_build_object('id', eval_runs.id, 'status', eval_runs.status, 'createdAt', eval_runs.created_at)) filter (where eval_runs.id is not null),
          '[]'::jsonb
        ) as runs,
        coalesce(
          jsonb_agg(distinct to_jsonb(run_samples)) filter (where run_samples.id is not null),
          '[]'::jsonb
        ) as samples,
        coalesce(
          jsonb_agg(distinct to_jsonb(eval_results)) filter (where eval_results.id is not null),
          '[]'::jsonb
        ) as results,
        coalesce(
          jsonb_agg(distinct to_jsonb(gate_results)) filter (where gate_results.id is not null),
          '[]'::jsonb
        ) as gates
      from run_plans
      left join eval_runs on eval_runs.run_plan_id = run_plans.id
      left join run_samples on run_samples.eval_run_id = eval_runs.id
      left join eval_results on eval_results.eval_run_id = eval_runs.id
      left join gate_results on gate_results.eval_run_id = eval_runs.id
      where run_plans.workspace_id = $1 and run_plans.id = $2
      group by run_plans.id, run_plans.fingerprint, run_plans.resolved_plan, run_plans.created_at
    `,
    [workspaceId, batchId]
  );
  if (!row) return undefined;
  const runs = row.runs ?? [];
  return {
    id: row.id,
    runPlanId: row.id,
    planFingerprint: row.planFingerprint,
    status: runs.some((run) => run.status === "running") ? "running" : (runs[0]?.status ?? "draft"),
    createdAt: toIso(row.createdAt),
    runCount: runs.length,
    sampleCount: row.samples.length,
    resultCount: row.results.length,
    failedGateCount: row.gates.filter((gate) => gate.passed === false).length,
    runs,
    plan: row.plan,
    samples: row.samples,
    results: row.results,
    gates: row.gates
  };
}

export async function listBenchmarks(workspaceId: string): Promise<BenchmarkCatalog> {
  const [benchmarks, datasets] = await Promise.all([
    queryRows<BenchmarkCatalog["benchmarks"][number]>(
      `
        select
          benchmarks.id,
          benchmarks.name,
          benchmarks.source,
          benchmarks.license,
          coalesce(jsonb_agg(to_jsonb(benchmark_versions) order by benchmark_versions.created_at desc) filter (where benchmark_versions.id is not null), '[]'::jsonb) as versions
        from benchmarks
        left join benchmark_versions on benchmark_versions.benchmark_id = benchmarks.id
        where benchmarks.workspace_id = $1
        group by benchmarks.id
        order by benchmarks.name
      `,
      [workspaceId]
    ),
    queryRows<BenchmarkCatalog["datasets"][number]>(
      `
        select
          datasets.id,
          datasets.name,
          datasets.kind,
          coalesce(jsonb_agg(to_jsonb(dataset_versions) order by dataset_versions.created_at desc) filter (where dataset_versions.id is not null), '[]'::jsonb) as versions
        from datasets
        left join dataset_versions on dataset_versions.dataset_id = datasets.id
        where datasets.workspace_id = $1
        group by datasets.id
        order by datasets.name
      `,
      [workspaceId]
    )
  ]);
  return { benchmarks, datasets };
}

export async function listScenarios(workspaceId: string): Promise<ScenarioCatalog> {
  const [suites, evalSets] = await Promise.all([
    queryRows<ScenarioCatalog["suites"][number]>(
      `
        select
          scenario_suites.id,
          scenario_suites.name,
          coalesce(jsonb_agg(to_jsonb(scenario_versions) order by scenario_versions.version desc) filter (where scenario_versions.id is not null), '[]'::jsonb) as versions
        from scenario_suites
        left join scenario_versions on scenario_versions.suite_id = scenario_suites.id
        where scenario_suites.workspace_id = $1
        group by scenario_suites.id
        order by scenario_suites.name
      `,
      [workspaceId]
    ),
    queryRows<ScenarioCatalog["evalSets"][number]>(
      `
        select
          eval_sets.id,
          eval_sets.name,
          coalesce(jsonb_agg(to_jsonb(eval_set_versions) order by eval_set_versions.version desc) filter (where eval_set_versions.id is not null), '[]'::jsonb) as versions
        from eval_sets
        left join eval_set_versions on eval_set_versions.eval_set_id = eval_sets.id
        where eval_sets.workspace_id = $1
        group by eval_sets.id
        order by eval_sets.name
      `,
      [workspaceId]
    )
  ]);
  return { suites, evalSets };
}

export async function listInstructions(workspaceId: string, projectId?: string): Promise<InstructionCatalog> {
  const [definitions, candidates, experiments, releases] = await Promise.all([
    queryRows<InstructionCatalog["definitions"][number]>(
      `
        select
          prompt_definitions.id,
          prompt_definitions.stable_key as "stableKey",
          prompt_definitions.target_id as "targetId",
          coalesce(
            (select jsonb_agg(jsonb_build_object(
              'id', v.id, 'prompt_definition_id', v.prompt_definition_id,
              'parent_version_ids', v.parent_version_ids, 'content_hash', v.content_hash,
              'status', v.status, 'created_at', v.created_at
            ) order by v.created_at desc, v.id desc)
              from prompt_versions v where v.prompt_definition_id = prompt_definitions.id),
            '[]'::jsonb
          ) as versions,
          coalesce(
            (select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc)
              from prompt_releases r where r.prompt_definition_id = prompt_definitions.id),
            '[]'::jsonb
          ) as releases
        from prompt_definitions
        where prompt_definitions.workspace_id = $1
          and ($2::text is null or exists (
            select 1 from targets t join projects p on p.id = t.project_id and p.workspace_id = t.workspace_id
            where t.id = prompt_definitions.target_id and t.workspace_id = $1 and p.id = $2
          ))
        order by prompt_definitions.stable_key, prompt_definitions.id
      `,
      [workspaceId, projectId ?? null]
    ),
    queryRows(
      `
        select optimization_candidates.*, optimization_campaigns.workspace_id
        from optimization_candidates
        join optimization_campaigns on optimization_campaigns.id = optimization_candidates.campaign_id
        where optimization_campaigns.workspace_id = $1
          and ($2::text is null or exists (
            select 1 from prompt_versions v
            join prompt_definitions d on d.id = v.prompt_definition_id and d.workspace_id = $1
            join targets t on t.id = d.target_id and t.workspace_id = d.workspace_id
            join projects p on p.id = t.project_id and p.workspace_id = d.workspace_id
            where v.id = optimization_candidates.prompt_version_id and p.id = $2
          ))
        order by optimization_candidates.generation desc, optimization_candidates.id
      `,
      [workspaceId, projectId ?? null]
    ),
    queryRows(
      `
        select online_experiments.*
        from online_experiments
        where workspace_id = $1
          and ($2::text is null or exists (
            select 1 from prompt_definitions d
            join targets t on t.id = d.target_id and t.workspace_id = d.workspace_id
            join projects p on p.id = t.project_id and p.workspace_id = d.workspace_id
            where d.id = online_experiments.prompt_definition_id and d.workspace_id = $1 and p.id = $2
          ))
        order by id
      `,
      [workspaceId, projectId ?? null]
    ),
    queryRows(
      `
        select prompt_releases.*
        from prompt_releases
        join prompt_definitions on prompt_definitions.id = prompt_releases.prompt_definition_id
        where prompt_definitions.workspace_id = $1
          and ($2::text is null or exists (
            select 1 from targets t join projects p on p.id = t.project_id and p.workspace_id = t.workspace_id
            where t.id = prompt_definitions.target_id and t.workspace_id = $1 and p.id = $2
          ))
        order by prompt_releases.created_at desc, prompt_releases.id desc
      `,
      [workspaceId, projectId ?? null]
    )
  ]);
  return { definitions, candidates, experiments, releases };
}

export async function listCampaigns(workspaceId: string): Promise<CampaignCatalog> {
  const campaigns = await queryRows(
    `
      select
        optimization_campaigns.*,
        count(optimization_candidates.id)::int as "candidateCount"
      from optimization_campaigns
      left join optimization_candidates on optimization_candidates.campaign_id = optimization_campaigns.id
      where optimization_campaigns.workspace_id = $1
      group by optimization_campaigns.id
      order by optimization_campaigns.created_at desc
    `,
    [workspaceId]
  );
  return { campaigns };
}

export async function persistTraceImport(workspaceId: string, result: ImportBatchLike, sourceKind = "manual_import", projectId?: string) {
  if (result.dryRun) return { ...result, persisted: false, persistedCount: 0 };
  return withTransaction(async (client) => {
    const projectIds = await existingProjectIds(
      client,
      workspaceId,
      [...new Set([projectId, ...result.traces.map((trace) => trace.projectId)].filter((value): value is string => Boolean(value)))]
    );
    await client.query(
      `
        insert into ingest_jobs (id, workspace_id, kind, status, idempotency_key, cursor_after, report)
        values ($1, $2, $3, 'completed', $4, $5, $6::jsonb)
        on conflict (workspace_id, idempotency_key) do update
        set status = excluded.status,
            cursor_after = excluded.cursor_after,
            report = excluded.report
      `,
      [
        result.id,
        workspaceId,
        sourceKind,
        result.id,
        result.checkpoint.cursor,
        JSON.stringify({ traceCount: result.traceCount, duplicates: result.duplicates, sourceKind })
      ]
    );

    let persistedCount = 0;
    for (const trace of result.traces) {
      const safeProjectId = projectIds.has(trace.projectId ?? "") ? trace.projectId : projectIds.has(projectId ?? "") ? projectId : null;
      const inserted = await client.query<{ id: string }>(
        `
          insert into traces (
            id, workspace_id, project_id, source, external_trace_id, environment,
            target_id, target_version, target_fingerprint, prompt_definition_id, prompt_version_id, prompt_hash,
            session_id, scope_keys, started_at, ended_at, status, input, output, metadata, tags, usage,
            cost_usd, latency_ms, canonical_schema_version, content_hash, redaction_state, ingested_at
          )
          values (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11, $12,
            $13, $14::jsonb, $15, $16, $17, $18::jsonb, $19::jsonb, $20::jsonb, $21, $22::jsonb,
            $23, $24, $25, $26, $27, $28
          )
          on conflict (workspace_id, source, external_trace_id, content_hash) do update
          set ingested_at = excluded.ingested_at
          returning id
        `,
        [
          trace.id,
          workspaceId,
          safeProjectId,
          trace.source,
          trace.externalTraceId,
          trace.environment,
          trace.targetId ?? null,
          trace.targetVersion ?? null,
          trace.targetFingerprint ?? null,
          trace.promptDefinitionId ?? null,
          trace.promptVersionId ?? null,
          trace.promptHash ?? null,
          trace.sessionId ?? null,
          JSON.stringify(trace.scopeKeys ?? {}),
          timestamp(trace.startedAt),
          trace.endedAt ? timestamp(trace.endedAt) : null,
          trace.status,
          trace.input === undefined ? null : JSON.stringify(trace.input),
          trace.output === undefined ? null : JSON.stringify(trace.output),
          JSON.stringify(trace.metadata ?? {}),
          trace.tags ?? [],
          trace.usage ? JSON.stringify(trace.usage) : null,
          trace.costUsd ?? null,
          trace.latencyMs ?? null,
          trace.canonicalSchemaVersion,
          trace.contentHash,
          trace.redactionState,
          timestamp(trace.ingestedAt)
        ]
      );
      if (inserted.rowCount) persistedCount += 1;
      for (const span of trace.spans ?? []) {
        await client.query(
          `
            insert into spans (
              id, trace_id, external_span_id, parent_span_id, kind, name, started_at, ended_at, status,
              error, input, output, provider, model, model_parameters, messages, usage, cost_usd,
              tool_name, tool_call_id, tool_arguments, tool_result, retrieval_evidence, handoff,
              attributes, events, links, prompt_version_id, prompt_hash, raw_source_ref
            )
            values (
              $1, $2, $3, $4, $5, $6, $7, $8, $9,
              $10, $11::jsonb, $12::jsonb, $13, $14, $15::jsonb, $16::jsonb, $17::jsonb, $18,
              $19, $20, $21::jsonb, $22::jsonb, $23::jsonb, $24::jsonb,
              $25::jsonb, $26::jsonb, $27::jsonb, $28, $29, $30
            )
            on conflict (trace_id, external_span_id) do nothing
          `,
          [
            span.id,
            trace.id,
            span.externalSpanId,
            span.parentSpanId ?? null,
            span.kind,
            span.name,
            timestamp(span.startedAt),
            span.endedAt ? timestamp(span.endedAt) : null,
            span.status,
            span.error ?? null,
            span.input === undefined ? null : JSON.stringify(span.input),
            span.output === undefined ? null : JSON.stringify(span.output),
            span.provider ?? null,
            span.model ?? null,
            JSON.stringify(span.modelParameters ?? {}),
            span.messages ? JSON.stringify(span.messages) : null,
            span.usage ? JSON.stringify(span.usage) : null,
            span.costUsd ?? null,
            span.toolName ?? null,
            span.toolCallId ?? null,
            span.toolArguments === undefined ? null : JSON.stringify(span.toolArguments),
            span.toolResult === undefined ? null : JSON.stringify(span.toolResult),
            span.retrievalEvidence === undefined ? null : JSON.stringify(span.retrievalEvidence),
            span.handoff === undefined ? null : JSON.stringify(span.handoff),
            JSON.stringify(span.attributes ?? {}),
            JSON.stringify(span.events ?? []),
            JSON.stringify(span.links ?? []),
            span.promptVersionId ?? null,
            span.promptHash ?? null,
            span.rawSourceRef ?? null
          ]
        );
      }
    }
    return { ...result, persisted: true, persistedCount };
  });
}

export async function persistBenchmarkImport(workspaceId: string, result: BenchmarkImportLike) {
  return withTransaction(async (client) => {
    await client.query(
      `
        insert into benchmarks (id, workspace_id, name, source, license)
        values ($1, $2, $3, $4, $5)
        on conflict (id) do update
        set name = excluded.name,
            source = excluded.source,
            license = excluded.license
      `,
      [result.benchmarkId, workspaceId, result.family.toUpperCase(), result.family, result.license]
    );
    await client.query(
      `
        insert into benchmark_versions (id, benchmark_id, version, metadata, pass_rules)
        values ($1, $2, $3, $4::jsonb, $5::jsonb)
        on conflict (id) do nothing
      `,
      [
        result.benchmarkVersionId,
        result.benchmarkId,
        result.benchmarkVersionId.replace(`${result.benchmarkId}_`, ""),
        JSON.stringify({ limitations: result.limitations, fingerprint: result.fingerprint }),
        JSON.stringify(result.evalSet.gates)
      ]
    );

    const datasetId = `dataset_${result.benchmarkVersionId}`;
    const datasetVersionId = `${datasetId}_v1`;
    await client.query(
      `
        insert into datasets (id, workspace_id, name, kind)
        values ($1, $2, $3, 'benchmark')
        on conflict (id) do nothing
      `,
      [datasetId, workspaceId, `${result.family.toUpperCase()} ${result.benchmarkVersionId}`]
    );
    await client.query(
      `
        insert into dataset_versions (id, dataset_id, version, fingerprint)
        values ($1, $2, 1, $3)
        on conflict (id) do nothing
      `,
      [datasetVersionId, datasetId, result.fingerprint]
    );
    for (const row of result.datasetRows) {
      await client.query(
        `
          insert into dataset_rows (id, dataset_version_id, row_key, input, expected_output, context, history, trace_fixture, metadata, review_status)
          values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10)
          on conflict (dataset_version_id, row_key) do nothing
        `,
        [
          `row_${shortHash(`${datasetVersionId}:${row.id}`, 20)}`,
          datasetVersionId,
          row.id,
          JSON.stringify(row.input),
          row.expectedOutput === undefined ? null : JSON.stringify(row.expectedOutput),
          row.context === undefined ? null : JSON.stringify(row.context),
          row.history === undefined ? null : JSON.stringify(row.history),
          row.trace === undefined ? null : JSON.stringify(row.trace),
          JSON.stringify(row.metadata ?? {}),
          row.reviewStatus
        ]
      );
    }

    await client.query(
      `
        insert into eval_sets (id, workspace_id, name)
        values ($1, $2, $3)
        on conflict (id) do nothing
      `,
      [result.evalSet.setId, workspaceId, result.evalSet.name]
    );
    await client.query(
      `
        insert into eval_set_versions (id, eval_set_id, version, contract, fingerprint)
        values ($1, $2, 1, $3::jsonb, $4)
        on conflict (id) do nothing
      `,
      [result.evalSet.id, result.evalSet.setId, JSON.stringify(result.evalSet), result.evalSet.fingerprint]
    );
    for (let index = 0; index < result.evalSet.itemVersions.length; index += 1) {
      const itemVersion = result.evalSet.itemVersions[index]!;
      await client.query(
        `
          insert into eval_items (id, workspace_id, name, type)
          values ($1, $2, $3, $4)
          on conflict (id) do nothing
        `,
        [itemVersion.item.itemId, workspaceId, itemVersion.item.name, itemVersion.item.type]
      );
      await client.query(
        `
          insert into eval_item_versions (id, eval_item_id, version, output_schema, config, fingerprint)
          values ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
          on conflict (id) do nothing
        `,
        [
          itemVersion.item.id,
          itemVersion.item.itemId,
          itemVersion.item.version,
          JSON.stringify(itemVersion.item.outputSchema),
          JSON.stringify(itemVersion.item.config),
          itemVersion.item.fingerprint
        ]
      );
      await client.query(
        `
          insert into eval_set_item_versions (eval_set_version_id, eval_item_version_id, position, weight, criticality)
          values ($1, $2, $3, $4, $5)
          on conflict (eval_set_version_id, eval_item_version_id) do nothing
        `,
        [result.evalSet.id, itemVersion.item.id, index, itemVersion.weight, itemVersion.criticality]
      );
    }
    return { ...result, persisted: true };
  });
}

export async function persistEvalRun(workspaceId: string, input: PersistedEvalRunInput) {
  const idempotencyKey = input.idempotencyKey ?? `eval_run:${input.plan.planFingerprint}`;
  return withTransaction(async (client) => {
    const planResult = await client.query<{ id: string }>(
      `
        insert into run_plans (id, workspace_id, resolved_plan, fingerprint)
        values ($1, $2, $3::jsonb, $4)
        on conflict (fingerprint) do update
        set resolved_plan = run_plans.resolved_plan
        returning id
      `,
      [input.plan.id, workspaceId, JSON.stringify(input.plan), input.plan.planFingerprint]
    );
    const runPlanId = planResult.rows[0]!.id;
    const runId = `run_${shortHash(`${workspaceId}:${idempotencyKey}`, 20)}`;
    const runResult = await client.query<{ id: string }>(
      `
        insert into eval_runs (id, workspace_id, run_plan_id, status, idempotency_key)
        values ($1, $2, $3, 'completed', $4)
        on conflict (workspace_id, idempotency_key) do update
        set status = excluded.status
        returning id
      `,
      [runId, workspaceId, runPlanId, idempotencyKey]
    );
    const evalRunId = runResult.rows[0]!.id;
    const sampleIds = new Map<string, string>();
    for (const sample of input.plan.sampleManifest.rows) {
      const sampleId = `sample_${shortHash(`${evalRunId}:${sample.rowId}`, 20)}`;
      sampleIds.set(sample.rowId, sampleId);
      await client.query(
        `
          insert into run_samples (id, eval_run_id, row_id, source_kind, snapshot_hash, status)
          values ($1, $2, $3, $4, $5, 'completed')
          on conflict (eval_run_id, row_id) do update
          set status = excluded.status
        `,
        [sampleId, evalRunId, sample.rowId, sample.sourceKind, sample.snapshotHash]
      );
    }
    for (const result of input.results) {
      const sampleId = sampleIds.get(result.rowId);
      if (!sampleId) continue;
      await client.query(
        `
          insert into eval_results (id, eval_run_id, run_sample_id, eval_item_version_id, original_output, normalized_fields)
          values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
          on conflict (eval_run_id, run_sample_id, eval_item_version_id) do update
          set original_output = excluded.original_output,
              normalized_fields = excluded.normalized_fields
        `,
        [result.id, evalRunId, sampleId, result.evalItemVersionId, JSON.stringify(result.originalOutput), JSON.stringify(result.fields)]
      );
    }
    for (const gate of input.gates) {
      await client.query(
        `
          insert into gate_results (id, eval_run_id, level, scope_id, score, passed, decision, formula, reasons, fingerprint)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
          on conflict (eval_run_id, level, scope_id) do update
          set score = excluded.score,
              passed = excluded.passed,
              decision = excluded.decision,
              formula = excluded.formula,
              reasons = excluded.reasons,
              fingerprint = excluded.fingerprint
        `,
        [gate.id, evalRunId, gate.level, gate.scopeId, gate.score ?? null, gate.passed, gate.decision, gate.formula, JSON.stringify(gate.reasons), gate.fingerprint]
      );
    }
    return { runId: evalRunId, runPlanId, sampleCount: input.plan.sampleManifest.rows.length, resultCount: input.results.length, gateCount: input.gates.length };
  });
}

export function isDatabaseUnavailable(error: unknown): error is DatabaseUnavailableError {
  return error instanceof DatabaseUnavailableError || (error instanceof Error && error.message === "database_unavailable");
}

function getPool() {
  const url = databaseUrl();
  if (!url) throw new DatabaseUnavailableError("database_url_not_configured");
  pool ??= new Pool({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === "true" || process.env.SUPABASE_DB_SSL === "true" ? { rejectUnauthorized: false } : undefined
  });
  return pool;
}

function databaseUrl() {
  return process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.SUPABASE_DB_URL;
}

function normalizeDatabaseError(error: unknown) {
  if (error instanceof DatabaseUnavailableError) return error;
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code);
    if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT") return new DatabaseUnavailableError("database_unavailable");
  }
  return error;
}

async function existingProjectIds(client: PoolClient, workspaceId: string, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const result = await client.query<{ id: string }>("select id from projects where workspace_id = $1 and id = any($2)", [workspaceId, ids]);
  return new Set(result.rows.map((row) => row.id));
}

function timestamp(value: string) {
  if (/^\d{16,}$/.test(value)) {
    try {
      return new Date(Number(BigInt(value) / BigInt(1000000))).toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function shortHash(value: unknown, length = 16) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex").slice(0, length);
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

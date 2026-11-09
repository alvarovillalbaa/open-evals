import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test as base, expect, type Browser, type BrowserContext, type TestInfo } from "@playwright/test";
import type { ProvidedOutputRunRecord } from "@open-evals/core";

const COHORT = "open-evals-provided-output-browser-20261109";
const MARKER = "open-evals-provided-output-20261109-created-disposable-v1";
const SECRET = "authored_open_evals_provided_output_20261109_fixture_only";
const PEPPER = "authored_provided_output_browser_pepper_20261109_fixture_only";

interface Client {
  connect(): Promise<void>;
  end(): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export interface RunSnapshot {
  counts: { plans: number; runs: number; samples: number; results: number; gates: number; audits: number };
  records: ProvidedOutputRunRecord[];
  audits: Array<{ resourceId: string; actorId: string; metadata: Record<string, unknown> }>;
}

export interface SeededEvalSet {
  setId: string;
  versionIds: string[];
  firstFingerprint: string;
}

export interface OwnedProvidedOutputFixture {
  baseUrl: string;
  workspaceId: string;
  datasetVersionId: string;
  rowIds: readonly [string, string];
  apiKey: string;
  seedEvalSet(count?: number): Promise<SeededEvalSet>;
  snapshot(): Promise<RunSnapshot>;
  mutateSource(marker: string): Promise<void>;
  viewerContext(browser: Browser): Promise<BrowserContext>;
  attachSnapshot(name: string): Promise<void>;
}

function settings() {
  assert.equal(process.env.PROVIDED_OUTPUT_BROWSER_ALLOW, "owned-disposable");
  assert.equal(process.env.AUTH_SECRET, SECRET);
  assert.equal(process.env.API_KEY_PEPPER, PEPPER);
  let app: URL, database: URL;
  try {
    app = new URL(process.env.PROVIDED_OUTPUT_BROWSER_BASE_URL ?? "");
    database = new URL(process.env.PROVIDED_OUTPUT_BROWSER_DATABASE_URL ?? "");
  } catch { throw new Error("explicit owned loopback URLs required"); }
  assert.equal(app.origin, "http://127.0.0.1:4173");
  assert.ok(["", "/"].includes(app.pathname) && !app.username && !app.password && !app.search && !app.hash);
  assert.ok(["postgres:", "postgresql:"].includes(database.protocol));
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.port, "65432");
  assert.equal(database.username, "postgres");
  assert.match(database.pathname, /^\/oe_provided_output_test_[a-z0-9_]{1,48}$/);
  assert.equal(database.search, "");
  assert.equal(database.hash, "");
  return { baseUrl: app.origin, databaseUrl: database.toString(), databaseName: database.pathname.slice(1) };
}

async function verify(client: Client, name: string) {
  const rows = (await client.query<{ name: string; marker: string; owner: string; actor: string; address: string }>(
    `select current_database() as name, shobj_description(d.oid, 'pg_database') as marker,
      pg_get_userbyid(d.datdba) as owner, current_user as actor, host(inet_server_addr()) as address
      from pg_database d where d.datname = current_database()`
  )).rows;
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.ok(row);
  assert.equal(row.name, name); assert.equal(row.marker, MARKER);
  assert.equal(row.owner, "postgres"); assert.equal(row.actor, "postgres");
  assert.ok(["127.0.0.1", "::ffff:127.0.0.1"].includes(row.address));
  const names = ["users", "workspaces", "workspace_memberships", "datasets", "dataset_versions", "dataset_rows",
    "eval_sets", "eval_set_versions", "eval_items", "eval_item_versions", "eval_set_item_versions", "run_plans",
    "eval_runs", "run_samples", "eval_results", "gate_results", "audit_events", "projects", "project_api_keys"];
  const tables = (await client.query<{ name: string; relation: string }>(
    "select name, to_regclass('public.' || name)::text as relation from unnest($1::text[]) name", [names]
  )).rows;
  assert.equal(tables.length, names.length);
  assert.ok(tables.every(table => table.name === table.relation), "unchanged migrations required before fixture writes");
}

// The actual app verifies this authored signed-session wire; no Auth module is mocked.
function cookie(baseUrl: string, workspaceId: string, userId: string, role: "owner" | "viewer") {
  const expiresAt = Date.now() + 20 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ userId, workspaceId, role, expiresAt })).toString("base64url");
  const signature = createHmac("sha256", SECRET).update(payload).digest("base64url");
  return { name: "open_evals_session", value: `${payload}.${signature}`, url: baseUrl,
    httpOnly: true, secure: false, sameSite: "Lax" as const, expires: Math.floor(expiresAt / 1000) };
}

function emptyCounts() { return { plans: 0, runs: 0, samples: 0, results: 0, gates: 0, audits: 0 }; }

async function snapshot(client: Client, workspaceId: string): Promise<RunSnapshot> {
  const counts = (await client.query<RunSnapshot["counts"]>(`select
    (select count(*)::int from run_plans where workspace_id = $1) as plans,
    (select count(*)::int from eval_runs where workspace_id = $1) as runs,
    (select count(*)::int from run_samples s join eval_runs r on r.id = s.eval_run_id where r.workspace_id = $1) as samples,
    (select count(*)::int from eval_results s join eval_runs r on r.id = s.eval_run_id where r.workspace_id = $1) as results,
    (select count(*)::int from gate_results s join eval_runs r on r.id = s.eval_run_id where r.workspace_id = $1) as gates,
    (select count(*)::int from audit_events where workspace_id = $1 and action = 'provided_output.run.saved') as audits`, [workspaceId])).rows[0];
  assert.ok(counts);
  const records = (await client.query<{ record: ProvidedOutputRunRecord }>(
    "select resolved_plan as record from run_plans where workspace_id = $1 order by id", [workspaceId]
  )).rows.map(row => row.record);
  const audits = (await client.query<RunSnapshot["audits"][number]>(
    `select resource_id as "resourceId", actor_user_id as "actorId", metadata from audit_events
      where workspace_id = $1 and action = 'provided_output.run.saved' order by id`, [workspaceId]
  )).rows;
  return { counts, records, audits };
}

async function attach(info: TestInfo, name: string, value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  assert.ok(body.length <= 16 * 1024, "bounded authored observation attachment");
  await info.attach(name, { body, contentType: "application/json" });
}

export const test = base.extend<{ owned: OwnedProvidedOutputFixture }>({
  owned: async ({ context }, use, info) => {
    const config = settings();
    const { Client: PgClient } = createRequire(new URL("../../packages/db/package.json", import.meta.url))("pg");
    const client: Client = new PgClient({ connectionString: config.databaseUrl, ssl: false,
      application_name: `${COHORT}-${info.testId}`, connectionTimeoutMillis: 5000,
      statement_timeout: 10000, query_timeout: 12000, options: "-c search_path=public" });
    const workspaceId = randomUUID(), actorId = randomUUID(), identity = randomUUID();
    const workspaceName = `${COHORT}:${identity}`;
    const datasetId = `provided_dataset_${identity}`, datasetVersionId = `${datasetId}_v1`;
    const rowIds = [`${datasetId}_alpha`, `${datasetId}_beta`] as const;
    const projectId = randomUUID(), keyId = randomUUID();
    const apiKey = `oe_browser_${identity}.${randomUUID()}`;
    const actors = new Map<string, { name: string; role: "owner" | "viewer" }>();
    const peers: BrowserContext[] = [];
    let created = false;
    await client.connect();
    try {
      await verify(client, config.databaseName);
      await client.query("begin");
      try {
        await client.query("insert into workspaces (id, name, mode) values ($1, $2, 'hosted')", [workspaceId, workspaceName]);
        const actorName = `${workspaceName}:${actorId}`;
        await client.query("insert into users (id, email, name) values ($1, $2, $3)", [actorId, `${actorId}@owned-browser.invalid`, actorName]);
        await client.query("insert into workspace_memberships (workspace_id, user_id, role) values ($1, $2, 'owner')", [workspaceId, actorId]);
        await client.query("insert into projects (id, workspace_id, name, environment) values ($1, $2, $3, 'authored-test')", [projectId, workspaceId, workspaceName]);
        await client.query(`insert into project_api_keys (id, project_id, key_hash, scope, name, key_prefix, scopes)
          values ($1, $2, $3, 'admin', $4, 'oe_browser', $5::text[])`,
        [keyId, projectId, createHmac("sha256", PEPPER).update(apiKey).digest("hex"), workspaceName, ["admin", "evals:read", "evals:write"]]);
        await client.query("insert into datasets (id, workspace_id, name, kind) values ($1, $2, 'Authored browser inputs', 'custom')", [datasetId, workspaceId]);
        await client.query("insert into dataset_versions (id, dataset_id, version, fingerprint) values ($1, $2, 1, $3)",
          [datasetVersionId, datasetId, createHash("sha256").update(`authored-source:${identity}`).digest("hex")]);
        await client.query(`insert into dataset_rows (id, dataset_version_id, row_key, input, expected_output, context, history, trace_fixture, metadata, review_status)
          values ($1, $3, 'Alpha', $4::jsonb, 'null'::jsonb, null, '[0,false,""]'::jsonb, null, $6::jsonb, 'golden'),
                 ($2, $3, 'Beta', $5::jsonb, '"approved"'::jsonb, 'false'::jsonb, 'null'::jsonb, null, $6::jsonb, 'reviewed')`,
        [rowIds[0], rowIds[1], datasetVersionId, JSON.stringify({ prompt: "Authored alpha", nested: [0, false, "", null], unicode: "🧭" }),
          JSON.stringify({ prompt: "Authored beta", zero: 0, enabled: false }), JSON.stringify({ source: COHORT, zero: 0, flag: false, next: null })]);
        await client.query("commit");
        actors.set(actorId, { name: actorName, role: "owner" });
        created = true;
      } catch (error) { await client.query("rollback"); throw error; }
      await context.addCookies([cookie(config.baseUrl, workspaceId, actorId, "owner")]);
      const owned: OwnedProvidedOutputFixture = {
        baseUrl: config.baseUrl, workspaceId, datasetVersionId, rowIds, apiKey,
        async seedEvalSet(count = 1) {
          assert.ok(Number.isInteger(count) && count >= 1 && count <= 21);
          const setId = randomUUID(), versionIds: string[] = [];
          let expectedVersionId: string | null = null, firstFingerprint = "";
          for (let version = 1; version <= count; version += 1) {
            const versionId = randomUUID();
            const response = await context.request.post(`${config.baseUrl}/api/v1/eval-sets`, { maxRedirects: 0, data: {
              schemaVersion: "custom-eval-set-draft-v1", setId, versionId, version, expectedVersionId,
              name: `Authored evaluator version ${version}`, contains: "approved", datasetPassRateThreshold: 50
            } });
            assert.equal(response.status(), 201, "actual custom-set save required for browser source");
            const value = await response.json();
            assert.equal(value.version.id, versionId);
            assert.equal(value.version.version, version);
            if (version === 1) firstFingerprint = value.version.fingerprint;
            versionIds.push(versionId); expectedVersionId = versionId;
          }
          return { setId, versionIds, firstFingerprint };
        },
        snapshot: () => snapshot(client, workspaceId),
        async mutateSource(marker) {
          assert.match(marker, /^[A-Z0-9_]{1,80}$/);
          const rows = (await client.query(`update dataset_rows r set input = jsonb_set(r.input, '{mutation}', to_jsonb($3::text))
            from dataset_versions v join datasets d on d.id = v.dataset_id
            where r.dataset_version_id = v.id and d.workspace_id = $1 and r.id = $2 returning r.id`, [workspaceId, rowIds[0], marker])).rows;
          assert.deepEqual(rows, [{ id: rowIds[0] }]);
        },
        async viewerContext(browser) {
          const userId = randomUUID(), name = `${workspaceName}:${userId}`;
          await client.query("begin");
          try {
            await client.query("insert into users (id, email, name) values ($1, $2, $3)", [userId, `${userId}@owned-browser.invalid`, name]);
            await client.query("insert into workspace_memberships (workspace_id, user_id, role) values ($1, $2, 'viewer')", [workspaceId, userId]);
            await client.query("commit"); actors.set(userId, { name, role: "viewer" });
          } catch (error) { await client.query("rollback"); throw error; }
          const peer = await browser.newContext({ baseURL: config.baseUrl, viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
          peers.push(peer);
          await peer.addCookies([cookie(config.baseUrl, workspaceId, userId, "viewer")]);
          return peer;
        },
        async attachSnapshot(name) {
          const data = await snapshot(client, workspaceId);
          await attach(info, name, { schemaVersion: "provided-output-browser-observation-v1", workspaceId,
            counts: data.counts, records: data.records.map(record => ({ runId: record.plan.publicRunId,
              planFingerprint: record.plan.fingerprint, recordFingerprint: record.fingerprint,
              datasetVersionId: record.plan.dataset.version.id, evalSetVersionId: record.plan.evalSet.contract.id,
              outputs: record.plan.draft.outputs, gateLevels: [...new Set(record.execution.gates.map(gate => gate.level))] })),
            auditResourceIds: data.audits.map(audit => audit.resourceId) });
        }
      };
      await use(owned);
    } finally {
      try {
        for (const peer of peers) await peer.close();
        if (created) {
          await verify(client, config.databaseName);
          await client.query("begin");
          try {
            assert.deepEqual((await client.query("select name from workspaces where id = $1 for update", [workspaceId])).rows, [{ name: workspaceName }]);
            const expectedActors = [...actors.entries()].sort(([a], [b]) => a.localeCompare(b));
            assert.deepEqual((await client.query('select user_id as id, role from workspace_memberships where workspace_id = $1 order by user_id', [workspaceId])).rows,
              expectedActors.map(([id, actor]) => ({ id, role: actor.role })));
            assert.deepEqual((await client.query("select id, name from users where id = any($1::text[]) order by id", [[...actors.keys()]])).rows,
              expectedActors.map(([id, actor]) => ({ id, name: actor.name })));
            assert.deepEqual((await client.query("select id, name from projects where workspace_id = $1", [workspaceId])).rows, [{ id: projectId, name: workspaceName }]);
            const before = await snapshot(client, workspaceId);
            await client.query("delete from eval_runs where workspace_id = $1", [workspaceId]);
            await client.query("delete from run_plans where workspace_id = $1", [workspaceId]);
            await client.query("delete from eval_sets where workspace_id = $1", [workspaceId]);
            await client.query("delete from eval_items where workspace_id = $1", [workspaceId]);
            await client.query("delete from datasets where workspace_id = $1", [workspaceId]);
            await client.query("delete from projects where workspace_id = $1", [workspaceId]);
            await client.query("delete from audit_events where workspace_id = $1", [workspaceId]);
            const after = await snapshot(client, workspaceId);
            assert.deepEqual(after.counts, emptyCounts());
            for (const table of ["eval_sets", "eval_items", "datasets", "projects", "audit_events"]) {
              assert.equal((await client.query(`select id from ${table} where workspace_id = $1`, [workspaceId])).rows.length, 0);
            }
            await client.query("delete from workspace_memberships where workspace_id = $1", [workspaceId]);
            await client.query("delete from workspaces where id = $1 and name = $2", [workspaceId, workspaceName]);
            await client.query("delete from users where id = any($1::text[])", [[...actors.keys()]]);
            assert.equal((await client.query("select id from workspaces where id = $1", [workspaceId])).rows.length, 0);
            assert.equal((await client.query("select id from users where id = any($1::text[])", [[...actors.keys()]])).rows.length, 0);
            await client.query("commit");
            await attach(info, "owned-fixture-cleanup", { schemaVersion: "provided-output-browser-cleanup-v1", status: "removed",
              workspaceId, actorCount: actors.size, ownershipValidated: true, before: before.counts, after: after.counts,
              workspaceAbsent: true, actorsAbsent: true });
          } catch (error) { await client.query("rollback"); throw error; }
        }
      } finally { await client.end(); }
    }
  }
});

export { expect };
export async function expectNoRuns(owned: OwnedProvidedOutputFixture) { expect((await owned.snapshot()).counts).toEqual(emptyCounts()); }
export async function expectOneRun(owned: OwnedProvidedOutputFixture, record: ProvidedOutputRunRecord) {
  const data = await owned.snapshot();
  expect(data.counts).toEqual({ plans: 1, runs: 1, samples: record.plan.dataset.rows.length,
    results: record.execution.results.length, gates: record.execution.gates.length, audits: 1 });
  expect(data.records).toEqual([record]);
  expect(data.audits).toHaveLength(1);
  expect(data.audits[0]?.resourceId).toBe(record.plan.runId);
  return data;
}

import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test as base, expect, type Browser, type BrowserContext, type TestInfo } from "@playwright/test";
import type { CustomDatasetDraft, CustomDatasetVersionRecord, ProvidedOutputRunRecord } from "@open-evals/core";

const COHORT = "open-evals-custom-datasets-browser-20261109";
const MARKER = "open-evals-custom-datasets-20261109-created-disposable-v1";
const SECRET = "authored_open_evals_custom_datasets_20261109_fixture_only";
const PEPPER = "authored_custom_dataset_browser_pepper_20261109_fixture_only";

interface Client {
  connect(): Promise<void>;
  end(): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
}
export interface DatasetCounts {
  datasets: number; versions: number; rows: number; datasetAudits: number;
  plans: number; runs: number; samples: number; results: number; gates: number; runAudits: number;
  evalSets: number; evalItems: number;
}
interface StoredRow {
  versionId: string; id: string; rowKey: string; input: unknown; expectedOutput: unknown; expectedPresent: boolean;
  context: unknown; contextPresent: boolean; history: unknown; historyPresent: boolean;
  traceFixture: unknown; tracePresent: boolean; metadata: Record<string, unknown>; reviewStatus: string;
}
export interface DatasetObservation {
  counts: DatasetCounts;
  datasets: Array<{ id: string; name: string; kind: string }>;
  versions: Array<{ id: string; datasetId: string; version: number; fingerprint: string; createdAt: Date | string }>;
  rows: StoredRow[];
  audits: Array<{ actorId: string; resourceId: string; metadataHash: string; metadata: unknown }>;
  runs: ProvidedOutputRunRecord[];
}
export interface OwnedCustomDatasetFixture {
  baseUrl: string; workspaceId: string; actorId: string; apiKey: string;
  snapshot(): Promise<DatasetObservation>;
  saveDataset(sourceText: string, name?: string): Promise<CustomDatasetVersionRecord>;
  append(record: CustomDatasetVersionRecord, sourceText: string): Promise<CustomDatasetVersionRecord>;
  seedLegacyDataset(): Promise<{ id: string; name: string; versionId: string }>;
  seedEvalSet(): Promise<string>;
  viewerContext(browser: Browser): Promise<BrowserContext>;
  attachSnapshot(name: string): Promise<void>;
}

function settings() {
  assert.equal(process.env.CUSTOM_DATASET_BROWSER_ALLOW, "owned-disposable");
  assert.equal(process.env.AUTH_SECRET, SECRET); assert.equal(process.env.API_KEY_PEPPER, PEPPER);
  let app: URL, database: URL;
  try {
    app = new URL(process.env.CUSTOM_DATASET_BROWSER_BASE_URL ?? "");
    database = new URL(process.env.CUSTOM_DATASET_BROWSER_DATABASE_URL ?? "");
  } catch { throw new Error("explicit owned loopback URLs required"); }
  assert.equal(app.origin, "http://127.0.0.1:4173");
  assert.ok(["", "/"].includes(app.pathname) && !app.username && !app.password && !app.search && !app.hash);
  assert.ok(["postgres:", "postgresql:"].includes(database.protocol));
  assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "65432"); assert.equal(database.username, "postgres");
  assert.match(database.pathname, /^\/oe_custom_datasets_test_[a-z0-9_]{1,48}$/);
  assert.equal(database.search, ""); assert.equal(database.hash, "");
  return { baseUrl: app.origin, databaseUrl: database.toString(), databaseName: database.pathname.slice(1) };
}

async function verify(client: Client, name: string) {
  const rows = (await client.query<{ name: string; marker: string; owner: string; actor: string; address: string }>(
    `select current_database() as name, shobj_description(d.oid, 'pg_database') as marker,
      pg_get_userbyid(d.datdba) as owner, current_user as actor, host(inet_server_addr()) as address
      from pg_database d where d.datname = current_database()`
  )).rows;
  assert.equal(rows.length, 1); const row = rows[0]; assert.ok(row);
  assert.equal(row.name, name); assert.equal(row.marker, MARKER); assert.equal(row.owner, "postgres"); assert.equal(row.actor, "postgres");
  assert.ok(["127.0.0.1", "::ffff:127.0.0.1"].includes(row.address));
  const names = ["users", "workspaces", "workspace_memberships", "projects", "project_api_keys", "datasets", "dataset_versions", "dataset_rows",
    "eval_sets", "eval_set_versions", "eval_items", "eval_item_versions", "eval_set_item_versions", "run_plans", "eval_runs",
    "run_samples", "eval_results", "gate_results", "audit_events", "auth_sessions", "auth_accounts"];
  const tables = (await client.query<{ name: string; relation: string }>("select name, to_regclass('public.' || name)::text as relation from unnest($1::text[]) name", [names])).rows;
  assert.equal(tables.length, names.length); assert.ok(tables.every(table => table.name === table.relation), "unchanged migrations required before fixture writes");
}

function cookie(baseUrl: string, workspaceId: string, userId: string, role: "owner" | "viewer") {
  const expiresAt = Date.now() + 20 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ userId, workspaceId, role, expiresAt })).toString("base64url");
  const signature = createHmac("sha256", SECRET).update(payload).digest("base64url");
  return { name: "open_evals_session", value: `${payload}.${signature}`, url: baseUrl,
    httpOnly: true, secure: false, sameSite: "Lax" as const, expires: Math.floor(expiresAt / 1000) };
}
export function emptyCounts(): DatasetCounts {
  return { datasets: 0, versions: 0, rows: 0, datasetAudits: 0, plans: 0, runs: 0, samples: 0, results: 0, gates: 0, runAudits: 0, evalSets: 0, evalItems: 0 };
}
async function snapshot(client: Client, workspaceId: string): Promise<DatasetObservation> {
  const counts = (await client.query<DatasetCounts>(`select
    (select count(*)::int from datasets where workspace_id = $1) as datasets,
    (select count(*)::int from dataset_versions v join datasets d on d.id = v.dataset_id where d.workspace_id = $1) as versions,
    (select count(*)::int from dataset_rows r join dataset_versions v on v.id = r.dataset_version_id join datasets d on d.id = v.dataset_id where d.workspace_id = $1) as rows,
    (select count(*)::int from audit_events where workspace_id = $1 and action = 'custom_dataset.version.saved') as "datasetAudits",
    (select count(*)::int from run_plans where workspace_id = $1) as plans,
    (select count(*)::int from eval_runs where workspace_id = $1) as runs,
    (select count(*)::int from run_samples s join eval_runs r on r.id = s.eval_run_id where r.workspace_id = $1) as samples,
    (select count(*)::int from eval_results s join eval_runs r on r.id = s.eval_run_id where r.workspace_id = $1) as results,
    (select count(*)::int from gate_results s join eval_runs r on r.id = s.eval_run_id where r.workspace_id = $1) as gates,
    (select count(*)::int from audit_events where workspace_id = $1 and action = 'provided_output.run.saved') as "runAudits",
    (select count(*)::int from eval_sets where workspace_id = $1) as "evalSets",
    (select count(*)::int from eval_items where workspace_id = $1) as "evalItems"`, [workspaceId])).rows[0];
  assert.ok(counts);
  const datasets = (await client.query<DatasetObservation["datasets"][number]>("select id, name, kind from datasets where workspace_id = $1 order by id limit 5", [workspaceId])).rows;
  const versions = (await client.query<DatasetObservation["versions"][number]>(`select v.id, v.dataset_id as "datasetId", v.version, v.fingerprint, v.created_at as "createdAt"
    from dataset_versions v join datasets d on d.id = v.dataset_id where d.workspace_id = $1 order by v.version limit 10`, [workspaceId])).rows;
  const rows = (await client.query<StoredRow>(`select r.dataset_version_id as "versionId", r.id, r.row_key as "rowKey", r.input,
    r.expected_output as "expectedOutput", r.expected_output is not null as "expectedPresent", r.context, r.context is not null as "contextPresent",
    r.history, r.history is not null as "historyPresent", r.trace_fixture as "traceFixture", r.trace_fixture is not null as "tracePresent", r.metadata,
    r.review_status as "reviewStatus" from dataset_rows r join dataset_versions v on v.id = r.dataset_version_id join datasets d on d.id = v.dataset_id
    where d.workspace_id = $1 order by v.version, r.row_key collate "C", r.id collate "C" limit 30`, [workspaceId])).rows;
  const audits = (await client.query<DatasetObservation["audits"][number]>(`select actor_user_id as "actorId", resource_id as "resourceId", metadata_hash as "metadataHash", metadata
    from audit_events where workspace_id = $1 and action = 'custom_dataset.version.saved' order by resource_id limit 10`, [workspaceId])).rows;
  const runs = (await client.query<{ record: ProvidedOutputRunRecord }>("select resolved_plan as record from run_plans where workspace_id = $1 order by id limit 3", [workspaceId])).rows.map(row => row.record);
  assert.ok(counts.datasets < 5 && counts.versions < 10 && counts.rows < 30 && counts.datasetAudits < 10 && counts.plans < 3, "authored fixture observation bounds exceeded");
  return { counts, datasets, versions, rows, audits, runs };
}
async function attach(info: TestInfo, name: string, value: unknown) {
  const body = Buffer.from(JSON.stringify(value)); assert.ok(body.length <= 16 * 1024);
  await info.attach(name, { body, contentType: "application/json" });
}

export const test = base.extend<{ owned: OwnedCustomDatasetFixture }>({
  owned: async ({ context }, use, info) => {
    const config = settings();
    const { Client: PgClient } = createRequire(new URL("../../packages/db/package.json", import.meta.url))("pg");
    const client: Client = new PgClient({ connectionString: config.databaseUrl, ssl: false, application_name: `${COHORT}-${info.testId}`,
      connectionTimeoutMillis: 5000, statement_timeout: 10000, query_timeout: 12000, options: "-c search_path=public" });
    const workspaceId = randomUUID(), actorId = randomUUID(), identity = randomUUID(), projectId = randomUUID(), keyId = randomUUID();
    const workspaceName = `${COHORT}:${identity}`, apiKey = `oe_custom_browser_${identity}.${randomUUID()}`;
    const actors = new Map<string, { name: string; role: "owner" | "viewer" }>(); const peers: BrowserContext[] = [];
    let created = false;
    await client.connect();
    try {
      await verify(client, config.databaseName); await client.query("begin");
      try {
        const actorName = `${workspaceName}:${actorId}`;
        await client.query("insert into workspaces (id, name, mode) values ($1, $2, 'hosted')", [workspaceId, workspaceName]);
        await client.query("insert into users (id, email, name) values ($1, $2, $3)", [actorId, `${actorId}@custom-dataset-browser.invalid`, actorName]);
        await client.query("insert into workspace_memberships (workspace_id, user_id, role) values ($1, $2, 'owner')", [workspaceId, actorId]);
        await client.query("insert into projects (id, workspace_id, name, environment) values ($1, $2, $3, 'authored-test')", [projectId, workspaceId, workspaceName]);
        await client.query(`insert into project_api_keys (id, project_id, key_hash, scope, name, key_prefix, scopes)
          values ($1, $2, $3, 'admin', $4, 'oe_custom_browser', $5::text[])`,
        [keyId, projectId, createHmac("sha256", PEPPER).update(apiKey).digest("hex"), workspaceName, ["admin", "evals:read", "evals:write"]]);
        await client.query("commit"); actors.set(actorId, { name: actorName, role: "owner" }); created = true;
      } catch (error) { await client.query("rollback"); throw error; }
      await context.addCookies([cookie(config.baseUrl, workspaceId, actorId, "owner")]);
      async function apiSave(draft: CustomDatasetDraft) {
        const preview = await context.request.post(`${config.baseUrl}/api/v1/custom-datasets/preview`, { maxRedirects: 0, data: draft });
        assert.equal(preview.status(), 200); const pinned = (await preview.json()).preview;
        const saved = await context.request.post(`${config.baseUrl}/api/v1/custom-datasets`, { maxRedirects: 0, data: {
          schemaVersion: "custom-dataset-save-v1", draft, expectedPreviewFingerprint: pinned.fingerprint
        } });
        assert.equal(saved.status(), 201); const value = await saved.json(); assert.equal(value.replayed, false);
        assert.equal(value.record.content.dataset.publicId, draft.datasetId); assert.equal(value.record.content.version.publicId, draft.versionId);
        return value.record as CustomDatasetVersionRecord;
      }
      const owned: OwnedCustomDatasetFixture = {
        baseUrl: config.baseUrl, workspaceId, actorId, apiKey, snapshot: () => snapshot(client, workspaceId),
        saveDataset: (sourceText, name = "Authored initial dataset") => apiSave({ schemaVersion: "custom-dataset-draft-v1", datasetId: randomUUID(), versionId: randomUUID(),
          version: 1, expectedVersionId: null, name, format: "json", defaultReviewStatus: "synthetic", sourceText }),
        append: (record, sourceText) => apiSave({ schemaVersion: "custom-dataset-draft-v1", datasetId: record.content.dataset.publicId, versionId: randomUUID(),
          version: record.content.version.version + 1, expectedVersionId: record.content.version.publicId, name: record.content.dataset.name,
          format: "json", defaultReviewStatus: "synthetic", sourceText }),
        async seedLegacyDataset() {
          const id = `owned_legacy_${randomUUID()}`, versionId = `${id}_v1`, name = `Authored visible legacy ${identity}`;
          await verify(client, config.databaseName); await client.query("begin");
          try {
            await client.query("insert into datasets (id, workspace_id, name, kind) values ($1, $2, $3, 'user')", [id, workspaceId, name]);
            await client.query("insert into dataset_versions (id, dataset_id, version, fingerprint) values ($1, $2, 1, $3)", [versionId, id, createHash("sha256").update(name).digest("hex")]);
            await client.query(`insert into dataset_rows (id, dataset_version_id, row_key, input, metadata, review_status)
              values ($1, $2, 'Legacy', '{"prompt":"Authored visible control"}'::jsonb, $3::jsonb, 'synthetic')`, [`${id}_row`, versionId, JSON.stringify({ cohort: COHORT })]);
            await client.query("commit"); return { id, name, versionId };
          } catch (error) { await client.query("rollback"); throw error; }
        },
        async seedEvalSet() {
          const versionId = randomUUID();
          const response = await context.request.post(`${config.baseUrl}/api/v1/eval-sets`, { maxRedirects: 0, data: {
            schemaVersion: "custom-eval-set-draft-v1", setId: randomUUID(), versionId, version: 1, expectedVersionId: null,
            name: "Authored dataset scoring check", contains: "approved", datasetPassRateThreshold: 50
          } });
          assert.equal(response.status(), 201); assert.equal((await response.json()).version.id, versionId); return versionId;
        },
        async viewerContext(browser) {
          const userId = randomUUID(), name = `${workspaceName}:${userId}`;
          await client.query("begin");
          try {
            await client.query("insert into users (id, email, name) values ($1, $2, $3)", [userId, `${userId}@custom-dataset-browser.invalid`, name]);
            await client.query("insert into workspace_memberships (workspace_id, user_id, role) values ($1, $2, 'viewer')", [workspaceId, userId]);
            await client.query("commit"); actors.set(userId, { name, role: "viewer" });
          } catch (error) { await client.query("rollback"); throw error; }
          const peer = await browser.newContext({ baseURL: config.baseUrl, viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
          peers.push(peer); await peer.addCookies([cookie(config.baseUrl, workspaceId, userId, "viewer")]); return peer;
        },
        async attachSnapshot(name) {
          const data = await snapshot(client, workspaceId);
          await attach(info, name, { schemaVersion: "custom-dataset-browser-observation-v1", workspaceId, counts: data.counts,
            versions: data.versions.map(version => ({ id: version.id, version: version.version, fingerprint: version.fingerprint })),
            auditResourceIds: data.audits.map(audit => audit.resourceId), runs: data.runs.map(run => ({ runId: run.plan.publicRunId, datasetVersionId: run.plan.dataset.version.id, planFingerprint: run.plan.fingerprint })) });
        }
      };
      await use(owned);
    } finally {
      try {
        for (const peer of peers) await peer.close();
        if (created) {
          await verify(client, config.databaseName); await client.query("begin");
          try {
            assert.deepEqual((await client.query("select name from workspaces where id = $1 for update", [workspaceId])).rows, [{ name: workspaceName }]);
            const expectedActors = [...actors.entries()].sort(([a], [b]) => a.localeCompare(b));
            assert.deepEqual((await client.query('select user_id as id, role from workspace_memberships where workspace_id = $1 order by user_id', [workspaceId])).rows, expectedActors.map(([id, actor]) => ({ id, role: actor.role })));
            assert.deepEqual((await client.query("select id, email, name from users where id = any($1::text[]) order by id", [[...actors.keys()]])).rows,
              expectedActors.map(([id, actor]) => ({ id, email: `${id}@custom-dataset-browser.invalid`, name: actor.name })));
            assert.deepEqual((await client.query("select id, name from projects where workspace_id = $1", [workspaceId])).rows, [{ id: projectId, name: workspaceName }]);
            const before = await snapshot(client, workspaceId);
            await client.query("delete from eval_runs where workspace_id = $1", [workspaceId]);
            await client.query("delete from run_plans where workspace_id = $1", [workspaceId]);
            await client.query("delete from eval_sets where workspace_id = $1", [workspaceId]);
            await client.query("delete from eval_items where workspace_id = $1", [workspaceId]);
            await client.query("delete from datasets where workspace_id = $1", [workspaceId]);
            await client.query("delete from projects where workspace_id = $1", [workspaceId]);
            await client.query("delete from audit_events where workspace_id = $1", [workspaceId]);
            const after = await snapshot(client, workspaceId); assert.deepEqual(after.counts, emptyCounts());
            for (const table of ["eval_sets", "eval_items", "datasets", "projects", "audit_events"]) assert.equal((await client.query(`select id from ${table} where workspace_id = $1`, [workspaceId])).rows.length, 0);
            await client.query("delete from workspace_memberships where workspace_id = $1", [workspaceId]);
            await client.query("delete from workspaces where id = $1 and name = $2", [workspaceId, workspaceName]);
            await client.query("delete from users where id = any($1::text[])", [[...actors.keys()]]);
            assert.equal((await client.query("select id from workspaces where id = $1", [workspaceId])).rows.length, 0);
            assert.equal((await client.query("select id from users where id = any($1::text[])", [[...actors.keys()]])).rows.length, 0);
            await client.query("commit");
            await attach(info, "owned-fixture-cleanup", { schemaVersion: "custom-dataset-browser-cleanup-v1", status: "removed", workspaceId,
              actorCount: actors.size, ownershipValidated: true, before: before.counts, after: after.counts, workspaceAbsent: true, actorsAbsent: true });
          } catch (error) { await client.query("rollback"); throw error; }
        }
      } finally { await client.end(); }
    }
  }
});

export { expect };
export async function expectNoDatasetWrites(owned: OwnedCustomDatasetFixture) {
  expect((await owned.snapshot()).counts).toEqual(emptyCounts());
}
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
}
export async function expectStored(owned: OwnedCustomDatasetFixture, record: CustomDatasetVersionRecord) {
  const data = await owned.snapshot();
  expect(data.datasets.find(row => row.id === record.content.dataset.id)).toEqual({ id: record.content.dataset.id, name: record.content.dataset.name, kind: "custom-dataset-v1" });
  const version = data.versions.find(row => row.id === record.snapshot.version.id); expect(version).toBeTruthy();
  expect({ ...version, createdAt: new Date(version!.createdAt).toISOString() }).toEqual({ id: record.snapshot.version.id, datasetId: record.content.dataset.id,
    version: record.content.version.version, fingerprint: record.content.fingerprint, createdAt: record.snapshot.version.createdAt });
  expect(data.rows.filter(row => row.versionId === record.snapshot.version.id).map(row => ({ id: row.id, rowKey: row.rowKey, input: row.input,
    expectedOutput: { present: row.expectedPresent, value: row.expectedOutput }, context: { present: row.contextPresent, value: row.context },
    history: { present: row.historyPresent, value: row.history }, traceFixture: { present: row.tracePresent, value: row.traceFixture }, metadata: row.metadata, reviewStatus: row.reviewStatus }))).toEqual(record.snapshot.rows);
  const audit = data.audits.find(row => row.resourceId === record.snapshot.version.id); expect(audit).toBeTruthy();
  expect(audit!.actorId).toBe(owned.actorId); expect(audit!.metadata).toEqual(record.manifest);
  expect(audit!.metadataHash).toBe(createHash("sha256").update(stable(record.manifest)).digest("hex"));
  return data;
}

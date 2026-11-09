import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test as base, expect, type Browser, type BrowserContext } from "@playwright/test";
import type { HttpEvalPlanDraft, HttpEvalPlanPreview, HttpEvalPlanVersionRecord } from "@open-evals/core";

const COHORT = "open-evals-http-target-plans-browser-20261109";
const MARKER = "open-evals-http-target-runs-20261109-created-disposable-v1";
const SECRET = "authored_open_evals_http_target_20261109_fixture_only";
const PEPPER = "authored_http_target_browser_pepper_20261109_fixture_only";
interface Client { connect(): Promise<void>; end(): Promise<void>; query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> }
export interface HttpPlanCounts { datasets: number; versions: number; rows: number; evalSets: number; evalItems: number; plans: number; planAudits: number; runs: number; samples: number; results: number; gates: number; workflows: number; events: number; audits: number }
export const zeroCounts = (): HttpPlanCounts => ({ datasets: 0, versions: 0, rows: 0, evalSets: 0, evalItems: 0, plans: 0, planAudits: 0, runs: 0, samples: 0, results: 0, gates: 0, workflows: 0, events: 0, audits: 0 });
export interface HttpPlanSources { datasetVersionId: string; evalSetVersionIds: string[] }
export interface HttpPlanObservation { counts: HttpPlanCounts; plans: Array<{ id: string; fingerprint: string; createdAt: string; record: HttpEvalPlanVersionRecord }>; audits: Array<{ actorId: string; action: string; resourceId: string; metadataHash: string; metadata: unknown }>; dispatchClaims: number }
export interface OwnedHttpPlanFixture {
  baseUrl: string; workspaceId: string; actorId: string; apiKey: string;
  sources(): Promise<HttpPlanSources>;
  snapshot(): Promise<HttpPlanObservation>;
  savePlan(draft: HttpEvalPlanDraft): Promise<HttpEvalPlanVersionRecord>;
  viewerContext(browser: Browser): Promise<BrowserContext>;
  foreignContext(browser: Browser): Promise<BrowserContext>;
}
function settings() {
  assert.equal(process.env.HTTP_PLAN_BROWSER_ALLOW, "owned-disposable"); assert.equal(process.env.AUTH_SECRET, SECRET); assert.equal(process.env.API_KEY_PEPPER, PEPPER);
  const app = new URL(process.env.HTTP_PLAN_BROWSER_BASE_URL ?? ""), db = new URL(process.env.HTTP_PLAN_BROWSER_DATABASE_URL ?? "");
  assert.equal(app.origin, "http://127.0.0.1:4173"); assert.equal(app.pathname, "/"); assert.ok(!app.username && !app.password && !app.search && !app.hash);
  assert.ok(["postgres:", "postgresql:"].includes(db.protocol)); assert.equal(db.hostname, "127.0.0.1"); assert.equal(db.port, "65432"); assert.equal(db.username, "postgres");
  assert.match(db.pathname, /^\/oe_http_eval_test_[0-9]+_[0-9]+$/); assert.equal(db.search, ""); assert.equal(db.hash, "");
  return { baseUrl: app.origin, databaseUrl: db.toString(), databaseName: db.pathname.slice(1) };
}
async function verify(client: Client, databaseName: string) {
  const rows = (await client.query<{ name: string; marker: string; owner: string; actor: string; address: string; port: number }>(`select current_database() as name,
    shobj_description(d.oid,'pg_database') as marker,pg_get_userbyid(d.datdba) as owner,current_user as actor,host(inet_server_addr()) as address,inet_server_port() as port
    from pg_database d where d.datname=current_database()`)).rows;
  assert.equal(rows.length, 1); const row = rows[0]!; assert.equal(row.name, databaseName); assert.equal(row.marker, MARKER); assert.equal(row.owner, "postgres"); assert.equal(row.actor, "postgres"); assert.equal(row.port, 65432); assert.ok(["127.0.0.1", "::ffff:127.0.0.1"].includes(row.address));
  const names = ["users", "workspaces", "workspace_memberships", "projects", "project_api_keys", "datasets", "dataset_versions", "dataset_rows", "eval_sets", "eval_set_versions", "eval_items", "eval_item_versions", "eval_set_item_versions", "run_plans", "eval_runs", "run_samples", "eval_results", "gate_results", "workflow_runs", "workflow_events", "audit_events"];
  const tables = (await client.query<{ name: string; relation: string }>("select name,to_regclass('public.'||name)::text as relation from unnest($1::text[]) name", [names])).rows;
  assert.equal(tables.length, names.length); assert.ok(tables.every(t => t.name === t.relation));
}
function cookie(baseUrl: string, workspaceId: string, userId: string, role: "owner" | "viewer") {
  const expiresAt = Date.now() + 20 * 60 * 1000, payload = Buffer.from(JSON.stringify({ userId, workspaceId, role, expiresAt })).toString("base64url");
  return { name: "open_evals_session", value: `${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`, url: baseUrl, httpOnly: true, secure: false, sameSite: "Lax" as const, expires: Math.floor(expiresAt / 1000) };
}
async function observe(client: Client, workspaceIds: string[]): Promise<HttpPlanObservation> {
  const counts = (await client.query<HttpPlanCounts>(`select
    (select count(*)::int from datasets where workspace_id=any($1::text[])) as datasets,
    (select count(*)::int from dataset_versions v join datasets d on d.id=v.dataset_id where d.workspace_id=any($1::text[])) as versions,
    (select count(*)::int from dataset_rows r join dataset_versions v on v.id=r.dataset_version_id join datasets d on d.id=v.dataset_id where d.workspace_id=any($1::text[])) as rows,
    (select count(*)::int from eval_sets where workspace_id=any($1::text[])) as "evalSets",
    (select count(*)::int from eval_items where workspace_id=any($1::text[])) as "evalItems",
    (select count(*)::int from run_plans where workspace_id=any($1::text[])) as plans,
    (select count(*)::int from audit_events where workspace_id=any($1::text[]) and action='http_eval.plan.saved') as "planAudits",
    (select count(*)::int from eval_runs where workspace_id=any($1::text[])) as runs,
    (select count(*)::int from run_samples s join eval_runs r on r.id=s.eval_run_id where r.workspace_id=any($1::text[])) as samples,
    (select count(*)::int from eval_results s join eval_runs r on r.id=s.eval_run_id where r.workspace_id=any($1::text[])) as results,
    (select count(*)::int from gate_results s join eval_runs r on r.id=s.eval_run_id where r.workspace_id=any($1::text[])) as gates,
    (select count(*)::int from workflow_runs where workspace_id=any($1::text[])) as workflows,
    (select count(*)::int from workflow_events e join workflow_runs w on w.id=e.workflow_run_id where w.workspace_id=any($1::text[])) as events,
    (select count(*)::int from audit_events where workspace_id=any($1::text[])) as audits`, [workspaceIds])).rows[0]!;
  assert.ok(counts.plans <= 5 && counts.rows <= 10 && counts.evalSets <= 4, "authored fixture bounds exceeded");
  const stored = (await client.query<{ id: string; fingerprint: string; createdAt: Date; storage: { schemaVersion: string; recordText: string } }>("select id,fingerprint,created_at as \"createdAt\",resolved_plan as storage from run_plans where workspace_id=any($1::text[]) order by created_at,id limit 6", [workspaceIds])).rows;
  const plans = stored.map(row => { assert.equal(row.storage.schemaVersion, "http-eval-plan-storage-v1"); assert.equal(typeof row.storage.recordText, "string"); const record = JSON.parse(row.storage.recordText) as HttpEvalPlanVersionRecord; assert.equal(record.storage.versionId, row.id); assert.equal(record.fingerprint, row.fingerprint); assert.equal(record.createdAt, row.createdAt.toISOString()); return { id: row.id, fingerprint: row.fingerprint, createdAt: row.createdAt.toISOString(), record }; });
  const audits = (await client.query<HttpPlanObservation["audits"][number]>("select actor_user_id as \"actorId\",action,resource_id as \"resourceId\",metadata_hash as \"metadataHash\",metadata from audit_events where workspace_id=any($1::text[]) and action='http_eval.plan.saved' order by created_at,id limit 6", [workspaceIds])).rows;
  const dispatchClaims = (await client.query<{ count: number }>("select count(*)::int as count from workflow_events e join workflow_runs w on w.id=e.workflow_run_id where w.workspace_id=any($1::text[]) and e.event_type='http_eval.row.claimed'", [workspaceIds])).rows[0]!.count;
  return { counts, plans, audits, dispatchClaims };
}
export const test = base.extend<{ owned: OwnedHttpPlanFixture }>({
  owned: async ({ context }, use, info) => {
    const config = settings(), { Client: PgClient } = createRequire(new URL("../../packages/db/package.json", import.meta.url))("pg");
    const client: Client = new PgClient({ connectionString: config.databaseUrl, ssl: false, application_name: `${COHORT}:${info.testId}`, connectionTimeoutMillis: 5000, statement_timeout: 10000, query_timeout: 12000, options: "-c search_path=public" });
    const workspaceId = randomUUID(), actorId = randomUUID(), projectId = randomUUID(), keyId = randomUUID(), identity = randomUUID();
    const apiKey = `oe_http_browser_${identity}.${randomUUID()}`, peers: BrowserContext[] = [], workspaces = new Map<string, string>(), actors = new Map<string, { workspaceId: string; role: "owner" | "viewer"; name: string }>();
    let created = false, selected: HttpPlanSources | undefined;
    await client.connect();
    try {
      await verify(client, config.databaseName); await client.query("begin");
      try {
        const workspaceName = `${COHORT}:${identity}`, name = `${workspaceName}:${actorId}`;
        await client.query("insert into workspaces(id,name,mode)values($1,$2,'hosted')", [workspaceId, workspaceName]);
        await client.query("insert into users(id,email,name)values($1,$2,$3)", [actorId, `${actorId}@http-plan-browser.invalid`, name]);
        await client.query("insert into workspace_memberships(workspace_id,user_id,role)values($1,$2,'owner')", [workspaceId, actorId]);
        await client.query("insert into projects(id,workspace_id,name,environment)values($1,$2,$3,'authored-test')", [projectId, workspaceId, workspaceName]);
        await client.query("insert into project_api_keys(id,project_id,key_hash,scope,name,key_prefix,scopes)values($1,$2,$3,'admin',$4,'oe_http_browser',$5::text[])", [keyId, projectId, createHmac("sha256", PEPPER).update(apiKey).digest("hex"), workspaceName, ["admin", "evals:read", "evals:write"]]);
        await client.query("commit"); workspaces.set(workspaceId, workspaceName); actors.set(actorId, { workspaceId, role: "owner", name }); created = true;
      } catch (e) { await client.query("rollback"); throw e; }
      await context.addCookies([cookie(config.baseUrl, workspaceId, actorId, "owner")]);
      async function peer(browser: Browser, foreign: boolean) {
        const id = randomUUID(), ws = foreign ? randomUUID() : workspaceId, wsName = foreign ? `${COHORT}:${randomUUID()}` : workspaces.get(workspaceId)!, name = `${wsName}:${id}`, role = foreign ? "owner" as const : "viewer" as const;
        await client.query("begin"); try {
          if (foreign) await client.query("insert into workspaces(id,name,mode)values($1,$2,'hosted')", [ws, wsName]);
          await client.query("insert into users(id,email,name)values($1,$2,$3)", [id, `${id}@http-plan-browser.invalid`, name]);
          await client.query("insert into workspace_memberships(workspace_id,user_id,role)values($1,$2,$3)", [ws, id, role]); await client.query("commit"); workspaces.set(ws, wsName); actors.set(id, { workspaceId: ws, role, name });
        } catch (e) { await client.query("rollback"); throw e; }
        const result = await browser.newContext({ baseURL: config.baseUrl, viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); peers.push(result); await result.addCookies([cookie(config.baseUrl, ws, id, role)]); return result;
      }
      const owned: OwnedHttpPlanFixture = {
        baseUrl: config.baseUrl, workspaceId, actorId, apiKey, snapshot: () => observe(client, [...workspaces.keys()]), viewerContext: browser => peer(browser, false), foreignContext: browser => peer(browser, true),
        async sources() {
          if (selected) return selected;
          const draft = { schemaVersion: "custom-dataset-draft-v1", datasetId: randomUUID(), versionId: randomUUID(), version: 1, expectedVersionId: null, name: "Authored HTTP browser inputs", format: "json", defaultReviewStatus: "reviewed", sourceText: JSON.stringify([{ rowKey: "Álpha 🧪", input: { prompt: "Authored café input", n: 0, enabled: false }, expectedOutput: { reference: "SECRET_REFERENCE" }, context: null, metadata: { source: "authored" } }, { rowKey: "Beta", input: "Authored second input", history: [], metadata: { source: "authored" } }]) };
          const p = await context.request.post(`${config.baseUrl}/api/v1/custom-datasets/preview`, { data: draft, maxRedirects: 0 }); assert.equal(p.status(), 200);
          const d = await context.request.post(`${config.baseUrl}/api/v1/custom-datasets`, { data: { schemaVersion: "custom-dataset-save-v1", draft, expectedPreviewFingerprint: (await p.json()).preview.fingerprint }, maxRedirects: 0 }); assert.equal(d.status(), 201);
          const datasetVersionId = (await d.json()).record.snapshot.version.id, evalSetVersionIds: string[] = [];
          for (const [i, contains] of ["approved", "ready"].entries()) { const versionId = randomUUID(); const saved = await context.request.post(`${config.baseUrl}/api/v1/eval-sets`, { maxRedirects: 0, data: { schemaVersion: "custom-eval-set-draft-v1", setId: randomUUID(), versionId, version: 1, expectedVersionId: null, name: `Authored HTTP evaluator ${i}`, contains, datasetPassRateThreshold: 100 } }); assert.equal(saved.status(), 201); assert.equal((await saved.json()).version.id, versionId); evalSetVersionIds.push(versionId); }
          selected = { datasetVersionId, evalSetVersionIds: evalSetVersionIds.sort() }; return selected;
        },
        async savePlan(draft) {
          const p = await context.request.post(`${config.baseUrl}/api/v1/http-target-plans/preview`, { data: draft, maxRedirects: 0 }); assert.equal(p.status(), 200); const preview = (await p.json()).preview as HttpEvalPlanPreview;
          const saved = await context.request.post(`${config.baseUrl}/api/v1/http-target-plans`, { data: { schemaVersion: "http-eval-plan-save-v1", draft: preview.draft, expectedPreviewFingerprint: preview.fingerprint }, maxRedirects: 0 }); assert.equal(saved.status(), 201); const value = await saved.json(); assert.equal(value.replayed, false); return value.record as HttpEvalPlanVersionRecord;
        }
      };
      await use(owned);
    } finally {
      try {
        for (const peer of peers) await peer.close();
        if (created) {
          await verify(client, config.databaseName); await client.query("begin");
          try {
            const workspaceIds = [...workspaces.keys()], actorIds = [...actors.keys()];
            const ws = (await client.query<{ id: string; name: string }>("select id,name from workspaces where id=any($1::text[]) for update", [workspaceIds])).rows; assert.equal(ws.length, workspaces.size); for (const row of ws) assert.equal(row.name, workspaces.get(row.id));
            const us = (await client.query<{ id: string; email: string; name: string }>("select id,email,name from users where id=any($1::text[])", [actorIds])).rows; assert.equal(us.length, actors.size); for (const row of us) { assert.equal(row.email, `${row.id}@http-plan-browser.invalid`); assert.equal(row.name, actors.get(row.id)?.name); }
            const memberships = (await client.query<{ workspaceId: string; id: string; role: string }>("select workspace_id as \"workspaceId\",user_id as id,role from workspace_memberships where workspace_id=any($1::text[])", [workspaceIds])).rows; assert.equal(memberships.length, actors.size); for (const row of memberships) { const actor = actors.get(row.id); assert.ok(actor); assert.equal(row.workspaceId, actor.workspaceId); assert.equal(row.role, actor.role); }
            assert.deepEqual((await client.query("select id,name from projects where workspace_id=any($1::text[])", [workspaceIds])).rows, [{ id: projectId, name: workspaces.get(workspaceId) }]);
            assert.deepEqual((await client.query("select id,project_id as \"projectId\",key_hash as hash,key_prefix as prefix from project_api_keys where project_id=$1", [projectId])).rows, [{ id: keyId, projectId, hash: createHmac("sha256", PEPPER).update(apiKey).digest("hex"), prefix: "oe_http_browser" }]);
            const before = await observe(client, workspaceIds);
            for (const table of ["workflow_runs", "eval_runs", "run_plans", "eval_sets", "eval_items", "datasets", "projects", "audit_events"]) await client.query(`delete from ${table} where workspace_id=any($1::text[])`, [workspaceIds]);
            const after = await observe(client, workspaceIds); assert.deepEqual(after.counts, zeroCounts());
            await client.query("delete from workspace_memberships where workspace_id=any($1::text[])", [workspaceIds]); await client.query("delete from workspaces where id=any($1::text[])", [workspaceIds]); await client.query("delete from users where id=any($1::text[])", [actorIds]);
            assert.equal((await client.query("select id from workspaces where id=any($1::text[])", [workspaceIds])).rows.length, 0); assert.equal((await client.query("select id from users where id=any($1::text[])", [actorIds])).rows.length, 0); await client.query("commit");
            await info.attach("owned-fixture-cleanup", { body: Buffer.from(JSON.stringify({ schemaVersion: "http-plan-browser-cleanup-v1", status: "removed", workspaceCount: workspaces.size, actorCount: actors.size, ownershipValidated: true, before: before.counts, after: after.counts, dispatchClaims: before.dispatchClaims, workspaceAbsent: true, actorsAbsent: true, actualHttpExecutionChecked: false })), contentType: "application/json" });
            assert.equal(before.dispatchClaims, 0); assert.equal(before.counts.runs, 0); assert.equal(before.counts.workflows, 0);
          } catch (e) { await client.query("rollback"); throw e; }
        }
      } finally { await client.end(); }
    }
  }
});
export { expect };

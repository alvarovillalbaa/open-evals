import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { constants, openSync, fstatSync, readSync, writeSync, ftruncateSync, closeSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test as base, expect, type Browser, type BrowserContext } from "@playwright/test";
import type { AnyHttpEvalPlanVersionRecord, CustomEvalItemDraftV2, CustomEvalItemVersionRecordV2, CustomEvalSetDraftV2, CustomEvalSetVersionRecordV2, HttpEvalPlanDraftV3, CustomEvalSetVersionRecordV3 } from "@open-evals/core";

const COHORT = "open-evals-matching-v3-browser-20261112";
const MARKER = "open-evals-matching-v3-20261112-created-disposable-v1";
const SECRET = "authored_open_evals_matching_v3_20261112_fixture_only";
const PEPPER = "authored_matching_v3_browser_pepper_20261112_fixture_only";
const HOST = "composition-target.example.com";
interface Client { connect(): Promise<void>; end(): Promise<void>; query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> }
export interface CompositionCounts { datasets: number; rows: number; evalItems: number; itemVersions: number; evalSets: number; setVersions: number; memberships: number; plans: number; runs: number; samples: number; results: number; gates: number; workflows: number; events: number; audits: number; projects: number; benchmarks: number }
export interface CompositionObservation {
  counts: CompositionCounts;
  claimCount: number;
  normalBounds: boolean;
  plans: AnyHttpEvalPlanVersionRecord[];
  results: unknown[];
  gates: unknown[];
  claims: Array<{ claimToken: string; requestFingerprint: string; rowId: string }>;
}
export interface TransportObservation { phase: string; workspaceId?: string; runId?: string; rowId?: string; requestFingerprint?: string; requestBodySha256?: string; responseBodySha256?: string; claimToken?: string; idempotencyKey?: string; sequence?: number; actualExternalTargetCalls?: number; nativeDnsSocketTlsChecked?: boolean }
export interface OwnedCompositionFixture {
  baseUrl: string; workspaceId: string; actorId: string; apiKey: string;
  snapshot(): Promise<CompositionObservation>;
  dataset(): Promise<string>;
  saveItem(patch?: Partial<CustomEvalItemDraftV2>): Promise<CustomEvalItemVersionRecordV2>;
  saveSet(items: CustomEvalItemVersionRecordV2[], patch?: Partial<CustomEvalSetDraftV2>): Promise<CustomEvalSetVersionRecordV2>;
  savePlan(sets: Array<CustomEvalSetVersionRecordV2 | CustomEvalSetVersionRecordV3>, datasetVersionId: string): Promise<AnyHttpEvalPlanVersionRecord>;
  armTransport(plan: AnyHttpEvalPlanVersionRecord, runId: string): Promise<void>;
  journal(): TransportObservation[];
  viewerContext(browser: Browser): Promise<BrowserContext>;
  foreignContext(browser: Browser): Promise<BrowserContext>;
}
const zero = (): CompositionCounts => ({ datasets: 0, rows: 0, evalItems: 0, itemVersions: 0, evalSets: 0, setVersions: 0, memberships: 0, plans: 0, runs: 0, samples: 0, results: 0, gates: 0, workflows: 0, events: 0, audits: 0, projects: 0, benchmarks: 0 });
function settings() {
  assert.equal(process.env.EVAL_MATCHING_BROWSER_ALLOW, "owned-disposable"); assert.equal(process.env.AUTH_SECRET, SECRET); assert.equal(process.env.API_KEY_PEPPER, PEPPER);
  const app = new URL(process.env.EVAL_MATCHING_BROWSER_BASE_URL ?? ""), database = new URL(process.env.EVAL_MATCHING_BROWSER_DATABASE_URL ?? "");
  assert.equal(app.href, "http://127.0.0.1:4173/"); assert.ok(["postgres:", "postgresql:"].includes(database.protocol));
  assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "65432"); assert.equal(database.username, "postgres");
  assert.match(database.pathname, /^\/oe_matching_v3_test_[0-9]+_[0-9]+$/); assert.equal(database.search, ""); assert.equal(database.hash, "");
  const evidenceRoot = resolve(process.env.RUNNER_TEMP ?? "", "open-evals-matching-v3-evidence"); assert.ok(process.env.RUNNER_TEMP);
  const bindingFile = resolve(process.env.EVAL_MATCHING_BROWSER_BINDING_FILE ?? ""), journalFile = resolve(process.env.EVAL_MATCHING_BROWSER_TRANSPORT_JOURNAL ?? "");
  assert.equal(dirname(bindingFile), evidenceRoot); assert.equal(dirname(journalFile), evidenceRoot);
  assert.equal(bindingFile, resolve(evidenceRoot, "transport-binding.json")); assert.equal(journalFile, resolve(evidenceRoot, "transport-journal.jsonl"));
  return { baseUrl: app.origin, databaseUrl: database.href, databaseName: database.pathname.slice(1), bindingFile, journalFile };
}
function privateFile(path: string, maximum: number, write = false): { fd: number; text: string } {
  const fd = openSync(path, (write ? constants.O_RDWR : constants.O_RDONLY) | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd); assert.ok(before.isFile() && before.uid === process.getuid!() && before.nlink === 1 && (before.mode & 0o077) === 0 && before.size <= maximum);
    const buffer = Buffer.alloc(before.size + 1); let length = 0;
    for (;;) { const count = readSync(fd, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
    assert.equal(length, before.size); const after = fstatSync(fd); for (const key of ["dev", "ino", "size", "mtimeMs", "ctimeMs"] as const) assert.equal(after[key], before[key]);
    return { fd, text: new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)) };
  } catch (error) { closeSync(fd); throw error; }
}
function journal(path: string): TransportObservation[] {
  const file = privateFile(path, 65536);
  try {
    const entries = file.text.split("\n").filter(Boolean).map(line => JSON.parse(line));
    assert.ok(entries.length >= 1 && entries.length <= 16);
    for (const entry of entries) { assert.equal(entry.schemaVersion, "eval-matching-transport-observation-v1"); assert.equal(entry.cohort, COHORT); }
    assert.equal(entries[0].phase, "guard_ready"); return entries;
  } finally { closeSync(file.fd); }
}
async function verify(client: Client, name: string) {
  const rows = (await client.query<{ name: string; marker: string; owner: string; actor: string; address: string; port: number }>(`select current_database() as name, shobj_description(d.oid,'pg_database') as marker,
    pg_get_userbyid(d.datdba) as owner,current_user as actor,host(inet_server_addr()) as address,inet_server_port() as port from pg_database d where d.datname=current_database()`)).rows;
  assert.equal(rows.length, 1); const row = rows[0]!; assert.equal(row.name, name); assert.equal(row.marker, MARKER); assert.equal(row.owner, "postgres"); assert.equal(row.actor, "postgres"); assert.equal(row.port, 65432); assert.ok(["127.0.0.1", "::ffff:127.0.0.1"].includes(row.address));
  const names = ["users", "workspaces", "workspace_memberships", "projects", "project_api_keys", "datasets", "dataset_versions", "dataset_rows", "eval_sets", "eval_set_versions", "eval_items", "eval_item_versions", "eval_set_item_versions", "run_plans", "eval_runs", "run_samples", "eval_results", "gate_results", "audit_events", "auth_sessions", "auth_accounts", "workflow_runs", "workflow_events", "queue_messages", "benchmarks", "benchmark_versions"];
  const tables = (await client.query<{ name: string; relation: string }>("select name,to_regclass('public.'||name)::text as relation from unnest($1::text[]) name", [names])).rows;
  assert.equal(tables.length, 26); assert.ok(tables.every(table => table.name === table.relation));
}
function cookie(baseUrl: string, workspaceId: string, userId: string, role: "owner" | "viewer") {
  const expiresAt = Date.now() + 20 * 60 * 1000, payload = Buffer.from(JSON.stringify({ userId, workspaceId, role, expiresAt })).toString("base64url");
  return { name: "open_evals_session", value: `${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`, url: baseUrl, httpOnly: true, secure: false, sameSite: "Lax" as const, expires: Math.floor(expiresAt / 1000) };
}
// Counts and at most three claim keys are safe diagnostics even when a regression
// creates extra work. Cleanup never parses potentially corrupt domain records.
async function diagnostics(client: Client, workspaceIds: string[]) {
  const countRow = (await client.query<CompositionCounts & { claimCount: number }>(`select
    (select count(*)::int from datasets where workspace_id=any($1::text[])) as datasets,
    (select count(*)::int from dataset_rows r join dataset_versions v on v.id=r.dataset_version_id join datasets d on d.id=v.dataset_id where d.workspace_id=any($1::text[])) as rows,
    (select count(*)::int from eval_items where workspace_id=any($1::text[])) as "evalItems",
    (select count(*)::int from eval_item_versions v join eval_items i on i.id=v.eval_item_id where i.workspace_id=any($1::text[])) as "itemVersions",
    (select count(*)::int from eval_sets where workspace_id=any($1::text[])) as "evalSets",
    (select count(*)::int from eval_set_versions v join eval_sets s on s.id=v.eval_set_id where s.workspace_id=any($1::text[])) as "setVersions",
    (select count(*)::int from eval_set_item_versions m join eval_set_versions v on v.id=m.eval_set_version_id join eval_sets s on s.id=v.eval_set_id where s.workspace_id=any($1::text[])) as memberships,
    (select count(*)::int from run_plans where workspace_id=any($1::text[])) as plans,
    (select count(*)::int from eval_runs where workspace_id=any($1::text[])) as runs,
    (select count(*)::int from run_samples s join eval_runs r on r.id=s.eval_run_id where r.workspace_id=any($1::text[])) as samples,
    (select count(*)::int from eval_results v join eval_runs r on r.id=v.eval_run_id where r.workspace_id=any($1::text[])) as results,
    (select count(*)::int from gate_results v join eval_runs r on r.id=v.eval_run_id where r.workspace_id=any($1::text[])) as gates,
    (select count(*)::int from workflow_runs where workspace_id=any($1::text[])) as workflows,
    (select count(*)::int from workflow_events e join workflow_runs w on w.id=e.workflow_run_id where w.workspace_id=any($1::text[])) as events,
    (select count(*)::int from audit_events where workspace_id=any($1::text[])) as audits,
    (select count(*)::int from projects where workspace_id=any($1::text[])) as projects,
    (select count(*)::int from benchmarks where workspace_id=any($1::text[])) as benchmarks,
    (select count(*)::int from workflow_events e join workflow_runs w on w.id=e.workflow_run_id where w.workspace_id=any($1::text[]) and e.event_type='http_eval.row.claimed') as "claimCount"`, [workspaceIds])).rows[0]!;
  const { claimCount, ...counts } = countRow;
  const normalBounds = counts.datasets <= 2 && counts.rows <= 4 && counts.evalItems <= 6 && counts.itemVersions <= 10 && counts.evalSets <= 5 && counts.setVersions <= 8 && counts.memberships <= 20 && counts.plans <= 3 && counts.runs <= 1 && counts.samples <= 2 && counts.results <= 6 && counts.gates <= 20 && counts.events <= 5 && counts.audits <= 30 && claimCount <= 2;
  const claims = (await client.query<{ claimToken: string; requestFingerprint: string; rowId: string }>(`select e.payload->'claim'->>'claimToken' as "claimToken",e.payload->'claim'->>'requestFingerprint' as "requestFingerprint",e.payload->'claim'->>'rowId' as "rowId" from workflow_events e join workflow_runs w on w.id=e.workflow_run_id where w.workspace_id=any($1::text[]) and e.event_type='http_eval.row.claimed' order by e.id limit 3`, [workspaceIds])).rows;
  return { counts, claimCount, claims, normalBounds };
}
async function observe(client: Client, workspaceIds: string[]): Promise<CompositionObservation> {
  const diagnostic = await diagnostics(client, workspaceIds);
  assert.equal(diagnostic.normalBounds, true, "Authored fixture bounds exceeded");
  const stored = (await client.query<{ storage: { schemaVersion: string; recordText: string }; id: string; fingerprint: string; createdAt: Date }>(`select id,fingerprint,created_at as "createdAt",resolved_plan as storage from run_plans where workspace_id=any($1::text[]) order by id limit 4`, [workspaceIds])).rows;
  const plans = stored.map(row => { assert.ok(["http-eval-plan-storage-v1", "http-eval-plan-storage-v2", "http-eval-plan-storage-v3"].includes(row.storage.schemaVersion)); const record = JSON.parse(row.storage.recordText) as AnyHttpEvalPlanVersionRecord; assert.equal(record.storage.versionId, row.id); assert.equal(record.fingerprint, row.fingerprint); assert.equal(record.createdAt, row.createdAt.toISOString()); return record; });
  const results = (await client.query<{ value: unknown }>(`select v.normalized_fields->'result' as value from eval_results v join eval_runs r on r.id=v.eval_run_id where r.workspace_id=any($1::text[]) order by v.id limit 7`, [workspaceIds])).rows.map(row => row.value);
  const gates = (await client.query<{ value: unknown }>(`select v.reasons->'gate' as value from gate_results v join eval_runs r on r.id=v.eval_run_id where r.workspace_id=any($1::text[]) order by v.id limit 21`, [workspaceIds])).rows.map(row => row.value);
  return { ...diagnostic, plans, results, gates };
}
export const test = base.extend<{ owned: OwnedCompositionFixture }>({
  owned: async ({ context }, use, info) => {
    const config = settings(), { Client: PgClient } = createRequire(new URL("../../packages/db/package.json", import.meta.url))("pg");
    const client: Client = new PgClient({ connectionString: config.databaseUrl, ssl: false, application_name: COHORT, connectionTimeoutMillis: 5000, statement_timeout: 10000, query_timeout: 12000, options: "-c search_path=public" });
    const workspaceId = randomUUID(), actorId = randomUUID(), projectId = randomUUID(), keyId = randomUUID(), identity = randomUUID(), workspaceName = `${COHORT}:${identity}`;
    const apiKey = `oe_composition_browser_${identity}.${randomUUID()}`, peers: BrowserContext[] = [], workspaces = new Map<string, string>(), actors = new Map<string, { workspaceId: string; role: "owner" | "viewer"; name: string }>();
    let created = false, datasetId: string | undefined, armed = false;
    await client.connect();
    try {
      await verify(client, config.databaseName); journal(config.journalFile); await client.query("begin");
      try {
        const name = `${workspaceName}:${actorId}`;
        await client.query("insert into workspaces(id,name,mode)values($1,$2,'hosted')", [workspaceId, workspaceName]);
        await client.query("insert into users(id,email,name)values($1,$2,$3)", [actorId, `${actorId}@composition-browser.invalid`, name]);
        await client.query("insert into workspace_memberships(workspace_id,user_id,role)values($1,$2,'owner')", [workspaceId, actorId]);
        await client.query("insert into projects(id,workspace_id,name,environment)values($1,$2,$3,'authored-test')", [projectId, workspaceId, workspaceName]);
        await client.query("insert into project_api_keys(id,project_id,key_hash,scope,name,key_prefix,scopes)values($1,$2,$3,'admin',$4,'oe_composition_browser',$5::text[])", [keyId, projectId, createHmac("sha256", PEPPER).update(apiKey).digest("hex"), workspaceName, ["admin", "evals:read", "evals:write"]]);
        await client.query("commit"); workspaces.set(workspaceId, workspaceName); actors.set(actorId, { workspaceId, role: "owner", name }); created = true;
      } catch (error) { await client.query("rollback"); throw error; }
      await context.addCookies([cookie(config.baseUrl, workspaceId, actorId, "owner")]);
      async function peer(browser: Browser, foreign: boolean) {
        const id = randomUUID(), ws = foreign ? randomUUID() : workspaceId, wsName = foreign ? `${COHORT}:${randomUUID()}` : workspaceName, name = `${wsName}:${id}`, role = foreign ? "owner" as const : "viewer" as const;
        await client.query("begin"); try {
          if (foreign) await client.query("insert into workspaces(id,name,mode)values($1,$2,'hosted')", [ws, wsName]);
          await client.query("insert into users(id,email,name)values($1,$2,$3)", [id, `${id}@composition-browser.invalid`, name]);
          await client.query("insert into workspace_memberships(workspace_id,user_id,role)values($1,$2,$3)", [ws, id, role]); await client.query("commit"); workspaces.set(ws, wsName); actors.set(id, { workspaceId: ws, role, name });
        } catch (error) { await client.query("rollback"); throw error; }
        const result = await browser.newContext({ baseURL: config.baseUrl, viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); peers.push(result); await result.addCookies([cookie(config.baseUrl, ws, id, role)]); return result;
      }
      const owned: OwnedCompositionFixture = {
        baseUrl: config.baseUrl, workspaceId, actorId, apiKey, snapshot: () => observe(client, [...workspaces.keys()]), journal: () => journal(config.journalFile), viewerContext: browser => peer(browser, false), foreignContext: browser => peer(browser, true),
        async dataset() {
          if (datasetId) return datasetId;
          const draft = { schemaVersion: "custom-dataset-draft-v1", datasetId: randomUUID(), versionId: randomUUID(), version: 1, expectedVersionId: null, name: "Authored composition café 🧪", format: "json", defaultReviewStatus: "reviewed", sourceText: JSON.stringify([{ rowKey: "Álpha 🧪", input: { fixtureCase: "all", n: 0, enabled: false }, expectedOutput: { reference: "SECRET_REFERENCE" }, context: null, metadata: { source: "authored" } }, { rowKey: "Beta", input: { fixtureCase: "omit_shared" }, expectedOutput: "NEVER_SENT_REFERENCE", history: [], metadata: { source: "authored" } }]) };
          const p = await context.request.post(`${config.baseUrl}/api/v1/custom-datasets/preview`, { data: draft, maxRedirects: 0 }); assert.equal(p.status(), 200);
          const saved = await context.request.post(`${config.baseUrl}/api/v1/custom-datasets`, { data: { schemaVersion: "custom-dataset-save-v1", draft, expectedPreviewFingerprint: (await p.json()).preview.fingerprint }, maxRedirects: 0 }); assert.equal(saved.status(), 201); datasetId = (await saved.json()).record.snapshot.version.id as string; return datasetId;
        },
        async saveItem(patch = {}) {
          const draft: CustomEvalItemDraftV2 = { schemaVersion: "custom-eval-item-draft-v2", itemId: randomUUID(), versionId: randomUUID(), version: 1, expectedVersionId: null, name: "Authored blue item", contains: "blue", ...patch };
          const p = await context.request.post(`${config.baseUrl}/api/v2/eval-items/preview`, { data: draft, maxRedirects: 0 }); assert.equal(p.status(), 200); const preview = (await p.json()).preview;
          const saved = await context.request.post(`${config.baseUrl}/api/v2/eval-items`, { data: { schemaVersion: "custom-eval-item-save-v2", draft: preview.draft, expectedPreviewFingerprint: preview.fingerprint }, maxRedirects: 0 }); assert.equal(saved.status(), 201); return (await saved.json()).record;
        },
        async saveSet(items, patch = {}) {
          const draft: CustomEvalSetDraftV2 = { schemaVersion: "custom-eval-set-draft-v2", setId: randomUUID(), versionId: randomUUID(), version: 1, expectedVersionId: null, name: "Authored composed set", members: items.map(item => ({ itemId: item.draft.itemId, versionId: item.draft.versionId, fingerprint: item.contract.fingerprint })), datasetPassRateThreshold: 0, ...patch };
          const p = await context.request.post(`${config.baseUrl}/api/v2/eval-sets/preview`, { data: draft, maxRedirects: 0 }); assert.equal(p.status(), 200); const preview = (await p.json()).preview;
          const saved = await context.request.post(`${config.baseUrl}/api/v2/eval-sets`, { data: { schemaVersion: "custom-eval-set-save-v2", draft: preview.draft, expectedPreviewFingerprint: preview.fingerprint }, maxRedirects: 0 }); assert.equal(saved.status(), 201); return (await saved.json()).record;
        },
        async savePlan(sets, datasetVersionId) {
          const draft: HttpEvalPlanDraftV3 = { schemaVersion: "http-eval-plan-draft-v3", planId: randomUUID(), versionId: randomUUID(), version: 1, expectedVersionId: null, name: "Authored shared-item plan", datasetVersionId, evalSetVersions: sets.map(set => ({ schemaVersion: set.schemaVersion === "custom-eval-set-record-v3" ? "custom-eval-set-ref-v3" : "custom-eval-set-ref-v2", setId: set.draft.setId, versionId: set.draft.versionId, fingerprint: set.contract.fingerprint })), target: { targetId: "authored-composition-target", targetVersion: "1", endpoint: `https://${HOST}/evaluate`, timeoutMs: 5000 }, limits: { concurrency: 2, maxDurationSeconds: 15 } };
          const p = await context.request.post(`${config.baseUrl}/api/v1/http-target-plans/preview`, { data: draft, maxRedirects: 0 }); assert.equal(p.status(), 200); const preview = (await p.json()).preview;
          const saved = await context.request.post(`${config.baseUrl}/api/v1/http-target-plans`, { data: { schemaVersion: "http-eval-plan-save-v3", draft: preview.draft, expectedPreviewFingerprint: preview.fingerprint }, maxRedirects: 0 }); assert.equal(saved.status(), 201); return (await saved.json()).record;
        },
        async armTransport(plan, runId) {
          assert.equal(armed, false); assert.match(runId, /^[0-9a-f-]{36}$/); assert.equal(plan.schemaVersion, "http-eval-plan-record-v3"); assert.equal(plan.workspaceId, workspaceId); assert.equal(plan.content.samples.length, 2);
          await verify(client, config.databaseName); const stored = (await observe(client, [workspaceId])).plans.find(value => value.storage.versionId === plan.storage.versionId); assert.deepEqual(stored, plan);
          const file = privateFile(config.bindingFile, 8192, true);
          try {
            const previous = JSON.parse(file.text); assert.equal(previous.schemaVersion, "eval-matching-transport-unarmed-v1"); assert.equal(previous.cohort, COHORT);
            const value = { schemaVersion: "eval-matching-transport-binding-v1", cohort: COHORT, database: config.databaseName, marker: MARKER, workspaceId, workspaceName, actorId, actorName: `${workspaceName}:${actorId}`, identity, runId, planVersionId: plan.storage.versionId, planFingerprint: plan.fingerprint, maxCalls: 2, rowIds: plan.content.samples.map(sample => sample.rowId), expiresAt: new Date(Date.now() + 4 * 60 * 1000).toISOString() };
            const bytes = Buffer.from(JSON.stringify(value)); assert.ok(bytes.length <= 8192); ftruncateSync(file.fd, 0); writeSync(file.fd, bytes, 0, bytes.length, 0); armed = true;
          } finally { closeSync(file.fd); }
        }
      };
      await use(owned);
    } finally {
      try {
        const peerClosures = await Promise.allSettled(peers.map(peer => peer.close()));
        if (created) {
          await verify(client, config.databaseName); await client.query("begin");
          let cleanupCommitted = false;
          try {
            const workspaceIds = [...workspaces.keys()], actorIds = [...actors.keys()];
            const ws = (await client.query<{ id: string; name: string }>("select id,name from workspaces where id=any($1::text[]) for update", [workspaceIds])).rows; assert.equal(ws.length, workspaces.size); for (const row of ws) assert.equal(row.name, workspaces.get(row.id));
            const users = (await client.query<{ id: string; email: string; name: string }>("select id,email,name from users where id=any($1::text[])", [actorIds])).rows; assert.equal(users.length, actors.size); for (const row of users) { assert.equal(row.email, `${row.id}@composition-browser.invalid`); assert.equal(row.name, actors.get(row.id)?.name); }
            const memberships = (await client.query<{ workspaceId: string; id: string; role: string }>("select workspace_id as \"workspaceId\",user_id as id,role from workspace_memberships where workspace_id=any($1::text[])", [workspaceIds])).rows; assert.equal(memberships.length, actors.size); for (const row of memberships) { const actor = actors.get(row.id); assert.ok(actor); assert.equal(row.workspaceId, actor.workspaceId); assert.equal(row.role, actor.role); }
            assert.deepEqual((await client.query("select id,name from projects where workspace_id=any($1::text[])", [workspaceIds])).rows, [{ id: projectId, name: workspaceName }]);
            assert.deepEqual((await client.query("select id,project_id as \"projectId\",key_hash as hash,key_prefix as prefix from project_api_keys where project_id=$1", [projectId])).rows, [{ id: keyId, projectId, hash: createHmac("sha256", PEPPER).update(apiKey).digest("hex"), prefix: "oe_composition_browser" }]);
            let deferred: unknown;
            async function cleanupDiagnostic() {
              await client.query("savepoint composition_cleanup_diagnostic");
              try { const value = await diagnostics(client, workspaceIds); await client.query("release savepoint composition_cleanup_diagnostic"); return value; }
              catch (error) { deferred ??= error; await client.query("rollback to savepoint composition_cleanup_diagnostic"); await client.query("release savepoint composition_cleanup_diagnostic"); return undefined; }
            }
            const before = await cleanupDiagnostic();
            if (before && !before.normalBounds) deferred ??= new Error("eval_composition_fixture_bounds_exceeded");
            for (const table of ["workflow_runs", "eval_runs", "run_plans", "benchmarks", "eval_sets", "eval_items", "datasets", "projects", "audit_events"]) await client.query(`delete from ${table} where workspace_id=any($1::text[])`, [workspaceIds]);
            const after = await cleanupDiagnostic();
            let zeroConfirmed = false;
            if (after) { try { assert.deepEqual(after.counts, zero()); assert.equal(after.claimCount, 0); zeroConfirmed = true; } catch (error) { deferred ??= error; } }
            if (!zeroConfirmed) deferred ??= new Error("eval_composition_cleanup_counts_unconfirmed");
            await client.query("delete from workspace_memberships where workspace_id=any($1::text[])", [workspaceIds]); await client.query("delete from workspaces where id=any($1::text[])", [workspaceIds]); await client.query("delete from users where id=any($1::text[])", [actorIds]);
            assert.equal((await client.query("select id from workspaces where id=any($1::text[])", [workspaceIds])).rows.length, 0); assert.equal((await client.query("select id from users where id=any($1::text[])", [actorIds])).rows.length, 0); await client.query("commit"); cleanupCommitted = true;
            if (armed) { try {
              const file = privateFile(config.bindingFile, 8192, true);
              try { const bound = JSON.parse(file.text); assert.equal(bound.workspaceId, workspaceId); assert.equal(bound.identity, identity); const bytes = Buffer.from(JSON.stringify({ schemaVersion: "eval-matching-transport-unarmed-v1", cohort: COHORT })); ftruncateSync(file.fd, 0); writeSync(file.fd, bytes, 0, bytes.length, 0); } finally { closeSync(file.fd); }
            } catch (error) { deferred ??= error; } }
            let transport: TransportObservation[] = [], transportReadable = false;
            try { transport = journal(config.journalFile); transportReadable = true; } catch (error) { deferred ??= error; }
            const ownCalls = transport.filter(value => value.phase === "committed_claim_before_authored_response" && value.workspaceId === workspaceId);
            const claimKeys = before?.claims.map(value => `${value.rowId}/${value.claimToken}/${value.requestFingerprint}`).sort(), transportKeys = ownCalls.map(value => `${value.rowId}/${value.claimToken}/${value.requestFingerprint}`).sort();
            const claimsMatch = Boolean(before && transportReadable && before.claimCount === ownCalls.length && JSON.stringify(claimKeys) === JSON.stringify(transportKeys));
            const unexpected = transport.filter(value => !["guard_ready", "authored_dns", "committed_claim_before_authored_response"].includes(value.phase)).length;
            await info.attach("owned-composition-cleanup", { body: Buffer.from(JSON.stringify({ schemaVersion: "eval-matching-browser-cleanup-v1", status: zeroConfirmed ? "removed" : "removed_with_unverified_counts", workspaceCount: workspaces.size, actorCount: actors.size, ownershipValidated: true, before: before?.counts ?? null, after: after?.counts ?? null, zeroCountsConfirmed: zeroConfirmed, normalFixtureBoundsRespected: before?.normalBounds ?? false, diagnosticFailureDeferred: Boolean(deferred), dispatchClaims: before?.claimCount ?? null, transportCalls: ownCalls.length, claimsMatchTransport: claimsMatch, workspaceAbsent: true, actorsAbsent: true, productionRouteExecutionWithAuthoredTransportChecked: ownCalls.length === 2 && claimsMatch, nativeHttpExecutionChecked: false, nativeDnsSocketTlsChecked: false, actualExternalTargetCalls: 0 })), contentType: "application/json" });
            await info.attach("owned-composition-transport", { body: Buffer.from(JSON.stringify({ schemaVersion: "eval-matching-browser-transport-v1", status: claimsMatch && unexpected === 0 ? "matched" : "mismatched", workspaceId, ownObservationCount: ownCalls.length, ownClaimCount: before?.claimCount ?? null, claimKeysMatch: claimsMatch, aggregateAcrossPreloadInstances: true, counterScope: "process-local", aggregateDnsObservations: transport.filter(value => value.phase === "authored_dns").length, aggregateRequestObservations: transport.filter(value => value.phase === "committed_claim_before_authored_response").length, aggregateUnexpectedObservations: unexpected, nativeDnsSocketTlsChecked: false, actualExternalTargetCalls: 0 })), contentType: "application/json" });
            if (deferred) throw deferred;
            assert.equal(zeroConfirmed, true);
            assert.equal(claimsMatch, true, "Every actual SQL claim must match the authored response journal exactly");
            assert.ok(transport.every(value => ["guard_ready", "authored_dns", "committed_claim_before_authored_response"].includes(value.phase)), "Unexpected target attempt retained in transport journal");
          } catch (error) { if (!cleanupCommitted) await client.query("rollback"); throw error; }
        }
        const failedClose = peerClosures.find(result => result.status === "rejected");
        if (failedClose?.status === "rejected") throw failedClose.reason;
      } finally { await client.end(); }
    }
  }
});
export { expect };

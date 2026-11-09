import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test as base, expect, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

const COHORT = "open-evals-custom-browser-20261109";
const DATABASE_MARKER = `${COHORT}-created-disposable-v1`;
const AUTH_SECRET = "authored_open_evals_browser_20261109_fixture_only";

interface DatabaseClient {
  connect(): Promise<void>;
  end(): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export interface PersistedVersion {
  id: string;
  version: number;
  fingerprint: string;
  contract: {
    id: string;
    setId: string;
    name: string;
    authoring: { version: number; expectedVersionId: string | null; requestFingerprint: string };
    itemVersions: Array<{ item: { config: { contains: string } } }>;
    gates: { datasetPassRateThreshold: number };
  };
}

export interface PersistenceSnapshot {
  counts: { sets: number; versions: number; items: number; itemVersions: number; members: number; audits: number };
  versions: PersistedVersion[];
  audits: Array<{ versionId: string; actorId: string; metadata: Record<string, unknown> }>;
}

export interface OwnedBrowserFixture {
  baseUrl: string;
  workspaceId: string;
  actorId: string;
  snapshot(): Promise<PersistenceSnapshot>;
  peerContext(browser: Browser): Promise<{ context: BrowserContext; actorId: string }>;
  attachSnapshot(name: string): Promise<void>;
}

function settings() {
  assert.equal(process.env.CUSTOM_EVAL_BROWSER_ALLOW, "owned-disposable", "explicit owned browser fixture required");
  assert.equal(process.env.AUTH_SECRET, AUTH_SECRET, "authored test-only signing secret required");
  let app: URL, database: URL;
  try {
    app = new URL(process.env.CUSTOM_EVAL_BROWSER_BASE_URL ?? "");
    database = new URL(process.env.CUSTOM_EVAL_BROWSER_DATABASE_URL ?? "");
  } catch { throw new Error("explicit loopback browser and disposable database URLs required"); }
  assert.equal(app.origin, "http://127.0.0.1:4173", "only the owned production app is admitted");
  assert.ok(["", "/"].includes(app.pathname) && !app.username && !app.password && !app.search && !app.hash);
  assert.ok(["postgres:", "postgresql:"].includes(database.protocol));
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.port, "65432");
  assert.equal(database.username, "postgres");
  assert.match(database.pathname, /^\/oe_custom_browser_test_[a-z0-9_]{1,48}$/);
  assert.equal(database.search, "", "database connection overrides are forbidden");
  assert.equal(database.hash, "");
  return { baseUrl: app.origin, databaseUrl: database.toString(), databaseName: database.pathname.slice(1) };
}

async function verifyDatabase(client: DatabaseClient, databaseName: string) {
  const rows = (await client.query<{ name: string; marker: string; owner: string; currentUser: string; address: string }>(
    `select current_database() as name, shobj_description(d.oid, 'pg_database') as marker,
      pg_get_userbyid(d.datdba) as owner, current_user as "currentUser", host(inet_server_addr()) as address
      from pg_database d where d.datname = current_database()`
  )).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, databaseName);
  assert.equal(rows[0].marker, DATABASE_MARKER);
  assert.equal(rows[0].owner, "postgres");
  assert.equal(rows[0].currentUser, "postgres");
  assert.ok(["127.0.0.1", "::ffff:127.0.0.1"].includes(rows[0].address), "actual server must be loopback");
  const required = ["users", "workspaces", "workspace_memberships", "eval_sets", "eval_set_versions", "eval_items", "eval_item_versions", "eval_set_item_versions", "audit_events"];
  const tables = (await client.query<{ name: string; relation: string }>(
    "select name, to_regclass('public.' || name)::text as relation from unnest($1::text[]) name", [required]
  )).rows;
  assert.equal(tables.length, required.length);
  assert.ok(tables.every(row => row.relation === row.name), "owned setup must apply unchanged migrations first");
}

// Matches the existing auth.ts session verifier; no app/Auth module is imported or bypassed.
function sessionCookie(baseUrl: string, workspaceId: string, actorId: string) {
  const expiresAt = Date.now() + 20 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ userId: actorId, workspaceId, role: "owner", expiresAt })).toString("base64url");
  const signature = createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
  return { name: "open_evals_session", value: `${payload}.${signature}`, url: baseUrl,
    httpOnly: true, secure: false, sameSite: "Lax" as const, expires: Math.floor(expiresAt / 1000) };
}

function zeroCounts() {
  return { sets: 0, versions: 0, items: 0, itemVersions: 0, members: 0, audits: 0 };
}

async function snapshot(client: DatabaseClient, workspaceId: string): Promise<PersistenceSnapshot> {
  const counts = (await client.query<PersistenceSnapshot["counts"]>(`select
    (select count(*)::int from eval_sets where workspace_id = $1) as sets,
    (select count(*)::int from eval_set_versions v join eval_sets s on s.id = v.eval_set_id where s.workspace_id = $1) as versions,
    (select count(*)::int from eval_items where workspace_id = $1) as items,
    (select count(*)::int from eval_item_versions v join eval_items i on i.id = v.eval_item_id where i.workspace_id = $1) as "itemVersions",
    (select count(*)::int from eval_set_item_versions m join eval_set_versions v on v.id = m.eval_set_version_id join eval_sets s on s.id = v.eval_set_id where s.workspace_id = $1) as members,
    (select count(*)::int from audit_events where workspace_id = $1) as audits`, [workspaceId])).rows[0];
  const versions = (await client.query<PersistedVersion>(
    `select v.id, v.version, v.fingerprint, v.contract from eval_set_versions v
      join eval_sets s on s.id = v.eval_set_id where s.workspace_id = $1 order by v.version`, [workspaceId]
  )).rows;
  const audits = (await client.query<PersistenceSnapshot["audits"][number]>(
    `select a.resource_id as "versionId", a.actor_user_id as "actorId", a.metadata
      from audit_events a left join eval_set_versions v on v.id = a.resource_id
      where a.workspace_id = $1 order by v.version, a.id`, [workspaceId]
  )).rows;
  return { counts, versions, audits };
}

async function attach(testInfo: TestInfo, name: string, value: unknown) {
  await testInfo.attach(name, { body: Buffer.from(JSON.stringify(value, null, 2)), contentType: "application/json" });
}

export const test = base.extend<{ owned: OwnedBrowserFixture }>({
  owned: async ({ context }, use, testInfo) => {
    const config = settings();
    const { Client } = createRequire(new URL("../../packages/db/package.json", import.meta.url))("pg");
    const client: DatabaseClient = new Client({ connectionString: config.databaseUrl, ssl: false,
      application_name: `${COHORT}-${testInfo.testId}`, connectionTimeoutMillis: 5000,
      statement_timeout: 10000, query_timeout: 12000, options: "-c search_path=public" });
    const workspaceId = randomUUID(), actorId = randomUUID(), identity = randomUUID();
    const workspaceName = `${COHORT}:${identity}`;
    const actors = new Map<string, string>();
    const peerContexts: BrowserContext[] = [];
    let created = false;
    await client.connect();
    try {
      await verifyDatabase(client, config.databaseName);
      await client.query("begin");
      try {
        await client.query("insert into workspaces (id, name, mode) values ($1, $2, 'hosted')", [workspaceId, workspaceName]);
        const actorName = `${workspaceName}:${actorId}`;
        await client.query("insert into users (id, email, name) values ($1, $2, $3)", [actorId, `${actorId}@owned-browser.invalid`, actorName]);
        await client.query("insert into workspace_memberships (workspace_id, user_id, role) values ($1, $2, 'owner')", [workspaceId, actorId]);
        await client.query("commit");
        actors.set(actorId, actorName);
        created = true;
      } catch (error) { await client.query("rollback"); throw error; }
      await context.addCookies([sessionCookie(config.baseUrl, workspaceId, actorId)]);
      const owned: OwnedBrowserFixture = {
        baseUrl: config.baseUrl, workspaceId, actorId,
        snapshot: () => snapshot(client, workspaceId),
        async peerContext(browser) {
          const peerId = randomUUID(), peerName = `${workspaceName}:${peerId}`;
          await client.query("begin");
          try {
            await client.query("insert into users (id, email, name) values ($1, $2, $3)", [peerId, `${peerId}@owned-browser.invalid`, peerName]);
            await client.query("insert into workspace_memberships (workspace_id, user_id, role) values ($1, $2, 'owner')", [workspaceId, peerId]);
            await client.query("commit");
            actors.set(peerId, peerName);
          } catch (error) { await client.query("rollback"); throw error; }
          const peer = await browser.newContext({ baseURL: config.baseUrl, viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
          peerContexts.push(peer);
          await peer.addCookies([sessionCookie(config.baseUrl, workspaceId, peerId)]);
          return { context: peer, actorId: peerId };
        },
        async attachSnapshot(name) {
          const data = await snapshot(client, workspaceId);
          await attach(testInfo, name, { schemaVersion: "custom-eval-browser-persistence-v1", workspaceId,
            counts: data.counts, versions: data.versions.map(({ id, version, fingerprint }) => ({ id, version, fingerprint })),
            audits: data.audits.map(({ versionId, actorId: author }) => ({ versionId, actorId: author })) });
        }
      };
      await use(owned);
    } finally {
      try {
        for (const peer of peerContexts) await peer.close();
        if (created) {
          await verifyDatabase(client, config.databaseName);
          await client.query("begin");
          try {
            const workspace = (await client.query<{ name: string }>("select name from workspaces where id = $1 for update", [workspaceId])).rows;
            assert.deepEqual(workspace, [{ name: workspaceName }], "foreign or missing workspace cannot be removed");
            const memberships = (await client.query<{ userId: string; role: string }>(
              'select user_id as "userId", role from workspace_memberships where workspace_id = $1 order by user_id', [workspaceId]
            )).rows;
            assert.deepEqual(memberships, [...actors.keys()].sort().map(userId => ({ userId, role: "owner" })));
            const users = (await client.query<{ id: string; name: string }>("select id, name from users where id = any($1::text[]) order by id", [[...actors.keys()]])).rows;
            assert.deepEqual(users, [...actors.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, name]) => ({ id, name })));
            const before = await snapshot(client, workspaceId);
            await client.query("delete from eval_sets where workspace_id = $1", [workspaceId]);
            await client.query("delete from eval_items where workspace_id = $1", [workspaceId]);
            await client.query("delete from audit_events where workspace_id = $1", [workspaceId]);
            const after = await snapshot(client, workspaceId);
            assert.deepEqual(after.counts, zeroCounts());
            await client.query("delete from workspace_memberships where workspace_id = $1", [workspaceId]);
            await client.query("delete from workspaces where id = $1 and name = $2", [workspaceId, workspaceName]);
            await client.query("delete from users where id = any($1::text[])", [[...actors.keys()]]);
            assert.equal((await client.query("select id from workspaces where id = $1", [workspaceId])).rows.length, 0);
            assert.equal((await client.query("select id from users where id = any($1::text[])", [[...actors.keys()]])).rows.length, 0);
            await client.query("commit");
            await attach(testInfo, "owned-fixture-cleanup", { schemaVersion: "custom-eval-browser-cleanup-v1", status: "removed",
              workspaceId, actorCount: actors.size, ownershipValidated: true, before: before.counts, after: after.counts,
              workspaceAbsent: true, actorsAbsent: true });
          } catch (error) { await client.query("rollback"); throw error; }
        }
      } finally { await client.end(); }
    }
  }
});

export { expect };

export async function expectPersisted(owned: OwnedBrowserFixture, versionIds: string[]) {
  const data = await owned.snapshot();
  expect(data.counts).toEqual({ sets: 1, versions: versionIds.length, items: 1, itemVersions: versionIds.length, members: versionIds.length, audits: versionIds.length });
  expect(data.versions.map(version => version.id)).toEqual(versionIds);
  expect(data.audits.map(audit => audit.versionId)).toEqual(versionIds);
  expect(data.versions.every(version => /^[a-f0-9]{64}$/.test(version.fingerprint))).toBe(true);
  return data;
}

export async function expectNoRows(owned: OwnedBrowserFixture) {
  expect((await owned.snapshot()).counts).toEqual(zeroCounts());
}

export async function openCreate(page: Page, owned: OwnedBrowserFixture) {
  // Actual signed-cookie HTTP access is checked before expecting the production-rendered page.
  const access = await page.context().request.get(`${owned.baseUrl}/api/v1/eval-sets`, { maxRedirects: 0 });
  expect(access.status()).toBe(200);
  expect(await access.json()).toEqual({ sets: [] });
  const document = await page.goto(`${owned.baseUrl}/evals/custom`);
  expect(document?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Create an Eval Set", exact: true })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toBeEditable();
}

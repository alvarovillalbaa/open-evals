import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

// Authored, UNRUN T3 checks. Invoke deliberately with the repository's locked tsx:
// node --import tsx --test tests/integration/custom-evals-store.node.mjs
// External setup must create an owner-controlled loopback database whose name starts
// oe_custom_evals_test_, apply unchanged migrations 0001/0002, and set its database
// COMMENT to DATABASE_MARKER below. This file neither creates nor migrates a database.
// Require CUSTOM_EVALS_TEST_ALLOW=local-disposable and CUSTOM_EVALS_TEST_DATABASE_URL.
// There is no fallback to an application's database configuration.
const DATABASE_MARKER = "open-evals-custom-evals-20261109-created-disposable-v1";
const applicationName = `oe_custom_evals_${randomUUID().replaceAll("-", "")}`;
const environmentKeys = ["DATABASE_URL", "POSTGRES_URL", "SUPABASE_DB_URL", "DATABASE_SSL", "SUPABASE_DB_SSL"];
const previousEnvironment = new Map(environmentKeys.map(key => [key, process.env[key]]));
let inspector, Client, prepareCustomEvalSet, saveCustomEvalSet, listCustomEvalSets, getCustomEvalSet;
let connectionString, databaseName, fixture;

function guardedUrl() {
  assert.equal(process.env.CUSTOM_EVALS_TEST_ALLOW, "local-disposable", "explicit disposable target required");
  let url;
  try { url = new URL(process.env.CUSTOM_EVALS_TEST_DATABASE_URL ?? ""); }
  catch { throw new Error("dedicated test database URL required"); }
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "PostgreSQL URL required");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "loopback database required");
  assert.match(url.pathname, /^\/oe_custom_evals_test_[a-z0-9_]{1,48}$/, "dedicated test database name required");
  assert.equal(url.search, "", "connection overrides are forbidden");
  assert.equal(url.hash, "", "connection fragments are forbidden");
  databaseName = url.pathname.slice(1);
  return url.toString();
}

async function verifyDatabase() {
  const { rows } = await inspector.query(`select current_database() as name,
    shobj_description(d.oid, 'pg_database') as marker,
    pg_get_userbyid(d.datdba) = current_user as owned,
    host(inet_server_addr()) as address from pg_database d where d.datname = current_database()`);
  assert.deepEqual(rows, [{ name: databaseName, marker: DATABASE_MARKER, owned: true,
    address: rows[0]?.address }]);
  assert.ok(["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(rows[0].address), "actual server must be loopback");
  const required = ["workspaces", "eval_sets", "eval_set_versions", "eval_items", "eval_item_versions", "eval_set_item_versions", "audit_events"];
  const tables = (await inspector.query("select name, to_regclass('public.' || name)::text as relation from unnest($1::text[]) name", [required])).rows;
  assert.equal(tables.length, required.length);
  assert.ok(tables.every(row => row.relation === row.name), "externally migrated schema required");
}

function active() {
  assert.ok(fixture?.created, "owned fixture is not ready");
  return fixture;
}

function draft(overrides = {}) {
  return { schemaVersion: "custom-eval-set-draft-v1", setId: randomUUID(), versionId: randomUUID(),
    version: 1, expectedVersionId: null, name: "Authored contains check", contains: "AUTHORED_PRIVATE_NEEDLE",
    datasetPassRateThreshold: 80, ...overrides };
}

function prepare(overrides = {}) { return prepareCustomEvalSet(draft(overrides)); }
function save(prepared, scope = active().scope) { return saveCustomEvalSet(scope, prepared); }
function conflict(code) {
  return error => { assert.equal(error.status, 409); assert.equal(error.code, code); return true; };
}
async function counts() {
  const ids = active().workspaceIds;
  return (await inspector.query(`select
    (select count(*) from eval_sets where workspace_id = any($1::text[])) as sets,
    (select count(*) from eval_set_versions v join eval_sets s on s.id = v.eval_set_id where s.workspace_id = any($1::text[])) as versions,
    (select count(*) from eval_items where workspace_id = any($1::text[])) as items,
    (select count(*) from eval_item_versions v join eval_items i on i.id = v.eval_item_id where i.workspace_id = any($1::text[])) as item_versions,
    (select count(*) from eval_set_item_versions m join eval_set_versions v on v.id = m.eval_set_version_id join eval_sets s on s.id = v.eval_set_id where s.workspace_id = any($1::text[])) as members,
    (select count(*) from audit_events where workspace_id = any($1::text[])) as audits`, [ids])).rows[0];
}
async function audits(versionId) {
  return (await inspector.query(`select actor_user_id, action, resource_type, resource_id, metadata
    from audit_events where workspace_id = $1 and resource_id = $2 order by id`, [active().scope.workspaceId, versionId])).rows;
}
async function membership(versionId) {
  return (await inspector.query(`select m.eval_item_version_id as id, m.position, m.weight::text as weight, m.criticality,
    i.workspace_id, v.eval_item_id, v.version, v.output_schema, v.config, v.fingerprint
    from eval_set_item_versions m join eval_item_versions v on v.id = m.eval_item_version_id
    join eval_items i on i.id = v.eval_item_id where m.eval_set_version_id = $1 order by m.position`, [versionId])).rows;
}

async function cleanupFixture() {
  if (!fixture?.created) return;
  await verifyDatabase();
  const f = fixture;
  const rows = (await inspector.query("select id, name from workspaces where id = any($1::text[]) order by id", [f.workspaceIds])).rows;
  assert.equal(rows.length, 2, "fixture workspace disappeared before cleanup");
  for (const row of rows) assert.equal(row.name, `${applicationName}:${row.id}`, "foreign workspace must never be removed");
  await inspector.query("begin");
  try {
    await inspector.query("delete from eval_sets where workspace_id = any($1::text[])", [f.workspaceIds]);
    await inspector.query("delete from eval_items where workspace_id = any($1::text[])", [f.workspaceIds]);
    await inspector.query("delete from audit_events where workspace_id = any($1::text[])", [f.workspaceIds]);
    assert.deepEqual(await counts(), { sets: "0", versions: "0", items: "0", item_versions: "0", members: "0", audits: "0" });
    await inspector.query("delete from workspaces where id = any($1::text[])", [f.workspaceIds]);
    assert.equal((await inspector.query("select id from workspaces where id = any($1::text[])", [f.workspaceIds])).rows.length, 0);
    await inspector.query("commit");
    fixture = undefined;
  } catch (error) { await inspector.query("rollback"); throw error; }
}

describe("custom Eval Set persistence [tier3; authored UNRUN]", { concurrency: false, timeout: 180_000 }, () => {
  before(async () => {
    connectionString = guardedUrl();
    ({ Client } = createRequire(new URL("../../packages/db/package.json", import.meta.url))("pg"));
    inspector = new Client({ connectionString, ssl: false, application_name: `${applicationName}_inspector`,
      connectionTimeoutMillis: 5_000, statement_timeout: 10_000, query_timeout: 12_000 });
    await inspector.connect();
    await verifyDatabase();
    for (const key of environmentKeys) delete process.env[key];
    const storeUrl = new URL(connectionString);
    storeUrl.searchParams.set("application_name", applicationName);
    storeUrl.searchParams.set("options", "-c statement_timeout=10000 -c lock_timeout=7000");
    process.env.DATABASE_URL = storeUrl.toString();
    ({ prepareCustomEvalSet } = await import("../../packages/core/src/custom-evals.ts"));
    ({ saveCustomEvalSet, listCustomEvalSets, getCustomEvalSet } = await import("../../packages/db/src/custom-evals.ts"));
  });
  beforeEach(async () => {
    await verifyDatabase();
    const workspaceIds = [randomUUID(), randomUUID()];
    fixture = { workspaceIds, scope: { workspaceId: workspaceIds[0], actorId: randomUUID() },
      foreignScope: { workspaceId: workspaceIds[1], actorId: randomUUID() }, created: false };
    await inspector.query("insert into workspaces (id, name, mode) values ($1, $2, 'local'), ($3, $4, 'local')",
      [workspaceIds[0], `${applicationName}:${workspaceIds[0]}`, workspaceIds[1], `${applicationName}:${workspaceIds[1]}`]);
    fixture.created = true;
  });
  afterEach(cleanupFixture);
  after(async () => {
    try { await cleanupFixture(); }
    finally {
      for (const [key, value] of previousEnvironment) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      await inspector?.end();
    }
  });

  test("CE-PG01 saves and reloads the exact contract, membership and private-free audit", async () => {
    const p = prepare(), saved = await save(p), item = p.contract.itemVersions[0].item;
    assert.equal(saved.replayed, false);
    assert.equal(saved.version.id, p.draft.versionId);
    assert.deepEqual(saved.version.contract, p.contract);
    assert.equal(saved.version.fingerprint, p.contract.fingerprint);
    assert.ok(Number.isFinite(Date.parse(saved.version.createdAt)));
    const loaded = await getCustomEvalSet(active().scope.workspaceId, p.draft.setId);
    assert.deepEqual(loaded.versions, [saved.version]);
    assert.equal(loaded.hasMore, false);
    assert.deepEqual(await membership(p.draft.versionId), [{ id: item.id, position: 0, weight: "1", criticality: "critical",
      workspace_id: active().scope.workspaceId, eval_item_id: item.itemId, version: 1,
      output_schema: item.outputSchema, config: item.config, fingerprint: item.fingerprint }]);
    assert.deepEqual(await audits(p.draft.versionId), [{ actor_user_id: active().scope.actorId,
      action: "custom_eval.version.saved", resource_type: "custom_eval_set_version", resource_id: p.draft.versionId,
      metadata: { setId: p.draft.setId, versionId: p.draft.versionId, version: 1, requestFingerprint: p.requestFingerprint,
        contractFingerprint: p.contract.fingerprint, expectedVersionId: null } }]);
    assert.equal(JSON.stringify(await audits(p.draft.versionId)).includes(p.draft.contains), false);
  });

  test("CE-PG02 exact retries by another authorized actor preserve one version and one audit", async () => {
    const p = prepare(), first = await save(p), before = await counts();
    const replay = await save(p, { ...active().scope, actorId: randomUUID() });
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.version, first.version);
    assert.deepEqual(await counts(), before);
    assert.equal((await audits(p.draft.versionId)).length, 1);
  });

  test("CE-PG03 reusing a version identity with changed intent conflicts without rewriting it", async () => {
    const p = prepare(), first = await save(p), before = await counts();
    const changed = prepareCustomEvalSet({ ...p.draft, contains: "DIFFERENT_AUTHORED_NEEDLE" });
    await assert.rejects(save(changed), conflict("custom_eval_identity_conflict"));
    assert.deepEqual((await getCustomEvalSet(active().scope.workspaceId, p.draft.setId)).versions, [first.version]);
    assert.deepEqual(await counts(), before);
  });

  test("CE-PG04 version two retains immutable version one and exact old retries", async () => {
    const firstInput = prepare(), first = await save(firstInput);
    const originalMembership = await membership(first.version.id);
    const next = prepare({ setId: firstInput.draft.setId, version: 2, expectedVersionId: first.version.id,
      name: "Renamed authored check", contains: "SECOND_AUTHORED_NEEDLE", datasetPassRateThreshold: 0 });
    const second = await save(next);
    const detail = await getCustomEvalSet(active().scope.workspaceId, firstInput.draft.setId);
    assert.deepEqual(detail.versions, [second.version, first.version]);
    assert.equal(detail.name, next.draft.name);
    assert.deepEqual((await save(firstInput)).version, first.version);
    assert.deepEqual((await getCustomEvalSet(active().scope.workspaceId, firstInput.draft.setId)).versions, detail.versions);
    assert.deepEqual(await membership(first.version.id), originalMembership);
    assert.equal((await audits(first.version.id)).length, 1);
    assert.equal((await audits(second.version.id)).length, 1);
  });

  test("CE-PG05 stale heads and skipped version numbers conflict without adding members", async () => {
    const p = prepare(), first = await save(p);
    const second = await save(prepare({ setId: p.draft.setId, version: 2, expectedVersionId: first.version.id }));
    const before = await counts();
    for (const next of [
      prepare({ setId: p.draft.setId, version: 2, expectedVersionId: first.version.id }),
      prepare({ setId: p.draft.setId, version: 3, expectedVersionId: first.version.id }),
      prepare({ setId: p.draft.setId, version: 4, expectedVersionId: second.version.id })
    ]) await assert.rejects(save(next), conflict("custom_eval_version_conflict"));
    assert.deepEqual(await counts(), before);
  });

  test("CE-PG06 foreign workspace reads are absent and global set identity reuse is refused", async () => {
    const p = prepare(), first = await save(p), before = await counts();
    assert.equal(await getCustomEvalSet(active().foreignScope.workspaceId, p.draft.setId), undefined);
    assert.deepEqual(await listCustomEvalSets(active().foreignScope.workspaceId), []);
    await assert.rejects(save(p, active().foreignScope), conflict("custom_eval_identity_conflict"));
    assert.deepEqual((await getCustomEvalSet(active().scope.workspaceId, p.draft.setId)).versions, [first.version]);
    assert.deepEqual(await counts(), before);
  });

  test("CE-PG07 existing global version and evaluator identities are not adopted by a new set", async () => {
    const p = prepare(); await save(p);
    const before = await counts();
    await assert.rejects(save(prepare({ versionId: p.draft.versionId })), conflict("custom_eval_identity_conflict"));
    assert.deepEqual(await counts(), before);
    const collision = prepare(), item = collision.contract.itemVersions[0].item;
    await inspector.query("insert into eval_items (id, workspace_id, name, type) values ($1, $2, $3, $4)",
      [item.itemId, active().foreignScope.workspaceId, "Foreign authored identity", "string_check"]);
    const withCollision = await counts();
    await assert.rejects(save(collision), conflict("custom_eval_identity_conflict"));
    assert.deepEqual(await counts(), withCollision);
    assert.equal(await getCustomEvalSet(active().scope.workspaceId, collision.draft.setId), undefined);
  });

  test("CE-PG08 missing or altered persisted membership fails closed on reads and retries", async () => {
    const p = prepare(); await save(p);
    const member = (await membership(p.draft.versionId))[0];
    await inspector.query("update eval_set_item_versions set weight = 2 where eval_set_version_id = $1", [p.draft.versionId]);
    await assert.rejects(getCustomEvalSet(active().scope.workspaceId, p.draft.setId), conflict("custom_eval_storage_conflict"));
    await assert.rejects(save(p), conflict("custom_eval_storage_conflict"));
    await inspector.query("delete from eval_set_item_versions where eval_set_version_id = $1", [p.draft.versionId]);
    await assert.rejects(getCustomEvalSet(active().scope.workspaceId, p.draft.setId), conflict("custom_eval_storage_conflict"));
    await assert.rejects(save(p), conflict("custom_eval_storage_conflict"));
    assert.equal((await audits(p.draft.versionId)).length, 1);
    assert.equal((await inspector.query("select id from eval_item_versions where id = $1", [member.id])).rows.length, 1);
  });

  test("CE-PG09 tampered stored contracts are refused without repair or a second audit", async () => {
    const p = prepare(); await save(p);
    const changed = { ...p.contract, name: "Tampered authored name" };
    await inspector.query("update eval_set_versions set contract = $2::jsonb where id = $1", [p.draft.versionId, JSON.stringify(changed)]);
    await assert.rejects(getCustomEvalSet(active().scope.workspaceId, p.draft.setId), conflict("custom_eval_storage_conflict"));
    await assert.rejects(save(p), conflict("custom_eval_storage_conflict"));
    assert.deepEqual((await inspector.query("select contract from eval_set_versions where id = $1", [p.draft.versionId])).rows[0].contract, changed);
    assert.equal((await audits(p.draft.versionId)).length, 1);
  });

  test("CE-PG10 an actual audit failure rolls back parent, version, evaluator and membership writes", async () => {
    const p = prepare(), suffix = randomUUID().replaceAll("-", ""), functionName = `ce_rollback_${suffix}`, triggerName = `ce_audit_${suffix}`;
    const before = await counts();
    let functionOid, triggerOid;
    try {
      await inspector.query(`create function public.${functionName}() returns trigger language plpgsql as $$
        begin if NEW.workspace_id = '${active().scope.workspaceId}' then
          raise exception 'custom_evals_authored_rollback' using errcode = 'P0001';
        end if; return NEW; end $$`);
      functionOid = (await inspector.query("select to_regprocedure($1)::oid as oid", [`public.${functionName}()`])).rows[0].oid;
      await inspector.query(`create trigger ${triggerName} before insert on public.audit_events for each row execute function public.${functionName}()`);
      triggerOid = (await inspector.query("select oid from pg_trigger where tgname = $1 and tgrelid = 'public.audit_events'::regclass and tgfoid = $2::oid", [triggerName, functionOid])).rows[0].oid;
      await assert.rejects(save(p), error => { assert.equal(error.status, 503); assert.equal(error.code, "custom_eval_storage_unavailable"); return true; });
      assert.deepEqual(await counts(), before);
    } finally {
      if (triggerOid) {
        assert.equal((await inspector.query("select oid from pg_trigger where tgname = $1 and tgrelid = 'public.audit_events'::regclass and tgfoid = $2::oid", [triggerName, functionOid])).rows[0]?.oid, triggerOid);
        await inspector.query(`drop trigger ${triggerName} on public.audit_events`);
      }
      if (functionOid) {
        assert.equal((await inspector.query("select to_regprocedure($1)::oid as oid", [`public.${functionName}()`])).rows[0].oid, functionOid);
        await inspector.query(`drop function public.${functionName}()`);
      }
    }
    assert.equal((await save(p)).replayed, false);
  });

  test("CE-PG11 history is bounded to twenty newest versions with an honest hasMore flag", async () => {
    const setId = randomUUID(), saved = [];
    let expectedVersionId = null;
    for (let version = 1; version <= 21; version++) {
      const result = await save(prepare({ setId, version, expectedVersionId, contains: `AUTHORED_NEEDLE_${version}` }));
      saved.push(result.version); expectedVersionId = result.version.id;
    }
    const detail = await getCustomEvalSet(active().scope.workspaceId, setId);
    assert.deepEqual(detail.versions, saved.slice(1).reverse());
    assert.equal(detail.hasMore, true);
    assert.deepEqual(await listCustomEvalSets(active().scope.workspaceId), [{ id: setId, name: "Authored contains check", versionCount: 21, latestVersionId: saved[20].id }]);
    assert.equal((await counts()).versions, "21");
  });

  test("CE-PG12 two writers blocked on the same actual workspace lock accept exactly one successor", async () => {
    const p = prepare(), first = await save(p);
    const proposals = ["LEFT", "RIGHT"].map(contains => prepare({ setId: p.draft.setId, version: 2,
      expectedVersionId: first.version.id, contains: `AUTHORED_${contains}` }));
    const blocker = new Client({ connectionString, ssl: false, application_name: `${applicationName}_blocker`,
      connectionTimeoutMillis: 5_000, statement_timeout: 10_000, query_timeout: 12_000 });
    let pending, released = false;
    await blocker.connect();
    try {
      await blocker.query("begin");
      const pid = (await blocker.query("select pg_backend_pid() as pid")).rows[0].pid;
      await blocker.query("select id from workspaces where id = $1 for update", [active().scope.workspaceId]);
      pending = Promise.allSettled(proposals.map(value => save(value)));
      let waiting = 0;
      for (let attempt = 0; attempt < 100; attempt++) {
        waiting = Number((await inspector.query(`select count(*) from pg_stat_activity a
          where a.datname = current_database() and a.application_name = $1 and a.wait_event_type = 'Lock'
          and ($2::int = any(pg_blocking_pids(a.pid)) or exists (
            select 1 from pg_stat_activity predecessor where predecessor.pid = any(pg_blocking_pids(a.pid))
              and predecessor.datname = current_database() and predecessor.application_name = $1
              and $2::int = any(pg_blocking_pids(predecessor.pid))))`, [applicationName, pid])).rows[0].count);
        if (waiting === 2) break;
        await delay(40);
      }
      assert.equal(waiting, 2, "both actual save transactions must reach the held lock before release");
      await blocker.query("commit"); released = true;
      const results = await pending;
      const accepted = results.filter(row => row.status === "fulfilled"), rejected = results.filter(row => row.status === "rejected");
      assert.equal(accepted.length, 1); assert.equal(rejected.length, 1);
      assert.equal(accepted[0].value.replayed, false);
      conflict("custom_eval_version_conflict")(rejected[0].reason);
      const detail = await getCustomEvalSet(active().scope.workspaceId, p.draft.setId);
      assert.deepEqual(detail.versions, [accepted[0].value.version, first.version]);
      assert.deepEqual(await counts(), { sets: "1", versions: "2", items: "1", item_versions: "2", members: "2", audits: "2" });
    } finally {
      try { if (!released) await blocker.query("rollback"); }
      finally { try { await pending; } finally { await blocker.end(); } }
    }
  });
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

// Authored, UNRUN T3 owner-SQL checks; no HTTP/Auth/RLS/browser/provider claim.
// Deliberate invocation: node --import tsx --test tests/integration/provided-output-runs.node.mjs
// External setup owns migrations 0001/0002, the database and the exact database COMMENT.
// This file never creates, migrates or drops a database. It has no application URL fallback.
const testCohort = process.env.PROVIDED_OUTPUT_TEST_COHORT;
const customDatasetCohort = testCohort === "open-evals-custom-datasets-20261109";
const httpTargetCohort = testCohort === "open-evals-http-target-runs-20261109";
const DATABASE_MARKER = httpTargetCohort
  ? "open-evals-http-target-runs-20261109-created-disposable-v1"
  : customDatasetCohort
  ? "open-evals-custom-datasets-20261109-created-disposable-v1"
  : "open-evals-provided-output-20261109-created-disposable-v1";
const applicationName = `oe_provided_output_${randomUUID().replaceAll("-", "")}`;
const environmentKeys = ["DATABASE_URL", "POSTGRES_URL", "SUPABASE_DB_URL", "DATABASE_SSL", "SUPABASE_DB_SSL"];
const previousEnvironment = new Map(environmentKeys.map(key => [key, process.env[key]]));
let inspector, Client, connectionString, databaseName, fixture;
let core, custom, store, customStore, service, legacyEngine, stableStringify, stableHash;

function guardedUrl() {
  assert.equal(process.env.PROVIDED_OUTPUT_TEST_ALLOW, "local-disposable", "explicit disposable target required");
  assert.ok(testCohort === undefined || customDatasetCohort || httpTargetCohort, "unknown disposable verification cohort");
  let url;
  try { url = new URL(process.env.PROVIDED_OUTPUT_TEST_DATABASE_URL ?? ""); }
  catch { throw new Error("dedicated test database URL required"); }
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "loopback URL required");
  if (customDatasetCohort || httpTargetCohort) {
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "65432");
    assert.equal(url.username, "postgres");
    assert.match(url.pathname, httpTargetCohort ? /^\/oe_http_eval_test_[0-9]+_[0-9]+$/ : /^\/oe_custom_datasets_test_[0-9]+_[0-9]+$/, "current owned database name required");
  } else {
    assert.match(url.pathname, /^\/oe_provided_output_test_[a-z0-9_]{1,38}$/, "dedicated database name required");
  }
  assert.equal(url.search, "", "connection overrides forbidden"); assert.equal(url.hash, "", "fragments forbidden");
  databaseName = url.pathname.slice(1);
  return url.toString();
}

async function verifyDatabase() {
  const rows = (await inspector.query(`select current_database() as name, shobj_description(d.oid, 'pg_database') as marker,
    pg_get_userbyid(d.datdba) = current_user as owned, host(inet_server_addr()) as address
    from pg_database d where d.datname = current_database()`)).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].name, databaseName); assert.equal(rows[0].marker, DATABASE_MARKER);
  assert.equal(rows[0].owned, true); assert.ok(["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(rows[0].address), "actual server must be loopback");
  const required = ["users", "workspaces", "workspace_memberships", "datasets", "dataset_versions", "dataset_rows", "eval_sets", "eval_set_versions",
    "eval_items", "eval_item_versions", "eval_set_item_versions", "run_plans", "eval_runs", "run_samples", "eval_results", "gate_results", "audit_events"];
  const tables = (await inspector.query("select name, to_regclass('public.' || name)::text as relation from unnest($1::text[]) name", [required])).rows;
  assert.equal(tables.length, required.length); assert.ok(tables.every(row => row.name === row.relation), "externally migrated schema required");
}

function active() { assert.ok(fixture?.created, "owned fixture required"); return fixture; }
const callbacks = { prepare: input => core.prepareProvidedOutputRunRecord(input), validateRecord: value => core.parseProvidedOutputRunRecord(value) };
function save(request, scope = active().scope) { return store.saveProvidedOutputRun(scope, request, callbacks); }
function read(publicRunId, workspaceId = active().scope.workspaceId) { return store.getProvidedOutputRun(workspaceId, publicRunId, callbacks.validateRecord); }
function rejected(status, code) {
  return error => { assert.equal(error.status, status); if (code) assert.equal(error.code, code); return true; };
}
async function profileCounts() {
  return (await inspector.query(`select
    (select count(*) from run_plans where workspace_id = any($1::text[])) as plans,
    (select count(*) from eval_runs where workspace_id = any($1::text[])) as runs,
    (select count(*) from run_samples s join eval_runs r on r.id = s.eval_run_id where r.workspace_id = any($1::text[])) as samples,
    (select count(*) from eval_results x join eval_runs r on r.id = x.eval_run_id where r.workspace_id = any($1::text[])) as results,
    (select count(*) from gate_results g join eval_runs r on r.id = g.eval_run_id where r.workspace_id = any($1::text[])) as gates,
    (select count(*) from audit_events where workspace_id = any($1::text[]) and action = 'provided_output.run.saved') as audits`, [active().workspaceIds])).rows[0];
}
const emptyCounts = { plans: "0", runs: "0", samples: "0", results: "0", gates: "0", audits: "0" };
const json = value => JSON.parse(JSON.stringify(value));

async function seedDataset({ count = 2, scope = active().scope, rowKeys, nullable = false } = {}) {
  const id = `po_dataset_${randomUUID()}`, versionId = `po_version_${randomUUID()}`;
  const rows = Array.from({ length: count }, (_, index) => ({ id: `po_row_${randomUUID()}`, rowKey: rowKeys?.[index] ?? String(index).padStart(3, "0") }));
  await inspector.query("begin");
  try {
    await inspector.query("insert into datasets (id, workspace_id, name, kind) values ($1, $2, $3, 'user')", [id, scope.workspaceId, `${applicationName}:${id}`]);
    await inspector.query("insert into dataset_versions (id, dataset_id, version, fingerprint, created_at) values ($1, $2, 7, $3, '2026-11-09T00:00:00.000Z')",
      [versionId, id, "authored-legacy-declared-fingerprint"]);
    for (const [index, row] of rows.entries()) await inspector.query(`insert into dataset_rows
      (id, dataset_version_id, row_key, input, expected_output, context, history, trace_fixture, metadata, review_status)
      values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, 'reviewed')`,
    [row.id, versionId, row.rowKey, JSON.stringify({ prompt: `Authored input ${index}` }), JSON.stringify("APPROVED reference"),
      nullable ? index === 0 ? null : "null" : JSON.stringify({ context: index }), JSON.stringify([`History ${index}`]),
      JSON.stringify({ fixture: index }), JSON.stringify({ cohort: applicationName })]);
    await inspector.query("commit");
  } catch (error) { await inspector.query("rollback"); throw error; }
  return { id, versionId, rows };
}
async function seedCustom({ scope = active().scope, setId = randomUUID(), version = 1, expectedVersionId = null, contains = "APPROVED", threshold = 50 } = {}) {
  const prepared = custom.prepareCustomEvalSet({ schemaVersion: "custom-eval-set-draft-v1", setId, versionId: randomUUID(), version,
    expectedVersionId, name: "Authored saved response check", contains, datasetPassRateThreshold: threshold });
  return { prepared, saved: await customStore.saveCustomEvalSet(scope, prepared) };
}
async function selection({ dataset, customVersion, scope = active().scope } = {}) {
  const d = dataset ?? await seedDataset({ scope }), c = customVersion ?? (await seedCustom({ scope })).saved.version.id;
  return { dataset: d, evalSetVersionId: c, scope };
}
async function preview(selected, { runId = randomUUID(), output = "APPROVED actual response", outputs } = {}) {
  const inputs = await store.getProvidedOutputInputs(selected.scope.workspaceId, { datasetVersionId: selected.dataset.versionId, evalSetVersionId: selected.evalSetVersionId });
  assert.ok(inputs);
  const draft = core.prepareProvidedOutputRunDraft({ schemaVersion: "provided-output-run-draft-v1", runId,
    datasetVersionId: selected.dataset.versionId, evalSetVersionId: selected.evalSetVersionId,
    outputs: outputs ?? inputs.dataset.rows.map(row => ({ rowId: row.id, output })) });
  const plan = core.resolveProvidedOutputRun({ workspaceId: selected.scope.workspaceId, draft, ...inputs });
  return { inputs, plan, request: core.prepareProvidedOutputRunRequest({ schemaVersion: "provided-output-run-request-v1", draft, expectedPlanFingerprint: plan.fingerprint }) };
}

async function cleanupFixture() {
  if (!fixture?.created) return;
  await verifyDatabase();
  const f = fixture;
  const workspaces = (await inspector.query("select id, name from workspaces where id = any($1::text[]) order by id", [f.workspaceIds])).rows;
  assert.equal(workspaces.length, 2);
  for (const row of workspaces) assert.equal(row.name, `${applicationName}:${row.id}`, "foreign workspace must not be removed");
  const users = (await inspector.query("select id, email, name from users where id = any($1::text[])", [f.actorIds])).rows;
  assert.equal(users.length, 2);
  for (const user of users) { assert.equal(user.email, `${user.id}@provided-output.invalid`); assert.equal(user.name, applicationName); }
  await inspector.query("begin");
  try {
    await inspector.query("delete from eval_runs where workspace_id = any($1::text[])", [f.workspaceIds]);
    await inspector.query("delete from run_plans where workspace_id = any($1::text[])", [f.workspaceIds]);
    await inspector.query("delete from datasets where workspace_id = any($1::text[])", [f.workspaceIds]);
    await inspector.query("delete from eval_sets where workspace_id = any($1::text[])", [f.workspaceIds]);
    await inspector.query("delete from eval_items where workspace_id = any($1::text[])", [f.workspaceIds]);
    await inspector.query("delete from audit_events where workspace_id = any($1::text[])", [f.workspaceIds]);
    assert.deepEqual(await profileCounts(), emptyCounts);
    await inspector.query("delete from workspaces where id = any($1::text[])", [f.workspaceIds]);
    await inspector.query("delete from users where id = any($1::text[])", [f.actorIds]);
    assert.equal((await inspector.query("select id from workspaces where id = any($1::text[])", [f.workspaceIds])).rowCount, 0);
    assert.equal((await inspector.query("select id from users where id = any($1::text[])", [f.actorIds])).rowCount, 0);
    await inspector.query("commit"); fixture = undefined;
  } catch (error) { await inspector.query("rollback"); throw error; }
}

describe("provided-output persistence [tier3; authored UNRUN]", { concurrency: false, timeout: 240_000 }, () => {
  before(async () => {
    connectionString = guardedUrl();
    ({ Client } = createRequire(new URL("../../packages/db/package.json", import.meta.url))("pg"));
    inspector = new Client({ connectionString, ssl: false, application_name: `${applicationName}_inspector`,
      connectionTimeoutMillis: 5_000, statement_timeout: 15_000, query_timeout: 17_000 });
    await inspector.connect(); await verifyDatabase();
    for (const key of environmentKeys) delete process.env[key];
    const storeUrl = new URL(connectionString);
    storeUrl.searchParams.set("application_name", applicationName);
    storeUrl.searchParams.set("options", "-c statement_timeout=15000 -c lock_timeout=10000");
    process.env.DATABASE_URL = storeUrl.toString();
    core = await import("../../packages/core/src/provided-output-runs.ts");
    custom = await import("../../packages/core/src/custom-evals.ts");
    ({ stableStringify, stableHash } = await import("../../packages/core/src/hash.ts"));
    legacyEngine = await import("../../packages/core/src/eval-engine.ts");
    customStore = await import("../../packages/db/src/custom-evals.ts");
    store = await import("../../packages/db/src/provided-output-runs.ts");
    service = await import("../../packages/db/src/service.ts");
  });
  beforeEach(async () => {
    await verifyDatabase();
    const workspaceIds = [randomUUID(), randomUUID()], actorIds = [randomUUID(), randomUUID()];
    fixture = { workspaceIds, actorIds, scope: { workspaceId: workspaceIds[0], actorId: actorIds[0] },
      foreignScope: { workspaceId: workspaceIds[1], actorId: actorIds[1] }, created: false };
    await inspector.query("begin");
    try {
      for (const [index, id] of workspaceIds.entries()) {
        await inspector.query("insert into users (id, email, name) values ($1, $2, $3)", [actorIds[index], `${actorIds[index]}@provided-output.invalid`, applicationName]);
        await inspector.query("insert into workspaces (id, name, mode) values ($1, $2, 'local')", [id, `${applicationName}:${id}`]);
        await inspector.query("insert into workspace_memberships (workspace_id, user_id, role) values ($1, $2, 'owner')", [id, actorIds[index]]);
      }
      await inspector.query("commit"); fixture.created = true;
    } catch (error) { await inspector.query("rollback"); throw error; }
  });
  afterEach(cleanupFixture);
  after(async () => {
    try { await cleanupFixture(); }
    finally {
      for (const [key, value] of previousEnvironment) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      await inspector?.end();
    }
  });

  test("PO-PG01 scoped catalogues and exact saved custom versions work beyond the latest twenty", async () => {
    const d = await seedDataset(), setId = randomUUID(), versions = [];
    let parent = null;
    for (let version = 1; version <= 21; version++) {
      const value = await seedCustom({ setId, version, expectedVersionId: parent, contains: `APPROVED_${version}` });
      versions.push(value.saved.version); parent = value.saved.version.id;
    }
    const recent = await customStore.getCustomEvalSet(active().scope.workspaceId, setId);
    assert.equal(recent.hasMore, true); assert.equal(recent.versions.some(version => version.id === versions[0].id), false);
    const exact = await store.getProvidedOutputInputs(active().scope.workspaceId, { datasetVersionId: d.versionId, evalSetVersionId: versions[0].id });
    assert.deepEqual(exact.evalSet.contract, versions[0].contract); assert.equal(exact.evalSet.members[0].position, 0);
    const catalog = await store.listProvidedOutputSources(active().scope.workspaceId);
    assert.equal(catalog.datasets.some(row => row.versionId === d.versionId), true);
    assert.equal(catalog.evalSets.some(row => row.versionId === versions[0].id), true);
    assert.equal(catalog.datasetsHasMore, false); assert.equal(catalog.evalSetsHasMore, false);
    assert.deepEqual(await store.listProvidedOutputSources(active().foreignScope.workspaceId), { datasets: [], evalSets: [], datasetsHasMore: false, evalSetsHasMore: false });
    assert.deepEqual(await profileCounts(), emptyCounts);
  });

  test("PO-PG02 complete ordered snapshots preserve SQL absence, JSON null and every source field", async () => {
    const selected = await selection({ dataset: await seedDataset({ rowKeys: ["😀", "\ue000"], nullable: true }) });
    const p = await preview(selected), rows = p.inputs.dataset.rows;
    assert.deepEqual(rows.map(row => row.rowKey), ["\ue000", "😀"]);
    assert.deepEqual(rows[0].context, { present: true, value: null }); assert.deepEqual(rows[1].context, { present: false, value: null });
    assert.equal(rows[0].expectedOutput.value, "APPROVED reference"); assert.ok(rows[0].history.present && rows[0].traceFixture.present);
    assert.equal(rows[0].metadata.cohort, applicationName); assert.equal(rows[0].reviewStatus, "reviewed");
    assert.deepEqual(json(core.parseProvidedOutputDatasetSnapshot(p.inputs.dataset)), p.inputs.dataset);
    assert.equal(p.plan.sampleManifest.rows[0].sourceId, rows[0].id);
    await inspector.query("update dataset_rows set metadata = metadata || '{\"changed\":true}'::jsonb where id = $1", [rows[0].id]);
    const changed = await preview(selected, { runId: p.request.draft.runId });
    assert.notEqual(changed.plan.datasetFingerprint, p.plan.datasetFingerprint); assert.notEqual(changed.plan.fingerprint, p.plan.fingerprint);
  });

  test("PO-PG03 empty actual responses never fall back to saved expected answers and missing coverage writes nothing", async () => {
    const selected = await selection(), p = await preview(selected, { output: "" });
    const saved = await save(p.request);
    assert.equal(saved.record.execution.results.every(result => result.fields[0].value === false), true);
    assert.equal(saved.record.execution.gates.find(gate => gate.level === "run").passed, false);
    const actualPlan = (await inspector.query("select workspace_id, fingerprint, resolved_plan from run_plans where id = $1", [saved.record.plan.id])).rows[0];
    assert.equal(actualPlan.workspace_id, active().scope.workspaceId); assert.equal(actualPlan.fingerprint, saved.record.plan.fingerprint);
    assert.deepEqual(actualPlan.resolved_plan, json(saved.record));
    const actualRun = (await inspector.query("select workspace_id, run_plan_id, status, idempotency_key from eval_runs where id = $1", [saved.record.plan.runId])).rows[0];
    assert.deepEqual(actualRun, { workspace_id: active().scope.workspaceId, run_plan_id: saved.record.plan.id,
      status: "completed", idempotency_key: `provided-output-run-v1:${p.request.draft.runId}` });
    const actualResults = (await inspector.query("select id, original_output, normalized_fields from eval_results where eval_run_id = $1 order by id", [saved.record.plan.runId])).rows;
    assert.deepEqual(actualResults, saved.record.execution.results.map(result => ({ id: result.id, original_output: result.originalOutput,
      normalized_fields: result.fields })).sort((a, b) => a.id.localeCompare(b.id)));
    const actualGates = (await inspector.query("select id, level, scope_id, to_jsonb(score) as score, passed, decision, formula, reasons, fingerprint from gate_results where eval_run_id = $1 order by id", [saved.record.plan.runId])).rows;
    assert.deepEqual(actualGates, saved.record.execution.gates.map(gate => ({ id: gate.id, level: gate.level, scope_id: gate.scopeId,
      score: gate.score, passed: gate.passed, decision: gate.decision, formula: gate.formula, reasons: gate.reasons,
      fingerprint: gate.fingerprint })).sort((a, b) => a.id.localeCompare(b.id)));
    const audits = (await inspector.query("select actor_user_id, resource_type, resource_id, metadata, metadata_hash from audit_events where workspace_id = $1 and action = 'provided_output.run.saved'", [active().scope.workspaceId])).rows;
    const metadata = { publicRunId: p.request.draft.runId, runId: saved.record.plan.runId, planId: saved.record.plan.id,
      requestFingerprint: saved.record.requestFingerprint, planFingerprint: saved.record.plan.fingerprint, recordFingerprint: saved.record.fingerprint };
    assert.deepEqual(audits, [{ actor_user_id: active().scope.actorId, resource_type: "provided_output_run", resource_id: saved.record.plan.runId,
      metadata, metadata_hash: stableHash(metadata, 64) }]);
    assert.equal(JSON.stringify(audits).includes("APPROVED"), false); assert.equal(JSON.stringify(audits).includes("Authored input"), false);
    const missing = await preview(selected); missing.request.draft.outputs.pop();
    const beforeCounts = await profileCounts();
    await assert.rejects(save(missing.request), rejected(422, "provided_output_coverage_invalid"));
    assert.deepEqual(await profileCounts(), beforeCounts);
  });

  test("PO-PG04 all one hundred rows execute while an overflowing population is refused intact", async () => {
    const selected = await selection({ dataset: await seedDataset({ count: 100 }) }), p = await preview(selected);
    const saved = await save(p.request);
    assert.equal(saved.record.plan.dataset.rows.length, 100); assert.equal(saved.record.execution.results.length, 100);
    assert.equal(saved.record.execution.gates.length, 305);
    assert.deepEqual(await profileCounts(), { plans: "1", runs: "1", samples: "100", results: "100", gates: "305", audits: "1" });
    const overflow = await seedDataset({ count: 101 }), beforeCounts = await profileCounts();
    await assert.rejects(store.getProvidedOutputInputs(active().scope.workspaceId, { datasetVersionId: overflow.versionId, evalSetVersionId: selected.evalSetVersionId }), rejected(422, "provided_output_dataset_size"));
    assert.equal((await inspector.query("select count(*)::int as count from dataset_rows where dataset_version_id = $1", [overflow.versionId])).rows[0].count, 101);
    assert.deepEqual(await profileCounts(), beforeCounts);
  });

  test("PO-PG05 the canonical one-MiB snapshot boundary includes all saved-row structure", async () => {
    const selected = await selection({ dataset: await seedDataset({ count: 1 }) }), initial = await preview(selected);
    const proposed = structuredClone(initial.inputs.dataset); proposed.rows[0].input = "";
    const capacity = 1_048_576 - Buffer.byteLength(stableStringify(proposed)); assert.ok(capacity > 0);
    await inspector.query("update dataset_rows set input = to_jsonb($2::text) where id = $1", [proposed.rows[0].id, "x".repeat(capacity)]);
    const boundary = await preview(selected); assert.equal(Buffer.byteLength(stableStringify(boundary.inputs.dataset)), 1_048_576);
    assert.equal((await save(boundary.request)).record.plan.datasetFingerprint, boundary.plan.datasetFingerprint);
    const beforeCounts = await profileCounts();
    await inspector.query("update dataset_rows set input = to_jsonb($2::text) where id = $1", [proposed.rows[0].id, "x".repeat(capacity + 1)]);
    await assert.rejects(store.getProvidedOutputInputs(active().scope.workspaceId, { datasetVersionId: selected.dataset.versionId, evalSetVersionId: selected.evalSetVersionId }), rejected(422));
    assert.deepEqual(await profileCounts(), beforeCounts);
  });

  test("PO-PG06 exact lost-response retries replay one frozen record after source mutation and deletion", async () => {
    const selected = await selection(), p = await preview(selected), first = await save(p.request), beforeCounts = await profileCounts();
    await inspector.query("update dataset_rows set input = '{\"changed\":true}'::jsonb where dataset_version_id = $1", [selected.dataset.versionId]);
    await inspector.query("delete from datasets where id = $1", [selected.dataset.id]);
    await inspector.query("delete from eval_sets where id = $1", [first.record.plan.evalSet.contract.setId]);
    const replay = await save(p.request, { ...active().scope, actorId: active().foreignScope.actorId });
    assert.equal(replay.replayed, true); assert.deepEqual(replay.record, first.record);
    assert.deepEqual(await read(p.request.draft.runId), first.record); assert.deepEqual(await profileCounts(), beforeCounts);
    const listed = await store.listProvidedOutputRuns(active().scope.workspaceId, callbacks.validateRecord);
    assert.equal(listed.runs.length, 1); assert.equal(listed.runs[0].runId, p.request.draft.runId); assert.equal(listed.hasMore, false);
  });

  test("PO-PG07 a changed request cannot reuse a committed public run identity", async () => {
    const selected = await selection(), p = await preview(selected), first = await save(p.request), beforeCounts = await profileCounts();
    const changed = await preview(selected, { runId: p.request.draft.runId, output: "DIFFERENT actual response" });
    await assert.rejects(save(changed.request), rejected(409, "provided_output_storage_conflict"));
    assert.deepEqual(await read(p.request.draft.runId), first.record); assert.deepEqual(await profileCounts(), beforeCounts);
  });

  test("PO-PG08 preview drift in saved sources refuses a new run without writing its old plan", async () => {
    const selected = await selection(), p = await preview(selected);
    await inspector.query("update dataset_rows set history = '[\"changed history\"]'::jsonb where id = $1", [selected.dataset.rows[0].id]);
    await assert.rejects(save(p.request), rejected(409, "provided_output_preview_changed"));
    assert.equal(await read(p.request.draft.runId), undefined); assert.deepEqual(await profileCounts(), emptyCounts);
    const reviewed = await preview(selected, { runId: p.request.draft.runId });
    assert.equal((await save(reviewed.request)).replayed, false);
  });

  test("PO-PG09 workspace-bound source selection, public IDs and retrieval never adopt foreign data", async () => {
    const selected = await selection(), p = await preview(selected), first = await save(p.request);
    const foreign = active().foreignScope;
    assert.equal(await read(p.request.draft.runId, foreign.workspaceId), undefined);
    assert.equal(await store.getProvidedOutputInputs(foreign.workspaceId, { datasetVersionId: selected.dataset.versionId, evalSetVersionId: selected.evalSetVersionId }), undefined);
    await assert.rejects(save(p.request, foreign), rejected(404, "provided_output_not_found"));
    const foreignSelection = await selection({ scope: foreign }), other = await preview(foreignSelection, { runId: p.request.draft.runId });
    const second = await save(other.request, foreign);
    assert.notEqual(second.record.plan.id, first.record.plan.id); assert.notEqual(second.record.plan.runId, first.record.plan.runId);
    assert.deepEqual(await read(p.request.draft.runId), first.record);
    assert.deepEqual(await read(p.request.draft.runId, foreign.workspaceId), second.record);
  });

  test("PO-PG10 exact JSONB numeric value loss is refused before hashing or persistence", async () => {
    const selected = await selection(), rowId = selected.dataset.rows[0].id;
    for (const raw of ['{"nested":{"unsafe":9007199254740993}}', '{"nested":{"close":0.10000000000000001}}', '{"nested":{"tiny":1e-1000}}']) {
      await inspector.query("update dataset_rows set input = $2::jsonb where id = $1", [rowId, raw]);
      const stored = (await inspector.query("select input::text as raw from dataset_rows where id = $1", [rowId])).rows[0].raw;
      await assert.rejects(store.getProvidedOutputInputs(active().scope.workspaceId, { datasetVersionId: selected.dataset.versionId, evalSetVersionId: selected.evalSetVersionId }), rejected(422, "provided_output_dataset_precision"));
      assert.equal((await inspector.query("select input::text as raw from dataset_rows where id = $1", [rowId])).rows[0].raw, stored);
      assert.deepEqual(await profileCounts(), emptyCounts);
    }
    await inspector.query("update dataset_rows set input = '{\"equivalent\":2.0}'::jsonb where id = $1", [rowId]);
    assert.equal((await preview(selected)).inputs.dataset.rows.find(row => row.id === rowId).input.equivalent, 2);
  });

  test("PO-PG11 corrupt plan, sample, result, gate and audit projections fail closed without repair", async () => {
    const p = await preview(await selection()), saved = await save(p.request), runId = saved.record.plan.runId;
    const beforeCounts = await profileCounts();
    const mutations = [
      async () => { const original = (await inspector.query("select resolved_plan from run_plans where id = $1", [saved.record.plan.id])).rows[0].resolved_plan;
        const altered = structuredClone(original); altered.requestFingerprint = "0".repeat(64);
        await inspector.query("update run_plans set resolved_plan = $2::jsonb where id = $1", [saved.record.plan.id, JSON.stringify(altered)]);
        return () => inspector.query("update run_plans set resolved_plan = $2::jsonb where id = $1", [saved.record.plan.id, JSON.stringify(original)]); },
      async () => { const row = (await inspector.query("select id, snapshot_hash from run_samples where eval_run_id = $1 order by id limit 1", [runId])).rows[0];
        await inspector.query("update run_samples set snapshot_hash = $2 where id = $1", [row.id, "0".repeat(64)]);
        return () => inspector.query("update run_samples set snapshot_hash = $2 where id = $1", [row.id, row.snapshot_hash]); },
      async () => { const row = (await inspector.query("select id, normalized_fields from eval_results where eval_run_id = $1 order by id limit 1", [runId])).rows[0];
        await inspector.query("update eval_results set normalized_fields = '[]'::jsonb where id = $1", [row.id]);
        return () => inspector.query("update eval_results set normalized_fields = $2::jsonb where id = $1", [row.id, JSON.stringify(row.normalized_fields)]); },
      async () => { const row = (await inspector.query("select id, passed from gate_results where eval_run_id = $1 and level = 'run'", [runId])).rows[0];
        await inspector.query("update gate_results set passed = not passed where id = $1", [row.id]);
        return () => inspector.query("update gate_results set passed = $2 where id = $1", [row.id, row.passed]); },
      async () => { const row = (await inspector.query("select id, metadata_hash from audit_events where workspace_id = $1 and action = 'provided_output.run.saved'", [active().scope.workspaceId])).rows[0];
        await inspector.query("update audit_events set metadata_hash = $2 where id = $1", [row.id, "0".repeat(64)]);
        return () => inspector.query("update audit_events set metadata_hash = $2 where id = $1", [row.id, row.metadata_hash]); }
    ];
    for (const mutate of mutations) {
      const restore = await mutate();
      try { await assert.rejects(read(p.request.draft.runId), rejected(409, "provided_output_storage_conflict"));
        await assert.rejects(save(p.request), rejected(409, "provided_output_storage_conflict")); assert.deepEqual(await profileCounts(), beforeCounts); }
      finally { await restore(); }
      assert.deepEqual(await read(p.request.draft.runId), saved.record);
    }
  });

  test("PO-PG12 legacy readers hide private envelopes and legacy writers cannot alter profile identities", async () => {
    const p = await preview(await selection()), saved = await save(p.request), beforeCounts = await profileCounts();
    assert.deepEqual(await service.listRunBatches(active().scope.workspaceId), []);
    assert.equal(await service.getRunBatch(active().scope.workspaceId, saved.record.plan.id), undefined);
    const makeLegacy = () => {
      const plan = legacyEngine.resolveRunPlan({ id: `legacy_${randomUUID()}`, targetId: "authored-legacy-target", targetKind: "provided_output",
        rows: [{ id: `legacy-row-${randomUUID()}`, input: "authored", output: "APPROVED", metadata: {}, reviewStatus: "reviewed" }], evalSet: p.inputs.evalSet.contract });
      const results = plan.sampleManifest.rows.map(sample => legacyEngine.runDeterministicEval(p.inputs.evalSet.contract.itemVersions[0].item, sample));
      return { plan, results, gates: legacyEngine.evaluateGates(plan.id, p.inputs.evalSet.contract, results) };
    };
    const byId = makeLegacy(); byId.plan.id = saved.record.plan.id;
    const byHash = makeLegacy(); byHash.plan.planFingerprint = saved.record.plan.fingerprint;
    const byKey = makeLegacy(); byKey.idempotencyKey = `provided-output-run-v1:${p.request.draft.runId}`;
    const byMarker = makeLegacy(); byMarker.plan.schemaVersion = "provided-output-run-record-v1";
    for (const input of [byId, byHash, byKey, byMarker]) await assert.rejects(service.persistEvalRun(active().scope.workspaceId, input),
      error => { assert.equal(error.status, 409); assert.equal(error.message, "provided_output_legacy_collision"); return true; });
    await assert.rejects(service.persistEvalRun(active().foreignScope.workspaceId, byHash), error => {
      assert.equal(error.status, 409); assert.equal(error.message, "provided_output_legacy_collision"); return true;
    });
    assert.deepEqual(await read(p.request.draft.runId), saved.record); assert.deepEqual(await profileCounts(), beforeCounts);
  });

  test("PO-PG13 an actual audit trigger failure rolls back the complete run transaction", async () => {
    const p = await preview(await selection()), suffix = randomUUID().replaceAll("-", ""), functionName = `po_rollback_${suffix}`, triggerName = `po_audit_${suffix}`;
    let functionOid, triggerOid;
    try {
      await inspector.query(`create function public.${functionName}() returns trigger language plpgsql as $$ begin
        if NEW.workspace_id = '${active().scope.workspaceId}' and NEW.action = 'provided_output.run.saved' then
          raise exception 'provided_output_authored_rollback' using errcode = 'P0001'; end if; return NEW; end $$`);
      functionOid = (await inspector.query("select to_regprocedure($1)::oid as oid", [`public.${functionName}()`])).rows[0].oid;
      await inspector.query(`create trigger ${triggerName} before insert on public.audit_events for each row execute function public.${functionName}()`);
      triggerOid = (await inspector.query("select oid from pg_trigger where tgname = $1 and tgrelid = 'public.audit_events'::regclass and tgfoid = $2::oid", [triggerName, functionOid])).rows[0].oid;
      await assert.rejects(save(p.request), error => { assert.equal(error.code, "P0001"); return true; });
      assert.deepEqual(await profileCounts(), emptyCounts); assert.equal(await read(p.request.draft.runId), undefined);
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
    assert.equal((await save(p.request)).replayed, false);
  });

  test("PO-PG14 positively blocked concurrent workspace writers accept one immutable intent", async () => {
    const selected = await selection(), runId = randomUUID(), left = await preview(selected, { runId, output: "APPROVED left" }), right = await preview(selected, { runId, output: "right fails configured text" });
    const blocker = new Client({ connectionString, ssl: false, application_name: `${applicationName}_blocker`,
      connectionTimeoutMillis: 5_000, statement_timeout: 15_000, query_timeout: 17_000 });
    let pending, released = false;
    await blocker.connect();
    try {
      await blocker.query("begin"); const pid = (await blocker.query("select pg_backend_pid() as pid")).rows[0].pid;
      await blocker.query("select id from workspaces where id = $1 for update", [active().scope.workspaceId]);
      pending = Promise.allSettled([save(left.request), save(right.request)]);
      let waiting = 0;
      for (let attempt = 0; attempt < 125; attempt++) {
        waiting = Number((await inspector.query(`select count(*) from pg_stat_activity a where a.datname = current_database()
          and a.application_name = $1 and a.wait_event_type = 'Lock' and ($2::int = any(pg_blocking_pids(a.pid)) or exists (
            select 1 from pg_stat_activity predecessor where predecessor.pid = any(pg_blocking_pids(a.pid))
              and predecessor.datname = current_database() and predecessor.application_name = $1
              and $2::int = any(pg_blocking_pids(predecessor.pid))))`, [applicationName, pid])).rows[0].count);
        if (waiting === 2) break;
        await delay(40);
      }
      assert.equal(waiting, 2, "both actual writers must reach the held workspace lock before release");
      await blocker.query("commit"); released = true;
      const settled = await pending, accepted = settled.filter(result => result.status === "fulfilled"), refused = settled.filter(result => result.status === "rejected");
      assert.equal(accepted.length, 1); assert.equal(refused.length, 1); assert.equal(accepted[0].value.replayed, false);
      rejected(409, "provided_output_storage_conflict")(refused[0].reason);
      assert.deepEqual(await read(runId), accepted[0].value.record);
      const winner = accepted[0].value.record.plan.fingerprint === left.plan.fingerprint ? left.request : right.request;
      assert.equal((await save(winner)).replayed, true);
      assert.deepEqual(await profileCounts(), { plans: "1", runs: "1", samples: "2", results: "2", gates: "11", audits: "1" });
    } finally {
      try { if (!released) await blocker.query("rollback"); }
      finally { try { await pending; } finally { await blocker.end(); } }
    }
  });
});

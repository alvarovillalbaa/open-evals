import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

// T3 owner-SQL checks. This file never creates/migrates/drops a database or starts an app.
// Explicit invocation: node --import tsx --test tests/integration/custom-datasets.node.mjs
const MARKER = "open-evals-custom-datasets-20261109-created-disposable-v1";
const ACTION = "custom_dataset.version.saved";
const applicationName = `oe_custom_dataset_${randomUUID().replaceAll("-", "")}`;
const environmentKeys = ["DATABASE_URL", "POSTGRES_URL", "SUPABASE_DB_URL", "DATABASE_SSL", "SUPABASE_DB_SSL"];
const previousEnvironment = new Map(environmentKeys.map(key => [key, process.env[key]]));
let Client, inspector, connectionString, databaseName, fixture;
let core, customCore, providedCore, store, customStore, providedStore, service, stableHash, stableStringify;

function guardedUrl() {
  assert.equal(process.env.CUSTOM_DATASET_TEST_ALLOW, "local-disposable");
  let url;
  try { url = new URL(process.env.CUSTOM_DATASET_TEST_DATABASE_URL ?? ""); }
  catch { throw new Error("explicit owned test database URL required"); }
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "65432"); assert.equal(url.username, "postgres");
  assert.match(url.pathname, /^\/oe_custom_datasets_test_[0-9]+_[0-9]+$/);
  assert.equal(url.search, ""); assert.equal(url.hash, "");
  databaseName = url.pathname.slice(1);
  return url.toString();
}
async function verifyDatabase() {
  const rows = (await inspector.query(`select current_database() as name, shobj_description(d.oid, 'pg_database') as marker,
    pg_get_userbyid(d.datdba) as owner, current_user as actor, host(inet_server_addr()) as address,
    inet_server_port() as port from pg_database d where d.datname = current_database()`)).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, databaseName); assert.equal(rows[0].marker, MARKER);
  assert.equal(rows[0].owner, "postgres"); assert.equal(rows[0].actor, "postgres"); assert.equal(rows[0].port, 65432);
  assert.ok(["127.0.0.1", "::ffff:127.0.0.1"].includes(rows[0].address));
  const names = ["users", "workspaces", "workspace_memberships", "datasets", "dataset_versions", "dataset_rows",
    "eval_sets", "eval_set_versions", "eval_items", "eval_item_versions", "eval_set_item_versions", "audit_events",
    "run_plans", "eval_runs", "run_samples", "eval_results", "gate_results"];
  const tables = (await inspector.query("select name, to_regclass('public.' || name)::text as relation from unnest($1::text[]) name", [names])).rows;
  assert.equal(tables.length, names.length); assert.ok(tables.every(row => row.name === row.relation));
}
function active() { assert.ok(fixture?.created, "owned fixture must exist"); return fixture; }
const plain = value => JSON.parse(JSON.stringify(value));
// Core JSON copies use null prototypes; PostgreSQL readback is compared by complete JSON values.
const equalJson = (actual, expected) => assert.deepEqual(plain(actual), plain(expected));
const callbacks = {
  prepare: input => core.prepareCustomDatasetVersionRecord(input),
  restore: input => core.restoreCustomDatasetVersionRecord(input)
};
function rejected(status, code) {
  return error => { assert.equal(error.status, status); if (code) assert.equal(error.code, code); return true; };
}
function save(request, scope = active().scope, bridge = callbacks) { return store.saveCustomDatasetVersion(scope, request, bridge); }
function read(saved, scope = active().scope) {
  return store.getCustomDatasetVersion(scope.workspaceId, saved.content.dataset.publicId, saved.content.version.publicId);
}
function rows() {
  return [
    { rowKey: "Alpha", input: { prompt: "Authored alpha" }, expectedOutput: null, history: ["earlier authored turn"],
      traceFixture: { authored: true }, metadata: { provenance: "authored" }, reviewStatus: "reviewed" },
    { rowKey: "Beta", input: "Authored beta", context: null, metadata: { language: "en" }, reviewStatus: "synthetic" }
  ];
}
function draft(patch = {}) {
  return core.prepareCustomDatasetDraft({ schemaVersion: "custom-dataset-draft-v1", datasetId: randomUUID(), versionId: randomUUID(),
    version: 1, expectedVersionId: null, name: "Authored custom examples", format: "json", defaultReviewStatus: null,
    sourceText: JSON.stringify(rows()), ...patch });
}
async function intent(patch = {}, scope = active().scope) {
  const value = draft(patch), head = await store.getCustomDatasetHead(scope.workspaceId, value.datasetId);
  const preview = core.resolveCustomDatasetPreview({ workspaceId: scope.workspaceId, draft: value, head });
  const request = core.prepareCustomDatasetSaveRequest({ schemaVersion: "custom-dataset-save-v1", draft: value,
    expectedPreviewFingerprint: preview.fingerprint });
  return { draft: value, preview, request };
}
async function append(first, patch = {}, scope = active().scope) {
  return intent({ datasetId: first.content.dataset.publicId, name: first.content.dataset.name,
    versionId: randomUUID(), version: first.content.version.version + 1, expectedVersionId: first.content.version.publicId, ...patch }, scope);
}
async function evaluator(scope = active().scope) {
  const cached = active().evaluators.get(scope.workspaceId);
  if (cached) return cached;
  const prepared = customCore.prepareCustomEvalSet({ schemaVersion: "custom-eval-set-draft-v1", setId: randomUUID(),
    versionId: randomUUID(), version: 1, expectedVersionId: null, name: "Authored response check", contains: "APPROVED", datasetPassRateThreshold: 50 });
  const saved = await customStore.saveCustomEvalSet(scope, prepared);
  active().evaluators.set(scope.workspaceId, saved.version.id);
  return saved.version.id;
}
async function scoringInputs(record, scope = active().scope) {
  return providedStore.getProvidedOutputInputs(scope.workspaceId, {
    datasetVersionId: record.content.version.id, evalSetVersionId: await evaluator(scope)
  });
}
async function corruptReads(record) {
  await assert.rejects(read(record), rejected(409, "custom_dataset_storage_conflict"));
  await assert.rejects(scoringInputs(record), rejected(409, "custom_dataset_storage_conflict"));
}
async function counts() {
  return (await inspector.query(`select
    (select count(*)::int from datasets where workspace_id = any($1::text[])) as datasets,
    (select count(*)::int from dataset_versions v join datasets d on d.id = v.dataset_id where d.workspace_id = any($1::text[])) as versions,
    (select count(*)::int from dataset_rows r join dataset_versions v on v.id = r.dataset_version_id join datasets d on d.id = v.dataset_id where d.workspace_id = any($1::text[])) as rows,
    (select count(*)::int from audit_events where workspace_id = any($1::text[]) and action = '${ACTION}') as audits,
    (select count(*)::int from run_plans where workspace_id = any($1::text[])) as plans,
    (select count(*)::int from eval_runs where workspace_id = any($1::text[])) as runs`, [active().workspaceIds])).rows[0];
}
const emptyCounts = { datasets: 0, versions: 0, rows: 0, audits: 0, plans: 0, runs: 0 };
async function insertRow(versionId, row) {
  await inspector.query(`insert into dataset_rows
    (id, dataset_version_id, row_key, input, expected_output, context, history, trace_fixture, metadata, review_status)
    values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10)`,
  [row.id, versionId, row.rowKey, JSON.stringify(row.input), row.expectedOutput.present ? JSON.stringify(row.expectedOutput.value) : null,
    row.context.present ? JSON.stringify(row.context.value) : null, row.history.present ? JSON.stringify(row.history.value) : null,
    row.traceFixture.present ? JSON.stringify(row.traceFixture.value) : null, JSON.stringify(row.metadata), row.reviewStatus]);
}
async function cleanupFixture() {
  if (!fixture?.created) return;
  await verifyDatabase();
  const f = fixture;
  const workspaces = (await inspector.query("select id, name from workspaces where id = any($1::text[])", [f.workspaceIds])).rows;
  assert.equal(workspaces.length, 2);
  for (const row of workspaces) assert.equal(row.name, `${applicationName}:${row.id}`);
  const users = (await inspector.query("select id, email, name from users where id = any($1::text[])", [f.actorIds])).rows;
  assert.equal(users.length, 2);
  for (const user of users) { assert.equal(user.name, applicationName); assert.equal(user.email, `${user.id}@custom-dataset.invalid`); }
  await inspector.query("begin");
  try {
    await inspector.query("delete from eval_runs where workspace_id = any($1::text[])", [f.workspaceIds]);
    await inspector.query("delete from run_plans where workspace_id = any($1::text[])", [f.workspaceIds]);
    await inspector.query("delete from datasets where workspace_id = any($1::text[])", [f.workspaceIds]);
    await inspector.query("delete from eval_sets where workspace_id = any($1::text[])", [f.workspaceIds]);
    await inspector.query("delete from eval_items where workspace_id = any($1::text[])", [f.workspaceIds]);
    await inspector.query("delete from audit_events where workspace_id = any($1::text[])", [f.workspaceIds]);
    assert.deepEqual(await counts(), emptyCounts);
    await inspector.query("delete from workspaces where id = any($1::text[])", [f.workspaceIds]);
    await inspector.query("delete from users where id = any($1::text[])", [f.actorIds]);
    assert.equal((await inspector.query("select id from workspaces where id = any($1::text[])", [f.workspaceIds])).rowCount, 0);
    assert.equal((await inspector.query("select id from users where id = any($1::text[])", [f.actorIds])).rowCount, 0);
    await inspector.query("commit"); fixture = undefined;
  } catch (error) { await inspector.query("rollback"); throw error; }
}

describe("custom dataset persistence [T3; owner SQL only]", { concurrency: false, timeout: 300_000 }, () => {
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
    core = await import("../../packages/core/src/custom-datasets.ts");
    customCore = await import("../../packages/core/src/custom-evals.ts");
    providedCore = await import("../../packages/core/src/provided-output-runs.ts");
    ({ stableHash, stableStringify } = await import("../../packages/core/src/hash.ts"));
    store = await import("../../packages/db/src/custom-datasets.ts");
    customStore = await import("../../packages/db/src/custom-evals.ts");
    providedStore = await import("../../packages/db/src/provided-output-runs.ts");
    service = await import("../../packages/db/src/service.ts");
  });
  beforeEach(async () => {
    await verifyDatabase();
    const workspaceIds = [randomUUID(), randomUUID()], actorIds = [randomUUID(), randomUUID()];
    fixture = { workspaceIds, actorIds, scope: { workspaceId: workspaceIds[0], actorId: actorIds[0] },
      foreignScope: { workspaceId: workspaceIds[1], actorId: actorIds[1] }, evaluators: new Map(), created: false };
    await inspector.query("begin");
    try {
      for (const [index, id] of workspaceIds.entries()) {
        await inspector.query("insert into users (id, email, name) values ($1, $2, $3)", [actorIds[index], `${actorIds[index]}@custom-dataset.invalid`, applicationName]);
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

  test("CD-PG01 complete creation roundtrips references, presence, user metadata and one deterministic audit", async () => {
    const source = rows();
    source[0].metadata = JSON.parse('{"provenance":"authored","__proto__":{"safe":"own data"},"constructor":{"safe":"data"},"toJSON":"literal"}');
    const p = await intent({ sourceText: JSON.stringify(source) }), result = await save(p.request), record = result.record;
    assert.equal(result.replayed, false); equalJson(await read(record), record);
    assert.equal(record.content.fingerprint, p.preview.content.fingerprint);
    assert.deepEqual(record.snapshot.rows[0].expectedOutput, { present: true, value: null });
    assert.deepEqual(record.snapshot.rows[0].context, { present: false, value: null });
    assert.deepEqual(record.snapshot.rows[1].context, { present: true, value: null });
    const raw = (await inspector.query("select input, expected_output is null as absent_expected, expected_output, context is null as absent_context, history, trace_fixture, metadata, review_status from dataset_rows where id = $1", [record.snapshot.rows[0].id])).rows[0];
    assert.equal(raw.absent_expected, false); assert.equal(raw.expected_output, null); assert.equal(raw.absent_context, true);
    assert.deepEqual(raw.input, { prompt: "Authored alpha" }); assert.deepEqual(raw.metadata, source[0].metadata);
    assert.equal(Object.hasOwn(raw.metadata, "__proto__"), true); assert.equal(raw.metadata.toJSON, "literal");
    assert.equal({}.safe, undefined);
    assert.deepEqual(raw.history, ["earlier authored turn"]); assert.deepEqual(raw.trace_fixture, { authored: true }); assert.equal(raw.review_status, "reviewed");
    const ids = core.customDatasetStorageIds(active().scope.workspaceId, p.draft.datasetId, p.draft.versionId);
    const audit = (await inspector.query("select id, workspace_id, actor_user_id, action, resource_type, resource_id, metadata_hash, metadata from audit_events where id = $1", [ids.auditId])).rows;
    assert.deepEqual(audit, [{ id: ids.auditId, workspace_id: active().scope.workspaceId, actor_user_id: active().scope.actorId,
      action: ACTION, resource_type: "custom_dataset_version", resource_id: ids.versionId,
      metadata_hash: stableHash(record.manifest, 64), metadata: plain(record.manifest) }]);
    assert.equal(Object.hasOwn(record.manifest, "sourceText"), false); assert.equal(Object.hasOwn(record.manifest, "rows"), false);
    assert.deepEqual(await counts(), { datasets: 1, versions: 1, rows: 2, audits: 1, plans: 0, runs: 0 });
  });

  test("CD-PG02 append history retains more than twenty versions and exact old-version lookup", async () => {
    let record = (await save((await intent()).request)).record;
    const first = record;
    for (let version = 2; version <= 22; version++) record = (await save((await append(record)).request)).record;
    const detail = await store.getCustomDataset(active().scope.workspaceId, first.content.dataset.publicId);
    assert.equal(detail.versions.length, 20); assert.equal(detail.hasMore, true);
    assert.deepEqual(detail.versions.map(row => row.version), Array.from({ length: 20 }, (_, index) => 22 - index));
    assert.equal(detail.versions.some(row => row.id === first.content.version.publicId), false);
    equalJson(await read(first), first);
    assert.deepEqual(await store.getCustomDatasetHead(active().scope.workspaceId, first.content.dataset.publicId), core.customDatasetHeadFromRecord(record));
    const catalog = await store.listCustomDatasets(active().scope.workspaceId);
    assert.equal(catalog.datasets.length, 1); assert.equal(catalog.hasMore, false);
    assert.equal(catalog.datasets[0].versionCount, 22); assert.equal(catalog.datasets[0].head.id, record.content.version.publicId);
  });

  test("CD-PG03 exact replay precedes the latest head even when a later version has become corrupt", async () => {
    const firstIntent = await intent(), first = (await save(firstIntent.request)).record;
    const second = (await save((await append(first)).request)).record;
    await inspector.query("update dataset_rows set metadata = '{\"later_corruption\":true}'::jsonb where id = $1", [second.snapshot.rows[0].id]);
    const before = await counts(), replay = await save(firstIntent.request);
    assert.equal(replay.replayed, true); equalJson(replay.record, first); assert.deepEqual(await counts(), before);
    await assert.rejects(store.getCustomDatasetHead(active().scope.workspaceId, first.content.dataset.publicId), rejected(409));
    equalJson(await read(first), first);
  });

  test("CD-PG04 reused public version identity rejects changed raw spelling, format and explicit defaults", async () => {
    const p = await intent(), saved = (await save(p.request)).record, before = await counts();
    const changes = [r => { r.draft.sourceText += " "; }, r => { r.draft.defaultReviewStatus = "reviewed"; },
      r => { r.draft.format = "jsonl"; r.draft.sourceText = rows().map(row => JSON.stringify(row)).join("\n"); }];
    for (const change of changes) {
      const altered = plain(p.request); change(altered);
      await assert.rejects(save(altered), rejected(409, "custom_dataset_identity_conflict"));
      equalJson(await read(saved), saved); assert.deepEqual(await counts(), before);
    }
  });

  test("CD-PG05 competing prepared heads use CAS and immutable names without partial versions", async () => {
    const first = (await save((await intent()).request)).record;
    const left = await append(first), right = await append(first);
    const second = (await save(left.request)).record, before = await counts();
    await assert.rejects(save(right.request), rejected(409, "custom_dataset_version_conflict"));
    const rename = { schemaVersion: "custom-dataset-save-v1", draft: { ...plain(second.manifest.intent), schemaVersion: "custom-dataset-draft-v1",
      datasetId: second.content.dataset.publicId, versionId: randomUUID(), version: 3, expectedVersionId: second.content.version.publicId,
      name: "Renamed", sourceText: JSON.stringify(rows()) }, expectedPreviewFingerprint: "0".repeat(64) };
    delete rename.draft.workspaceId; delete rename.draft.sourceDigest; delete rename.draft.contentFingerprint; delete rename.draft.fingerprint;
    await assert.rejects(save(rename), rejected(409, "custom_dataset_name_immutable"));
    assert.deepEqual(await counts(), before); equalJson(await read(second), second);
  });

  test("CD-PG06 equal public identities remain workspace-scoped across stored IDs, readback and scoring selection", async () => {
    const firstIntent = await intent(), first = (await save(firstIntent.request)).record, foreign = active().foreignScope;
    assert.equal(await store.getCustomDatasetVersion(foreign.workspaceId, first.content.dataset.publicId, first.content.version.publicId), undefined);
    const foreignInputs = await providedStore.getProvidedOutputInputs(foreign.workspaceId, {
      datasetVersionId: first.content.version.id, evalSetVersionId: await evaluator(foreign)
    });
    assert.equal(foreignInputs, undefined);
    const otherIntent = await intent({ ...plain(firstIntent.draft) }, foreign), other = (await save(otherIntent.request, foreign)).record;
    assert.notEqual(other.content.dataset.id, first.content.dataset.id); assert.notEqual(other.content.version.id, first.content.version.id);
    assert.notEqual(other.snapshot.rows[0].id, first.snapshot.rows[0].id);
    equalJson(await read(first), first); equalJson(await read(other, foreign), other);
    assert.equal((await store.listCustomDatasets(foreign.workspaceId)).datasets[0].storageDatasetId, other.content.dataset.id);
  });

  test("CD-PG07 exactly one hundred rows persist while a new one-hundred-and-first row is refused intact", async () => {
    const records = Array.from({ length: 100 }, (_, index) => ({ rowKey: String(index).padStart(3, "0"), input: index }));
    const p = await intent({ sourceText: JSON.stringify(records), defaultReviewStatus: "reviewed" }), saved = (await save(p.request)).record;
    assert.equal(saved.snapshot.rows.length, 100); assert.equal(new Set(saved.snapshot.rows.map(row => row.id)).size, 100);
    const before = await counts(), rejectedDraft = draft({ sourceText: JSON.stringify([...records, { rowKey: "extra", input: 100 }]), defaultReviewStatus: "reviewed" });
    await assert.rejects(save({ schemaVersion: "custom-dataset-save-v1", draft: rejectedDraft, expectedPreviewFingerprint: "0".repeat(64) }), rejected(422, "custom_dataset_row_count"));
    assert.deepEqual(await counts(), before);
    assert.equal((await inspector.query("select count(*)::int as count from dataset_rows where dataset_version_id = $1", [saved.content.version.id])).rows[0].count, 100);
  });

  test("CD-PG08 the exact one-MiB complete snapshot boundary includes names, generated identities and wrappers", async () => {
    const source = [{ rowKey: "A", input: "" }], baseDraft = draft({ sourceText: JSON.stringify(source), defaultReviewStatus: "reviewed" });
    const initial = core.resolveCustomDatasetPreview({ workspaceId: active().scope.workspaceId, draft: baseDraft, head: null });
    source[0].input = "x".repeat(1_048_576 - initial.canonicalSnapshotBytes);
    const at = await intent({ ...plain(baseDraft), sourceText: JSON.stringify(source) }), saved = (await save(at.request)).record;
    assert.equal(Buffer.byteLength(stableStringify(saved.snapshot)), 1_048_576); equalJson(await read(saved), saved);
    const before = await counts(); source[0].input += "x";
    const overflow = draft({ ...plain(baseDraft), datasetId: randomUUID(), versionId: randomUUID(), sourceText: JSON.stringify(source) });
    await assert.rejects(save({ schemaVersion: "custom-dataset-save-v1", draft: overflow, expectedPreviewFingerprint: "0".repeat(64) }), rejected(422, "custom_dataset_snapshot_invalid"));
    assert.deepEqual(await counts(), before);
  });

  test("CD-PG09 raw file numeric loss fails before any dataset, version, row or audit is written", async () => {
    for (const token of ["9007199254740993", "0.10000000000000001", "1e-1000"]) {
      const d = draft({ sourceText: `[{"rowKey":"A","input":{"nested":${token}}}]`, defaultReviewStatus: "reviewed" });
      await assert.rejects(save({ schemaVersion: "custom-dataset-save-v1", draft: d, expectedPreviewFingerprint: "0".repeat(64) }), rejected(422, "custom_dataset_source_precision"));
      assert.deepEqual(await counts(), emptyCounts);
    }
  });

  test("CD-PG10 changed JSONB numeric values are refused through both readers without repairing stored data", async () => {
    const saved = (await save((await intent()).request)).record, row = saved.snapshot.rows[0];
    for (const raw of ['{"nested":9007199254740993}', '{"nested":0.10000000000000001}', '{"nested":1e-1000}']) {
      await inspector.query("update dataset_rows set input = $2::jsonb where id = $1", [row.id, raw]);
      const stored = (await inspector.query("select input::text as raw from dataset_rows where id = $1", [row.id])).rows[0].raw;
      await corruptReads(saved);
      assert.equal((await inspector.query("select input::text as raw from dataset_rows where id = $1", [row.id])).rows[0].raw, stored);
    }
    await inspector.query("update dataset_rows set input = $2::jsonb where id = $1", [row.id, JSON.stringify(row.input)]);
    equalJson(await read(saved), saved);
  });

  test("CD-PG11 complete row content and identity corruption cannot pass either immutable reader", async () => {
    const saved = (await save((await intent()).request)).record, row = saved.snapshot.rows[0], changedId = `changed_${randomUUID()}`;
    const changes = [
      ["input", JSON.stringify("changed"), JSON.stringify(row.input)],
      ["metadata", '{"changed":true}', JSON.stringify(row.metadata)],
      ["expected_output", null, JSON.stringify(row.expectedOutput.value)],
      ["review_status", "golden", row.reviewStatus], ["id", changedId, row.id]
    ];
    for (const [column, changed, original] of changes) {
      const json = ["input", "metadata", "expected_output"].includes(column) ? "::jsonb" : "";
      await inspector.query(`update dataset_rows set ${column} = $2${json} where id = $1`, [row.id, changed]);
      try { await corruptReads(saved); }
      finally { await inspector.query(`update dataset_rows set ${column} = $2${json} where id = $1`, [column === "id" ? changedId : row.id, original]); }
    }
    equalJson(await read(saved), saved);
  });

  test("CD-PG12 missing and extra row membership is rejected rather than silently sampled or repaired", async () => {
    const saved = (await save((await intent()).request)).record, row = saved.snapshot.rows[0];
    await inspector.query("delete from dataset_rows where id = $1", [row.id]);
    await corruptReads(saved); await insertRow(saved.content.version.id, row);
    const extra = { ...plain(row), id: core.customDatasetRowId(active().scope.workspaceId, saved.content.dataset.publicId,
      saved.content.version.publicId, "Extra"), rowKey: "Extra" };
    await insertRow(saved.content.version.id, extra);
    await corruptReads(saved); await inspector.query("delete from dataset_rows where id = $1", [extra.id]);
    equalJson(await read(saved), saved);
  });

  test("CD-PG13 literal review-status types are checked even when forged manifest fingerprints are recomputed", async () => {
    const p = await intent(), saved = (await save(p.request)).record, ids = core.customDatasetStorageIds(active().scope.workspaceId, p.draft.datasetId, p.draft.versionId);
    let called = 0;
    const coercion = plain(p.request); coercion.draft.defaultReviewStatus = ["reviewed"];
    await assert.rejects(save(coercion, active().scope, { ...callbacks, prepare(input) { called++; return callbacks.prepare(input); } }), rejected(422, "custom_dataset_invalid"));
    assert.equal(called, 0);
    const altered = plain(saved.manifest); altered.intent.defaultReviewStatus = ["reviewed"];
    const { fingerprint: ignored, ...intentBody } = altered.intent; altered.intent.fingerprint = stableHash(intentBody, 64);
    altered.previewFingerprint = stableHash({ schemaVersion: "custom-dataset-preview-v1", workspaceId: active().scope.workspaceId,
      intent: altered.intent, head: altered.head, content: saved.content,
      canonicalSnapshotBytes: Buffer.byteLength(stableStringify(saved.snapshot)), createdAtByteAllowance: 24 }, 64);
    altered.requestFingerprint = stableHash({ schemaVersion: "custom-dataset-request-fingerprint-v1", workspaceId: active().scope.workspaceId,
      intent: altered.intent, expectedPreviewFingerprint: altered.previewFingerprint }, 64);
    await inspector.query("update audit_events set metadata = $2::jsonb, metadata_hash = $3 where id = $1", [ids.auditId, JSON.stringify(altered), stableHash(altered, 64)]);
    await corruptReads(saved);
    assert.throws(() => core.restoreCustomDatasetVersionRecord({ workspaceId: active().scope.workspaceId, snapshot: saved.snapshot, manifest: altered }), rejected(409));
  });

  test("CD-PG14 missing, duplicate and changed audit projections fail closed independently of complete row storage", async () => {
    const p = await intent(), saved = (await save(p.request)).record, ids = core.customDatasetStorageIds(active().scope.workspaceId, p.draft.datasetId, p.draft.versionId);
    const original = (await inspector.query("select * from audit_events where id = $1", [ids.auditId])).rows[0];
    for (const [column, changed] of [["metadata_hash", "0".repeat(64)], ["actor_user_id", null], ["resource_type", "other"], ["action", "other"]]) {
      await inspector.query(`update audit_events set ${column} = $2 where id = $1`, [ids.auditId, changed]);
      try { await corruptReads(saved); }
      finally { await inspector.query(`update audit_events set ${column} = $2 where id = $1`, [ids.auditId, original[column]]); }
    }
    await inspector.query("delete from audit_events where id = $1", [ids.auditId]); await corruptReads(saved);
    await inspector.query(`insert into audit_events (id, workspace_id, actor_user_id, action, resource_type, resource_id, metadata_hash, metadata)
      values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [original.id, original.workspace_id, original.actor_user_id, original.action,
      original.resource_type, original.resource_id, original.metadata_hash, JSON.stringify(original.metadata)]);
    const duplicate = `authored_duplicate_${randomUUID()}`;
    await inspector.query(`insert into audit_events (id, workspace_id, actor_user_id, action, resource_type, resource_id, metadata_hash, metadata)
      values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [duplicate, original.workspace_id, original.actor_user_id, original.action,
      original.resource_type, original.resource_id, original.metadata_hash, JSON.stringify(original.metadata)]);
    await corruptReads(saved); await inspector.query("delete from audit_events where id = $1", [duplicate]);
    equalJson(await read(saved), saved);
  });

  test("CD-PG15 private namespace and kind markers are excluded while literal near-prefix legacy names remain visible", async () => {
    const saved = (await save((await intent()).request)).record;
    const nearId = `customXdataset_${randomUUID()}`, nearVersion = `customXdatasetXversion_${randomUUID()}`;
    await inspector.query("insert into datasets (id,workspace_id,name,kind) values ($1,$2,'Authored near-prefix legacy','user')", [nearId, active().scope.workspaceId]);
    await inspector.query("insert into dataset_versions (id,dataset_id,version,fingerprint) values ($1,$2,1,'authored-legacy')", [nearVersion, nearId]);
    const nearRow = { ...plain(saved.snapshot.rows[0]), id: `customXdatasetXrow_${randomUUID()}`, rowKey: "Near" };
    await insertRow(nearVersion, nearRow);
    const first = await service.listBenchmarks(active().scope.workspaceId);
    assert.deepEqual(first.datasets.map(row => row.id), [nearId]);
    const customCatalog = await store.listCustomDatasets(active().scope.workspaceId);
    assert.equal(customCatalog.datasets[0].storageDatasetId, saved.content.dataset.id);
    const markers = [
      { id: `authored_kind_${randomUUID()}`, versionId: `authored_kind_version_${randomUUID()}`, rowId: `authored_kind_row_${randomUUID()}`, kind: "custom-dataset-v1" },
      { id: `custom_dataset_${"a".repeat(64)}`, versionId: `authored_id_version_${randomUUID()}`, rowId: `authored_id_row_${randomUUID()}`, kind: "user" },
      { id: `authored_version_${randomUUID()}`, versionId: `custom_dataset_version_${"b".repeat(64)}`, rowId: `authored_version_row_${randomUUID()}`, kind: "user" },
      { id: `authored_row_${randomUUID()}`, versionId: `authored_row_version_${randomUUID()}`, rowId: `custom_dataset_row_${"c".repeat(64)}`, kind: "user" }
    ];
    for (const marker of markers) {
      await inspector.query("insert into datasets (id,workspace_id,name,kind) values ($1,$2,'Authored corrupt marker',$3)", [marker.id, active().scope.workspaceId, marker.kind]);
      await inspector.query("insert into dataset_versions (id,dataset_id,version,fingerprint) values ($1,$2,1,'authored-corrupt')", [marker.versionId, marker.id]);
      await insertRow(marker.versionId, { ...plain(saved.snapshot.rows[0]), id: marker.rowId, rowKey: "Marker" });
      await assert.rejects(providedStore.getProvidedOutputInputs(active().scope.workspaceId, {
        datasetVersionId: marker.versionId, evalSetVersionId: await evaluator()
      }), rejected(409, "custom_dataset_storage_conflict"));
    }
    assert.deepEqual((await service.listBenchmarks(active().scope.workspaceId)).datasets.map(row => row.id), [nearId]);
    const ordinary = await providedStore.getProvidedOutputInputs(active().scope.workspaceId, { datasetVersionId: nearVersion, evalSetVersionId: await evaluator() });
    assert.equal(ordinary.dataset.version.id, nearVersion);
  });

  test("CD-PG16 own orphan manifests are conflicts without disclosing foreign orphan state through raw scoring IDs", async () => {
    const p = await intent(), saved = (await save(p.request)).record;
    await inspector.query("delete from dataset_versions where id = $1", [saved.content.version.id]);
    await assert.rejects(read(saved), rejected(409, "custom_dataset_storage_conflict"));
    await assert.rejects(scoringInputs(saved), rejected(409, "custom_dataset_storage_conflict"));
    const foreign = active().foreignScope;
    assert.equal(await providedStore.getProvidedOutputInputs(foreign.workspaceId, {
      datasetVersionId: saved.content.version.id, evalSetVersionId: await evaluator(foreign)
    }), undefined);
    const cleanMissing = core.customDatasetStorageIds(active().scope.workspaceId, p.draft.datasetId, randomUUID()).versionId;
    assert.equal(await providedStore.getProvidedOutputInputs(active().scope.workspaceId, {
      datasetVersionId: cleanMissing, evalSetVersionId: await evaluator()
    }), undefined);
    await assert.rejects(save(p.request), rejected(409, "custom_dataset_storage_conflict"));
  });

  test("CD-PG17 a real audit trigger failure rolls back dataset, version and every inserted row", async () => {
    const p = await intent(), suffix = randomUUID().replaceAll("-", ""), functionName = `cd_rollback_${suffix}`, triggerName = `cd_audit_${suffix}`;
    let functionOid, triggerOid;
    try {
      await inspector.query(`create function public.${functionName}() returns trigger language plpgsql as $$ begin
        if NEW.workspace_id = '${active().scope.workspaceId}' and NEW.action = '${ACTION}' then
          raise exception 'custom_dataset_authored_rollback' using errcode = 'P0001'; end if; return NEW; end $$`);
      functionOid = (await inspector.query("select to_regprocedure($1)::oid as oid", [`public.${functionName}()`])).rows[0].oid;
      await inspector.query(`create trigger ${triggerName} before insert on public.audit_events for each row execute function public.${functionName}()`);
      triggerOid = (await inspector.query("select oid from pg_trigger where tgname=$1 and tgrelid='public.audit_events'::regclass and tgfoid=$2::oid", [triggerName, functionOid])).rows[0].oid;
      await assert.rejects(save(p.request), error => { assert.equal(error.code, "P0001"); return true; });
      assert.deepEqual(await counts(), emptyCounts);
      assert.equal(await store.getCustomDatasetVersion(active().scope.workspaceId, p.draft.datasetId, p.draft.versionId), undefined);
    } finally {
      if (triggerOid) {
        assert.equal((await inspector.query("select oid from pg_trigger where tgname=$1 and tgrelid='public.audit_events'::regclass and tgfoid=$2::oid", [triggerName, functionOid])).rows[0]?.oid, triggerOid);
        await inspector.query(`drop trigger ${triggerName} on public.audit_events`);
      }
      if (functionOid) {
        assert.equal((await inspector.query("select to_regprocedure($1)::oid as oid", [`public.${functionName}()`])).rows[0].oid, functionOid);
        await inspector.query(`drop function public.${functionName}()`);
      }
    }
    assert.equal((await save(p.request)).replayed, false);
  });

  test("CD-PG18 positively blocked concurrent creators accept only one immutable initial version", async () => {
    const left = await intent(), right = await intent({ datasetId: left.draft.datasetId });
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
      assert.equal(waiting, 2, "both actual writers must reach the owned held workspace lock");
      await blocker.query("commit"); released = true;
      const settled = await pending, accepted = settled.filter(row => row.status === "fulfilled"), refused = settled.filter(row => row.status === "rejected");
      assert.equal(accepted.length, 1); assert.equal(refused.length, 1); assert.equal(accepted[0].value.replayed, false);
      rejected(409, "custom_dataset_version_conflict")(refused[0].reason);
      const winner = accepted[0].value.record, winningRequest = winner.content.version.publicId === left.draft.versionId ? left.request : right.request;
      equalJson(await read(winner), winner); assert.equal((await save(winningRequest)).replayed, true);
      assert.deepEqual(await counts(), { datasets: 1, versions: 1, rows: 2, audits: 1, plans: 0, runs: 0 });
    } finally {
      try { if (!released) await blocker.query("rollback"); }
      finally { try { await pending; } finally { await blocker.end(); } }
    }
  });

  test("CD-PG19 actual saved timestamps, names and profile kind remain integrity-bound through both readers", async () => {
    const saved = (await save((await intent()).request)).record;
    const changes = [
      ["dataset_versions", "created_at", saved.content.version.id, "2026-11-10T00:00:00.000Z", saved.manifest.createdAt],
      ["datasets", "name", saved.content.dataset.id, "Changed immutable name", saved.content.dataset.name],
      ["datasets", "kind", saved.content.dataset.id, "user", "custom-dataset-v1"]
    ];
    for (const [table, column, id, changed, original] of changes) {
      await inspector.query(`update ${table} set ${column}=$2 where id=$1`, [id, changed]);
      try {
        await corruptReads(saved);
        assert.equal((await service.listBenchmarks(active().scope.workspaceId)).datasets.some(row => row.id === saved.content.dataset.id), false);
      } finally { await inspector.query(`update ${table} set ${column}=$2 where id=$1`, [id, original]); }
    }
    equalJson(await read(saved), saved);
  });

  test("CD-PG20 saved custom versions feed actual-output scoring and frozen run replay survives source deletion", async () => {
    const saved = (await save((await intent()).request)).record, inputs = await scoringInputs(saved);
    equalJson(inputs.dataset, saved.snapshot);
    const draft = providedCore.prepareProvidedOutputRunDraft({ schemaVersion: "provided-output-run-draft-v1", runId: randomUUID(),
      datasetVersionId: saved.content.version.id, evalSetVersionId: inputs.evalSet.contract.id,
      outputs: saved.snapshot.rows.map((row, index) => ({ rowId: row.id, output: index === 0 ? "" : "APPROVED actual response" })) });
    const plan = providedCore.resolveProvidedOutputRun({ workspaceId: active().scope.workspaceId, draft, ...inputs });
    const request = providedCore.prepareProvidedOutputRunRequest({ schemaVersion: "provided-output-run-request-v1", draft, expectedPlanFingerprint: plan.fingerprint });
    const bridge = { prepare: providedCore.prepareProvidedOutputRunRecord, validateRecord: providedCore.parseProvidedOutputRunRecord };
    const run = await providedStore.saveProvidedOutputRun(active().scope, request, bridge);
    assert.equal(run.replayed, false); equalJson(run.record.plan.dataset, saved.snapshot);
    assert.equal(run.record.execution.results.length, 2);
    assert.equal(run.record.execution.gates.find(gate => gate.level === "dataset").passed, true);
    assert.equal(run.record.execution.gates.find(gate => gate.level === "run").passed, false);
    assert.equal(run.record.plan.draft.outputs.find(output => output.rowId === saved.snapshot.rows[0].id).output, "");
    assert.equal(run.record.plan.policy.maxTargetCalls, 0); assert.equal(run.record.plan.policy.maxJudgeCalls, 0);
    equalJson(await read(saved), saved);
    await inspector.query("delete from datasets where id=$1", [saved.content.dataset.id]);
    const replay = await providedStore.saveProvidedOutputRun(active().scope, request, bridge);
    assert.equal(replay.replayed, true); equalJson(replay.record, run.record);
    equalJson(await providedStore.getProvidedOutputRun(active().scope.workspaceId, draft.runId, providedCore.parseProvidedOutputRunRecord), run.record);
    assert.deepEqual(await counts(), { datasets: 0, versions: 0, rows: 0, audits: 1, plans: 1, runs: 1 });
  });
});

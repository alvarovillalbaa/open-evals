import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createInstructionFixture, expectStatus } from "./instruction-authoring.fixtures.mjs";

// Prepared integration scope. Do not run against a hosted service or an existing database.
// Start the two loopback Next servers sequentially and apply all three unchanged migrations.
// This uses owner SQL credentials: it checks application access, not Supabase RLS behavior.
let fixture, prefix, id, workspace, otherWorkspace, project, otherProject, target, otherTarget, foreignTarget;
let ownerId, editorId, owner, editor, viewer, foreignOwner, keys, demoBase;
let request, sql, definitionInput, definitionPath, literal, preview, save, removeRollbackTrigger;
let rollbackFunction, rollbackTrigger;
const state = {};
const privateBinding = "KEEP_BINDING_PRIVATE_authored_fixture";

before(async () => {
  fixture = await createInstructionFixture();
  ({ prefix, id, workspaceId: workspace, otherWorkspaceId: otherWorkspace, projectId: project, otherProjectId: otherProject,
    targetId: target, otherTargetId: otherTarget, foreignTargetId: foreignTarget, ownerId, editorId, owner, editor, viewer,
    foreignOwner, keys, demoBaseURL: demoBase, request, sql, definitionInput, definitionPath, literal, preview, save,
    rollbackFunction, rollbackTrigger, removeRollbackTrigger } = fixture);
});

after(async () => {
  await fixture?.cleanup();
});

test("unauthenticated instruction requests fail before malformed request parsing", async () => {
  expectStatus(await request("/api/v1/instructions", { auth: null }), 401);
  expectStatus(await request("/api/v1/instructions", { auth: null, method: "POST", raw: "{" }), 401);
  expectStatus(await request("/api/v1/prompts/resolve", { auth: null, method: "POST", body: null }), 401);
});

test("viewer sessions can read but cannot create, preview or save", async () => {
  expectStatus(await request("/api/v1/instructions", { auth: viewer }), 200);
  for (const path of ["/api/v1/instructions", definitionPath(id("missing"), "/preview"), definitionPath(id("missing"), "/versions")]) {
    expectStatus(await request(path, { auth: viewer, method: "POST", raw: "{" }), 403);
  }
});

test("persisted project API keys enforce separate read and write scopes", async () => {
  expectStatus(await request("/api/v1/instructions", { auth: keys.read }), 200);
  expectStatus(await request("/api/v1/instructions", { auth: keys.write }), 403);
  expectStatus(await request("/api/v1/instructions", { auth: keys.neither }), 403);
  expectStatus(await request("/api/v1/instructions", { auth: keys.read, method: "POST", body: definitionInput("scope_read") }), 403);
  expectStatus(await request("/api/v1/instructions", { auth: keys.write, method: "POST", body: definitionInput("scope_write") }), 201);
});

test("empty definition creation returns a recoverable saved detail", async () => {
  state.definition = definitionInput("main");
  const created = expectStatus(await request("/api/v1/instructions", { method: "POST", body: state.definition }), 201);
  assert.equal(created.replayed, false);
  assert.deepEqual(created.definition, state.definition);
  const detail = expectStatus(await request(definitionPath(state.definition.id)), 200);
  assert.deepEqual(detail.versions, []);
  assert.equal(detail.selectedVersion, null);
  assert.equal(detail.canWrite, true);
  assert.equal(expectStatus(await request(definitionPath(state.definition.id), { auth: viewer }), 200).canWrite, false);
  const row = (await sql("select variable_schema, component_schema from prompt_definitions where id = $1", [state.definition.id]))[0];
  assert.deepEqual(row, { variable_schema: {}, component_schema: {} });
});

test("same creation intent replays across authorized sessions with one audit event", async () => {
  for (const auth of [owner, editor]) {
    const result = expectStatus(await request("/api/v1/instructions", { auth, method: "POST", body: state.definition }), 200);
    assert.equal(result.replayed, true);
  }
  assert.equal(await auditCount(state.definition.id, "prompt.definition.created"), 1);
});

test("definition identity and stable-key reuse conflict without exposing foreign rows", async () => {
  expectStatus(await request("/api/v1/instructions", { method: "POST", body: { ...state.definition, stableKey: id("changed_key") } }), 409);
  expectStatus(await request("/api/v1/instructions", { method: "POST", body: { ...state.definition, id: id("duplicate_key") } }), 409);
  const foreign = definitionInput("foreign_identity", foreignTarget);
  expectStatus(await request("/api/v1/instructions", { auth: foreignOwner, method: "POST", body: foreign }), 201);
  expectStatus(await request("/api/v1/instructions", { method: "POST", body: { ...foreign, targetId: target } }), 409);
  expectStatus(await request(definitionPath(foreign.id)), 404);
});

test("concurrent creation serializes stable-key uniqueness through the workspace lock", async () => {
  const stableKey = id("concurrent_stable");
  const results = await Promise.all(["left", "right"].map(label => request("/api/v1/instructions", {
    method: "POST", body: { id: id(`concurrent_${label}`), stableKey, targetId: target }
  })));
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  assert.equal(Number((await sql("select count(*) as count from prompt_definitions where workspace_id = $1 and stable_key = $2", [workspace, stableKey]))[0].count), 1);
});

test("target ownership and project binding constrain creation and detail reads", async () => {
  expectStatus(await request("/api/v1/instructions", { method: "POST", body: definitionInput("foreign_target", foreignTarget) }), 404);
  expectStatus(await request("/api/v1/instructions", { auth: keys.both, method: "POST", body: { id: id("untargeted_key"), stableKey: id("untargeted_key") } }), 403);
  expectStatus(await request("/api/v1/instructions", { auth: keys.both, method: "POST", body: definitionInput("wrong_project", otherTarget) }), 404);
  state.otherDefinition = definitionInput("other_project_definition", otherTarget);
  expectStatus(await request("/api/v1/instructions", { method: "POST", body: state.otherDefinition }), 201);
  expectStatus(await request(definitionPath(state.otherDefinition.id), { auth: keys.both }), 404);
  expectStatus(await request(definitionPath(state.otherDefinition.id), { auth: keys.other }), 200);
  expectStatus(await request(definitionPath(state.definition.id), { auth: keys.foreign }), 404);
});

test("literal preview derives draft metadata without persisting a version", async () => {
  state.rootInput = literal("root");
  state.rootPreview = await preview(state.definition.id, state.rootInput);
  state.alternateRootPreview = await preview(state.definition.id, literal("root", "A different unlocked base."));
  assert.equal(state.rootPreview.version.status, "draft");
  assert.deepEqual(state.rootPreview.version.parentVersionIds, []);
  assert.match(state.rootPreview.requestFingerprint, /^[0-9a-f]{64}$/);
  assert.match(state.rootPreview.previewFingerprint, /^[0-9a-f]{64}$/);
  assert.equal((await sql("select id from prompt_versions where prompt_definition_id = $1", [state.definition.id])).length, 0);
  expectStatus(await request(definitionPath(state.definition.id, "/preview"), { method: "POST", body: { ...state.rootInput, status: "active" } }), 422);
});

test("root save and reload preserve exact materialized bytes, source and server ownership", async () => {
  state.rootSaved = await save(state.definition.id, state.rootInput, state.rootPreview);
  assert.equal(state.rootSaved.replayed, false);
  assert.deepEqual(state.rootSaved.version.version, state.rootPreview.version);
  const selected = expectStatus(await request(`${definitionPath(state.definition.id)}?versionId=${id("root")}`), 200).selectedVersion;
  assert.deepEqual(selected, state.rootSaved.version);
  const row = (await sql("select status, components from prompt_versions where id = $1", [id("root")]))[0];
  assert.equal(row.status, "draft");
  assert.equal(row.components.schemaVersion, "prompt-version-storage-v1");
  assert.equal(row.components.write.actorId, ownerId);
  assert.equal(row.components.write.requestFingerprint, state.rootPreview.requestFingerprint);
  assert.equal(await auditCount(id("root"), "prompt.version.created"), 1);
});

test("composition persistence retains unused bindings and named operation blocks", async () => {
  const definition = definitionInput("composed");
  expectStatus(await request("/api/v1/instructions", { method: "POST", body: definition }), 201);
  const input = {
    versionId: id("composed_root"),
    components: [{ id: "greeting", kind: "role", locked: false, operations: [{ op: "include", name: "greet" }] }],
    composition: {
      schemaVersion: "prompt-composition-v1",
      bindings: { name: { type: "string", value: "Ada" }, unused: { type: "json", value: { note: privateBinding } } },
      blocks: { greet: [{ op: "text", template: "Hello {{name}}" }], unused: [{ op: "text", template: "Later {{name}}" }] }
    }
  };
  const result = await save(definition.id, input, await preview(definition.id, input));
  const loaded = expectStatus(await request(definitionPath(definition.id)), 200).selectedVersion;
  assert.deepEqual(loaded, result.version);
  assert.equal(loaded.authoring, "composition");
  assert.equal(loaded.version.components[0].content, "Hello Ada");
  assert.deepEqual(loaded.version.compositionSnapshot.bindings.unused, input.composition.bindings.unused);
  assert.deepEqual(loaded.version.compositionSnapshot.blocks.unused, input.composition.blocks.unused);
});

test("a second root requires an explicit canonical base", async () => {
  const input = literal("second_root");
  expectStatus(await request(definitionPath(state.definition.id, "/preview"), { method: "POST", body: input }), 409);
  expectStatus(await request(definitionPath(state.definition.id, "/versions"), { method: "POST", body: { ...input, previewFingerprint: "0".repeat(64) } }), 409);
});

test("research siblings can fork from the same older canonical version", async () => {
  for (const label of ["child", "sibling"]) {
    const input = { ...literal(label, `Unlocked ${label}.`), baseVersionId: id("root") };
    const saved = await save(state.definition.id, input, await preview(state.definition.id, input));
    assert.deepEqual(saved.version.version.parentVersionIds, [id("root")]);
    assert.equal(saved.version.status, "draft");
  }
  const detail = expectStatus(await request(definitionPath(state.definition.id)), 200);
  assert.equal(detail.versions.length, 3);
  assert.ok(detail.versions.some(row => row.id === id("root")));
});

test("exact retries survive newer siblings while actor or intent reuse conflicts", async () => {
  const replay = await save(state.definition.id, state.rootInput, state.rootPreview, 200);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.version, state.rootSaved.version);
  expectStatus(await request(definitionPath(state.definition.id, "/versions"), { auth: editor, method: "POST", body: { ...state.rootInput, previewFingerprint: state.rootPreview.previewFingerprint } }), 409);
  expectStatus(await request(definitionPath(state.definition.id, "/versions"), { method: "POST", body: { ...literal("root", "Changed intent."), previewFingerprint: state.rootPreview.previewFingerprint } }), 409);
  const foreignPreview = expectStatus(await request(definitionPath(id("foreign_identity"), "/preview"), {
    auth: foreignOwner, method: "POST", body: literal("root")
  }), 200);
  assert.deepEqual(expectStatus(await request(definitionPath(id("foreign_identity"), "/versions"), {
    auth: foreignOwner, method: "POST", body: { ...literal("root"), previewFingerprint: foreignPreview.previewFingerprint }
  }), 409), { error: "prompt_version_identity_conflict" });
  assert.equal(await auditCount(id("root"), "prompt.version.created"), 1);
});

test("locked source changes are rejected before saving", async () => {
  const input = { ...literal("locked_change"), baseVersionId: id("root") };
  input.components[0].content = "Changed locked role.";
  expectStatus(await request(definitionPath(state.definition.id, "/preview"), { method: "POST", body: input }), 422);
  assert.equal((await sql("select id from prompt_versions where id = $1", [input.versionId])).length, 0);
});

test("source edits invalidate the reviewed preview without consuming the stable version ID", async () => {
  const input = { ...literal("edited_after_review"), baseVersionId: id("root") };
  const reviewed = await preview(state.definition.id, input);
  const edited = { ...literal("edited_after_review", "Edited after review."), baseVersionId: id("root") };
  expectStatus(await request(definitionPath(state.definition.id, "/versions"), { method: "POST", body: { ...edited, previewFingerprint: reviewed.previewFingerprint } }), 409);
  assert.equal((await sql("select id from prompt_versions where id = $1", [input.versionId])).length, 0);
  await save(state.definition.id, edited, await preview(state.definition.id, edited));
});

test("a changed canonical base invalidates review and fixture tampering is restored", async () => {
  const input = { ...literal("base_changed"), baseVersionId: id("root") };
  const reviewed = await preview(state.definition.id, input);
  const original = (await sql("select compiled_text, components, content_hash from prompt_versions where id = $1 and prompt_definition_id = $2", [id("root"), state.definition.id]))[0];
  const alternate = state.alternateRootPreview.version;
  const envelope = structuredClone(original.components);
  envelope.materializedComponents = alternate.components;
  envelope.source = { mode: "literal", components: alternate.components };
  envelope.sourceFingerprint = digest(envelope.source);
  try {
    await sql("update prompt_versions set compiled_text = $1, components = $2::jsonb, content_hash = $3 where id = $4 and prompt_definition_id = $5", [alternate.compiledText, JSON.stringify(envelope), alternate.contentHash, id("root"), state.definition.id]);
    const changed = expectStatus(await request(`${definitionPath(state.definition.id)}?versionId=${id("root")}`), 200).selectedVersion;
    assert.ok(changed.version, "the changed fixture must still decode as a canonical base");
    assert.notEqual(changed.version.contentHash, state.rootPreview.version.contentHash);
    expectStatus(await request(definitionPath(state.definition.id, "/versions"), { method: "POST", body: { ...input, previewFingerprint: reviewed.previewFingerprint } }), 409);
    assert.equal((await sql("select id from prompt_versions where id = $1", [input.versionId])).length, 0);
  } finally {
    await sql("update prompt_versions set compiled_text = $1, components = $2::jsonb, content_hash = $3 where id = $4 and prompt_definition_id = $5", [original.compiled_text, JSON.stringify(original.components), original.content_hash, id("root"), state.definition.id]);
  }
});

test("audit rows occur exactly once and contain only identifiers, hashes and counts", async () => {
  const rows = await sql("select action, resource_id, actor_user_id, metadata from audit_events where workspace_id = $1 order by id", [workspace]);
  const allowed = new Set(["definitionId", "versionId", "targetId", "creationIntentFingerprint", "parentVersionIds", "requestFingerprint", "previewFingerprint", "contentHash", "sourceFingerprint", "componentCount"]);
  for (const row of rows) {
    assert.ok(["prompt.definition.created", "prompt.version.created"].includes(row.action));
    assert.ok(Object.keys(row.metadata).every(key => allowed.has(key)));
    assert.ok(!JSON.stringify(row.metadata).includes(privateBinding));
    assert.ok(row.actor_user_id === ownerId || row.actor_user_id === editorId || row.actor_user_id.startsWith(`api_key:${prefix}`));
  }
  const versions = await sql("select v.id, count(a.id)::int as audits from prompt_versions v join prompt_definitions d on d.id = v.prompt_definition_id left join audit_events a on a.resource_id = v.id and a.workspace_id = d.workspace_id and a.action = 'prompt.version.created' where d.workspace_id = $1 group by v.id", [workspace]);
  assert.ok(versions.length > 0);
  assert.ok(versions.every(row => row.audits === 1));
});

test("audit insertion failure rolls the version back and permits the same reviewed retry", async () => {
  const input = { ...literal("audit_rollback"), baseVersionId: id("root") };
  const reviewed = await preview(state.definition.id, input);
  try {
    await sql(`create function ${rollbackFunction}() returns trigger language plpgsql as $$ begin raise exception 'owned_fixture_audit_failure'; end $$`);
    await sql(`create trigger ${rollbackTrigger} before insert on audit_events for each row when (new.resource_id = '${input.versionId}') execute function ${rollbackFunction}()`);
    const failed = await request(definitionPath(state.definition.id, "/versions"), { method: "POST", body: { ...input, previewFingerprint: reviewed.previewFingerprint } });
    expectStatus(failed, 503);
    assert.ok(!JSON.stringify(failed.body).includes("owned_fixture_audit_failure"));
    assert.equal((await sql("select id from prompt_versions where id = $1", [input.versionId])).length, 0);
    assert.equal(await auditCount(input.versionId, "prompt.version.created"), 0);
  } finally {
    await removeRollbackTrigger();
  }
  await save(state.definition.id, input, reviewed);
  assert.equal(await auditCount(input.versionId, "prompt.version.created"), 1);
});

test("drafts fail default resolve, explicit candidates work, and legacy active bytes stay unchanged", async () => {
  expectStatus(await request("/api/v1/prompts/resolve", { method: "POST", body: { definitionId: state.definition.id } }), 409);
  const candidate = expectStatus(await request("/api/v1/prompts/resolve", { method: "POST", body: { definitionId: state.definition.id, candidateVersionId: id("root") } }), 200);
  assert.deepEqual(candidate.appliedReleaseIds, ["explicit_eval_candidate_override"]);
  assert.equal(candidate.compiledText, state.rootPreview.version.compiledText);
  await legacyDefinition("legacy_active", target, workspace);
  const legacy = expectStatus(await request(definitionPath(id("legacy_active"))), 200).selectedVersion;
  assert.equal(legacy.readOnlyReason, "legacy_prompt_version");
  assert.equal(legacy.version, undefined);
  const resolved = expectStatus(await request("/api/v1/prompts/resolve", { method: "POST", body: { definitionId: id("legacy_active") } }), 200);
  assert.equal(resolved.compiledText, "legacy fixture bytes {{unexpanded}}");
  assert.equal(resolved.contentHash, "legacy-fixture-original-hash");
  expectStatus(await request(definitionPath(id("legacy_active"), "/preview"), { method: "POST", body: { ...literal("legacy_child"), baseVersionId: id("legacy_active_version") } }), 422);
});

test("catalog correlated aggregates avoid duplication and project filters cover related records", async () => {
  for (const [label, targetId, workspaceId] of [["catalog_own", target, workspace], ["catalog_other", otherTarget, workspace], ["catalog_foreign", foreignTarget, otherWorkspace]]) {
    await legacyDefinition(label, targetId, workspaceId);
    await sql("insert into optimization_campaigns (id, workspace_id, incumbent_prompt_version_id, status, frozen_contract) values ($1, $2, $3, 'draft', '{}'::jsonb)", [id(`${label}_campaign`), workspaceId, id(`${label}_version`)]);
    await sql("insert into optimization_candidates (id, campaign_id, prompt_version_id, generation, mutation_operator, hypothesis, status) values ($1, $2, $3, 1, 'fixture', 'authored fixture', 'draft')", [id(`${label}_candidate`), id(`${label}_campaign`), id(`${label}_version`)]);
    await sql("insert into online_experiments (id, workspace_id, prompt_definition_id, status, assignment_unit, policy) values ($1, $2, $3, 'draft', 'session', '{}'::jsonb)", [id(`${label}_experiment`), workspaceId, id(label)]);
    for (const stage of ["shadow", "canary"]) await sql("insert into prompt_releases (id, prompt_definition_id, prompt_version_id, scope_type, scope_id, stage, active) values ($1, $2, $3, 'project', $4, $5, false)", [id(`${label}_${stage}`), id(label), id(`${label}_version`), project, stage]);
  }
  const scoped = expectStatus(await request("/api/v1/instructions", { auth: keys.both }), 200);
  assert.ok(scoped.definitions.some(row => row.id === state.definition.id));
  assert.ok(scoped.definitions.every(row => row.targetId === target));
  assert.deepEqual(scoped.candidates.map(row => row.id), [id("catalog_own_candidate")]);
  assert.deepEqual(scoped.experiments.map(row => row.id), [id("catalog_own_experiment")]);
  assert.deepEqual(scoped.releases.map(row => row.id).sort(), [id("catalog_own_canary"), id("catalog_own_shadow")].sort());
  assert.ok(!JSON.stringify(scoped).includes(privateBinding));
  const summary = scoped.definitions.find(row => row.id === id("catalog_own"));
  assert.equal(summary.versions.length, 1);
  assert.equal(summary.releases.length, 2);
  assert.equal(Object.hasOwn(summary.versions[0], "components"), false);
  assert.equal(Object.hasOwn(summary.versions[0], "compiled_text"), false);
  const unscoped = expectStatus(await request("/api/v1/instructions"), 200);
  assert.ok(unscoped.definitions.some(row => row.id === state.otherDefinition.id));
  assert.ok(unscoped.definitions.every(row => row.id !== id("catalog_foreign")));
});

test("project keys cannot cross projects and configured keys without projects fail closed", async () => {
  const legacyKey = { authorization: "Bearer oe_instruction_disposable_legacy_only" };
  for (const auth of [legacyKey, keys.both]) {
    if (auth === legacyKey) {
      assert.equal(expectStatus(await request("/api/v1/instructions", { auth }), 403).error, "instruction_project_key_required");
      assert.equal(expectStatus(await request("/api/v1/instructions", { auth, method: "POST", body: definitionInput("no_project_key") }), 403).error, "instruction_project_key_required");
      expectStatus(await request("/api/v1/prompts/resolve", { auth, method: "POST", body: { definitionId: state.definition.id } }), 403);
    } else {
      expectStatus(await request(definitionPath(state.otherDefinition.id, "/preview"), { auth, method: "POST", body: literal("cross_project") }), 404);
      expectStatus(await request("/api/v1/prompts/resolve", { auth, method: "POST", body: { definitionId: id("catalog_other"), projectId: otherProject } }), 404);
    }
  }
});

test("HTTP boundaries reject malformed, oversized, spoofed and ambiguous requests", async () => {
  expectStatus(await request("/api/v1/instructions", { method: "POST", raw: "{" }), 400);
  expectStatus(await request("/api/v1/instructions", { method: "POST", body: definitionInput("wrong_media"), headers: { "content-type": "text/plain" } }), 400);
  expectStatus(await request("/api/v1/instructions", { method: "POST", body: { ...definitionInput("spoof"), workspaceId: otherWorkspace } }), 400);
  expectStatus(await request("/api/v1/instructions", { method: "POST", body: { ...definitionInput("reserved"), id: "constructor" } }), 422);
  expectStatus(await request(definitionPath(state.definition.id, "/preview"), { method: "POST", body: { ...literal("spoof_source"), actorId: ownerId, parentVersionIds: [] } }), 422);
  expectStatus(await request(`${definitionPath(state.definition.id)}?versionId=${id("root")}&versionId=${id("child")}`), 400);
  expectStatus(await request(`${definitionPath(state.definition.id)}?versionId=${id("missing_version")}`), 404);
  for (const body of [null, [], "value", { definitionId: 123 }, { definitionId: "\ud800" }, { definitionId: state.definition.id, status: "active" }]) {
    expectStatus(await request("/api/v1/prompts/resolve", { method: "POST", body }), 400);
  }
  expectStatus(await request("/api/v1/instructions", { method: "POST", raw: `{"padding":"${"x".repeat(2 * 1024 * 1024)}"}` }), 413);
  const oversizedStream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(`{"padding":"${"x".repeat(2 * 1024 * 1024)}"}`));
    controller.close();
  } });
  expectStatus(await request("/api/v1/instructions", { method: "POST", raw: oversizedStream }), 413);
});

test("hosted deployment flags deny implicit local-demo writes before persistence", async () => {
  const beforeCount = Number((await sql("select count(*) as count from prompt_definitions"))[0].count);
  expectStatus(await request("/api/v1/instructions", { auth: null, origin: demoBase }), 200);
  expectStatus(await request("/api/v1/instructions", { auth: null, origin: demoBase, method: "POST", body: definitionInput("blocked_local_demo") }), 403);
  expectStatus(await request(definitionPath(id("blocked_local_demo_definition"), "/preview"), { auth: null, origin: demoBase, method: "POST", body: literal("blocked_local_preview") }), 403);
  assert.equal(Number((await sql("select count(*) as count from prompt_definitions"))[0].count), beforeCount);
});

async function auditCount(resourceId, action) {
  return Number((await sql("select count(*) as count from audit_events where resource_id = $1 and action = $2 and workspace_id = $3", [resourceId, action, workspace]))[0].count);
}

async function legacyDefinition(label, targetId, workspaceId) {
  await sql("insert into prompt_definitions (id, workspace_id, target_id, stable_key) values ($1, $2, $3, $4)", [id(label), workspaceId, targetId, id(`${label}_stable`)]);
  await sql("insert into prompt_versions (id, prompt_definition_id, compiled_text, components, content_hash, status) values ($1, $2, $3, $4::jsonb, $5, 'active')", [id(`${label}_version`), id(label), "legacy fixture bytes {{unexpanded}}", JSON.stringify({ components: ["legacy-placeholder"] }), "legacy-fixture-original-hash"]);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function digest(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  decodePromptVersionRow, encodePromptVersionStorage, fingerprintPromptDraftRequest,
  inspectPromptVersionStorage, preparePromptDraft, promptDraftInputFromVersion,
  promptVersionSemanticFingerprint, validatePromptDraftInput
} from "../src/prompt-authoring.ts";
import { stableStringify } from "../src/hash.ts";
import { compilePromptVersion } from "../src/prompt.ts";

// Prepared only: execution requires separate approval for the authoring protocol scope.
const owner = { workspaceId: "workspace-a", actorId: "actor-a", definitionId: "definition-a" };
const clone = value => structuredClone(value);
const text = template => ({ op: "text", template });
const digest = value => createHash("sha256").update(stableStringify(value)).digest("hex");

function literal(versionId = "version-a") {
  return { versionId, components: [
    { id: "role", kind: "role", locked: true, content: "Help carefully." },
    { id: "rules", kind: "rules", locked: false, content: "Read before writing." }
  ] };
}

function composed(versionId = "version-a") {
  return {
    versionId,
    components: [{ id: "greeting", kind: "role", locked: false, operations: [{ op: "include", name: "greet" }] }],
    composition: {
      schemaVersion: "prompt-composition-v1",
      bindings: { name: { type: "string", value: "Ada" }, unused: { type: "json", value: { z: 2, a: 1 } } },
      blocks: { greet: [text("Hello {{name}}")], unused: [text("Future {{name}}!")] }
    }
  };
}

function saved(preview, context = owner) {
  return {
    id: preview.version.id, definitionId: preview.version.definitionId,
    compiledText: preview.version.compiledText, contentHash: preview.version.contentHash,
    parentVersionIds: [...preview.version.parentVersionIds], status: preview.version.status,
    components: clone(encodePromptVersionStorage(preview, context)),
    createdAt: new Date("2026-10-28T12:34:56.000Z")
  };
}

function invalidAuthored(row) {
  const dto = decodePromptVersionRow(row);
  assert.equal(dto.version, undefined);
  assert.equal(dto.readOnlyReason, "invalid_authored_version");
  return dto;
}

test("literal preview and stored row retain exact text, hash and server-derived draft", () => {
  const preview = preparePromptDraft(literal(), owner), dto = decodePromptVersionRow(saved(preview));
  assert.equal(preview.version.status, "draft");
  assert.deepEqual(preview.version.parentVersionIds, []);
  assert.equal(preview.version.compiledText, "<!-- role:role -->\nHelp carefully.\n\n<!-- rules:rules -->\nRead before writing.");
  assert.deepEqual(dto.version, preview.version);
  assert.equal(dto.authoring, "literal");
  assert.equal(dto.createdAt, "2026-10-28T12:34:56.000Z");
  assert.match(preview.requestFingerprint, /^[a-f0-9]{64}$/);
  assert.match(preview.previewFingerprint, /^[a-f0-9]{64}$/);
});

test("composed roundtrip retains unused bindings and libraries with a full source digest", () => {
  const preview = preparePromptDraft(composed(), owner), storage = encodePromptVersionStorage(preview, owner);
  const dto = decodePromptVersionRow(saved(preview));
  assert.equal(dto.authoring, "composition");
  assert.equal(dto.version.components[0].content, "Hello Ada");
  assert.deepEqual(dto.version.compositionSnapshot.blocks.unused, [text("Future {{name}}!")]);
  assert.deepEqual(dto.version.compositionSnapshot.bindings.unused.value, { a: 1, z: 2 });
  assert.equal(storage.sourceFingerprint, digest(storage.source));
  assert.equal(storage.sourceFingerprint.length, 64);
});

test("canonical request identity ignores record insertion order and omitted empty libraries", () => {
  const left = composed(), right = composed();
  right.composition.bindings = { unused: { type: "json", value: { a: 1, z: 2 } }, name: { type: "string", value: "Ada" } };
  right.composition.blocks = { unused: [text("Future {{name}}!")], greet: [text("Hello {{name}}") ] };
  assert.equal(fingerprintPromptDraftRequest(left, owner), fingerprintPromptDraftRequest(right, owner));
  const empty = { ...literal(), composition: { schemaVersion: "prompt-composition-v1", bindings: {} } };
  assert.equal(fingerprintPromptDraftRequest(empty, owner), fingerprintPromptDraftRequest({ ...empty, composition: { ...empty.composition, blocks: {} } }, owner));
});

test("request identity binds actor, workspace, definition, version and base without fetching a base", () => {
  const input = { ...literal(), baseVersionId: "old-base" }, original = fingerprintPromptDraftRequest(input, owner);
  for (const field of ["workspaceId", "actorId", "definitionId"]) {
    assert.notEqual(fingerprintPromptDraftRequest(input, { ...owner, [field]: `${owner[field]}-other` }), original, field);
  }
  for (const field of ["versionId", "baseVersionId"]) {
    assert.notEqual(fingerprintPromptDraftRequest({ ...input, [field]: `${input[field]}-other` }, owner), original, field);
  }
});

test("request identity binds unrendered source intent even when compiled output is unchanged", () => {
  const input = composed(), original = preparePromptDraft(input, owner);
  for (const change of [
    value => { value.composition.bindings.unused.value.z = 3; },
    value => { value.composition.blocks.unused[0].template = "Later {{name}}"; },
    value => { value.components[0].operations = [text("Hello {{name}}")]; }
  ]) {
    const next = clone(input); change(next);
    const result = preparePromptDraft(next, owner);
    assert.equal(result.version.compiledText, original.version.compiledText);
    assert.notEqual(result.requestFingerprint, original.requestFingerprint);
  }
});

test("preview changes when the same base identity has different valid immutable semantics", () => {
  const baseInput = literal("base"), first = preparePromptDraft(baseInput, owner).version;
  baseInput.components[1].content = "A different unlocked base.";
  const changed = preparePromptDraft(baseInput, owner).version;
  const input = { ...literal("child"), baseVersionId: "base" };
  const before = preparePromptDraft(input, owner, first), after = preparePromptDraft(input, owner, changed);
  assert.equal(before.requestFingerprint, after.requestFingerprint);
  assert.notEqual(before.previewFingerprint, after.previewFingerprint);
  assert.notEqual(promptVersionSemanticFingerprint(first), promptVersionSemanticFingerprint(changed));
});

test("base lifecycle transitions and creation of a sibling do not stale an identical review", () => {
  const base = preparePromptDraft(literal("base"), owner).version;
  const input = { ...literal("child"), baseVersionId: "base" };
  const before = preparePromptDraft(input, owner, base);
  preparePromptDraft({ ...literal("sibling"), baseVersionId: "base" }, owner, base);
  const active = { ...base, status: "active" }, retired = { ...base, status: "retired" };
  assert.equal(preparePromptDraft(input, owner, active).previewFingerprint, before.previewFingerprint);
  assert.equal(preparePromptDraft(input, owner, retired).previewFingerprint, before.previewFingerprint);
  assert.equal(promptVersionSemanticFingerprint(active), promptVersionSemanticFingerprint(retired));
});

test("an explicit fork can name an older canonical base and derives only that parent", () => {
  const old = preparePromptDraft(literal("older"), owner).version;
  const newer = preparePromptDraft({ ...literal("newer"), baseVersionId: old.id }, owner, old).version;
  const fork = preparePromptDraft({ ...literal("fork"), baseVersionId: old.id }, owner, old);
  assert.deepEqual(newer.parentVersionIds, [old.id]);
  assert.deepEqual(fork.version.parentVersionIds, [old.id]);
  assert.equal(decodePromptVersionRow(saved(fork)).version.id, "fork");
});

test("a changed binding cannot bypass the rendered content of a locked component", () => {
  const input = composed("base"); input.components[0].locked = true;
  const base = preparePromptDraft(input, owner).version;
  const next = composed("child"); next.components[0].locked = true;
  next.baseVersionId = base.id; next.composition.bindings.name.value = "Grace";
  assert.throws(() => preparePromptDraft(next, owner, base), /locked_component_changed/);
});

test("authoring preserves lock flags, contents and relative locked order", () => {
  const input = literal("base"); input.components[1].locked = true;
  const base = preparePromptDraft(input, owner).version;
  for (const change of [
    value => value.components.shift(),
    value => { value.components[0].locked = false; },
    value => { value.components[0].content = "Changed"; },
    value => value.components.reverse()
  ]) {
    const next = { ...literal("child"), baseVersionId: base.id }; next.components[1].locked = true; change(next);
    assert.throws(() => preparePromptDraft(next, owner, base), /locked_component/);
  }
});

test("base identity, definition and presence are verified with zero or one derived parent", () => {
  const base = preparePromptDraft(literal("base"), owner).version;
  assert.throws(() => preparePromptDraft({ ...literal(), baseVersionId: "base" }, owner), /base_required/);
  assert.throws(() => preparePromptDraft(literal(), owner, base), /unexpected_base/);
  assert.throws(() => preparePromptDraft({ ...literal(), baseVersionId: "other" }, owner, base), /base_identity_mismatch/);
  assert.throws(() => preparePromptDraft({ ...literal(), baseVersionId: "base" }, { ...owner, definitionId: "other" }, base), /definition_mismatch/);
  assert.throws(() => validatePromptDraftInput({ ...literal("same"), baseVersionId: "same" }), /invalid_parents/);
  assert.deepEqual(preparePromptDraft(literal(), owner).version.parentVersionIds, []);
});

test("draft requests reject unknown fields and all client authority fields", () => {
  for (const field of ["workspaceId", "actorId", "definitionId", "status", "compiledText", "parentVersionIds", "release", "previewFingerprint", "typo"]) {
    assert.throws(() => validatePromptDraftInput({ ...literal(), [field]: "untrusted" }), /unknown_field/, field);
  }
  assert.throws(() => validatePromptDraftInput({ ...literal(), baseVersionId: undefined }), /invalid_identifier/);
  assert.throws(() => validatePromptDraftInput({ ...literal(), composition: undefined }), /plain_record_required/);
});

test("component, binding and operation source shapes remain strict", () => {
  for (const change of [
    value => { value.components[0].extra = true; },
    value => { value.composition.extra = true; },
    value => { value.composition.bindings.name.extra = true; },
    value => { value.composition.blocks.greet[0].extra = true; }
  ]) {
    const value = composed(); change(value);
    assert.throws(() => validatePromptDraftInput(value), /unknown_field/);
  }
  const invalid = literal(); invalid.components[0].id = "__proto__";
  assert.throws(() => validatePromptDraftInput(invalid), /invalid_identifier/);
});

test("storage and write envelopes reject unknown fields, modes and schemas", () => {
  const row = saved(preparePromptDraft(composed(), owner));
  for (const change of [
    value => { value.extra = true; },
    value => { value.write.extra = true; },
    value => { value.source.extra = true; },
    value => { value.source.mode = "other"; },
    value => { value.schemaVersion = "prompt-version-storage-v2"; }
  ]) {
    const components = clone(row.components); change(components);
    assert.throws(() => inspectPromptVersionStorage(components));
    invalidAuthored({ ...row, components });
  }
});

test("all persisted fingerprints require complete lowercase SHA-256 and a valid actor", () => {
  const preview = preparePromptDraft(literal(), owner), row = saved(preview);
  for (const invalid of ["a".repeat(24), "A".repeat(64), "g".repeat(64), "a".repeat(63), "a".repeat(65)]) {
    for (const field of ["requestFingerprint", "previewFingerprint"]) {
      assert.throws(() => encodePromptVersionStorage({ ...preview, [field]: invalid }, owner), /sha256_required/);
      const storage = clone(row.components); storage.write[field] = invalid;
      assert.throws(() => inspectPromptVersionStorage(storage), /sha256_required/);
    }
    const storage = clone(row.components); storage.sourceFingerprint = invalid;
    assert.throws(() => inspectPromptVersionStorage(storage), /sha256_required/);
  }
  const invalidActor = clone(row.components); invalidActor.write.actorId = "";
  assert.throws(() => inspectPromptVersionStorage(invalidActor), /invalid_identifier/);
});

test("a format-valid but incorrect full source fingerprint invalidates an authored row", () => {
  const row = saved(preparePromptDraft(literal(), owner));
  row.components.sourceFingerprint = "0".repeat(64);
  assert.throws(() => inspectPromptVersionStorage(row.components), /source_fingerprint_mismatch/);
  invalidAuthored(row);
});

test("composition snapshot hashes and unrendered source tampering are recompiled exactly", () => {
  const original = saved(preparePromptDraft(composed(), owner));
  for (const change of [
    source => { source.snapshot.sourceHash = "0".repeat(24); },
    source => { source.snapshot.bindings.unused.value.a = 7; },
    source => { source.snapshot.blocks.unused[0].template = "Changed unused library"; }
  ]) {
    const row = clone(original); change(row.components.source);
    row.components.sourceFingerprint = digest(row.components.source);
    assert.throws(() => inspectPromptVersionStorage(row.components), /composition_snapshot_mismatch/);
    invalidAuthored(row);
  }
});

test("materialized content, lock, kind and component identity must exactly match source", () => {
  const original = saved(preparePromptDraft(literal(), owner));
  for (const [field, value] of [["content", "Forged"], ["locked", false], ["kind", "other"], ["id", "other"]]) {
    const row = clone(original); row.components.materializedComponents[0][field] = value;
    assert.throws(() => inspectPromptVersionStorage(row.components));
    invalidAuthored(row);
  }
});

test("authoritative text, content hash, status and invalid parent columns fail closed", () => {
  const original = saved(preparePromptDraft(literal(), owner));
  for (const change of [
    row => { row.compiledText += "Forged"; },
    row => { row.contentHash = "0".repeat(24); },
    row => { row.status = "unknown-status"; },
    row => { row.parentVersionIds = [row.id]; },
    row => { row.parentVersionIds = ["one", "two"]; }
  ]) {
    const row = clone(original); change(row); invalidAuthored(row);
  }
});

test("replay derivation binds authoritative row identity, definition and sole parent", () => {
  const preview = preparePromptDraft(literal(), owner), original = saved(preview);
  for (const change of [
    row => { row.id = "different-version"; },
    row => { row.definitionId = "different-definition"; },
    row => { row.parentVersionIds = ["different-base"]; }
  ]) {
    const row = clone(original); change(row);
    const dto = decodePromptVersionRow(row);
    assert.ok(dto.version);
    const context = { ...owner, definitionId: row.definitionId };
    assert.notEqual(fingerprintPromptDraftRequest(promptDraftInputFromVersion(dto.version), context), preview.requestFingerprint);
    assert.notEqual(promptVersionSemanticFingerprint(dto.version), promptVersionSemanticFingerprint(preview.version));
  }
});

test("legacy text, hash and unknown lifecycle status remain unchanged and view-only", () => {
  const row = saved(preparePromptDraft(literal(), owner));
  Object.assign(row, { components: [{ oldFormat: true }], compiledText: "Original historical text", contentHash: "historical-hash", status: "historical-status" });
  const dto = decodePromptVersionRow(row);
  assert.equal(dto.authoring, "legacy"); assert.equal(dto.readOnlyReason, "legacy_prompt_version");
  assert.equal(dto.compiledText, row.compiledText); assert.equal(dto.contentHash, row.contentHash);
  assert.equal(dto.status, "historical-status"); assert.equal(dto.version, undefined);
});

test("recognized malformed authored storage never silently falls back to ordinary legacy", () => {
  const original = saved(preparePromptDraft(literal(), owner));
  for (const components of [
    { schemaVersion: "prompt-version-storage-v1" },
    { materializedComponents: [] },
    { sourceFingerprint: "a".repeat(64) },
    { write: {} },
    { ...clone(original.components), source: { mode: "literal", components: null } }
  ]) invalidAuthored({ ...original, components });
});

test("normalized drafts, previews, storage and decoded records are detached and deeply frozen", () => {
  const input = composed(), normalized = validatePromptDraftInput(input), preview = preparePromptDraft(input, owner);
  input.composition.bindings.name.value = "Mutated"; input.components.length = 0;
  assert.equal(normalized.composition.bindings.name.value, "Ada");
  assert.equal(preview.version.components[0].content, "Hello Ada");
  const raw = saved(preview), inspected = inspectPromptVersionStorage(raw.components), dto = decodePromptVersionRow(raw);
  raw.components.source.snapshot.bindings.name.value = "Later"; raw.parentVersionIds.push("later");
  assert.equal(inspected.source.snapshot.bindings.name.value, "Ada");
  assert.deepEqual(dto.parentVersionIds, []);
  for (const object of [normalized, normalized.components, normalized.composition.bindings.name, preview, preview.version,
    inspected, inspected.source.snapshot.blocks.unused, inspected.write, dto, dto.version.components[0]]) assert.equal(Object.isFrozen(object), true);
  assert.throws(() => { inspected.write.actorId = "changed"; }, TypeError);
  assert.throws(() => { dto.version.components[0].locked = true; }, TypeError);
});

test("retry re-derives exact source intent without a base and rejects context or request substitution", () => {
  const base = preparePromptDraft(composed("base"), owner).version;
  const input = { ...composed("child"), baseVersionId: base.id };
  const preview = preparePromptDraft(input, owner, base), dto = decodePromptVersionRow(saved(preview));
  const derived = promptDraftInputFromVersion(dto.version);
  assert.equal(fingerprintPromptDraftRequest(derived, owner), preview.requestFingerprint);
  assert.deepEqual(derived, validatePromptDraftInput(input));
  assert.throws(() => encodePromptVersionStorage(preview, { ...owner, actorId: "another" }), /request_mismatch/);
  assert.throws(() => encodePromptVersionStorage({ ...preview, requestFingerprint: "0".repeat(64) }, owner), /request_mismatch/);
  assert.throws(() => encodePromptVersionStorage({ ...preview, version: { ...preview.version, status: "active" } }, owner), /invalid_draft_owner/);
});

test("NUL is rejected in literal, rendered and unused source strings including JSON keys", () => {
  const changes = [
    value => { value.components[0].operations = [text("NUL\u0000")]; },
    value => { value.composition.bindings.name.value = "Ada\u0000"; },
    value => { value.composition.bindings.unused.value.a = "Unused\u0000"; },
    value => { value.composition.blocks.unused[0].template = "Unused\u0000"; },
    value => { value.composition.bindings.unused.value["key\u0000"] = true; }
  ];
  for (const change of changes) { const value = composed(); change(value); assert.throws(() => preparePromptDraft(value, owner), /unpersistable_unicode/); }
  const raw = literal(); raw.components[0].content = "Literal\u0000";
  assert.throws(() => validatePromptDraftInput(raw), /unpersistable_unicode/);
});

test("isolated UTF-16 surrogates fail storage validation even in unused libraries and keys", () => {
  for (const invalid of ["\ud800", "\udfff", "A\ud800B", "\ud800\ud800"]) {
    for (const change of [
      value => { value.components[0].operations = [text(invalid)]; },
      value => { value.composition.bindings.unused.value.a = invalid; },
      value => { value.composition.blocks.unused[0].template = invalid; },
      value => { value.composition.bindings.unused.value[invalid] = true; }
    ]) { const value = composed(); change(value); assert.throws(() => preparePromptDraft(value, owner), /unpersistable_unicode/); }
  }
  assert.throws(() => fingerprintPromptDraftRequest(literal(), { ...owner, actorId: "actor\ud800" }), /unpersistable_unicode/);
});

test("valid astral pairs and ordinary Unicode survive preview, storage and reload exactly", () => {
  const value = composed(); value.composition.bindings.name.value = "Ada 🌍 ñ e\u0301";
  value.composition.bindings.unused.value["🧭"] = "🌊";
  value.composition.blocks.unused[0].template = "🗺️ {{name}}";
  const preview = preparePromptDraft(value, owner), dto = decodePromptVersionRow(saved(preview));
  assert.equal(dto.version.components[0].content, "Hello Ada 🌍 ñ e\u0301");
  assert.equal(dto.version.compositionSnapshot.bindings.unused.value["🧭"], "🌊");
  assert.equal(dto.version.compositionSnapshot.blocks.unused[0].template, "🗺️ {{name}}");
});

test("authoring retains compiler source byte and component count bounds", () => {
  const huge = literal(); huge.components[1].content = "x".repeat(1_048_577);
  assert.throws(() => validatePromptDraftInput(huge), /budget/);
  const many = literal(); many.components = Array.from({ length: 2049 }, (_, index) => ({ id: `c${index}`, kind: "rule", locked: false, content: "" }));
  assert.throws(() => validatePromptDraftInput(many), /bounded_array_required|budget/);
});

test("authoring retains nested operation and JSON depth bounds", () => {
  const nested = composed(); let block = text("bottom");
  for (let index = 0; index < 18; index++) block = { op: "if", variable: "enabled", then: [block] };
  nested.components[0].operations = [block]; nested.composition.bindings.enabled = { type: "boolean", value: true };
  assert.throws(() => validatePromptDraftInput(nested), /depth_budget/);
  const json = composed(); let value = 1;
  for (let index = 0; index < 18; index++) value = [value];
  json.composition.bindings.unused.value = value;
  assert.throws(() => validatePromptDraftInput(json), /depth_budget/);
});

test("non-JSON source accessors, sparse arrays and cycles are rejected without evaluating getters", () => {
  const accessor = literal(); let reads = 0;
  Object.defineProperty(accessor.components[0], "content", { enumerable: true, get() { reads++; return "unsafe"; } });
  assert.throws(() => validatePromptDraftInput(accessor), /enumerable_data_required/);
  assert.equal(reads, 0);
  const sparse = literal(); delete sparse.components[0];
  assert.throws(() => validatePromptDraftInput(sparse), /dense_data_array_required/);
  const cyclic = composed(); cyclic.composition.bindings.unused.value.self = cyclic.composition.bindings.unused.value;
  assert.throws(() => validatePromptDraftInput(cyclic), /cycle/);
  const dag = compilePromptVersion({ id: "dag", definitionId: owner.definitionId, components: literal().components, parentVersionIds: ["a", "b"] });
  assert.throws(() => promptDraftInputFromVersion(dag), /single_base_required/);
});

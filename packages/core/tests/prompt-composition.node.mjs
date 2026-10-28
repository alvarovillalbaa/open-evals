import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compilePromptVersion, assertLockedComponentsPreserved, resolvePromptRelease } from "../src/prompt.ts";
import { buildAblationVariants } from "../src/improvement.ts";

// Focused Node-only T2 cases; separate from the existing Vitest entrypoint.
// Authored prompts/bindings only. No target, judge, database or release mutation.
function input() {
  return {
    id: "version-1", definitionId: "definition-1", parentVersionIds: ["ancestor-1"],
    components: [
      { id: "role", kind: "role", locked: true, content: "Help people safely." },
      { id: "rules", kind: "rules", locked: false, content: "Verify the facts. Never invent a result." },
      { id: "tools", kind: "tools", locked: false, content: "Read before writing." },
      { id: "safety", kind: "safety", locked: true, content: "Keep private data private." }
    ]
  };
}

function composed(template = "Hello {{name}}") {
  return {
    id: "composed-1", definitionId: "definition-1",
    components: [{ id: "greeting", kind: "role", locked: false, content: template }],
    composition: {
      schemaVersion: "prompt-composition-v1",
      bindings: { name: { type: "string", value: "Ada" } },
      blocks: {}
    }
  };
}

function operations(blocks, bindings = {}, library = {}) {
  const value = composed();
  value.components = [{ id: "greeting", kind: "role", locked: false, operations: blocks }];
  value.composition.bindings = bindings; value.composition.blocks = library;
  return value;
}

function body(value) { return compilePromptVersion(value).components[0].content; }
function text(template) { return { op: "text", template }; }

test("literal compilation retains exact headers, spacing and historical content hash", () => {
  const value = input();
  const expected = "<!-- role:role -->\nHelp people safely.\n\n<!-- rules:rules -->\nVerify the facts. Never invent a result.\n\n<!-- tools:tools -->\nRead before writing.\n\n<!-- safety:safety -->\nKeep private data private.";
  const version = compilePromptVersion(value);
  assert.equal(version.compiledText, expected);
  assert.equal(version.contentHash, createHash("sha256").update(expected).digest("hex").slice(0, 24));
  assert.equal(version.status, "draft");
  assert.equal(version.compositionSnapshot, undefined);
});

test("literal mode preserves template-like characters as authored text", () => {
  const value = input(); value.components[1].content = "Use {{client}} as a literal example.";
  assert.equal(compilePromptVersion(value).components[1].content, value.components[1].content);
});

test("explicit undefined optional arguments retain literal defaults", () => {
  const value = input();
  Object.assign(value, { parentVersionIds: undefined, status: undefined, composition: undefined, baseVersion: undefined });
  const version = compilePromptVersion(value);
  assert.equal(version.status, "draft"); assert.deepEqual(version.parentVersionIds, []);
  assert.equal(version.compositionSnapshot, undefined);
});

test("a version owns its component and parent snapshots", () => {
  const value = input(), version = compilePromptVersion(value), original = version.compiledText;
  value.components[0].content = "Changed later"; value.components.push({ id: "extra", kind: "rule", locked: false, content: "extra" });
  value.parentVersionIds[0] = "changed-parent";
  assert.equal(version.compiledText, original);
  assert.equal(version.components[0].content, "Help people safely.");
  assert.equal(version.components.length, 4);
  assert.deepEqual(version.parentVersionIds, ["ancestor-1"]);
});

test("returned versions and nested snapshot records reject mutation", () => {
  const version = compilePromptVersion(input());
  assert.equal(Object.isFrozen(version), true);
  assert.equal(Object.isFrozen(version.components), true);
  assert.equal(Object.isFrozen(version.components[0]), true);
  assert.equal(Object.isFrozen(version.parentVersionIds), true);
  assert.throws(() => { version.compiledText = "forged"; }, TypeError);
  assert.throws(() => { version.components[0].content = "forged"; }, TypeError);
  assert.throws(() => { version.parentVersionIds.push("forged"); }, TypeError);
});

test("empty content remains a valid deletion ablation", () => {
  const value = input(); value.components[1].content = "";
  assert.equal(compilePromptVersion(value).components[1].content, "");
});

test("in-field variables resolve typed scalar values without truthiness loss", () => {
  const value = composed("{{name}}|{{count}}|{{enabled}}");
  value.composition.bindings.count = { type: "number", value: 0 };
  value.composition.bindings.enabled = { type: "boolean", value: false };
  assert.equal(body(value), "Ada|0|false");
});

test("JSON variables use canonical key ordering and preserve nested JSON", () => {
  const value = composed("{{json:payload}}");
  value.composition.bindings.payload = { type: "json", value: { z: [true, null, 0], a: { y: "é", x: 1 } } };
  assert.equal(body(value), '{"a":{"x":1,"y":"é"},"z":[true,null,0]}');
});

test("substituted text stays opaque rather than becoming another template", () => {
  const value = composed(); value.composition.bindings.name.value = "{{missing}}";
  assert.equal(body(value), "Hello {{missing}}");
});

test("escaped opening braces stay literal in opt-in composition", () => {
  assert.equal(body(composed(String.raw`\{{name}} / {{name}}`)), "{{name}} / Ada");
});

test("operation blocks concatenate in their authored order", () => {
  assert.equal(body(operations([text("First. "), text("Second.")])), "First. Second.");
});

test("named reusable blocks resolve explicitly supplied root bindings", () => {
  const value = operations([{ op: "include", name: "greeting" }, text("!")], { name: { type: "string", value: "Ada" } }, { greeting: [text("Hello {{name}}")] });
  assert.equal(body(value), "Hello Ada!");
});

test("shared bindings and includes compose multiple independently identified components", () => {
  const value = composed();
  value.components.push({ id: "signoff", kind: "style", locked: false, operations: [{ op: "include", name: "signoff" }] });
  value.composition.blocks.signoff = [text("Thanks, {{name}}.")];
  const version = compilePromptVersion(value);
  assert.deepEqual(version.components.map(item => item.content), ["Hello Ada", "Thanks, Ada."]);
  assert.equal(version.compiledText, "<!-- greeting:role -->\nHello Ada\n\n<!-- signoff:style -->\nThanks, Ada.");
});

test("conditionals use actual booleans and both branches are supported", () => {
  const value = operations([{ op: "if", variable: "enabled", then: [text("yes")], else: [text("no")] }], { enabled: { type: "boolean", value: true } });
  assert.equal(body(value), "yes"); value.composition.bindings.enabled.value = false;
  assert.equal(body(value), "no");
});

test("a false conditional without an else contributes no text", () => {
  assert.equal(body(operations([{ op: "if", variable: "enabled", then: [text("yes")] }], { enabled: { type: "boolean", value: false } })), "");
});

test("each supports scalar aliases, zero-based indexes and separators", () => {
  const value = operations([{ op: "each", variable: "names", as: "item", indexAs: "index", separator: "; ", body: [text("{{index}}:{{item}}")] }], { names: { type: "json", value: ["Ada", "Lin"] } });
  assert.equal(body(value), "0:Ada; 1:Lin");
});

test("an empty each still validates its body and renders no text", () => {
  const value = operations([{ op: "each", variable: "names", as: "item", body: [text("{{item}}")] }], { names: { type: "json", value: [] } });
  assert.equal(body(value), "");
  value.components[0].operations[0].body = [text("{{missing}}")];
  assert.throws(() => compilePromptVersion(value));
});

test("loop aliases serialize JSON items explicitly", () => {
  const value = operations([{ op: "each", variable: "items", as: "item", separator: ",", body: [text("{{json:item}}")] }], { items: { type: "json", value: [{ b: 2, a: 1 }, null] } });
  assert.equal(body(value), '{"a":1,"b":2},null');
});

test("an included library block is closed over root bindings rather than loop aliases", () => {
  const value = operations([{ op: "each", variable: "items", as: "item", separator: ",", body: [{ op: "include", name: "constant" }] }], { items: { type: "json", value: [1, 2] }, name: { type: "string", value: "root" } }, { constant: [text("{{name}}")] });
  assert.equal(body(value), "root,root");
  value.composition.blocks.constant = [text("{{item}}")];
  assert.throws(() => compilePromptVersion(value));
});

test("the authoring snapshot owns all source, binding and library data", () => {
  const value = operations([{ op: "include", name: "message" }], { payload: { type: "json", value: { names: ["Ada"] } } }, { message: [text("{{json:payload}}")] });
  const version = compilePromptVersion(value), snapshot = version.compositionSnapshot;
  assert.equal(snapshot.schemaVersion, "prompt-composition-v1");
  assert.equal(typeof snapshot.sourceHash, "string");
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.bindings.payload.value.names), true);
  assert.equal(Object.isFrozen(snapshot.blocks.message[0]), true);
  value.composition.bindings.payload.value.names[0] = "Changed";
  value.composition.blocks.message[0].template = "Changed";
  value.components[0].operations[0].name = "Changed";
  assert.equal(version.components[0].content, '{"names":["Ada"]}');
  assert.equal(snapshot.blocks.message[0].template, "{{json:payload}}");
  assert.equal(snapshot.components[0].operations[0].name, "message");
});

test("source identity captures non-rendered authoring changes independently of content identity", () => {
  const value = composed(), first = compilePromptVersion(value);
  value.composition.blocks.unused = [text("A reviewed reusable block")];
  const second = compilePromptVersion(value);
  assert.equal(first.compiledText, second.compiledText);
  assert.equal(first.contentHash, second.contentHash);
  assert.notEqual(first.compositionSnapshot.sourceHash, second.compositionSnapshot.sourceHash);
});

test("binding and library map insertion order do not change authoring identity", () => {
  const value = composed();
  value.composition.bindings.count = { type: "number", value: 2 };
  value.composition.bindings.enabled = { type: "boolean", value: true };
  value.composition.blocks = { first: [text("one")], second: [text("two")] };
  const first = compilePromptVersion(value);
  value.composition.bindings = Object.fromEntries(Object.entries(value.composition.bindings).reverse());
  value.composition.blocks = Object.fromEntries(Object.entries(value.composition.blocks).reverse());
  assert.equal(compilePromptVersion(value).compositionSnapshot.sourceHash, first.compositionSnapshot.sourceHash);
});

test("operations require explicit composition and unknown versions fail closed", () => {
  const value = operations([text("Hello")]); delete value.composition;
  assert.throws(() => compilePromptVersion(value));
  const other = composed(); other.composition.schemaVersion = "prompt-composition-v2";
  assert.throws(() => compilePromptVersion(other));
});

test("missing, malformed and property-traversal variables are rejected", () => {
  for (const template of ["{{missing}}", "{{name.value}}", "{{process.env}}", "{{name", "{{}}", "{{name + name}}", "{{json:missing}}"] ) {
    assert.throws(() => compilePromptVersion(composed(template)));
  }
});

test("JSON objects require explicit JSON formatting instead of implicit coercion", () => {
  const value = composed("{{payload}}"); value.composition.bindings.payload = { type: "json", value: { key: "value" } };
  assert.throws(() => compilePromptVersion(value));
});

test("all supplied bindings are validated even when they are not referenced", () => {
  for (const binding of [{ type: "string", value: 1 }, { type: "number", value: NaN }, { type: "number", value: Infinity }, { type: "boolean", value: "true" }, { type: "unknown", value: "x" }, { type: "json", value: undefined }]) {
    const value = composed(); value.composition.bindings.unused = binding;
    assert.throws(() => compilePromptVersion(value));
  }
  const hidden = composed();
  Object.defineProperty(hidden.composition.bindings, "unused", { value: { type: "number", value: NaN }, enumerable: false });
  assert.throws(() => compilePromptVersion(hidden));
});

test("hidden branches cannot conceal unknown references or wrong control types", () => {
  const value = operations([{ op: "if", variable: "enabled", then: [text("ok")], else: [text("{{missing}}")] }], { enabled: { type: "boolean", value: true } });
  assert.throws(() => compilePromptVersion(value));
  const wrong = operations([{ op: "if", variable: "enabled", then: [text("yes")] }], { enabled: { type: "string", value: "true" } });
  assert.throws(() => compilePromptVersion(wrong));
});

test("unknown blocks and include cycles are rejected even in unused libraries", () => {
  assert.throws(() => compilePromptVersion(operations([{ op: "include", name: "missing" }])));
  const value = composed(); value.composition.blocks = { a: [{ op: "include", name: "b" }], b: [{ op: "include", name: "a" }] };
  assert.throws(() => compilePromptVersion(value));
  const hidden = composed();
  Object.defineProperty(hidden.composition.blocks, "unused", { value: [{ op: "include", name: "unused" }], enumerable: false });
  assert.throws(() => compilePromptVersion(hidden));
});

test("unknown operations and extra executable-looking fields are rejected", () => {
  for (const block of [{ op: "eval", code: "process.exit()" }, { op: "text", template: "safe", command: "ignored?" }, { op: "include", name: "https://example.com/template" }]) {
    assert.throws(() => compilePromptVersion(operations([block])));
  }
});

test("loop control requires an array and aliases cannot shadow any binding", () => {
  assert.throws(() => compilePromptVersion(operations([{ op: "each", variable: "items", as: "item", body: [] }], { items: { type: "string", value: "array?" } })));
  for (const extra of [{ item: { type: "string", value: "root" } }, { index: { type: "number", value: 0 } }]) {
    assert.throws(() => compilePromptVersion(operations([{ op: "each", variable: "items", as: "item", indexAs: "index", body: [] }], { items: { type: "json", value: [] }, ...extra })));
  }
});

test("loop aliases must be distinct normalized names", () => {
  for (const names of [{ as: "item", indexAs: "item" }, { as: "a.b" }, { as: "__proto__" }]) {
    assert.throws(() => compilePromptVersion(operations([{ op: "each", variable: "items", ...names, body: [] }], { items: { type: "json", value: [] } })));
  }
});

test("cyclic, sparse and accessor JSON bindings are refused", () => {
  const cycle = {}; cycle.self = cycle;
  let reads = 0;
  const getter = {}; Object.defineProperty(getter, "secret", { get() { reads++; return "must not be read"; }, enumerable: true });
  for (const payload of [cycle, Array(1), getter]) {
    const value = composed(); value.composition.bindings.payload = { type: "json", value: payload };
    assert.throws(() => compilePromptVersion(value));
  }
  assert.equal(reads, 0);
});

test("duplicate component IDs cannot mask or replace locked content", () => {
  const value = input(); value.components.push({ ...value.components[0], locked: false, content: "replacement" });
  assert.throws(() => compilePromptVersion(value));
});

test("parents are normalized, distinct and cannot reference the version itself", () => {
  for (const parents of [["same", "same"], ["version-1"], [""], [" padded "]]) {
    const value = input(); value.parentVersionIds = parents;
    assert.throws(() => compilePromptVersion(value));
  }
});

test("a candidate must explicitly name its base as a parent", () => {
  const base = compilePromptVersion(input());
  const candidate = input(); candidate.id = "version-2"; candidate.baseVersion = base;
  assert.throws(() => compilePromptVersion(candidate));
  candidate.parentVersionIds = [base.id];
  assert.doesNotThrow(() => compilePromptVersion(candidate));
});

test("locked components preserve rendered content, kind, lock flags and definition", () => {
  const base = compilePromptVersion(input());
  for (const change of [
    value => { value.components[0].content = "changed"; },
    value => { value.components[0].kind = "other"; },
    value => { value.components[0].locked = false; },
    value => { value.components.shift(); },
    value => { value.definitionId = "another-definition"; }
  ]) {
    const value = input(); value.id = "version-2"; value.parentVersionIds = [base.id]; value.baseVersion = base; change(value);
    assert.throws(() => compilePromptVersion(value));
  }
});

test("locked relative order cannot be changed by reordering component records", () => {
  const base = compilePromptVersion(input()), value = input();
  value.id = "version-2"; value.parentVersionIds = [base.id]; value.baseVersion = base;
  [value.components[0], value.components[3]] = [value.components[3], value.components[0]];
  assert.throws(() => compilePromptVersion(value));
});

test("changing a binding cannot bypass a locked materialized instruction", () => {
  const value = composed(); value.components[0].locked = true;
  const base = compilePromptVersion(value);
  value.id = "composed-2"; value.parentVersionIds = [base.id]; value.baseVersion = base;
  value.composition.bindings.name.value = "Changed";
  assert.throws(() => compilePromptVersion(value));
});

test("a forged compiled body or content hash fails the lock guard", () => {
  const base = compilePromptVersion(input());
  assert.throws(() => assertLockedComponentsPreserved(base, { ...base, compiledText: "forged" }));
  assert.throws(() => assertLockedComponentsPreserved(base, { ...base, contentHash: "forged" }));
});

test("serialized authoring provenance is verified rather than trusting a stored source hash", () => {
  const value = composed(); value.composition.blocks.unused = [text("original")];
  const base = compilePromptVersion(value);
  for (const mutate of [
    snapshot => { snapshot.bindings.name.value = "forged"; },
    snapshot => { snapshot.blocks.unused[0].template = "forged"; },
    snapshot => { snapshot.sourceHash = "forged"; }
  ]) {
    const forged = structuredClone(base); mutate(forged.compositionSnapshot);
    assert.throws(() => assertLockedComponentsPreserved(base, forged));
  }
  value.composition.bindings.name.value = "Lin";
  const other = compilePromptVersion(value);
  assert.throws(() => assertLockedComponentsPreserved(base, { ...base, compositionSnapshot: other.compositionSnapshot }));
});

test("honest rendered snapshots round-trip under the compiled budget rather than source escaping", () => {
  const value = composed("{{name}}{{name}}");
  value.components[0].locked = true;
  value.composition.bindings.name.value = "\n".repeat(300_000);
  const version = compilePromptVersion(value);
  assert.ok(Buffer.byteLength(version.compiledText, "utf8") < 1_048_576);
  assert.ok(Buffer.byteLength(JSON.stringify(version.components), "utf8") > 1_048_576);
  assert.doesNotThrow(() => assertLockedComponentsPreserved(version, version));
  assert.doesNotThrow(() => assertLockedComponentsPreserved(version, JSON.parse(JSON.stringify(version))));
});

test("ablation variants preserve locked snapshots and bind their parent", () => {
  const base = compilePromptVersion(input()), before = structuredClone(base), variants = buildAblationVariants(base, "rules");
  for (const variant of variants) {
    assert.deepEqual(variant.promptVersion.parentVersionIds, [base.id]);
    assert.doesNotThrow(() => assertLockedComponentsPreserved(base, variant.promptVersion));
    assert.equal(Object.isFrozen(variant.promptVersion), true);
    assert.equal(variant.evidenceLevel, "hypothesis only");
  }
  assert.deepEqual(base, before);
  assert.throws(() => buildAblationVariants(base, "safety"), /locked_component_ablation_denied/);
});

test("a composed-base ablation explicitly creates a literal child of the authoring version", () => {
  const base = compilePromptVersion(composed("Hello {{name}}. Verify facts."));
  const variants = buildAblationVariants(base, "greeting");
  assert.equal(base.compositionSnapshot.bindings.name.value, "Ada");
  for (const variant of variants) {
    assert.deepEqual(variant.promptVersion.parentVersionIds, [base.id]);
    assert.equal(variant.promptVersion.compositionSnapshot, undefined);
    assert.equal(variant.promptVersion.components[0].content.includes("{{name}}"), false);
  }
});

test("order ablation reorders actual mutable slots without duplicating locked instructions", () => {
  const base = compilePromptVersion(input());
  const variant = buildAblationVariants(base, "rules").find(item => item.mutation === "order_test").promptVersion;
  assert.deepEqual(variant.components.map(item => item.id), ["role", "tools", "rules", "safety"]);
  assert.equal(variant.components[1].content, base.components[2].content);
  assert.equal(variant.components[2].content, base.components[1].content);
  assert.equal(variant.compiledText.split("Help people safely.").length - 1, 1);
  assert.equal(variant.compiledText.split("Keep private data private.").length - 1, 1);
});

test("release selection retains explicit-candidate precedence and original response fields", () => {
  const result = resolvePromptRelease({ definitionId: "definition-1", releases: [], baselineVersionId: "baseline", explicitCandidateVersionId: "candidate", scopes: {} });
  assert.equal(result.versionId, "candidate");
  assert.deepEqual(result.appliedReleaseIds, ["explicit_eval_candidate_override"]);
  assert.deepEqual(Object.keys(result).sort(), ["appliedReleaseIds", "resolutionFingerprint", "versionId"]);
});

test("output byte limits include multibyte text instead of just character counts", () => {
  const value = composed("{{name}}{{name}}");
  value.composition.bindings.name.value = "é".repeat(300_000);
  assert.throws(() => compilePromptVersion(value));
});

test("the compiled output limit is shared across components and headers", () => {
  const value = composed("{{name}}"); value.composition.bindings.name.value = "x".repeat(600_000);
  value.components.push({ id: "second", kind: "rule", locked: false, content: "{{name}}" });
  assert.throws(() => compilePromptVersion(value));
});

test("unused source data still respects its byte and nesting budgets", () => {
  const value = composed(); value.composition.bindings.unused = { type: "string", value: "é".repeat(600_000) };
  assert.throws(() => compilePromptVersion(value));
  let nested = null;
  for (let i = 0; i < 20; i++) nested = { child: nested };
  const deep = composed(); deep.composition.bindings.unused = { type: "json", value: nested };
  assert.throws(() => compilePromptVersion(deep));
});

test("acyclic shared empty-container graphs respect the global JSON work budget", () => {
  let shared = [];
  for (let i = 0; i < 3; i++) shared = Array(48).fill(shared);
  const value = composed(); value.composition.bindings.unused = { type: "json", value: shared };
  assert.throws(() => compilePromptVersion(value));
});

test("binding, library and AST node counts are bounded before rendering", () => {
  const bindings = composed();
  bindings.composition.bindings = Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`name_${i}`, { type: "number", value: i }]));
  assert.throws(() => compilePromptVersion(bindings));
  const library = composed(); library.composition.blocks = Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`block_${i}`, []]));
  assert.throws(() => compilePromptVersion(library));
  assert.throws(() => compilePromptVersion(operations(Array.from({ length: 2049 }, () => text("")))));
});

test("nested loops share one iteration budget even when their output is empty", () => {
  const value = operations([
    { op: "each", variable: "outer", as: "outerItem", body: [
      { op: "each", variable: "inner", as: "innerItem", body: [] }
    ] }
  ], { outer: { type: "json", value: Array(101).fill(null) }, inner: { type: "json", value: Array(100).fill(null) } });
  assert.throws(() => compilePromptVersion(value));
});

test("unselected branches cannot evade the validation iteration budget", () => {
  const value = operations([{ op: "if", variable: "enabled", then: [
    { op: "each", variable: "outer", as: "outerItem", body: [
      { op: "each", variable: "inner", as: "innerItem", body: [] }
    ] }
  ] }], { enabled: { type: "boolean", value: false }, outer: { type: "json", value: Array(101).fill(null) }, inner: { type: "json", value: Array(100).fill(null) } });
  assert.throws(() => compilePromptVersion(value));
});

test("empty substitutions in unselected branches still consume validation work", () => {
  const value = operations([{ op: "if", variable: "enabled", then: [text("{{empty}}".repeat(100_001))] }], { enabled: { type: "boolean", value: false }, empty: { type: "string", value: "" } });
  assert.throws(() => compilePromptVersion(value));
});

test("zero-output include graphs cannot evade the expansion work budget", () => {
  const library = { end: [] };
  for (let i = 10; i >= 0; i--) {
    const next = i === 10 ? "end" : `level_${i + 1}`;
    library[`level_${i}`] = Array.from({ length: 3 }, () => ({ op: "include", name: next }));
  }
  assert.throws(() => compilePromptVersion(operations([{ op: "include", name: "level_0" }], {}, library)));
});

test("unknown component fields, mixed content/operations and malformed flags fail closed", () => {
  for (const mutate of [
    value => { value.components[0].extra = "unknown"; },
    value => { value.components[0].operations = []; },
    value => { value.components[0].locked = "true"; },
    value => { value.components[0].id = "bad\nheader"; }
  ]) {
    const value = input(); mutate(value); assert.throws(() => compilePromptVersion(value));
  }
});

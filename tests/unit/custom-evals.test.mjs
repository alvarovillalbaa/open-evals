// T1: authored pure DTO/contract inputs against the actual core module and hash implementation.
// Native SWC is an explicit read-only test tool, separate from application builds; no fallback or type-check claim.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, openSync, fstatSync, lstatSync, readSync, closeSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import test from "node:test";
import { createContext, runInContext, SourceTextModule, SyntheticModule } from "node:vm";

const swcPath = process.env.OPEN_EVALS_TEST_SWC;
assert.ok(typeof swcPath === "string" && isAbsolute(swcPath) && swcPath.endsWith(".node"), "Configure the existing native SWC test addon");
const swc = createRequire(import.meta.url)(swcPath);
assert.equal(typeof swc.transformSync, "function", "Native transformSync is required; no fallback");

function readSource(name) {
  const path = new URL(`../../packages/core/src/${name}`, import.meta.url);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true });
    assert.ok(before.isFile() && before.size <= 65536n, "bounded regular source required");
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = readSync(fd, bytes, count, bytes.length - count, null);
      if (!read) break;
      count += read;
    }
    assert.equal(count, Number(before.size));
    for (const after of [fstatSync(fd, { bigint: true }), lstatSync(path, { bigint: true })]) {
      for (const key of ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"]) assert.equal(after[key], before[key]);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count));
  } finally { closeSync(fd); }
}

function javascript(name) {
  const output = swc.transformSync(readSource(name), false, Buffer.from(JSON.stringify({
    filename: name, swcrc: false, configFile: false, sourceMaps: false,
    jsc: { parser: { syntax: "typescript", tsx: false }, target: "es2022" }, module: { type: "es6" }
  })));
  assert.ok(typeof output?.code === "string" && Buffer.byteLength(output.code) > 0 && Buffer.byteLength(output.code) <= 262144);
  return output.code;
}

const context = createContext({ TextEncoder }, { codeGeneration: { strings: false, wasm: false } });
const crypto = new SyntheticModule(["createHash"], function () { this.setExport("createHash", createHash); }, { context });
const hashModule = new SourceTextModule(javascript("hash.ts"), { context, identifier: "actual-core:hash.ts" });
await hashModule.link(specifier => { assert.equal(specifier, "node:crypto"); return crypto; });
await hashModule.evaluate();
const coreModule = new SourceTextModule(javascript("custom-evals.ts"), { context, identifier: "actual-core:custom-evals.ts" });
await coreModule.link(specifier => { assert.equal(specifier, "./hash"); return hashModule; });
await coreModule.evaluate();
const core = coreModule.namespace, hashing = hashModule.namespace;
const realmParse = runInContext("JSON.parse", context);
const inRealm = value => realmParse(JSON.stringify(value));
const plain = value => JSON.parse(JSON.stringify(value));

const SET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIRST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NEXT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const BASE = { schemaVersion: "custom-eval-set-draft-v1", setId: SET, versionId: FIRST, version: 1,
  expectedVersionId: null, name: "  Authored contains check  ", contains: "  APPROVED\nVALUE\t", datasetPassRateThreshold: 80 };
const draft = (patch = {}) => Object.assign(inRealm(BASE), patch);
const prepared = (patch = {}) => core.prepareCustomEvalSet(draft(patch));
const contract = () => inRealm(prepared().contract);
function invalidDraft(value) {
  assert.throws(() => core.prepareCustomEvalSet(value), error => error instanceof core.CustomEvalSetError
    && error.status === 422 && error.code === "custom_eval_set_draft_invalid" && error.message === error.code);
}
function invalidContract(value) {
  assert.throws(() => core.parseCustomEvalSetContract(value), error => error instanceof core.CustomEvalSetError
    && error.status === 422 && error.code === "custom_eval_set_contract_invalid" && error.message === error.code);
}

test("CE01 a prepared first version contains exactly one existing-engine critical contains check", () => {
  const value = prepared(), saved = value.contract, membership = saved.itemVersions[0], item = membership.item;
  assert.equal(value.draft.name, "Authored contains check");
  assert.equal(value.draft.contains, BASE.contains);
  assert.equal(saved.schemaVersion, "custom-eval-set-v1");
  assert.equal(saved.id, FIRST); assert.equal(saved.setId, SET);
  assert.equal(saved.name, item.name);
  assert.equal(saved.itemVersions.length, 1);
  assert.equal(item.id, `custom_item_version_${FIRST}`); assert.equal(item.itemId, `custom_item_${SET}`);
  assert.equal(item.type, "string_check"); assert.equal(item.version, 1);
  assert.deepEqual(plain(item.evaluationUnits), ["llm_call"]);
  assert.deepEqual(plain(item.config), { contains: BASE.contains });
  assert.deepEqual(plain(item.outputSchema.fields), [{ key: "contains_expected", displayName: "Contains configured text", type: "boolean", criticality: "critical", gating: true }]);
  assert.equal(item.criticality, "critical"); assert.equal(membership.criticality, "critical"); assert.equal(membership.weight, 1);
  assert.deepEqual(plain(saved.gates), { rowThreshold: 100, datasetPassRateThreshold: 80, evalSetThreshold: 80, runThreshold: 80 });
  assert.deepEqual(plain(saved.authoring), { requestFingerprint: value.requestFingerprint, expectedVersionId: null, version: 1 });
});

test("CE02 later versions preserve declared parent and request version without resolving a database head", () => {
  const value = prepared({ versionId: NEXT, version: 3, expectedVersionId: FIRST });
  assert.equal(value.contract.id, NEXT);
  assert.equal(value.contract.itemVersions[0].item.id, `custom_item_version_${NEXT}`);
  assert.equal(value.contract.itemVersions[0].item.version, 3);
  assert.equal(value.contract.authoring.expectedVersionId, FIRST);
  assert.equal(value.contract.authoring.version, 3);
  assert.equal(core.parseCustomEvalSetContract(value.contract).fingerprint, value.contract.fingerprint);
});

test("CE03 all three fingerprints use the actual full SHA256 canonical preimages", () => {
  const value = prepared(), item = value.contract.itemVersions[0].item;
  const { fingerprint: itemHash, ...itemBody } = item;
  const { fingerprint: contractHash, ...contractBody } = value.contract;
  const independentDigest = input => createHash("sha256").update(hashing.stableStringify(input)).digest("hex");
  assert.equal(value.requestFingerprint, independentDigest(value.draft));
  assert.equal(itemHash, independentDigest(itemBody));
  assert.equal(contractHash, independentDigest(contractBody));
  for (const hash of [value.requestFingerprint, itemHash, contractHash]) assert.match(hash, /^[a-f0-9]{64}$/);
});

test("CE04 name trimming and input key order are normalized but contains text is never normalized", () => {
  const normalized = prepared({ name: "Authored contains check" });
  const reordered = realmParse(JSON.stringify(Object.fromEntries(Object.entries(BASE).reverse())));
  assert.equal(core.prepareCustomEvalSet(reordered).contract.fingerprint, normalized.contract.fingerprint);
  assert.equal(prepared().requestFingerprint, normalized.requestFingerprint);
  for (const contains of [BASE.contains.trim(), BASE.contains.toLowerCase(), BASE.contains.replace("\n", "\r\n")]) {
    const changed = prepared({ contains });
    assert.equal(changed.draft.contains, contains);
    assert.notEqual(changed.requestFingerprint, normalized.requestFingerprint);
    assert.notEqual(changed.contract.itemVersions[0].item.fingerprint, normalized.contract.itemVersions[0].item.fingerprint);
  }
});

test("CE05 member identities names and configured text bind item and contract fingerprints", () => {
  const original = prepared();
  for (const patch of [{ setId: OTHER }, { versionId: OTHER }, { name: "Another authored check" }, { contains: "Another exact needle" }]) {
    const changed = prepared(patch);
    assert.notEqual(changed.requestFingerprint, original.requestFingerprint);
    assert.notEqual(changed.contract.itemVersions[0].item.fingerprint, original.contract.itemVersions[0].item.fingerprint);
    assert.notEqual(changed.contract.fingerprint, original.contract.fingerprint);
  }
});

test("CE06 dataset thresholds bind requests and set gates without changing the evaluator item", () => {
  const original = prepared();
  for (const threshold of [0, 0.25, 100, -0]) {
    const value = prepared({ datasetPassRateThreshold: threshold });
    assert.deepEqual(plain(value.contract.gates), { rowThreshold: 100, datasetPassRateThreshold: threshold === 0 ? 0 : threshold,
      evalSetThreshold: threshold === 0 ? 0 : threshold, runThreshold: threshold === 0 ? 0 : threshold });
    assert.equal(value.contract.itemVersions[0].item.fingerprint, original.contract.itemVersions[0].item.fingerprint);
    assert.notEqual(value.requestFingerprint, original.requestFingerprint);
    assert.notEqual(value.contract.fingerprint, original.contract.fingerprint);
  }
  assert.equal(Object.is(prepared({ datasetPassRateThreshold: -0 }).draft.datasetPassRateThreshold, -0), false);
});

test("CE07 name limits count complete Unicode characters and exact UTF8 bytes", () => {
  const name = "😀".repeat(120);
  assert.equal(Buffer.byteLength(name), 480);
  assert.equal(prepared({ name }).draft.name, name);
  invalidDraft(draft({ name: "😀".repeat(121) }));
  invalidDraft(draft({ name: "x".repeat(121) }));
  assert.notEqual(prepared({ name: "é" }).requestFingerprint, prepared({ name: "e\u0301" }).requestFingerprint);
});

test("CE08 the contains limit is 4096 UTF8 bytes including preserved surrounding whitespace", () => {
  const contains = "😀".repeat(1024);
  assert.equal(Buffer.byteLength(contains), 4096);
  assert.equal(prepared({ contains }).draft.contains, contains);
  assert.equal(prepared({ contains: "x".repeat(4096) }).draft.contains.length, 4096);
  invalidDraft(draft({ contains: contains + "x" }));
  invalidDraft(draft({ contains: " " + "x".repeat(4096) }));
});

test("CE09 blank text NUL and lone surrogates are refused without stripping or replacement", () => {
  for (const key of ["name", "contains"]) {
    for (const value of ["", " \t\r\n", "bad\u0000text", "bad\ud800", "\udc00bad", "\ud800x\udc00"]) invalidDraft(draft({ [key]: value }));
  }
  assert.equal(prepared({ contains: " \t😀\r\n " }).draft.contains, " \t😀\r\n ");
});

test("CE10 the draft requires exactly its declared keys and primitive field types", () => {
  for (const value of [null, [], "authored", 1, true]) invalidDraft(value);
  for (const patch of [{ schemaVersion: "unknown" }, { extra: true }, { name: 7 }, { contains: false }, { version: "1" },
    { expectedVersionId: undefined }, { datasetPassRateThreshold: "80" }]) invalidDraft(draft(patch));
  for (const key of Object.keys(BASE)) { const value = draft(); delete value[key]; invalidDraft(value); }
});

test("CE11 all identities require lowercase canonical UUIDs", () => {
  for (const key of ["setId", "versionId"]) {
    for (const value of [SET.toUpperCase(), SET.replaceAll("-", ""), "not-a-uuid", 1, null]) invalidDraft(draft({ [key]: value }));
  }
  invalidDraft(draft({ versionId: NEXT, version: 2, expectedVersionId: FIRST.toUpperCase() }));
});

test("CE12 version bounds first-parent rules and self-parent refusal are explicit", () => {
  for (const version of [0, -1, 1.5, 1000001, NaN, Infinity]) invalidDraft(draft({ version }));
  invalidDraft(draft({ expectedVersionId: OTHER }));
  invalidDraft(draft({ version: 2 }));
  invalidDraft(draft({ version: 2, expectedVersionId: FIRST }));
  assert.equal(prepared({ versionId: NEXT, version: 1000000, expectedVersionId: FIRST }).contract.authoring.version, 1000000);
  const a = prepared({ versionId: NEXT, version: 2, expectedVersionId: FIRST });
  const b = prepared({ versionId: NEXT, version: 2, expectedVersionId: OTHER });
  assert.notEqual(a.requestFingerprint, b.requestFingerprint);
  assert.notEqual(a.contract.fingerprint, b.contract.fingerprint);
  assert.equal(a.contract.itemVersions[0].item.fingerprint, b.contract.itemVersions[0].item.fingerprint);
});

test("CE13 thresholds reject coercion nonfinite values and values outside 0 through 100", () => {
  for (const value of [-0.001, 100.001, NaN, Infinity, -Infinity, null, false, "0"]) invalidDraft(draft({ datasetPassRateThreshold: value }));
});

test("CE14 accessors symbols hidden keys and foreign prototypes cannot enter a draft", () => {
  let reads = 0;
  const getter = draft(); Object.defineProperty(getter, "contains", { enumerable: true, get() { reads++; return "unexpected"; } });
  invalidDraft(getter); assert.equal(reads, 0);
  const symbol = draft(); symbol[Symbol("hidden")] = true; invalidDraft(symbol);
  const hidden = draft(); Object.defineProperty(hidden, "extra", { value: true }); invalidDraft(hidden);
  const foreign = draft(); Object.setPrototypeOf(foreign, { inherited: true }); invalidDraft(foreign);
  const nullPrototype = draft(); Object.setPrototypeOf(nullPrototype, null);
  assert.equal(core.prepareCustomEvalSet(nullPrototype).contract.setId, SET);
});

test("CE15 preparation and parsing leave frozen inputs untouched and return detached contracts", () => {
  const input = Object.freeze(draft()), before = JSON.stringify(input), value = core.prepareCustomEvalSet(input);
  assert.equal(JSON.stringify(input), before); assert.notEqual(value.draft, input);
  function freeze(item) { if (item && typeof item === "object" && !Object.isFrozen(item)) { for (const child of Object.values(item)) freeze(child); Object.freeze(item); } }
  freeze(value.contract);
  const parsed = core.parseCustomEvalSetContract(value.contract);
  assert.notEqual(parsed, value.contract);
  assert.notEqual(parsed.itemVersions[0].item, value.contract.itemVersions[0].item);
  parsed.itemVersions[0].item.config.contains = "caller-owned changed text";
  assert.equal(value.contract.itemVersions[0].item.config.contains, BASE.contains);
});

test("CE16 saved contracts roundtrip canonically regardless of property insertion order", () => {
  const saved = contract(), reversed = realmParse(JSON.stringify(Object.fromEntries(Object.entries(saved).reverse())));
  assert.deepEqual(plain(core.parseCustomEvalSetContract(reversed)), plain(saved));
  assert.equal(hashing.stableStringify(core.parseCustomEvalSetContract(saved)), hashing.stableStringify(saved));
});

test("CE17 unknown schemas missing keys extras and claimed fingerprints cannot be silently repaired", () => {
  for (const change of [value => { value.schemaVersion = "custom-eval-set-v2"; }, value => { delete value.fingerprint; },
    value => { value.extra = true; }, value => { value.fingerprint = "0".repeat(64); },
    value => { value.authoring.requestFingerprint = "0".repeat(64); }, value => { value.itemVersions[0].item.fingerprint = "0".repeat(64); }]) {
    const value = contract(); change(value); invalidContract(value);
  }
});

test("CE18 parsing verifies complete membership evaluator metadata gates and authoring context", () => {
  const changes = [value => { value.itemVersions.push(value.itemVersions[0]); }, value => { value.itemVersions[0].weight = 2; },
    value => { value.itemVersions[0].item.id = `custom_item_version_${OTHER}`; }, value => { value.itemVersions[0].item.itemId = `custom_item_${OTHER}`; },
    value => { value.itemVersions[0].item.name = "Different name"; }, value => { value.itemVersions[0].item.type = "llm_judge"; },
    value => { value.itemVersions[0].item.evaluationUnits = inRealm(["agent_call"]); }, value => { value.itemVersions[0].item.outputSchema.fields[0].gating = false; },
    value => { value.itemVersions[0].item.config.caseSensitive = true; }, value => { value.itemVersions[0].criticality = "standard"; },
    value => { value.gates.rowThreshold = 99; }, value => { value.gates.runThreshold = 79; },
    value => { value.authoring.version = 2; }, value => { value.authoring.expectedVersionId = OTHER; }];
  for (const change of changes) { const value = contract(); change(value); invalidContract(value); }
});

test("CE19 recomputing valid digests does not authorize a different evaluator or membership", () => {
  for (const change of [value => { value.itemVersions[0].weight = 2; }, value => { value.itemVersions[0].item.outputSchema.fields[0].gating = false; }]) {
    const value = contract(); change(value);
    const { fingerprint: _itemHash, ...itemBody } = value.itemVersions[0].item;
    value.itemVersions[0].item.fingerprint = hashing.stableHash(itemBody, 64);
    const { fingerprint: _contractHash, ...contractBody } = value;
    value.fingerprint = hashing.stableHash(contractBody, 64);
    invalidContract(value);
  }
});

test("CE20 corrupt saved objects reject unsupported values without invoking accessors or leaking input", () => {
  let reads = 0;
  const getter = contract(); Object.defineProperty(getter.itemVersions[0].item.config, "contains", { enumerable: true, get() { reads++; return "not read"; } });
  invalidContract(getter); assert.equal(reads, 0);
  const cycle = contract(); cycle.extra = cycle; invalidContract(cycle);
  const undefinedValue = contract(); undefinedValue.extra = undefined; invalidContract(undefinedValue);
  const sparse = contract(); delete sparse.itemVersions[0]; invalidContract(sparse);
  const symbol = contract(); symbol[Symbol("extra")] = true; invalidContract(symbol);
  const malformed = contract(); malformed.itemVersions[0].item.config.contains = "authored-secret\ud800"; invalidContract(malformed);
  const safe = new core.CustomEvalSetError("untrusted-authored-message");
  assert.equal(safe.code, "custom_eval_set_draft_invalid"); assert.equal(safe.message, safe.code); assert.equal(safe.status, 422);
});

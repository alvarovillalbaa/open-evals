// T1: actual core source modules through Node's built-in TypeScript eraser.
// Authored fixtures only. This loader is not a compiler/build, DB, HTTP, Auth or provider check.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, openSync, fstatSync, lstatSync, readSync, closeSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { createContext, runInContext, SourceTextModule, SyntheticModule } from "node:vm";

function readSource(name) {
  const path = new URL(`../../packages/core/src/${name}.ts`, import.meta.url);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true });
    assert.ok(before.isFile() && before.size <= 65_536n);
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let count = 0;
    while (count < bytes.length) {
      const size = readSync(fd, bytes, count, bytes.length - count, null);
      if (!size) break;
      count += size;
    }
    assert.equal(count, Number(before.size));
    for (const after of [fstatSync(fd, { bigint: true }), lstatSync(path, { bigint: true })]) {
      for (const key of ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"]) assert.equal(after[key], before[key]);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count));
  } finally { closeSync(fd); }
}

const context = createContext({ TextEncoder }, { codeGeneration: { strings: false, wasm: false } });
const crypto = new SyntheticModule(["createHash"], function () { this.setExport("createHash", createHash); }, { context });
const modules = new Map();
for (const name of ["hash", "custom-evals", "eval-engine", "provided-output-runs", "custom-datasets"]) {
  modules.set(`./${name}`, new SourceTextModule(stripTypeScriptTypes(readSource(name), { mode: "strip", sourceMap: false }), {
    context, identifier: `actual-core:${name}.ts`
  }));
}
await modules.get("./custom-datasets").link(specifier => {
  if (specifier === "node:crypto") return crypto;
  assert.ok(modules.has(specifier), `unexpected runtime import: ${specifier}`);
  return modules.get(specifier);
});
await modules.get("./custom-datasets").evaluate();
const core = modules.get("./custom-datasets").namespace;
const realmParse = runInContext("JSON.parse", context);
const realm = value => realmParse(JSON.stringify(value));
const plain = value => JSON.parse(JSON.stringify(value));
const clone = value => realm(plain(value));
const DATASET = "11111111-1111-4111-8111-111111111111";
const VERSION = "22222222-2222-4222-8222-222222222222";
const NEXT = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const WORKSPACE = "authored-workspace";
const CREATED = "2026-11-09T00:00:00.000Z";

function rows() {
  return [{ rowKey: "Alpha", input: { prompt: "Authored example" }, expectedOutput: null, history: ["Authored earlier message"],
    traceFixture: { tool: "authored_stub" }, metadata: { provenance: "authored" }, reviewStatus: "reviewed" },
  { rowKey: "Beta", input: "Another input", context: null, metadata: { language: "en" }, reviewStatus: "synthetic" }];
}
function draft(patch = {}) {
  return realm({ schemaVersion: "custom-dataset-draft-v1", datasetId: DATASET, versionId: VERSION, version: 1,
    expectedVersionId: null, name: "Authored examples", format: "json", defaultReviewStatus: null,
    sourceText: JSON.stringify(rows()), ...patch });
}
function preview(d = draft(), head = null, workspaceId = WORKSPACE) {
  return core.resolveCustomDatasetPreview(realm({ workspaceId, draft: d, head }));
}
function request(d, pinned = preview(d)) {
  return core.prepareCustomDatasetSaveRequest(realm({ schemaVersion: "custom-dataset-save-v1", draft: d, expectedPreviewFingerprint: pinned.fingerprint }));
}
function record(d = draft(), head = null, createdAt = CREATED) {
  const pinned = preview(d, head);
  return core.prepareCustomDatasetVersionRecord(realm({ workspaceId: WORKSPACE, request: request(d, pinned), head, createdAt }));
}
function invalid(fn, code) {
  assert.throws(fn, error => error instanceof core.CustomDatasetError && error.status === 422 && (!code || error.code === code));
}
function conflict(fn, code) {
  assert.throws(fn, error => error instanceof core.CustomDatasetError && error.status === 409 && (!code || error.code === code));
}
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
const digest = value => createHash("sha256").update(canonical(value)).digest("hex");
function rehash(value) {
  const { fingerprint, ...body } = value;
  value.fingerprint = digest(body);
  return value;
}

test("CD01 complete preview preserves structured references, absent fields and explicit review declarations", () => {
  const pinned = preview();
  assert.equal(pinned.schemaVersion, "custom-dataset-preview-v1");
  assert.equal(pinned.head, null);
  assert.equal(pinned.createdAtByteAllowance, 24);
  assert.equal(Object.hasOwn(pinned, "createdAt"), false);
  assert.equal(Object.hasOwn(pinned.content.version, "createdAt"), false);
  const [a, b] = pinned.content.rows;
  assert.deepEqual(plain(a.input), { prompt: "Authored example" });
  assert.deepEqual(plain(a.expectedOutput), { present: true, value: null });
  assert.deepEqual(plain(a.context), { present: false, value: null });
  assert.deepEqual(plain(b.expectedOutput), { present: false, value: null });
  assert.deepEqual(plain(b.context), { present: true, value: null });
  assert.deepEqual(plain(a.history), { present: true, value: ["Authored earlier message"] });
  assert.deepEqual(plain(a.traceFixture), { present: true, value: { tool: "authored_stub" } });
  assert.deepEqual(plain(a.metadata), { provenance: "authored" });
  assert.equal(a.reviewStatus, "reviewed"); assert.equal(b.reviewStatus, "synthetic");
  assert.deepEqual(plain(core.parseCustomDatasetPreview(pinned)), plain(pinned));
});

test("CD02 JSONL with CRLF and one final terminator preserves data while raw text and format bind separate intent", () => {
  const json = draft(), jsonl = draft({ format: "jsonl", sourceText: rows().map(row => JSON.stringify(row)).join("\r\n") + "\r\n" });
  const first = preview(json), second = preview(jsonl);
  assert.deepEqual(plain(second.content), plain(first.content));
  assert.notEqual(second.intent.sourceDigest, first.intent.sourceDigest);
  assert.notEqual(second.intent.fingerprint, first.intent.fingerprint);
  assert.notEqual(second.fingerprint, first.fingerprint);
  assert.notEqual(core.customDatasetRequestFingerprint(WORKSPACE, request(json, first)), core.customDatasetRequestFingerprint(WORKSPACE, request(jsonl, second)));
});

test("CD03 malformed JSON and JSONL are refused without comments, trailing commas, scalar rows or skipped blank lines", () => {
  for (const sourceText of ['[{"rowKey":"A","input":1,}]', '[{"rowKey":"A","input":1}] trailing', '[/*comment*/{}]', '{}', '[null]', '[1]', '[[]]']) {
    invalid(() => preview(draft({ sourceText, defaultReviewStatus: "reviewed" })));
  }
  for (const sourceText of ['{"rowKey":"A","input":1}\n\n{"rowKey":"B","input":2}', '{"rowKey":"A","input":1}\n\n', 'null\n', '[]\n']) {
    invalid(() => preview(draft({ format: "jsonl", sourceText, defaultReviewStatus: "reviewed" })));
  }
});

test("CD04 duplicate decoded object keys are refused in nested metadata and escaped spellings with source positions", () => {
  for (const sourceText of [String.raw`[{"rowKey":"A","input":{"amount":1,"amount":2}}]`,
    String.raw`[{"rowKey":"A","input":1,"metadata":{"a":1,"\u0061":2}}]`,
    String.raw`[{"rowKey":"A","input":1,"metadata":{"__proto__":1,"__proto__":2}}]`]) {
    assert.throws(() => preview(draft({ sourceText, defaultReviewStatus: "reviewed" })), error =>
      error instanceof core.CustomDatasetError && error.code === "custom_dataset_source_duplicate_key"
        && error.rowIndex === 0 && error.line === 1 && Number.isInteger(error.column) && error.column > 1);
  }
  const text = '{"rowKey":"A","input":1}\n{"rowKey":"B","input":{"x":1,"x":2}}';
  assert.throws(() => preview(draft({ format: "jsonl", sourceText: text, defaultReviewStatus: "reviewed" })), error =>
    error.code === "custom_dataset_source_duplicate_key" && error.rowIndex === 1 && error.line === 2);
});

test("CD05 exact decimal values survive alternate spellings and representable integers beyond the safe-integer vocabulary", () => {
  const sourceText = '[{"rowKey":"A","input":[0,-0,2.0,1e3,9007199254740992,100000000000000000000,0.1]}]';
  const pinned = preview(draft({ sourceText, defaultReviewStatus: "reviewed" }));
  assert.deepEqual(plain(pinned.content.rows[0].input), [0, 0, 2, 1000, 9007199254740992, 100000000000000000000, 0.1]);
  assert.equal(Number.isSafeInteger(pinned.content.rows[0].input[4]), false);
  assert.equal(JSON.stringify(pinned.content.rows[0].input[5]), "100000000000000000000");
});

test("CD06 nested unsafe integers, close decimals, overflow and nonzero underflow fail before a preview exists", () => {
  for (const token of ["9007199254740993", "-9007199254740993", "0.10000000000000001", "1e-1000", "-1e-1000", "1e309", "4e-324"]) {
    const sourceText = `[{"rowKey":"A","input":{"nested":{"number":${token}}}}]`;
    assert.throws(() => preview(draft({ sourceText, defaultReviewStatus: "reviewed" })), error =>
      error.code === "custom_dataset_source_precision" && error.status === 422 && error.rowIndex === 0 && error.line === 1);
  }
});

test("CD07 long zero and leading-zero exponents are bounded without huge powers or exponent integers", { timeout: 15_000 }, () => {
  const zeros = "0".repeat(100_000), nines = "9".repeat(100_000);
  for (const [token, expected] of [[`0e${nines}`, 0], [`-0e-${nines}`, 0], [`1e+${zeros}3`, 1000]]) {
    const pinned = preview(draft({ sourceText: `[{"rowKey":"A","input":${token}}]`, defaultReviewStatus: "reviewed" }));
    assert.equal(pinned.content.rows[0].input, expected);
  }
  for (const token of [`1e${nines}`, `1e-${nines}`]) invalid(() => preview(draft({ sourceText: `[{"rowKey":"A","input":${token}}]`, defaultReviewStatus: "reviewed" })), "custom_dataset_source_precision");
});

test("CD08 invalid Unicode and NUL are refused in raw text, decoded values and decoded metadata keys", () => {
  for (const sourceText of [String.raw`[{"rowKey":"A","input":"\ud800"}]`, String.raw`[{"rowKey":"A","input":"\u0000"}]`,
    String.raw`[{"rowKey":"A","input":1,"metadata":{"\u0000":true}}]`]) invalid(() => preview(draft({ sourceText, defaultReviewStatus: "reviewed" })));
  for (const sourceText of ["\ud800", "\udfff", "\0", "\ufeff[]"]) invalid(() => preview(draft({ sourceText, defaultReviewStatus: "reviewed" })));
});

test("CD09 prototype-shaped metadata keys remain exact own data through preview, save and restoration", () => {
  const sourceText = String.raw`[{"rowKey":"A","input":1,"metadata":{"__proto__":{"polluted":true},"constructor":{"safe":"data"},"toJSON":"literal"}}]`;
  const d = draft({ sourceText, defaultReviewStatus: "reviewed" }), pinned = preview(d), saved = record(d);
  for (const metadata of [pinned.content.rows[0].metadata, saved.snapshot.rows[0].metadata, core.parseCustomDatasetVersionRecord(saved).snapshot.rows[0].metadata]) {
    assert.equal(Object.hasOwn(metadata, "__proto__"), true);
    assert.deepEqual(plain(metadata.__proto__), { polluted: true });
    assert.deepEqual(plain(metadata.constructor), { safe: "data" });
    assert.equal(metadata.toJSON, "literal");
    assert.equal(Object.getPrototypeOf(metadata), null);
  }
  assert.equal({}.polluted, undefined);
  assert.equal(runInContext("({}).polluted", context), undefined);
});

test("CD10 strict request identity rejects unknown fields, coercions, malformed UUIDs and invalid parent/version combinations", () => {
  const malformed = "11111111-1111-4111-111111111111";
  for (const patch of [{ schemaVersion: "legacy" }, { workspaceId: "foreign" }, { actorId: "caller" }, { version: "1" }, { version: 0 },
    { version: 2, expectedVersionId: null }, { version: 1, expectedVersionId: OTHER }, { version: 2, expectedVersionId: VERSION },
    { version: 2_147_483_648 }, { datasetId: malformed }, { versionId: malformed }, { datasetId: DATASET.toUpperCase().replace("1111", "AAAA") },
    { format: "csv" }, { defaultReviewStatus: "unreviewed" }, { name: "  " }]) invalid(() => core.prepareCustomDatasetDraft(draft(patch)));
  const pinned = preview();
  for (const patch of [{ schemaVersion: "legacy" }, { expectedPreviewFingerprint: "short" }, { workspaceId: "foreign" }]) {
    invalid(() => core.prepareCustomDatasetSaveRequest(realm({ schemaVersion: "custom-dataset-save-v1", draft: draft(), expectedPreviewFingerprint: pinned.fingerprint, ...patch })));
  }
});

test("CD11 row review status is an explicit declaration, and outputs or missing required source fields cannot be silently remapped", () => {
  invalid(() => preview(draft({ sourceText: '[{"rowKey":"A","input":1}]' })), "custom_dataset_review_status_required");
  const pinned = preview(draft({ defaultReviewStatus: "reviewed", sourceText: '[{"rowKey":"A","input":1},{"rowKey":"B","input":2,"reviewStatus":"golden"}]' }));
  assert.deepEqual(plain(pinned.content.rows.map(row => row.reviewStatus)), ["reviewed", "golden"]);
  for (const row of [{ rowKey: "A" }, { input: 1 }, { rowKey: "A", input: 1, output: "actual" },
    { rowKey: "A", input: 1, metadata: null }, { rowKey: "A", input: 1, reviewStatus: "unknown" }]) {
    assert.throws(() => preview(draft({ sourceText: JSON.stringify([row]), defaultReviewStatus: "reviewed" })), error => error.status === 422 && error.rowIndex === 0);
  }
  const multiline = '[\n {"rowKey":"A","input":1},\n {"rowKey":"B","input":2,"unexpected":true}\n]';
  assert.throws(() => preview(draft({ sourceText: multiline, defaultReviewStatus: "reviewed" })), error =>
    error.code === "custom_dataset_row_invalid" && error.rowIndex === 1 && error.line === 3 && error.column === 2);
});

test("CD12 canonical UTF-8 row-key order and unique keys preserve identity without locale or positional IDs", () => {
  const source = [{ rowKey: "😀", input: 1 }, { rowKey: "\ue000", input: 2 }];
  const first = preview(draft({ sourceText: JSON.stringify(source), defaultReviewStatus: "synthetic" }));
  const second = preview(draft({ sourceText: JSON.stringify([...source].reverse()), defaultReviewStatus: "synthetic" }));
  assert.deepEqual(plain(first.content.rows.map(row => row.rowKey)), ["\ue000", "😀"]);
  assert.equal(first.content.fingerprint, second.content.fingerprint);
  assert.notEqual(first.intent.sourceDigest, second.intent.sourceDigest);
  assert.deepEqual(first.content.rows.map(row => row.id), second.content.rows.map(row => row.id));
  invalid(() => preview(draft({ sourceText: '[{"rowKey":"A","input":1},{"rowKey":"A","input":2}]', defaultReviewStatus: "reviewed" })), "custom_dataset_row_key_duplicate");
});

test("CD13 overpopulation is refused during root parsing before malformed extra rows or quadratic location scans", { timeout: 10_000 }, () => {
  const firstHundred = Array.from({ length: 100 }, (_, index) => `{"rowKey":"${index}","input":0}`).join(",");
  const malformedExtra = `[${firstHundred},{"unterminated`;
  assert.throws(() => preview(draft({ sourceText: malformedExtra, defaultReviewStatus: "reviewed" })), error =>
    error.code === "custom_dataset_row_count" && error.rowIndex === 100 && error.line === 1
      && error.column === malformedExtra.indexOf('{"unterminated') + 1);
  invalid(() => preview(draft({ sourceText: `[${Array(20_000).fill("{}").join(",")}]`, defaultReviewStatus: "reviewed" })), "custom_dataset_row_count");
  assert.throws(() => preview(draft({ format: "jsonl", sourceText: Array(20_000).fill("{}").join("\n"), defaultReviewStatus: "reviewed" })), error =>
    error.code === "custom_dataset_row_count" && error.rowIndex === 100 && error.line === 101 && error.column === 1);
});

test("CD14 all one hundred complete rows retain their own stable stored identities", () => {
  const records = Array.from({ length: 100 }, (_, index) => ({ rowKey: `key-${String(index).padStart(3, "0")}`, input: index }));
  const pinned = preview(draft({ sourceText: JSON.stringify(records), defaultReviewStatus: "reviewed" }));
  assert.equal(pinned.content.rows.length, 100);
  assert.equal(new Set(pinned.content.rows.map(row => row.id)).size, 100);
  assert.deepEqual(plain(pinned.content.rows.map(row => row.input)), records.map(row => row.input));
  invalid(() => preview(draft({ sourceText: JSON.stringify([...records, { rowKey: "extra", input: 100 }]), defaultReviewStatus: "reviewed" })), "custom_dataset_row_count");
});

test("CD15 the full one-MiB consumer snapshot boundary includes generated IDs, references and saved timestamp", () => {
  const minimal = [{ rowKey: "A", input: "" }], d = draft({ sourceText: JSON.stringify(minimal), defaultReviewStatus: "reviewed" });
  const baseline = preview(d), capacity = 1_048_576 - baseline.canonicalSnapshotBytes;
  assert.ok(capacity > 0);
  minimal[0].input = "x".repeat(capacity);
  const at = draft({ sourceText: JSON.stringify(minimal), defaultReviewStatus: "reviewed" }), pinned = preview(at), saved = record(at);
  assert.equal(pinned.canonicalSnapshotBytes, 1_048_576);
  assert.equal(Buffer.byteLength(canonical(saved.snapshot)), 1_048_576);
  assert.equal(saved.snapshot.version.createdAt, CREATED);
  assert.equal(core.parseCustomDatasetVersionRecord(saved).fingerprint, saved.fingerprint);
  minimal[0].input += "x";
  invalid(() => preview(draft({ sourceText: JSON.stringify(minimal), defaultReviewStatus: "reviewed" })), "custom_dataset_snapshot_invalid");
});

test("CD16 legal near-node snapshots survive larger preview and record envelopes without reapplying domain limits to copies", { timeout: 60_000 }, () => {
  const source = [{ rowKey: "A", input: { groups: Array.from({ length: 3 }, () => Array(49_900).fill(null)) } }];
  const d = draft({ sourceText: JSON.stringify(source), defaultReviewStatus: "reviewed" }), pinned = preview(d), saved = record(d);
  assert.equal(pinned.content.rows[0].input.groups.flat().length, 149_700);
  assert.equal(core.parseCustomDatasetPreview(pinned).fingerprint, pinned.fingerprint);
  assert.equal(core.parseCustomDatasetVersionRecord(saved).fingerprint, saved.fingerprint);
  assert.equal(saved.snapshot.rows[0].input.groups[2].length, 49_900);
});

test("CD17 JSONL shares one aggregate node budget across rows instead of restarting its allowance", () => {
  const values = [0, 1].map(index => ({ rowKey: `A${index}`, input: [Array(40_000).fill(null), Array(40_000).fill(null)] }));
  invalid(() => preview(draft({ format: "jsonl", sourceText: values.map(value => JSON.stringify(value)).join("\n"), defaultReviewStatus: "reviewed" })), "custom_dataset_source_limit");
});

test("CD18 final consumer depth is enforced while valid near-depth inputs roundtrip through record wrappers", () => {
  function nested(depth) { let value = "leaf"; while (depth-- > 0) value = { next: value }; return value; }
  const d = draft({ sourceText: JSON.stringify([{ rowKey: "A", input: nested(28) }]), defaultReviewStatus: "reviewed" });
  const saved = record(d);
  assert.equal(core.parseCustomDatasetVersionRecord(saved).fingerprint, saved.fingerprint);
  invalid(() => preview(draft({ sourceText: JSON.stringify([{ rowKey: "A", input: nested(30) }]), defaultReviewStatus: "reviewed" })), "custom_dataset_snapshot_invalid");
});

test("CD19 trusted workspace, public dataset, version and row keys namespace full-length storage identities", () => {
  const first = preview(), other = preview(draft(), null, "different-workspace");
  for (const [a, b] of [[first.content.dataset.id, other.content.dataset.id], [first.content.version.id, other.content.version.id],
    [first.content.rows[0].id, other.content.rows[0].id]]) { assert.notEqual(a, b); assert.match(a, /_[a-f0-9]{64}$/); }
  const ids = core.customDatasetStorageIds(WORKSPACE, DATASET, VERSION);
  const versionHash = digest({ workspaceId: WORKSPACE, datasetId: DATASET, versionId: VERSION });
  assert.equal(ids.datasetId, `custom_dataset_${digest({ workspaceId: WORKSPACE, datasetId: DATASET })}`);
  assert.equal(ids.versionId, `custom_dataset_version_${versionHash}`);
  assert.equal(ids.auditId, `audit_custom_dataset_version_${versionHash}`);
  assert.equal(first.content.rows[0].id, `custom_dataset_row_${digest({ workspaceId: WORKSPACE, datasetId: DATASET, versionId: VERSION, rowKey: "Alpha" })}`);
  assert.equal(first.content.version.publicId, other.content.version.publicId);
});

test("CD20 every saved source field affects content while source spelling affects intent independently", () => {
  const baselineRows = rows(), baseline = preview();
  const edits = [row => { row.input = { changed: true }; }, row => { row.expectedOutput = "changed"; }, row => { row.context = null; },
    row => { row.history = []; }, row => { row.traceFixture = { changed: true }; }, row => { row.metadata = { changed: true }; },
    row => { row.reviewStatus = "golden"; }, row => { row.rowKey = "Changed"; }];
  for (const edit of edits) {
    const changed = structuredClone(baselineRows); edit(changed[0]);
    assert.notEqual(preview(draft({ sourceText: JSON.stringify(changed) })).content.fingerprint, baseline.content.fingerprint);
  }
  const pretty = preview(draft({ sourceText: JSON.stringify(baselineRows, null, 2) }));
  assert.equal(pretty.content.fingerprint, baseline.content.fingerprint);
  assert.notEqual(pretty.intent.fingerprint, baseline.intent.fingerprint);
});

test("CD21 raw UTF-8 digest and full versioned intent, preview, request and record preimages are explicit", () => {
  const d = draft(), pinned = preview(d), saved = record(d), req = request(d, pinned);
  assert.equal(pinned.intent.sourceDigest, createHash("sha256").update(d.sourceText, "utf8").digest("hex"));
  assert.notEqual(pinned.intent.sourceDigest, digest(d.sourceText));
  for (const value of [pinned.content, pinned.intent, pinned, saved]) {
    const { fingerprint, ...body } = value;
    assert.equal(fingerprint, digest(body)); assert.equal(fingerprint.length, 64);
  }
  const expected = digest({ schemaVersion: "custom-dataset-request-fingerprint-v1", workspaceId: WORKSPACE,
    intent: pinned.intent, expectedPreviewFingerprint: pinned.fingerprint });
  assert.equal(saved.manifest.requestFingerprint, expected);
  assert.equal(core.customDatasetRequestFingerprint(WORKSPACE, req), expected);
  assert.equal(saved.manifest.previewFingerprint, pinned.fingerprint);
  assert.equal(saved.snapshot.version.fingerprint, pinned.content.fingerprint);
});

test("CD22 append requires the exact prior head and immutable name, and pinned head-content drift changes preview", () => {
  const first = record(), head = core.customDatasetHeadFromRecord(first);
  const next = draft({ versionId: NEXT, version: 2, expectedVersionId: VERSION });
  const pinned = preview(next, head);
  assert.equal(pinned.content.version.previousVersionId, first.content.version.id);
  conflict(() => preview(next), "custom_dataset_version_conflict");
  conflict(() => preview(draft({ versionId: NEXT, version: 2, expectedVersionId: OTHER }), head), "custom_dataset_version_conflict");
  conflict(() => preview(draft({ versionId: NEXT, version: 2, expectedVersionId: VERSION, name: "Renamed" }), head), "custom_dataset_name_immutable");
  const changedHead = clone(head); changedHead.contentFingerprint = "a".repeat(64);
  conflict(() => core.prepareCustomDatasetVersionRecord(realm({ workspaceId: WORKSPACE, request: request(next, pinned), head: changedHead, createdAt: CREATED })), "custom_dataset_preview_changed");
});

test("CD23 frozen record restoration needs no latest-head lookup after constructing a later version", () => {
  const first = record(), head = core.customDatasetHeadFromRecord(first), d2 = draft({ versionId: NEXT, version: 2, expectedVersionId: VERSION });
  const second = record(d2, head, "2026-11-09T00:00:01.000Z");
  assert.notEqual(second.content.version.id, first.content.version.id);
  assert.notEqual(second.content.rows[0].id, first.content.rows[0].id);
  assert.equal(second.content.rows[0].rowKey, first.content.rows[0].rowKey);
  const restored = core.restoreCustomDatasetVersionRecord(realm({ workspaceId: WORKSPACE, snapshot: first.snapshot, manifest: first.manifest }));
  assert.deepEqual(plain(restored), plain(first));
  assert.deepEqual(plain(core.parseCustomDatasetVersionRecord(first)), plain(first));
});

test("CD24 rehashing only an outer record cannot conceal source, identity, timestamp or row-content corruption", () => {
  const saved = record();
  const edits = [r => { r.snapshot.rows[0].input = "changed"; }, r => { r.snapshot.rows[0].metadata = { changed: true }; },
    r => { r.snapshot.rows[0].expectedOutput = { present: false, value: null }; }, r => { r.snapshot.rows[0].reviewStatus = "golden"; },
    r => { r.snapshot.rows[0].id = "foreign"; }, r => { r.snapshot.rows.reverse(); }, r => { r.snapshot.rows.pop(); },
    r => { r.snapshot.dataset.name = "changed"; }, r => { r.snapshot.dataset.kind = "benchmark"; },
    r => { r.snapshot.version.createdAt = "2026-11-10T00:00:00.000Z"; }, r => { r.snapshot.version.fingerprint = "0".repeat(64); },
    r => { r.content.rows[0].input = "changed"; }, r => { r.workspaceId = "foreign"; }];
  for (const edit of edits) { const changed = clone(saved); edit(changed); rehash(changed); conflict(() => core.parseCustomDatasetVersionRecord(changed), "custom_dataset_storage_conflict"); }
});

test("CD25 manifest and frozen-parent mutations are checked beyond the outer fingerprint", () => {
  const first = record(), head = core.customDatasetHeadFromRecord(first);
  const saved = record(draft({ versionId: NEXT, version: 2, expectedVersionId: VERSION }), head);
  const edits = [r => { r.manifest.intent.sourceDigest = "0".repeat(64); rehash(r.manifest.intent); },
    r => { r.manifest.head.contentFingerprint = "1".repeat(64); }, r => { r.manifest.head.name = "Renamed parent"; },
    r => { r.manifest.rowCount = 1; }, r => { r.manifest.requestFingerprint = "2".repeat(64); },
    r => { r.manifest.previewFingerprint = "3".repeat(64); }, r => { r.manifest.createdAt = "2026-11-10T00:00:00.000Z"; },
    r => { r.manifest.rawSourceText = "must not be stored here"; }];
  for (const edit of edits) { const changed = clone(saved); edit(changed); rehash(changed); conflict(() => core.parseCustomDatasetVersionRecord(changed), "custom_dataset_storage_conflict"); }
});

test("CD26 a maximum legal escaped name can be appended without an accidental small-manifest rejection", () => {
  const name = "\u0001".repeat(4096), firstDraft = draft({ name }), first = record(firstDraft);
  const head = core.customDatasetHeadFromRecord(first), saved = record(draft({ name, versionId: NEXT, version: 2, expectedVersionId: VERSION }), head);
  assert.ok(Buffer.byteLength(canonical(saved.manifest)) > 32_768);
  assert.ok(Buffer.byteLength(canonical(saved.manifest)) <= 131_072);
  assert.equal(saved.snapshot.dataset.name, name);
  assert.equal(core.parseCustomDatasetVersionRecord(saved).fingerprint, saved.fingerprint);
});

test("CD27 hostile direct-call containers and accessors are refused without invoking caller getters", () => {
  let calls = 0;
  const accessor = draft(); Object.defineProperty(accessor, "sourceText", { enumerable: true, get() { calls++; return "[]"; } });
  invalid(() => core.prepareCustomDatasetDraft(accessor)); assert.equal(calls, 0);
  const symbol = draft(); symbol[Symbol("hidden")] = true; invalid(() => core.prepareCustomDatasetDraft(symbol));
  const hidden = draft(); Object.defineProperty(hidden, "hidden", { value: true, enumerable: false }); invalid(() => core.prepareCustomDatasetDraft(hidden));
  const cyclic = draft(); cyclic.loop = cyclic; invalid(() => core.prepareCustomDatasetDraft(cyclic));
  const poisoned = clone(record()); Object.defineProperty(poisoned.snapshot.rows[0], "input", { enumerable: true, get() { calls++; return "changed"; } });
  conflict(() => core.parseCustomDatasetVersionRecord(poisoned)); assert.equal(calls, 0);
});

test("CD28 the two-MiB request allowance includes the complete escaped outer save wrapper", () => {
  const base = draft({ sourceText: '[{"rowKey":"A","input":1}]', defaultReviewStatus: "reviewed" });
  const wrapper = { schemaVersion: "custom-dataset-save-v1", draft: plain(base), expectedPreviewFingerprint: "0".repeat(64) };
  const padding = 2_097_152 - Buffer.byteLength(JSON.stringify(wrapper)); assert.ok(padding > 0);
  wrapper.draft.sourceText += " ".repeat(padding);
  assert.equal(Buffer.byteLength(JSON.stringify(wrapper)), 2_097_152);
  assert.equal(core.prepareCustomDatasetSaveRequest(realm(wrapper)).draft.sourceText, wrapper.draft.sourceText);
  wrapper.draft.sourceText += " "; invalid(() => core.prepareCustomDatasetSaveRequest(realm(wrapper)), "custom_dataset_request_too_large");
  invalid(() => core.prepareCustomDatasetDraft(draft({ sourceText: "\n".repeat(1_050_000) + '[{"rowKey":"A","input":1}]', defaultReviewStatus: "reviewed" })), "custom_dataset_request_too_large");
});

test("CD29 preview reparsing refuses changed budget, source content, scope and invented saved-time fields", () => {
  const pinned = preview();
  const edits = [p => { p.canonicalSnapshotBytes--; }, p => { p.createdAtByteAllowance = 23; }, p => { p.workspaceId = "foreign"; },
    p => { p.content.rows[0].input = "changed"; }, p => { p.intent.sourceDigest = "0".repeat(64); }, p => { p.createdAt = CREATED; }];
  for (const edit of edits) { const changed = clone(pinned); edit(changed); rehash(changed); invalid(() => core.parseCustomDatasetPreview(changed)); }
});

test("CD30 UTF-8 byte limits apply to identifiers and names instead of JavaScript character counts", () => {
  const key = "😀".repeat(1024), name = "é".repeat(2048);
  const d = draft({ name, sourceText: JSON.stringify([{ rowKey: key, input: 1 }]), defaultReviewStatus: "reviewed" });
  const pinned = preview(d);
  assert.equal(Buffer.byteLength(pinned.content.rows[0].rowKey), 4096);
  assert.equal(Buffer.byteLength(pinned.content.dataset.name), 4096);
  invalid(() => preview(draft({ ...plain(d), name: `${name}é` })));
  invalid(() => preview(draft({ name, sourceText: JSON.stringify([{ rowKey: `${key}😀`, input: 1 }]), defaultReviewStatus: "reviewed" })));
});

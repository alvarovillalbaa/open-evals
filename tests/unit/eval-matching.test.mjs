// T2: authored deterministic values only. No server, database, provider or model.
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const baseline = process.env.OE_EXACT_BASELINE_DIR;
assert.ok(baseline && path.isAbsolute(baseline));
const roots = [root, baseline].map(value => pathToFileURL(path.resolve(value) + path.sep).href);
registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL && roots.some(value => context.parentURL.startsWith(value))
    && /^\.\.?\//.test(specifier) && !path.extname(new URL(specifier, context.parentURL).pathname)) {
    return nextResolve(specifier + ".ts", context);
  }
  return nextResolve(specifier, context);
} });
const matching = await import("../../packages/core/src/eval-matching.ts");
const legacy = await import("../../packages/core/src/eval-composition.ts");
const engine = await import("../../packages/core/src/eval-engine.ts");
const original = await import(pathToFileURL(path.join(baseline, "packages/core/src/eval-composition.ts")).href);
const { stableHash } = await import("../../packages/core/src/hash.ts");
const workspaceId = "authored-workspace", createdAt = "2026-11-12T00:00:00.000Z";
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const plain = value => JSON.parse(JSON.stringify(value));
const exactDraft = (number = 1, expected = "APPROVED") => ({ schemaVersion: "custom-eval-item-draft-v3", itemId: id(number), versionId: id(number + 1000), version: 1, expectedVersionId: null, name: "Exact response", expected });
const containsDraft = (number = 2, contains = "APPROVED") => ({ schemaVersion: "custom-eval-item-draft-v2", itemId: id(number), versionId: id(number + 1000), version: 1, expectedVersionId: null, name: "Required marker", contains });
function item(number = 1, expected = "APPROVED", scope = workspaceId) {
  const draft = exactDraft(number, expected), preview = matching.resolveCustomEvalItemPreviewV3({ workspaceId: scope, draft, head: null });
  return matching.prepareCustomEvalItemVersionRecordV3({ workspaceId: scope, head: null, createdAt,
    request: { schemaVersion: "custom-eval-item-save-v3", draft, expectedPreviewFingerprint: preview.fingerprint } });
}
function contains(number = 2, scope = workspaceId, module = legacy) {
  const draft = containsDraft(number), preview = module.resolveCustomEvalItemPreviewV2({ workspaceId: scope, draft, head: null });
  return module.prepareCustomEvalItemVersionRecordV2({ workspaceId: scope, head: null, createdAt,
    request: { schemaVersion: "custom-eval-item-save-v2", draft, expectedPreviewFingerprint: preview.fingerprint } });
}
const ref = record => ({ schemaVersion: record.schemaVersion === "custom-eval-item-record-v2" ? "custom-eval-item-ref-v2" : "custom-eval-item-ref-v3",
  itemId: record.draft.itemId, versionId: record.draft.versionId, fingerprint: record.contract.fingerprint });
function setDraft(items, number = 40) {
  return { schemaVersion: "custom-eval-set-draft-v3", setId: id(number), versionId: id(number + 1000), version: 1, expectedVersionId: null,
    name: "Authored acceptance", members: items.map(ref), datasetPassRateThreshold: 100 };
}
function set(items, number = 40) {
  const draft = setDraft(items, number), preview = matching.resolveCustomEvalSetPreviewV3({ workspaceId, draft, head: null, items });
  return matching.prepareCustomEvalSetVersionRecordV3({ workspaceId, head: null, items, createdAt,
    request: { schemaVersion: "custom-eval-set-save-v3", draft, expectedPreviewFingerprint: preview.fingerprint } });
}
function score(record, output) {
  return engine.runDeterministicEval(record.contract, { rowId: "row-authored", rowIndex: 0, sourceId: "source-authored", sourceKind: "dataset", snapshotHash: "a".repeat(64),
    input: { question: "Return the configured acceptance label." }, output, expectedOutput: "AN UNRELATED DATASET REFERENCE" });
}

test("XM01 literal equality rejects prefixes, suffixes, case and whitespace changes", () => {
  for (const actual of ["approved", " APPROVED", "APPROVED ", "APPROVED\n", "APPROVED extra", "prefix APPROVED"]) assert.equal(matching.exactTextMatches(actual, "APPROVED"), false);
  assert.equal(matching.exactTextMatches("APPROVED", "APPROVED"), true);
  assert.equal(matching.exactTextMatches(" A\n", " A\n"), true);
});
test("XM02 strings are not normalized or coerced from other output kinds", () => {
  let coerced = 0;
  const output = { toString() { coerced++; return "APPROVED"; } };
  for (const actual of [output, new String("APPROVED"), 42, true, null, undefined, { value: "APPROVED" }]) assert.equal(matching.exactTextMatches(actual, "APPROVED"), false);
  assert.equal(coerced, 0); assert.equal(matching.exactTextMatches("e\u0301", "é"), false); assert.equal(matching.exactTextMatches("🧭", "🧭"), true);
});
test("XM03 invalid, blank and oversized configured expectations fail before scoring", () => {
  for (const expected of [undefined, null, false, 42, "", " \n", "\0", "\ud800", "\udc00", "x".repeat(4097)]) assert.throws(() => matching.exactTextMatches("value", expected));
  assert.equal(matching.exactTextMatches("é".repeat(2048), "é".repeat(2048)), true);
});
test("XM04 v3 drafts preserve exact text while normalizing only the display name", () => {
  const draft = { ...exactDraft(), name: "  Label check  ", expected: " APPROVED\n" }, result = matching.prepareCustomEvalItemDraftV3(draft);
  assert.equal(result.name, "Label check"); assert.equal(result.expected, draft.expected); assert.notEqual(result, draft);
  draft.expected = "changed"; assert.equal(result.expected, " APPROVED\n");
});
test("XM05 draft admission rejects legacy tags, unknown fields and invalid scalar shapes", () => {
  for (const change of [{ schemaVersion: "custom-eval-item-draft-v2" }, { contains: "APPROVED" }, { version: true }, { expectedVersionId: id(900) }, { name: "x".repeat(121) }, { expected: "é".repeat(2049) }]) {
    assert.throws(() => matching.prepareCustomEvalItemDraftV3({ ...exactDraft(), ...change }));
  }
});
test("XM06 accessors are rejected without executing draft or source-array getters", () => {
  let calls = 0; const draft = exactDraft();
  Object.defineProperty(draft, "expected", { enumerable: true, get() { calls++; return "APPROVED"; } });
  assert.throws(() => matching.prepareCustomEvalItemDraftV3(draft)); assert.equal(calls, 0);
  const records = [item()], sources = [records[0]];
  Object.defineProperty(sources, "0", { enumerable: true, get() { calls++; return records[0]; } });
  assert.throws(() => matching.resolveCustomEvalSetPreviewV3({ workspaceId, draft: setDraft(records), head: null, items: sources })); assert.equal(calls, 0);
});
test("XM07 a first exact record reconstructs its complete immutable definition", () => {
  const record = item(); assert.deepEqual(matching.restoreCustomEvalItemVersionRecordV3(plain(record), workspaceId), record);
  assert.equal(record.contract.type, "exact_match"); assert.equal(record.contract.outputSchema.fields[0].key, "matches_expected");
  assert.equal(record.contract.config.expected, "APPROVED"); assert.equal(record.fingerprint.length, 64);
  assert.match(record.storage.itemId, /^custom_eval_item_v3_[a-f0-9]{64}$/);
  const preview = matching.resolveCustomEvalItemPreviewV3({ workspaceId, draft: record.draft, head: null });
  assert.equal(preview.recordByteAllowance, Buffer.byteLength(JSON.stringify(record)));
});
test("XM08 workspace and family participate in identities and fingerprints", () => {
  const exact = item(), other = item(1, "APPROVED", "other-workspace"), old = contains(1);
  assert.notEqual(exact.storage.itemId, other.storage.itemId); assert.notEqual(exact.contract.fingerprint, other.contract.fingerprint);
  assert.notEqual(exact.storage.itemId, old.storage.itemId); assert.notEqual(exact.storage.versionId, old.storage.versionId);
  assert.throws(() => matching.restoreCustomEvalItemVersionRecordV3(exact, "other-workspace"));
});
test("XM09 changed intent cannot reuse an earlier preview fingerprint", () => {
  const draft = exactDraft(), preview = matching.resolveCustomEvalItemPreviewV3({ workspaceId, draft, head: null });
  assert.throws(() => matching.prepareCustomEvalItemVersionRecordV3({ workspaceId, head: null, createdAt,
    request: { schemaVersion: "custom-eval-item-save-v3", draft: { ...draft, expected: "OTHER" }, expectedPreviewFingerprint: preview.fingerprint } }), error => error.status === 409);
});
test("XM10 appends require the exact matching-family parent and next version", () => {
  const first = item(), head = matching.customEvalItemHeadV3(first), draft = { ...first.draft, versionId: id(2001), version: 2, expectedVersionId: first.draft.versionId, expected: "UPDATED" };
  const preview = matching.resolveCustomEvalItemPreviewV3({ workspaceId, draft, head });
  const next = matching.prepareCustomEvalItemVersionRecordV3({ workspaceId, head, createdAt, request: { schemaVersion: "custom-eval-item-save-v3", draft, expectedPreviewFingerprint: preview.fingerprint } });
  assert.equal(next.head.profile, "eval-matching-v3"); assert.equal(next.draft.version, 2); assert.equal(first.contract.config.expected, "APPROVED");
  assert.throws(() => matching.resolveCustomEvalItemPreviewV3({ workspaceId, draft: { ...draft, expectedVersionId: id(999) }, head }));
  assert.throws(() => matching.resolveCustomEvalItemPreviewV3({ workspaceId, draft, head: legacy.customEvalItemHeadV2(contains()) }));
});
test("XM11 complete contract and record readback refuse edited fields or claimed hashes", () => {
  const record = item();
  for (const change of [r => { r.contract.config.expected = "changed"; }, r => { r.contract.outputSchema.fields[0].gating = false; }, r => { r.fingerprint = "0".repeat(64); }, r => { r.createdAt = "not-a-time"; }, r => { r.contract.type = "string_check"; }]) {
    const altered = plain(record); change(altered); assert.throws(() => matching.restoreCustomEvalItemVersionRecordV3(altered));
  }
});
test("XM12 exact evaluation uses the sealed configured text and reports critical failure", () => {
  const record = item(), pass = score(record, "APPROVED"), fail = score(record, "APPROVED extra");
  assert.deepEqual(pass.fields, [{ key: "matches_expected", value: true, passed: true, decision: "pass" }]);
  assert.deepEqual(fail.fields, [{ key: "matches_expected", value: false, passed: false, decision: "hard_fail" }]);
  assert.equal(pass.evaluatorVersion, record.contract.fingerprint); assert.equal(score(record, { text: "APPROVED" }).fields[0].passed, false);
});
test("XM13 an unsealed exact item cannot fall through to a demonstration judge", () => {
  const record = item(), altered = plain(record); delete altered.contract.authoring;
  assert.throws(() => score(altered, "APPROVED")); assert.throws(() => score({ contract: { ...record.contract, config: {} } }, "APPROVED"));
});
test("XM14 legacy contains behavior stays case-insensitive beside exact checks", () => {
  const old = contains(), exact = item();
  assert.equal(score(old, "approved extra").fields[0].passed, true);
  assert.equal(score(exact, "approved extra").fields[0].passed, false);
});
test("XM15 mixed sets preserve exact source versions and requested membership order", () => {
  const old = contains(), exact = item(), draft = setDraft([old, exact]);
  const preview = matching.resolveCustomEvalSetPreviewV3({ workspaceId, draft, head: null, items: [exact, old] });
  assert.deepEqual(preview.contract.itemVersions.map(m => m.item.id), [old.contract.id, exact.contract.id]);
  assert.deepEqual(preview.members.map(m => m.itemSchemaVersion), ["custom-eval-item-v2", "custom-eval-item-v3"]);
  assert.deepEqual(preview.members.map(m => m.itemRecordFingerprint), [old.fingerprint, exact.fingerprint]);
});
test("XM16 mixed-set records restore complete snapshots without following current heads", () => {
  const old = contains(), exact = item(), saved = set([old, exact]);
  assert.deepEqual(matching.restoreCustomEvalSetVersionRecordV3(plain(saved), workspaceId), saved);
  const changed = plain(exact); changed.draft.name = "A later unsaved name";
  assert.equal(saved.contract.itemVersions[1].item.name, "Exact response"); assert.notEqual(changed.draft.name, saved.contract.itemVersions[1].item.name);
});
test("XM17 shared contains checks keep the same identity across old and mixed sets", () => {
  const old = contains(), exact = item(), first = set([old, exact], 40), second = set([old], 41);
  assert.equal(first.contract.itemVersions[0].item.id, old.contract.id); assert.equal(second.contract.itemVersions[0].item.id, old.contract.id);
  assert.equal(first.members[0].itemRecordFingerprint, second.members[0].itemRecordFingerprint);
});
test("XM18 equal public UUID pairs in different families cannot alias their sources", () => {
  const old = contains(1), exact = item(1), saved = set([old, exact]);
  assert.equal(saved.contract.itemVersions.length, 2); assert.notEqual(saved.members[0].evalItemVersionId, saved.members[1].evalItemVersionId);
  const wrong = setDraft([old, exact]); wrong.members[1].schemaVersion = "custom-eval-item-ref-v2";
  assert.throws(() => matching.resolveCustomEvalSetPreviewV3({ workspaceId, draft: wrong, head: null, items: [old, exact] }));
});
test("XM19 duplicate, missing, foreign-workspace and mismatched source records fail closed", () => {
  const old = contains(), exact = item(), draft = setDraft([old, exact]);
  for (const items of [[old], [old, old], [old, item(1, "APPROVED", "foreign-workspace")]]) assert.throws(() => matching.resolveCustomEvalSetPreviewV3({ workspaceId, draft, head: null, items }));
  const changed = plain(draft); changed.members[1].fingerprint = "0".repeat(64);
  assert.throws(() => matching.resolveCustomEvalSetPreviewV3({ workspaceId, draft: changed, head: null, items: [old, exact] }));
});
test("XM20 membership bounds and gate thresholds reject excess rather than truncating", () => {
  const exact = item(), draft = setDraft([exact]);
  for (const members of [[], [...draft.members, ...draft.members], Array.from({ length: 33 }, (_, i) => ({ ...draft.members[0], itemId: id(i + 200) }))]) assert.throws(() => matching.prepareCustomEvalSetDraftV3({ ...draft, members }));
  for (const threshold of [-1, 101, NaN, true]) assert.throws(() => matching.prepareCustomEvalSetDraftV3({ ...draft, datasetPassRateThreshold: threshold }));
  assert.equal(matching.prepareCustomEvalSetDraftV3({ ...draft, datasetPassRateThreshold: -0 }).datasetPassRateThreshold, 0);
});
test("XM21 mixed-set readback rejects changed provenance, field schemas and membership weights", () => {
  const saved = set([contains(), item()]);
  for (const change of [r => { r.members[0].itemSchemaVersion = "custom-eval-item-v3"; }, r => { r.contract.itemVersions[0].weight = 2; }, r => { r.contract.itemVersions.reverse(); }, r => { r.contract.itemVersions[1].item.outputSchema.fields[0].key = "contains_expected"; }]) {
    const altered = plain(saved); change(altered); assert.throws(() => matching.restoreCustomEvalSetVersionRecordV3(altered));
  }
});
test("XM22 v2 validators do not silently accept matching-v3 identities", () => {
  assert.throws(() => legacy.prepareCustomEvalItemDraftV2(exactDraft()));
  assert.throws(() => legacy.restoreCustomEvalItemVersionRecordV2(item()));
  assert.throws(() => legacy.restoreCustomEvalSetVersionRecordV2(set([item()])));
});
test("XM23 moved value helpers preserve full v2 records and fingerprints from published base", () => {
  const before = contains(2, workspaceId, original), after = contains(2); assert.deepEqual(after, before);
  const make = (module, record) => {
    const draft = { schemaVersion: "custom-eval-set-draft-v2", setId: id(80), versionId: id(1080), version: 1, expectedVersionId: null, name: "Legacy acceptance",
      members: [{ itemId: record.draft.itemId, versionId: record.draft.versionId, fingerprint: record.contract.fingerprint }], datasetPassRateThreshold: 50 };
    const preview = module.resolveCustomEvalSetPreviewV2({ workspaceId, draft, head: null, items: [record] });
    return { preview, record: module.prepareCustomEvalSetVersionRecordV2({ workspaceId, createdAt, head: null, items: [record], request: { schemaVersion: "custom-eval-set-save-v2", draft, expectedPreviewFingerprint: preview.fingerprint } }) };
  };
  assert.deepEqual(make(legacy, after), make(original, before)); assert.deepEqual(legacy.customEvalItemHeadV2(after), original.customEvalItemHeadV2(before));
});
test("XM24 new-family fingerprints bind literal whitespace and complete mixed memberships", () => {
  const a = item(1, "APPROVED"), b = item(1, "APPROVED "); assert.notEqual(a.contract.fingerprint, b.contract.fingerprint);
  const mixed = set([contains(), a]), reordered = set([a, contains()]); assert.notEqual(mixed.contract.fingerprint, reordered.contract.fingerprint);
  const { fingerprint, ...record } = mixed; assert.equal(stableHash(record, 64), fingerprint);
});

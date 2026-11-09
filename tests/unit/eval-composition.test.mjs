// T1 actual modules, authored UNRUN. No target, server, database or model call.
import assert from "node:assert/strict";
import test from "node:test";
import { composition as c, plans, realm, plain, canonical, hash, uuid, WS, NOW, itemDraft, item, ref, setDraft, set } from "../helpers/eval-composition-fixtures.mjs";
const reject = (fn, code) => assert.throws(fn, e => e instanceof c.EvalCompositionError && (!code || e.code === code));

test("EC01 item native identity includes workspace, public aggregate and version with independent hash oracles", () => {
  const r = item(1), key = hash({ schemaVersion: "custom-eval-item-version-identity-v2", workspaceId: WS, id: uuid(1), versionId: uuid(1001) });
  assert.equal(r.storage.versionId, `custom_eval_item_version_v2_${key}`); assert.equal(r.storage.auditId, `audit_custom_eval_item_v2_${key}`);
  assert.equal(r.storage.itemId, `custom_eval_item_v2_${hash({ schemaVersion: "custom-eval-item-identity-v2", workspaceId: WS, id: uuid(1) })}`);
  assert.equal(r.contract.id, r.storage.versionId); assert.equal(r.contract.itemId, r.storage.itemId); assert.equal(r.contract.authoring.itemId, uuid(1));
  assert.notEqual(item(1, "red", {}, null, "other-workspace").storage.versionId, r.storage.versionId);
});
test("EC02 semantic and record fingerprints preserve exact contains bytes and trusted timestamp metadata", () => {
  const r = item(2, "  café 😀\n  ", { name: "  My check  " }); assert.equal(r.draft.name, "My check"); assert.equal(r.contract.config.contains, "  café 😀\n  ");
  for (const value of [r.contract, r]) { const { fingerprint, ...base } = value; assert.equal(fingerprint, hash(base)); }
  assert.deepEqual(Object.keys(r.contract.config), ["contains"]); assert.equal(r.contract.outputSchema.fields[0].criticality, "critical");
});
test("EC03 exact keys, public IDs, parent versions and PostgreSQL version bounds reject malformed drafts", () => {
  for (const patch of [{ extra: true }, { itemId: "not-uuid" }, { version: 0 }, { version: 2147483648 }, { expectedVersionId: uuid(3) }, { version: 2 }, { version: 2, expectedVersionId: uuid(1003) }]) reject(() => c.prepareCustomEvalItemDraftV2(realm(itemDraft(3, "red", patch))));
});
test("EC04 descriptor-safe copying refuses getters and cycles without invoking caller code", () => {
  const raw = realm(itemDraft(4)); let calls = 0; Object.defineProperty(raw, "contains", { enumerable: true, get() { calls++; return "hidden"; } });
  reject(() => c.prepareCustomEvalItemDraftV2(raw)); assert.equal(calls, 0);
  const cyclic = realm(itemDraft(4)); cyclic.extra = cyclic; reject(() => c.prepareCustomEvalItemDraftV2(cyclic));
  const proxy = new Proxy(raw, { getPrototypeOf() { throw new Error("private trap"); } }); reject(() => c.prepareCustomEvalItemDraftV2(proxy));
});
test("EC05 Unicode, NUL, blank text and byte/codepoint limits fail closed", () => {
  for (const contains of ["", " \n", "\u0000", "\ud800", "x".repeat(4097), "€".repeat(1366)]) reject(() => c.prepareCustomEvalItemDraftV2(realm(itemDraft(5, contains))));
  for (const name of [" ", "x".repeat(121), "\udfff", "😀".repeat(121)]) reject(() => c.prepareCustomEvalItemDraftV2(realm(itemDraft(5, "red", { name }))));
  assert.equal(item(5, "x".repeat(4096), { name: "😀".repeat(120) }).contract.name.length, 240);
});
test("EC06 preview accounts complete record bytes and never exposes a synthetic creation timestamp", () => {
  const draft = itemDraft(6), p = c.resolveCustomEvalItemPreviewV2(realm({ workspaceId: WS, draft, head: null })), r = item(6);
  assert.equal(Object.hasOwn(p, "createdAt"), false); assert.equal(p.recordByteAllowance, Buffer.byteLength(canonical(r))); assert.ok(p.recordByteAllowance <= 1048576);
  assert.deepEqual(plain(c.restoreCustomEvalItemVersionRecordV2(realm(r), WS)), r);
});
test("EC07 stale heads and altered preview fingerprints cannot save while appends preserve old names", () => {
  const first = item(7), h = plain(c.customEvalItemHeadV2(realm(first))), next = item(7, "blue", { version: 2, versionId: uuid(7002), expectedVersionId: first.draft.versionId, name: "Renamed" }, h);
  assert.equal(first.contract.name, "Item 7"); assert.equal(next.contract.name, "Renamed"); assert.notEqual(first.contract.fingerprint, next.contract.fingerprint);
  reject(() => c.resolveCustomEvalItemPreviewV2(realm({ workspaceId: WS, draft: next.draft, head: null })), "eval_composition_stale");
  reject(() => c.prepareCustomEvalItemVersionRecordV2(realm({ workspaceId: WS, request: { schemaVersion: "custom-eval-item-save-v2", draft: first.draft, expectedPreviewFingerprint: "0".repeat(64) }, head: null, createdAt: NOW })), "eval_composition_preview_changed");
  assert.deepEqual(plain(c.restoreCustomEvalItemVersionRecordV2(realm(first))), first);
});
test("EC08 set membership order freezes exact native identities and full public/provenance proofs", () => {
  const a = item(8), b = item(9, "blue"), r = set(100, [a, b]);
  assert.deepEqual(r.members.map(m => m.evalItemVersionId), [a.storage.versionId, b.storage.versionId]); assert.deepEqual(r.members.map(m => m.position), [0, 1]);
  assert.deepEqual(r.members, r.contract.memberProofs); assert.equal(r.members[0].publicItemVersionId, a.draft.versionId); assert.equal(r.members[0].itemRecordFingerprint, a.fingerprint);
  const reversed = set(100, [b, a]); assert.notEqual(reversed.fingerprint, r.fingerprint); assert.equal(reversed.members[0].evalItemVersionId, b.storage.versionId);
});
test("EC09 source enumeration order does not replace the author's explicit member order", () => {
  const a = item(10), b = item(11), draft = setDraft(101, [b, a]);
  const p = c.resolveCustomEvalSetPreviewV2(realm({ workspaceId: WS, draft, head: null, items: [a, b] }));
  assert.deepEqual(plain(p.contract.itemVersions.map(m => m.item.id)), [b.storage.versionId, a.storage.versionId]);
});
test("EC10 duplicate membership, changed fingerprints, absent and foreign source records are rejected", () => {
  const a = item(12), draft = setDraft(102, [a]);
  reject(() => c.prepareCustomEvalSetDraftV2(realm({ ...draft, members: [ref(a), ref(a)] })));
  for (const items of [[], [item(13)], [item(12, "red", {}, null, "foreign")], [a, a]]) reject(() => c.resolveCustomEvalSetPreviewV2(realm({ workspaceId: WS, draft, head: null, items })), "eval_composition_sources_invalid");
  reject(() => c.resolveCustomEvalSetPreviewV2(realm({ workspaceId: WS, draft: { ...draft, members: [{ ...ref(a), fingerprint: "0".repeat(64) }] }, head: null, items: [a] })), "eval_composition_sources_invalid");
});
test("EC11 identical configs under distinct version identities stay distinct and are not content-deduplicated", () => {
  const a = item(14), b = item(15), r = set(103, [a, b]); assert.equal(a.contract.config.contains, b.contract.config.contains); assert.equal(r.members.length, 2); assert.notEqual(r.members[0].evalItemVersionId, r.members[1].evalItemVersionId);
});
test("EC12 an old exact item remains valid after renamed heads and a set rename does not mutate old snapshots", () => {
  const first = item(16), later = item(16, "blue", { version: 2, versionId: uuid(16002), expectedVersionId: first.draft.versionId, name: "Later item" }, plain(c.customEvalItemHeadV2(realm(first))));
  const original = set(104, [first]), next = set(104, [later], { version: 2, versionId: uuid(10402), expectedVersionId: original.draft.versionId, name: "Later set" }, plain(c.customEvalSetHeadV2(realm(original))));
  assert.equal(original.contract.itemVersions[0].item.config.contains, "red"); assert.equal(next.contract.itemVersions[0].item.config.contains, "blue");
  assert.deepEqual(plain(c.restoreCustomEvalSetVersionRecordV2(realm(original))), original); assert.deepEqual(set(105, [first]).contract.itemVersions[0].item, first.contract);
});
test("EC13 stored-record corruption cannot be repaired by only recomputing its outer fingerprint", () => {
  const base = set(106, [item(17)]);
  for (const mutate of [r => r.members[0].position = 1, r => r.contract.memberProofs[0].itemRecordFingerprint = "0".repeat(64), r => r.storage.versionId += "x", r => r.createdAt = "2026-02-30T00:00:00.000Z", r => r.contract.itemVersions[0].item.name = "Forged", r => r.previewFingerprint = "0".repeat(64)]) {
    const bad = plain(base); mutate(bad); const { fingerprint, ...body } = bad; bad.fingerprint = hash(body); reject(() => c.restoreCustomEvalSetVersionRecordV2(realm(bad)), "eval_composition_record_invalid");
  }
});
test("EC14 complete32-member resource records retain membership metadata and independent serialized size", () => {
  const items = Array.from({ length: 32 }, (_, i) => item(200 + i, `needle ${i}`)), draft = setDraft(107, items), p = c.resolveCustomEvalSetPreviewV2(realm({ workspaceId: WS, draft, head: null, items })), r = set(107, items);
  assert.equal(r.members.length, 32); assert.equal(p.recordByteAllowance, Buffer.byteLength(canonical(r))); assert.equal(r.createdAt.length, 24); assert.equal(Object.hasOwn(p, "createdAt"), false);
  reject(() => c.prepareCustomEvalSetDraftV2(realm(setDraft(107, [...items, item(250)]))));
});
test("EC15 raw outer JSON is checked before numbers can round or duplicate keys can disappear", () => {
  for (const raw of ['{"version":1,"version":2}', '{"version":1.00000000000000001}', '{"datasetPassRateThreshold":0.10000000000000001}']) assert.throws(() => plans.parseHttpEvalJson(raw), e => e instanceof plans.HttpEvalError);
});
test("EC16 timestamp belongs to stored metadata while replay restoration preserves the original record exactly", () => {
  const first = item(18), request = { schemaVersion: "custom-eval-item-save-v2", draft: first.draft, expectedPreviewFingerprint: first.previewFingerprint };
  const another = c.prepareCustomEvalItemVersionRecordV2(realm({ workspaceId: WS, request, head: null, createdAt: "2026-11-09T00:00:01.000Z" }));
  assert.equal(first.contract.fingerprint, another.contract.fingerprint); assert.notEqual(first.fingerprint, another.fingerprint); assert.deepEqual(plain(c.restoreCustomEvalItemVersionRecordV2(realm(first))), first);
});
test("EC17 unknown source-array element getters are rejected without invoking caller code", () => {
  const saved = item(19), input = realm({ workspaceId: WS, draft: setDraft(108, [saved]), head: null, items: [] }), items = realm([saved]); let calls = 0;
  Object.defineProperty(items, "0", { enumerable: true, configurable: true, get() { calls++; return realm(saved); } }); input.items = items;
  let caught; try { c.resolveCustomEvalSetPreviewV2(input); } catch (error) { caught = error; }
  assert.equal(calls, 0, "the unknown source container must be inspected before any element access");
  assert.ok(caught instanceof c.EvalCompositionError); assert.equal(caught.code, "eval_composition_sources_invalid");
});

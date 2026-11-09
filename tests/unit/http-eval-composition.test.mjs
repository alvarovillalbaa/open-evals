// T1 actual core with authored responses only. No native transport or target is called.
import assert from "node:assert/strict";
import test from "node:test";
import { composition as c, plans, runs, realm, plain, canonical, hash, uuid, WS, NOW, LATER, item, set, source, legacy, dataset, draft, preview, plan, start, claim, finish, complete } from "../helpers/eval-composition-fixtures.mjs";
const reject = (fn, code) => assert.throws(fn, e => e instanceof plans.HttpEvalError && (!code || e.code === code));
function shared(threshold = 100, extra = false) {
  const a = item(1, "red"), b = item(2, "blue"), d = item(3, "green");
  return [source(set(101, [a, b], { datasetPassRateThreshold: threshold })), source(set(102, [b, d], { datasetPassRateThreshold: threshold })), ...(extra ? [source(set(103, [d], { datasetPassRateThreshold: threshold }))] : [])];
}
function legacyPlan(contains = "blue", threshold = 0) {
  const saved = legacy(700, contains, threshold), { evalSetVersions, ...base } = draft([saved]), d = { ...base, schemaVersion: "http-eval-plan-draft-v1", evalSetVersionIds: [saved.contract.id] }, data = dataset();
  const sources = [{ contract: saved.contract, members: saved.members }], p = plans.resolveHttpEvalPlanPreview(realm({ workspaceId: WS, draft: d, dataset: data, evalSets: sources, head: null }));
  return plain(plans.prepareHttpEvalPlanVersionRecord(realm({ workspaceId: WS, request: { schemaVersion: "http-eval-plan-save-v1", draft: d, expectedPreviewFingerprint: p.fingerprint }, dataset: data, evalSets: sources, head: null, createdAt: NOW })));
}
test("EC-HTTP01 two real v2 sets share one exact item and retain memberships with six unique results and twenty gates", () => {
  const sources = shared(), p = preview(sources); assert.deepEqual(plain(p.counts), { rowCount: 2, evalSetCount: 2, uniqueItemCount: 3, resultPairs: 6, targetCalls: 2 });
  const result = complete(plan(sources), ["red blue green", "red blue green"]), r = result.record;
  assert.equal(result.calls.length, 2); assert.equal(r.events.length, 2); assert.equal(r.execution.results.length, 6); assert.equal(r.execution.gates.length, 20); assert.ok(r.execution.gates.every(g => g.passed));
  assert.equal(new Set(r.execution.results.map(v => v.rowId + "/" + v.evalItemVersionId)).size, 6);
  const sharedId = sources[0].members[1].evalItemVersionId; assert.equal(sharedId, sources[1].members[0].evalItemVersionId);
  const sharedResults = r.execution.results.filter(v => v.evalItemVersionId === sharedId).map(v => v.id);
  for (const g of r.execution.gates.filter(g => g.level === "eval_set")) for (const id of sharedResults) assert.ok(g.sourceResultIds.includes(id));
  assert.deepEqual(new Set(r.execution.gates.map(g => g.level)), new Set(["field", "item_row", "row", "dataset", "eval_set", "target", "criticality", "run"]));
});
test("EC-HTTP02 equal configurations under different saved version identities remain two required evaluators", () => {
  const a = item(4), b = item(5), sources = [source(set(104, [a, b]))], r = complete(plan(sources), ["red", "red"]).record;
  assert.equal(r.plan.content.items.length, 2); assert.equal(r.execution.results.length, 4); assert.notEqual(a.contract.id, b.contract.id);
});
test("EC-HTTP03 v2 refs are canonical across selected sets while membership order stays authored", () => {
  const sources = shared(), p = preview(sources), reversed = preview([...sources].reverse()); assert.equal(p.fingerprint, reversed.fingerprint);
  assert.deepEqual(plain(p.content.evalSets.map(s => s.members.map(m => m.position))), [[0, 1], [0, 1]]);
  assert.equal(p.content.evalSets[0].members[0].publicItemId, sources[0].members[0].publicItemId); assert.equal(p.content.evalSets[0].members[0].itemRecordFingerprint, sources[0].members[0].itemRecordFingerprint);
});
test("EC-HTTP04 explicit mixed saved v1/v2 refs resolve without changing immutable v1 source contracts", () => {
  const old = legacy(701, "red"), newer = source(set(105, [item(6, "blue")])), sources = [old, newer], p = preview(sources);
  assert.equal(p.content.items.length, 2); assert.equal(p.content.evalSets[0].ref.schemaVersion, "custom-eval-set-ref-v1"); assert.equal(p.content.evalSets[0].sourceRecordFingerprint, null);
  assert.deepEqual(plain(p.content.evalSets[0].contract), old.contract); assert.equal(old.contract.schemaVersion, "custom-eval-set-v1");
  reject(() => plans.prepareHttpEvalPlanDraft(realm({ ...draft(sources), schemaVersion: "http-eval-plan-draft-v1" })));
});
test("EC-HTTP05 exact public tuple and fingerprint mismatches, duplicate refs and lost full proofs fail before work", () => {
  const sources = shared(), d = draft(sources);
  reject(() => preview(sources, dataset(), { evalSetVersions: [d.evalSetVersions[0], d.evalSetVersions[0]] }));
  for (const key of ["setId", "versionId", "fingerprint"]) { const bad = plain(sources); bad[0].ref[key] = key === "fingerprint" ? "0".repeat(64) : uuid(12345); reject(() => preview(bad), "http_eval_sources_invalid"); }
  const missing = plain(sources); delete missing[0].members[0].itemRecordFingerprint; reject(() => preview(missing), "http_eval_sources_invalid");
  const reordered = plain(sources); reordered[0].members.reverse(); reject(() => preview(reordered), "http_eval_sources_invalid");
});
test("EC-HTTP06 contradictory valid snapshots of one version identity cannot deduplicate away changed intent", () => {
  const a = item(7, "red"), contradictory = item(7, "blue"), sources = [source(set(106, [a])), source(set(107, [contradictory]))];
  assert.equal(a.storage.versionId, contradictory.storage.versionId); assert.notEqual(a.contract.fingerprint, contradictory.contract.fingerprint);
  reject(() => preview(sources), "http_eval_evaluator_conflict");
});
test("EC-HTTP07 profile and version families cannot mix, and v2 append heads carry their explicit family", () => {
  const sources = shared(), first = plan(sources), head = plain(plans.httpEvalPlanHeadFromRecord(realm(first)));
  assert.equal(head.profile, "http-target-eval-v2");
  const next = plan(sources, dataset(), { version: 2, versionId: uuid(8002), expectedVersionId: first.content.draft.versionId, name: "Renamed plan" }, head); assert.equal(next.content.draft.name, "Renamed plan");
  const untagged = plain(head); delete untagged.profile; reject(() => preview(sources, dataset(), { version: 2, versionId: uuid(8002), expectedVersionId: first.content.draft.versionId }, untagged));
  const bad = plain(first); bad.schemaVersion = "http-eval-plan-record-v1"; reject(() => plans.parseHttpEvalPlanVersionRecord(realm(bad)));
  reject(() => runs.createHttpEvalRunLedger(realm({ workspaceId: WS, plan: first, request: { schemaVersion: "http-eval-start-v1", runId: uuid(9000), planVersionId: first.storage.versionId, expectedPlanFingerprint: first.fingerprint }, startedAt: NOW, leaseToken: uuid(9001) })), "http_eval_plan_conflict");
  reject(() => plans.httpEvalDraftFamily({ schemaVersion: "future-profile" }), "http_eval_profile_invalid");
});
test("EC-HTTP08 v2 critical failures block every affected low-threshold scope while v1 policy remains unchanged", () => {
  const sources = shared(0, true), r = complete(plan(sources), ["red green", "red green"]).record;
  for (const source of sources.slice(0, 2)) assert.equal(r.execution.gates.find(g => g.level === "eval_set" && g.scopeId === source.contract.id).passed, false);
  assert.equal(r.execution.gates.find(g => g.level === "eval_set" && g.scopeId === sources[2].contract.id).passed, true);
  assert.equal(r.execution.gates.find(g => g.level === "dataset").passed, false); assert.equal(r.execution.gates.find(g => g.level === "run").passed, false);
  const old = complete(legacyPlan(), ["red green", "red green"]).record;
  assert.equal(old.execution.gates.find(g => g.level === "eval_set").passed, true); assert.equal(old.execution.gates.find(g => g.level === "dataset").passed, true); assert.equal(old.execution.gates.find(g => g.level === "run").passed, false);
  assert.ok(r.execution.gates.every(g => g.thresholdVersion.startsWith("http-eval-thresholds-v2:"))); assert.ok(old.execution.gates.every(g => g.thresholdVersion.startsWith("http-eval-thresholds-v1:")));
});
test("EC-HTTP09 a shared v2 request sends each input once and excludes all references and evaluator configuration", () => {
  const needle = "SECRET_EVALUATOR_NEEDLE", sources = [source(set(108, [item(8, needle)]))], p = plan(sources), initial = start(p), claimed = claim(p, initial), body = JSON.parse(claimed.request.body);
  assert.equal(body.schemaVersion, "http-json-target-request-v1"); assert.deepEqual(body.input, dataset().rows[0].input); assert.equal(body.context, null); assert.equal(Object.hasOwn(body, "history"), false);
  for (const secret of [needle, "SECRET_REFERENCE", "SECRET_TRACE_REFERENCE"]) assert.equal(claimed.request.body.includes(secret), false);
  assert.deepEqual(Object.keys(body).sort(), ["schemaVersion", "requestFingerprint", "runId", "rowId", "input", "context"].sort());
  const { requestFingerprint, ...base } = body; assert.equal(requestFingerprint, hash({ schemaVersion: "http-json-target-request-fingerprint-v1", workspaceId: WS, planFingerprint: p.fingerprint, body: base }));
});
test("EC-HTTP10 running snapshots have no terminal gates and deadline recovery emits matching v2 uncertain events", () => {
  const p = plan(shared()), initial = start(p), claimed = claim(p, initial), running = runs.buildHttpEvalRunRecord(realm({ plan: p, ledger: claimed.ledger, events: [] })); assert.equal(running.execution.gates.length, 0);
  const recovered = runs.recoverHttpEvalRun(realm({ plan: p, ledger: claimed.ledger, now: "2026-11-09T00:00:21.000Z" }));
  assert.deepEqual(plain(recovered.events.map(e => e.status)), ["outcome_unknown", "not_sent"]); assert.ok(recovered.events.every(e => e.schemaVersion === "http-eval-row-event-v2"));
  const r = runs.buildHttpEvalRunRecord(realm({ plan: p, ledger: recovered.ledger, events: recovered.events })); assert.equal(r.schemaVersion, "http-eval-run-record-v2"); assert.equal(r.execution.schemaVersion, "http-eval-execution-v2"); assert.equal(r.execution.results.length, 0); assert.ok(r.execution.gates.every(g => !g.passed));
});
test("EC-HTTP11 owner stop handles only never-claimed rows and immutable v2 events cannot wear v1 tags", () => {
  const p = plan(shared()), initial = start(p), claimed = claim(p, initial), stopped = runs.stopHttpEvalRun(realm({ plan: p, ledger: claimed.ledger, leaseToken: initial.leaseToken, now: LATER, reasonCode: "http_eval_owner_stopped" }));
  assert.equal(stopped.events.length, 1); assert.equal(stopped.ledger.rows[0].status, "claimed"); assert.equal(stopped.ledger.rows[1].status, "not_sent");
  const f = finish(p, { ...claimed, ledger: stopped.ledger }, "red blue green"), events = [f.event, ...stopped.events], r = runs.buildHttpEvalRunRecord(realm({ plan: p, ledger: f.ledger, events })); assert.equal(r.ledger.status, "failed");
  const bad = plain(events); bad[0].schemaVersion = "http-eval-row-event-v1"; reject(() => runs.buildHttpEvalRunRecord(realm({ plan: p, ledger: f.ledger, events: bad })), "http_eval_events_corrupt");
});
test("EC-HTTP12 all eight sets can retain32 memberships each with32 unique items and one target row", () => {
  const items = Array.from({ length: 32 }, (_, i) => item(300 + i)), sources = Array.from({ length: 8 }, (_, i) => source(set(900 + i, items))), data = dataset(1), p = preview(sources, data);
  assert.equal(p.content.evalSets.reduce((n, s) => n + s.members.length, 0), 256); assert.deepEqual(plain(p.counts), { rowCount: 1, evalSetCount: 8, uniqueItemCount: 32, resultPairs: 32, targetCalls: 1 });
  const r = complete(plan(sources, data), ["red"]).record; assert.equal(r.execution.results.length, 32); assert.equal(r.execution.gates.length, 77); assert.ok(r.execution.gates.every(g => g.passed));
});
test("EC-HTTP13 simultaneous maximum coverage and complete output allowance fail preview before an oversized run", () => {
  const items = Array.from({ length: 32 }, (_, i) => item(400 + i)), sources = Array.from({ length: 8 }, (_, i) => source(set(920 + i, items))), data = dataset(100); data.rows[0].input = "x".repeat(900000);
  reject(() => preview(sources, data), "http_eval_record_allowance_exceeded");
  const narrower = preview([source(set(930, [items[0]]))], dataset(100)); assert.equal(narrower.counts.rowCount, 100); // Coverage stays complete when admitted; no sampling fallback.
});
test("EC-HTTP14 complete source budgets and actual large response values remain bound on readback", () => {
  const sources = [source(set(109, [item(9)]))], p = plan(sources), output = "red" + "x".repeat(64997), r = complete(p, [output, output]).record;
  assert.equal(r.events[0].response.output.length, 65000); assert.equal(r.events[1].response.output.length, 65000); assert.equal(r.execution.results.length, 2);
  assert.ok(Buffer.byteLength(canonical(r)) <= preview(sources).recordByteAllowance); assert.ok(Buffer.byteLength(canonical(r)) <= 16777216);
  assert.deepEqual(plain(runs.parseHttpEvalRunRecord(realm(r))), r); assert.ok(preview(sources).recordByteAllowance >= 2 * (65536 - 2));
});
test("EC-HTTP15 unique-item, selected-set and row ceilings reject excess coverage without truncation", () => {
  const items = Array.from({ length: 32 }, (_, i) => item(500 + i)), sources = [source(set(940, items)), source(set(941, [item(550)]))];
  reject(() => preview(sources));
  const sets = Array.from({ length: 9 }, (_, i) => source(set(950 + i, [items[0]]))); reject(() => preview(sets));
  reject(() => preview([sets[0]], dataset(101)), "http_eval_sources_invalid");
});
test("EC-HTTP16 ledger row status must be a string enum for both strict profile families", () => {
  const outcomes = [];
  for (const p of [legacyPlan("red", 100), plan(shared())]) {
    const valid = complete(p, ["red blue green", "red blue green"]).record.ledger;
    assert.deepEqual(plain(runs.parseHttpEvalRunLedger(realm(valid), realm(p))), valid);
    const bad = plain(valid); bad.rows[0].status = ["succeeded"]; const { fingerprint, ...base } = bad; bad.fingerprint = hash(base);
    try { runs.parseHttpEvalRunLedger(realm(bad), realm(p)); outcomes.push("accepted"); }
    catch (error) { assert.ok(error instanceof plans.HttpEvalError); assert.equal(error.code, "http_eval_ledger_corrupt"); outcomes.push("rejected"); }
  }
  assert.deepEqual(outcomes, ["rejected", "rejected"]);
});

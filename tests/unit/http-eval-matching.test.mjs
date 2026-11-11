// T2: real core; authored responses only. No HTTP transport is created.
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { BASELINE, composition, matching, plans, runs, plain, hash, uuid, WS, NOW, LATER, item, exact, set, source, containsSet, legacy, dataset, draft, preview, plan, start, claim, finish, complete } from "../helpers/eval-matching-fixtures.mjs";
const reject = fn => assert.throws(fn);
function mixed(threshold = 100) {
  const contains = item(1, "APPROVED"), equal = exact(2);
  return [source(containsSet(101, [contains], threshold)), source(set(102, [contains, equal], { datasetPassRateThreshold: threshold }))];
}
test("XH01 shared contains and exact versions produce four unique results from two target calls", () => {
  const sources = mixed(), p = preview(sources), result = complete(plan(sources), ["APPROVED", "APPROVED"]);
  assert.deepEqual(p.counts, { rowCount: 2, evalSetCount: 2, uniqueItemCount: 2, resultPairs: 4, targetCalls: 2 });
  assert.equal(result.calls.length, 2); assert.equal(result.record.execution.results.length, 4); assert.equal(result.record.execution.gates.length, 16);
  assert.ok(result.record.execution.gates.every(g => g.passed));
  const shared = sources[0].members[0].evalItemVersionId;
  assert.equal(shared, sources[1].members[0].evalItemVersionId);
  assert.equal(result.record.execution.results.filter(r => r.evalItemVersionId === shared).length, 2);
});
test("XH02 exact mismatch can fail while the original contains rule passes", () => {
  const record = complete(plan(mixed()), ["approved", "APPROVED extra"]).record;
  for (const result of record.execution.results) {
    const exact = result.model === "literal_exact_text_v1";
    assert.equal(result.fields[0].key, exact ? "matches_expected" : "contains_expected");
    assert.equal(result.fields[0].passed, !exact);
    assert.equal(result.fields[0].decision, exact ? "hard_fail" : "pass");
  }
});
test("XH03 structured output is not coerced for exact matching and retains legacy contains behavior", () => {
  const record = complete(plan(mixed(), dataset(1)), [{ label: "APPROVED" }]).record;
  assert.equal(record.execution.results.find(r => r.model === "literal_exact_text_v1").fields[0].passed, false);
  assert.equal(record.execution.results.find(r => r.model === "case_insensitive_contains_v1").fields[0].passed, true);
});
test("XH04 literal whitespace and Unicode sequences survive HTTP snapshots without normalization", () => {
  const sources = [source(set(103, [exact(3, " é\n")]))];
  assert.ok(complete(plan(sources, dataset(1)), [" é\n"]).record.execution.gates.every(g => g.passed));
  for (const output of ["é", " é", " e\u0301\n"]) assert.equal(complete(plan(sources, dataset(1)), [output]).record.execution.results[0].fields[0].passed, false);
});
test("XH05 target bodies exclude both evaluators and all expected-output references", () => {
  const p = plan([source(set(104, [item(4, "PRIVATE_CONTAINS"), exact(5, "PRIVATE_EXACT")]))]), c = claim(p, start(p));
  for (const text of ["PRIVATE_CONTAINS", "PRIVATE_EXACT", "SECRET_REFERENCE", "SECRET_TRACE_REFERENCE", "expectedOutput"]) assert.equal(c.request.body.includes(text), false);
  assert.deepEqual(Object.keys(JSON.parse(c.request.body)).sort(), ["schemaVersion", "requestFingerprint", "runId", "rowId", "input", "context"].sort());
});
test("XH06 every affected critical scope fails even at zero percent and unaffected sets retain their own membership", () => {
  const sources = mixed(0), r = complete(plan(sources), ["approved", "approved"]).record;
  assert.equal(r.execution.gates.find(g => g.level === "eval_set" && g.scopeId === sources[0].contract.id).passed, true);
  assert.equal(r.execution.gates.find(g => g.level === "eval_set" && g.scopeId === sources[1].contract.id).passed, false);
  for (const level of ["dataset", "target", "criticality", "run"]) assert.equal(r.execution.gates.find(g => g.level === level).passed, false);
  assert.deepEqual(new Set(r.execution.gates.map(g => g.level)), new Set(["field", "item_row", "row", "dataset", "eval_set", "target", "criticality", "run"]));
});
test("XH07 explicit v1 v2 v3 sources retain their original complete contracts", () => {
  const sources = [legacy(700, "APPROVED"), ...mixed()], before = plain(sources), p = preview(sources);
  assert.deepEqual(p.content.evalSets.map(s => s.ref.schemaVersion), ["custom-eval-set-ref-v1", "custom-eval-set-ref-v2", "custom-eval-set-ref-v3"]);
  for (const s of sources) assert.deepEqual(p.content.evalSets.find(v => v.ref.schemaVersion === s.ref.schemaVersion).contract, s.contract);
  assert.deepEqual(sources, before); assert.equal(p.counts.uniqueItemCount, 3);
});
test("XH08 earlier profiles reject matching references and mismatched start families", () => {
  const sources = mixed(), d = draft(sources), p = plan(sources);
  reject(() => plans.prepareHttpEvalPlanDraft({ ...d, schemaVersion: "http-eval-plan-draft-v2" }));
  for (const schemaVersion of ["http-eval-start-v1", "http-eval-start-v2"]) reject(() => runs.createHttpEvalRunLedger({ workspaceId: WS, plan: p, request: { schemaVersion, runId: uuid(9000), planVersionId: p.storage.versionId, expectedPlanFingerprint: p.fingerprint }, startedAt: NOW, leaseToken: uuid(9001) }));
});
test("XH09 complete saved plan readback rejects edited exact fields and claimed hashes", () => {
  const p = plan(mixed()); assert.deepEqual(plain(plans.parseHttpEvalPlanVersionRecord(plain(p))), p);
  for (const change of [r => { r.content.items.find(i => i.type === "exact_match").config.expected = "OTHER"; }, r => { r.content.evalSets[1].members.reverse(); }, r => { r.fingerprint = "0".repeat(64); }]) { const altered = plain(p); change(altered); reject(() => plans.parseHttpEvalPlanVersionRecord(altered)); }
});
test("XH10 expired claims become unknown and cannot be resent", () => {
  const p = plan(mixed()), c = claim(p, start(p)), r = runs.recoverHttpEvalRun({ plan: p, ledger: c.ledger, now: "2026-11-12T00:00:21.000Z" });
  assert.deepEqual(r.events.map(e => e.status), ["outcome_unknown", "not_sent"]); assert.ok(r.events.every(e => e.schemaVersion === "http-eval-row-event-v3"));
  reject(() => claim(p, r.ledger)); const record = runs.buildHttpEvalRunRecord({ plan: p, ledger: r.ledger, events: r.events });
  assert.equal(record.execution.results.length, 0); assert.ok(record.execution.gates.every(g => !g.passed));
});
test("XH11 stop leaves claimed work intact and never-claimed rows remain not sent", () => {
  const p = plan(mixed()), initial = start(p), c = claim(p, initial), stopped = runs.stopHttpEvalRun({ plan: p, ledger: c.ledger, leaseToken: initial.leaseToken, now: LATER, reasonCode: "http_eval_owner_stopped" });
  assert.equal(stopped.ledger.rows[0].status, "claimed"); assert.equal(stopped.ledger.rows[1].status, "not_sent");
  const f = finish(p, { ...c, ledger: stopped.ledger }, "APPROVED"), record = runs.buildHttpEvalRunRecord({ plan: p, ledger: f.ledger, events: [f.event, ...stopped.events] });
  assert.equal(record.execution.results.length, 2); assert.equal(record.ledger.status, "failed"); assert.ok(record.execution.gates.some(g => g.reasons.includes("coverage_incomplete")));
});
test("XH12 readback recomputes all exact results and authoritative gates", () => {
  const record = complete(plan(mixed()), ["APPROVED", "APPROVED"]).record;
  assert.deepEqual(plain(runs.parseHttpEvalRunRecord(plain(record))), record);
  for (const change of [r => { r.execution.results[0].fields[0].passed = false; }, r => { r.execution.gates.pop(); }, r => { r.events[0].schemaVersion = "http-eval-row-event-v2"; }]) { const altered = plain(record); change(altered); reject(() => runs.parseHttpEvalRunRecord(altered)); }
});
test("XH13 eight mixed sets retain thirty-two memberships each while sending one authored row once", () => {
  const items = Array.from({ length: 32 }, (_, i) => i % 2 ? exact(300 + i) : item(300 + i, "APPROVED")), sources = Array.from({ length: 8 }, (_, i) => source(set(900 + i, items))), p = plan(sources, dataset(1)), result = complete(p, ["APPROVED"]);
  assert.equal(p.content.items.length, 32); assert.equal(p.content.evalSets.reduce((n, s) => n + s.members.length, 0), 256);
  assert.equal(result.calls.length, 1); assert.equal(result.record.execution.results.length, 32); assert.ok(result.record.execution.gates.every(g => g.passed));
});
test("XH14 thirty-three distinct checks fail before a ledger or target call exists", () => {
  const first = Array.from({ length: 32 }, (_, i) => exact(400 + i)), sources = [source(set(110, first)), source(set(111, [exact(500)]))]; reject(() => preview(sources, dataset(1)));
});
test("XH15 full serialized run stays within the admitted allowance for a large authored response", () => {
  const sources = mixed(), p = preview(sources), record = complete(plan(sources), ["APPROVED", "APPROVED" + "x".repeat(60000)]).record;
  assert.ok(Buffer.byteLength(JSON.stringify(record)) <= p.recordByteAllowance); assert.ok(p.recordByteAllowance <= plans.HTTP_EVAL_LIMITS.recordBytes);
});
test("XH16 original published v1 and v2 plans and full executions stay byte-for-byte identical", async () => {
  assert.ok(BASELINE); const oldPlans = await import(pathToFileURL(path.join(BASELINE, "packages/core/src/http-eval-plans.ts")).href), oldRuns = await import(pathToFileURL(path.join(BASELINE, "packages/core/src/http-eval-runs.ts")).href);
  for (const family of [1, 2]) {
    const sources = family === 1 ? [legacy(701, "APPROVED", 0)] : [source(containsSet(112, [item(6, "APPROVED")], 0))], data = dataset(), raw = draft(sources);
    const { evalSetVersions, ...common } = raw, d = family === 1 ? { ...common, schemaVersion: "http-eval-plan-draft-v1", evalSetVersionIds: sources.map(s => s.contract.id) } : { ...raw, schemaVersion: "http-eval-plan-draft-v2" };
    const selected = family === 1 ? sources.map(({ contract, members }) => ({ contract, members })) : sources;
    const build = (p, r) => { const pre = p.resolveHttpEvalPlanPreview({ workspaceId: WS, draft: d, dataset: data, evalSets: selected, head: null }), saved = p.prepareHttpEvalPlanVersionRecord({ workspaceId: WS, request: { schemaVersion: `http-eval-plan-save-v${family}`, draft: d, expectedPreviewFingerprint: pre.fingerprint }, dataset: data, evalSets: selected, head: null, createdAt: NOW });
      let ledger = r.createHttpEvalRunLedger({ workspaceId: WS, request: { schemaVersion: `http-eval-start-v${family}`, runId: uuid(9000), planVersionId: saved.storage.versionId, expectedPlanFingerprint: saved.fingerprint }, plan: saved, startedAt: NOW, leaseToken: uuid(9001) }); const events = [];
      for (let i = 0; i < 2; i++) { const c = r.claimHttpEvalRow({ plan: saved, ledger, rowId: saved.content.samples[i].rowId, leaseToken: ledger.leaseToken, claimToken: uuid(9100 + i), now: NOW }); const f = r.finalizeHttpEvalRow({ plan: saved, ledger: c.ledger, rowId: c.claim.rowId, claimToken: c.claim.claimToken, completedAt: LATER, responseText: JSON.stringify({ schemaVersion: "http-json-target-response-v1", requestFingerprint: c.claim.requestFingerprint, output: i ? "other" : "APPROVED" }) }); ledger = f.ledger; events.push(f.event); }
      return { preview: pre, plan: saved, record: r.buildHttpEvalRunRecord({ plan: saved, ledger, events }) };
    }; assert.deepEqual(build(plans, runs), build(oldPlans, oldRuns));
  }
});
test("XH17 matching appends require matching-family heads and a fresh complete preview", () => {
  const sources = mixed(), first = plan(sources), head = plans.httpEvalPlanHeadFromRecord(first), patch = { version: 2, versionId: uuid(8002), expectedVersionId: first.content.draft.versionId };
  assert.equal(head.profile, "http-target-eval-v3"); assert.equal(plan(sources, dataset(), patch, head).content.draft.version, 2);
  reject(() => preview(sources, dataset(), patch, { ...head, profile: "http-target-eval-v2" }));
  const p = preview(sources); reject(() => plans.prepareHttpEvalPlanVersionRecord({ workspaceId: WS, request: { schemaVersion: "http-eval-plan-save-v3", draft: { ...p.draft, name: "Changed" }, expectedPreviewFingerprint: p.fingerprint }, dataset: dataset(), evalSets: sources, head: null, createdAt: NOW }));
});
test("XH18 every saved execution layer carries v3 and binds the complete matching policy", () => {
  const r = complete(plan(mixed()), ["APPROVED", "APPROVED"]).record;
  assert.equal(r.schemaVersion, "http-eval-run-record-v3"); assert.equal(r.ledger.schemaVersion, "http-eval-run-ledger-v3"); assert.equal(r.execution.schemaVersion, "http-eval-execution-v3");
  assert.ok(r.events.every(e => e.schemaVersion === "http-eval-row-event-v3")); assert.ok(r.execution.gates.every(g => g.thresholdVersion.startsWith("http-eval-thresholds-v3:")));
  assert.equal(r.plan.content.policy.evaluator, "text_matching_v3"); assert.equal(r.plan.content.policy.maxJudgeCalls, 0);
  const { fingerprint, ...body } = r; assert.equal(hash(body), fingerprint);
});

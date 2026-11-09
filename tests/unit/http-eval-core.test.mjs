// T1 actual source only. No target, socket, database, browser or provider is invoked.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, openSync, fstatSync, lstatSync, readSync, closeSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { createContext, runInContext, SourceTextModule, SyntheticModule } from "node:vm";

function readSource(name) {
  const path = new URL(`../../packages/core/src/${name}.ts`, import.meta.url), fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true }); assert.ok(before.isFile() && before.size <= 65536n);
    const buffer = Buffer.alloc(Number(before.size) + 1); let count = 0;
    while (count < buffer.length) { const n = readSync(fd, buffer, count, buffer.length - count, null); if (!n) break; count += n; }
    assert.equal(count, Number(before.size));
    for (const after of [fstatSync(fd, { bigint: true }), lstatSync(path, { bigint: true })]) for (const key of ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"]) assert.equal(after[key], before[key]);
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, count));
  } finally { closeSync(fd); }
}
const context = createContext({ TextEncoder, URL }, { codeGeneration: { strings: false, wasm: false } });
const crypto = new SyntheticModule(["createHash"], function () { this.setExport("createHash", createHash); }, { context });
const modules = new Map();
for (const name of ["hash", "custom-evals", "eval-engine", "provided-output-runs", "eval-composition", "http-eval-plans", "http-eval-runs"]) modules.set(`./${name}`, new SourceTextModule(stripTypeScriptTypes(readSource(name), { mode: "strip", sourceMap: false }), { context, identifier: `actual-core:${name}.ts` }));
await modules.get("./http-eval-runs").link(specifier => { if (specifier === "node:crypto") return crypto; assert.ok(modules.has(specifier), `unexpected runtime import:${specifier}`); return modules.get(specifier); });
await modules.get("./http-eval-runs").evaluate();
const plans = modules.get("./http-eval-plans").namespace, runs = modules.get("./http-eval-runs").namespace, custom = modules.get("./custom-evals").namespace;
const realmParse = runInContext("JSON.parse", context), realm = value => realmParse(JSON.stringify(value)), plain = value => JSON.parse(JSON.stringify(value));
function canonical(value) { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`; }
const hash = value => createHash("sha256").update(canonical(value)).digest("hex");
const rawHash = value => createHash("sha256").update(value).digest("hex");
const uuid = n => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const WS = "authored-http-workspace", NOW = "2026-11-09T00:00:00.000Z", LATER = "2026-11-09T00:00:01.000Z";
function fail(fn, status = 422, code) { assert.throws(fn, e => e instanceof plans.HttpEvalError && e.status === status && (!code || e.code === code)); }
function dataset(count = 2) {
  return { dataset: { id: "authored-dataset", name: "Authored inputs", kind: "custom-dataset-v1" }, version: { id: "authored-version", datasetId: "authored-dataset", version: 1, fingerprint: "a".repeat(64), createdAt: NOW },
    rows: Array.from({ length: count }, (_, i) => ({ id: `source-row-${i}`, rowKey: `Key${i}`, input: { prompt: `authored input ${i}` }, expectedOutput: { present: true, value: "SECRET_REFERENCE" }, context: { present: i === 0, value: null }, history: { present: false, value: null }, traceFixture: { present: true, value: "SECRET_TRACE_REFERENCE" }, metadata: { origin: "authored", constructor: "data", toJSON: "data" }, reviewStatus: "reviewed" })) };
}
function savedSet(n, needle = "approved", threshold = 100) {
  const prepared = custom.prepareCustomEvalSet(realm({ schemaVersion: "custom-eval-set-draft-v1", setId: uuid(n + 100), versionId: uuid(n), version: 1, expectedVersionId: null, name: `Authored set ${n}`, contains: needle, datasetPassRateThreshold: threshold }));
  const contract = plain(prepared.contract), member = contract.itemVersions[0];
  return { contract, members: [{ evalSetVersionId: contract.id, evalItemVersionId: member.item.id, position: 0, weight: member.weight, criticality: member.criticality, itemFingerprint: member.item.fingerprint }] };
}
function draft(patch = {}) { return { schemaVersion: "http-eval-plan-draft-v1", planId: uuid(1), versionId: uuid(2), version: 1, expectedVersionId: null, name: "Authored HTTP plan", datasetVersionId: "authored-version", evalSetVersionIds: [uuid(10), uuid(11)], target: { targetId: "authored-target", targetVersion: "1", endpoint: "https://authored.example.com/evaluate", timeoutMs: 1000 }, limits: { concurrency: 1, maxDurationSeconds: 5 }, ...patch }; }
function preview(patch = {}, data = dataset(), sets = [savedSet(10), savedSet(11, "ready")], head = null) { return plans.resolveHttpEvalPlanPreview(realm({ workspaceId: WS, draft: draft(patch), dataset: data, evalSets: sets, head })); }
function record(patch = {}, data = dataset(), sets = [savedSet(10), savedSet(11, "ready")], head = null) {
  const p = preview(patch, data, sets, head); return plans.prepareHttpEvalPlanVersionRecord(realm({ workspaceId: WS, request: { schemaVersion: "http-eval-plan-save-v1", draft: p.draft, expectedPreviewFingerprint: p.fingerprint }, dataset: data, evalSets: sets, head, createdAt: NOW }));
}
function start(plan = record(), runId = uuid(20)) { return runs.createHttpEvalRunLedger(realm({ workspaceId: WS, request: { schemaVersion: "http-eval-start-v1", runId, planVersionId: plan.storage.versionId, expectedPlanFingerprint: plan.fingerprint }, plan, startedAt: NOW, leaseToken: uuid(21) })); }
function claim(plan, ledger, index = 0, token = uuid(30 + index), now = NOW) { return runs.claimHttpEvalRow(realm({ plan, ledger, rowId: plan.content.samples[index].rowId, leaseToken: ledger.leaseToken, claimToken: token, now })); }
function response(c, output = "Approved and ready", extra = {}) { return JSON.stringify({ schemaVersion: "http-json-target-response-v1", requestFingerprint: c.claim.requestFingerprint, output, ...extra }); }
function finish(plan, c, output = "Approved and ready", completedAt = LATER) { return runs.finalizeHttpEvalRow(realm({ plan, ledger: c.ledger, rowId: c.claim.rowId, claimToken: c.claim.claimToken, completedAt, responseText: response(c, output) })); }
function complete(plan = record(), outputs = ["Approved and ready", "Approved and ready"]) {
  let ledger = start(plan); const events = [];
  for (let i = 0; i < plan.content.samples.length; i++) { const f = finish(plan, claim(plan, ledger, i), outputs[i]); ledger = f.ledger; events.push(f.event); }
  return runs.buildHttpEvalRunRecord(realm({ plan, ledger, events }));
}
function rehash(value) { const { fingerprint: _, ...body } = value; value.fingerprint = hash(body); return value; }

test("HTTP01 preview freezes complete source presence, metadata, evaluator membership and hidden-reference policy", () => {
  const p = preview(); assert.equal(p.content.samples.length, 2); assert.equal(p.content.items.length, 2);
  assert.deepEqual(plain(p.content.dataset.rows[0].context), { present: true, value: null });
  assert.deepEqual(plain(p.content.dataset.rows[1].context), { present: false, value: null });
  assert.equal(p.content.dataset.rows[0].metadata.constructor, "data"); assert.equal(p.content.dataset.rows[0].metadata.toJSON, "data");
  assert.equal(p.content.policy.expectedOutputVisibility, "hidden"); assert.equal(p.content.policy.maxTargetCalls, 2); assert.equal(p.content.policy.maxJudgeCalls, 0);
  assert.equal(Object.hasOwn(p, "createdAt"), false); assert.ok(p.recordByteAllowance <= 16777216);
  assert.deepEqual(plain(plans.parseHttpEvalPlanPreview(p)), plain(p));
});
test("HTTP02 plan record identity/hash preimages include workspace and both public identities", () => {
  const r = record(), key = hash({ workspaceId: WS, planId: uuid(1), versionId: uuid(2) });
  assert.equal(r.storage.versionId, `http_eval_plan_version_${key}`); assert.equal(r.storage.auditId, `audit_http_eval_plan_${key}`);
  assert.equal(r.storage.planId, `http_eval_plan_${hash({ workspaceId: WS, planId: uuid(1) })}`);
  const { fingerprint, ...body } = plain(r); assert.equal(fingerprint, hash(body));
  assert.notEqual(plans.httpEvalPlanStorageIds("other-workspace", uuid(1), uuid(2)).versionId, r.storage.versionId);
  assert.deepEqual(plain(plans.parseHttpEvalPlanVersionRecord(r)), plain(r));
});
test("HTTP03 saved plan versions allow reviewed rename but enforce exact parent and next number", () => {
  const first = record(), head = plans.httpEvalPlanHeadFromRecord(first), patch = { version: 2, versionId: uuid(3), expectedVersionId: uuid(2), name: "Renamed version" };
  const next = record(patch, dataset(), [savedSet(10), savedSet(11, "ready")], head); assert.equal(next.content.draft.name, "Renamed version"); assert.equal(first.content.draft.name, "Authored HTTP plan");
  fail(() => preview({ ...patch, expectedVersionId: uuid(4) }, dataset(), [savedSet(10), savedSet(11)], head), 409);
  fail(() => preview({ ...patch, version: 3 }, dataset(), [savedSet(10), savedSet(11)], head), 409);
});
test("HTTP04 target, execution limits and references bind preview; stale preview cannot save", () => {
  const p = preview(), d = plain(p.draft); d.target.targetVersion = "2";
  assert.notEqual(preview({ target: d.target }).fingerprint, p.fingerprint);
  assert.notEqual(preview({ limits: { concurrency: 2, maxDurationSeconds: 5 } }).fingerprint, p.fingerprint);
  const data = dataset(); data.rows[0].expectedOutput.value = "another reference"; assert.notEqual(preview({}, data).fingerprint, p.fingerprint);
  fail(() => plans.prepareHttpEvalPlanVersionRecord(realm({ workspaceId: WS, request: { schemaVersion: "http-eval-plan-save-v1", draft: d, expectedPreviewFingerprint: p.fingerprint }, dataset: dataset(), evalSets: [savedSet(10), savedSet(11, "ready")], head: null, createdAt: NOW })), 409);
});
test("HTTP05 source set order is canonical and duplicates, missing members and source mismatch fail", () => {
  assert.equal(preview({ evalSetVersionIds: [uuid(11), uuid(10)] }, dataset(), [savedSet(11, "ready"), savedSet(10)]).fingerprint, preview().fingerprint);
  fail(() => preview({ evalSetVersionIds: [uuid(10), uuid(10)] }));
  const sets = [savedSet(10), savedSet(11)]; sets[0].members = []; fail(() => preview({}, dataset(), sets));
  const data = dataset(); data.version.id = "different"; fail(() => preview({}, data));
});
test("HTTP06 unavailable judge types cannot masquerade as the deterministic capability", () => {
  const sets = [savedSet(10), savedSet(11)]; sets[0].contract.itemVersions[0].item.type = "llm_judge";
  fail(() => preview({}, dataset(), sets));
});
test("HTTP07 exact draft keys, public identities and integer boundaries fail closed", () => {
  for (const patch of [{ extra: true }, { planId: "not-uuid" }, { version: 0 }, { expectedVersionId: uuid(4) }, { versionId: uuid(4), version: 2, expectedVersionId: uuid(4) }]) fail(() => preview(patch));
  for (const concurrency of [0, 1.5, 5]) fail(() => preview({ limits: { concurrency, maxDurationSeconds: 5 } }));
  for (const maxDurationSeconds of [4, 121]) fail(() => preview({ limits: { concurrency: 1, maxDurationSeconds } }));
});
test("HTTP08 endpoint protocol excludes credentials/query/fragment/nondefault ports/IP literals", () => {
  for (const endpoint of ["http://authored.example.com/eval", "https://user:pass@authored.example.com/eval", "https://authored.example.com/eval?q=x", "https://authored.example.com/eval#x", "https://authored.example.com:444/eval", "https://127.0.0.1/eval", "https://[::1]/eval", "https://localhost/eval"]) fail(() => preview({ target: { ...draft().target, endpoint } }));
});
test("HTTP09 descriptor inspection refuses getters without executing caller code", () => {
  const value = runInContext('globalThis.getterCalls=0; ({get x(){getterCalls++;return 1}})', context);
  fail(() => plans.copyHttpEvalJson(value)); assert.equal(runInContext("getterCalls", context), 0);
  fail(() => plans.copyHttpEvalJson(runInContext("(()=>{const a={};a.self=a;return a})()", context)));
});
test("HTTP10 raw parser detects decoded duplicate keys and retains prototype-looking data keys", () => {
  fail(() => plans.parseHttpEvalJson('{"a":1,"\\u0061":2}'), 422, "http_eval_json_duplicate_key");
  const v = plans.parseHttpEvalJson('{"__proto__":{"polluted":true},"constructor":"data","toJSON":"data"}');
  assert.equal(Object.hasOwn(v, "__proto__"), true); assert.equal(v.__proto__.polluted, true); assert.equal(v.constructor, "data"); assert.equal(v.toJSON, "data"); assert.equal(Object.getPrototypeOf(v), null);
});
test("HTTP11 raw decimal equivalence accepts canonical values and zero with a long exponent", () => {
  assert.deepEqual(plain(plans.parseHttpEvalJson('{"a":2.0,"b":1e3,"c":100000000000000000000}')), { a: 2, b: 1000, c: 100000000000000000000 });
  assert.equal(plans.parseHttpEvalJson(`0e${"9".repeat(10000)}`), 0);
});
test("HTTP12 raw numeric parser refuses rounding, underflow and exponent overflow at any depth", () => {
  for (const n of ["9007199254740993", "1.00000000000000001", "1e-999999", "1e999999", "0.10000000000000001"]) fail(() => plans.parseHttpEvalJson(`{"nested":[${n}]}`), 422, "http_eval_json_precision");
});
test("HTTP13 Unicode, NUL, trailing syntax, depth and aggregate source byte limits are enforced", () => {
  for (const s of ['"\\ud800"', '"\\u0000"', '"\ud800"', '{"a":1,}', '[1,]', 'true false']) fail(() => plans.parseHttpEvalJson(s));
  fail(() => plans.parseHttpEvalJson("[".repeat(66) + "0" + "]".repeat(66)));
  fail(() => plans.parseHttpEvalJson('"' + "x".repeat(100) + '"', 100));
});
test("HTTP14 snapshot sizes and row/set maxima are validated before target work", () => {
  fail(() => preview({}, dataset(101)));
  fail(() => preview({ evalSetVersionIds: Array.from({ length: 9 }, (_, i) => uuid(10 + i)) }));
  const data = dataset(1); data.rows[0].input = "x".repeat(1048576); fail(() => preview({}, data));
});
test("HTTP15 record readers recompute snapshots even when an attacker rehashes the outer record", () => {
  const r = plain(record()); r.content.dataset.rows[0].input.prompt = "mutated"; rehash(r); fail(() => plans.parseHttpEvalPlanVersionRecord(realm(r)));
  const r2 = plain(record()); r2.storage.versionId = "http_eval_plan_version_" + "f".repeat(64); rehash(r2); fail(() => plans.parseHttpEvalPlanVersionRecord(realm(r2)));
});
test("HTTP16 start intent binds exact saved storage version, workspace and plan fingerprint", () => {
  const p = record(), l = start(p); assert.equal(l.planVersionId, p.storage.versionId); assert.equal(l.deadlineAt, "2026-11-09T00:00:05.000Z"); assert.equal(l.leaseExpiresAt, "2026-11-09T00:00:20.000Z");
  fail(() => runs.createHttpEvalRunLedger(realm({ workspaceId: "other", request: { schemaVersion: "http-eval-start-v1", runId: uuid(20), planVersionId: p.storage.versionId, expectedPlanFingerprint: p.fingerprint }, plan: p, startedAt: NOW, leaseToken: uuid(21) })), 409);
  fail(() => runs.prepareHttpEvalStartRequest(realm({ schemaVersion: "http-eval-start-v1", runId: uuid(20), planVersionId: p.content.draft.versionId, expectedPlanFingerprint: p.fingerprint })));
});
test("HTTP17 outbound request contains input/present context and excludes all reference/evaluator fields", () => {
  const p = record(), c = claim(p, start(p)), body = JSON.parse(c.request.body);
  assert.deepEqual(Object.keys(body).sort(), ["context", "input", "requestFingerprint", "rowId", "runId", "schemaVersion"].sort()); assert.equal(body.context, null);
  for (const forbidden of ["SECRET_REFERENCE", "SECRET_TRACE_REFERENCE", "contains_expected", "approved", "expectedOutput", "metadata"]) assert.equal(c.request.body.includes(forbidden), false);
  const { requestFingerprint, ...base } = body; assert.equal(requestFingerprint, hash({ schemaVersion: "http-json-target-request-fingerprint-v1", workspaceId: WS, planFingerprint: p.fingerprint, body: base }));
  assert.equal(c.request.idempotencyKey, requestFingerprint); assert.equal(c.request.timeoutMs, 1000);
});
test("HTTP18 owner lease, concurrency, duplicate token and already-claimed rows cannot dispatch", () => {
  const p = record(), l = start(p), c = claim(p, l);
  fail(() => claim(p, c.ledger, 1), 409); fail(() => claim(p, c.ledger, 0), 409);
  fail(() => runs.claimHttpEvalRow(realm({ plan: p, ledger: l, rowId: l.rows[0].rowId, leaseToken: uuid(999), claimToken: uuid(30), now: NOW })), 409);
  const done = finish(p, c); fail(() => claim(p, done.ledger, 1, c.claim.claimToken), 409);
});
test("HTTP19 deadline clips timeout and refuses a new dispatch inside the final 500ms", () => {
  const p = record(), l = start(p), c = claim(p, l, 0, uuid(30), "2026-11-09T00:00:04.000Z"); assert.equal(c.request.timeoutMs, 1000);
  fail(() => claim(p, l, 0, uuid(30), "2026-11-09T00:00:04.501Z"), 409);
});
test("HTTP20 response echo, output presence and exact protocol fields are mandatory", () => {
  const fp = "a".repeat(64), valid = output => JSON.stringify({ schemaVersion: "http-json-target-response-v1", requestFingerprint: fp, output });
  for (const output of [null, "", "   "]) fail(() => runs.parseHttpEvalTargetResponse(valid(output), fp));
  assert.equal(runs.parseHttpEvalTargetResponse(valid(false), fp).output, false); assert.equal(runs.parseHttpEvalTargetResponse(valid(0), fp).output, 0);
  fail(() => runs.parseHttpEvalTargetResponse(valid("actual"), "b".repeat(64)));
  fail(() => runs.parseHttpEvalTargetResponse(JSON.stringify({ schemaVersion: "http-json-target-response-v1", requestFingerprint: fp, output: "actual", secret: true }), fp));
});
test("HTTP21 raw response rejects numeric loss/duplicates and separately bounds normalized output", () => {
  const fp = "a".repeat(64), prefix = `{"schemaVersion":"http-json-target-response-v1","requestFingerprint":"${fp}","output":`;
  fail(() => runs.parseHttpEvalTargetResponse(prefix + '9007199254740993}', fp));
  fail(() => runs.parseHttpEvalTargetResponse(prefix + '{"x":1,"x":2}}', fp));
  fail(() => runs.parseHttpEvalTargetResponse(prefix + '"' + "x".repeat(65536) + '"}', fp));
  const expanding = Array(12000).fill("1e20").join(","); fail(() => runs.parseHttpEvalTargetResponse(prefix + `[${expanding}]}`, fp));
});
test("HTTP22 reported usage/cost are bounded and not inserted into local evaluator token accounting", () => {
  const p = record(), c = claim(p, start(p)); const raw = response(c, "approved ready", { usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, costUsd: 0.01 });
  const f = runs.finalizeHttpEvalRow(realm({ plan: p, ledger: c.ledger, rowId: c.claim.rowId, claimToken: c.claim.claimToken, completedAt: LATER, responseText: raw }));
  assert.equal(f.event.response.costUsd, 0.01); assert.equal(f.event.response.usage.totalTokens, 5); assert.equal(Object.hasOwn(f.results[0], "usage"), false);
  for (const extra of [{ usage: { totalTokens: -1 } }, { usage: { inputTokens: 5, totalTokens: 2 } }, { costUsd: -1 }, { usage: { unknown: 1 } }]) fail(() => runs.parseHttpEvalTargetResponse(response(c, "actual", extra), c.claim.requestFingerprint));
});
test("HTTP23 one real response creates one result per distinct row+item and only declared fields", () => {
  const p = record(), c = claim(p, start(p)), f = finish(p, c);
  assert.equal(f.results.length, 2); assert.equal(new Set(f.results.map(r => r.id)).size, 2); assert.equal(f.event.rawResponseHash, rawHash(response(c)));
  for (const r of f.results) { assert.deepEqual(plain(r.originalOutput), { contains_expected: true }); assert.equal(r.sourceOutputFingerprint, hash("Approved and ready")); assert.equal(r.fields.length, 1); assert.equal(r.evaluatorVersion, p.content.items.find(i => i.id === r.evalItemVersionId).fingerprint); }
});
test("HTTP24 invalid target response finalizes a safe failed outcome without persisting remote HTML", () => {
  const p = record(), c = claim(p, start(p)); const f = runs.finalizeHttpEvalRow(realm({ plan: p, ledger: c.ledger, rowId: c.claim.rowId, claimToken: c.claim.claimToken, completedAt: LATER, responseText: "<html>remote secret</html>" }));
  assert.equal(f.event.status, "failed"); assert.equal(f.event.errorCode, "http_eval_response_invalid"); assert.equal(f.event.response, null); assert.equal(f.results.length, 0); assert.equal(JSON.stringify(f).includes("remote secret"), false);
});
test("HTTP25 transport uncertainty and known not-sent outcomes remain distinct", () => {
  const p = record(), c = claim(p, start(p));
  for (const [errorOutcome, status] of [["unknown", "outcome_unknown"], ["not_sent", "not_sent"]]) { const f = runs.finalizeHttpEvalRow(realm({ plan: p, ledger: c.ledger, rowId: c.claim.rowId, claimToken: c.claim.claimToken, completedAt: LATER, errorCode: "http_target_timeout", errorOutcome })); assert.equal(f.event.status, status); assert.equal(f.event.claim.claimToken, c.claim.claimToken); assert.equal(f.event.response, null); }
  fail(() => runs.finalizeHttpEvalRow(realm({ plan: p, ledger: c.ledger, rowId: c.claim.rowId, claimToken: c.claim.claimToken, completedAt: LATER, errorCode: "arbitrary remote stack" })));
});
test("HTTP26 identical finalize replays but changed content or token cannot overwrite", () => {
  const p = record(), c = claim(p, start(p)), f = finish(p, c), replay = finish(p, { ...c, ledger: f.ledger }); assert.equal(replay.event.fingerprint, f.event.fingerprint);
  fail(() => finish(p, { ...c, ledger: f.ledger }, "changed"), 409);
  fail(() => runs.finalizeHttpEvalRow(realm({ plan: p, ledger: c.ledger, rowId: c.claim.rowId, claimToken: uuid(999), completedAt: LATER, responseText: response(c) })), 409);
});
test("HTTP27 partial execution retains results without persisting premature gates", () => {
  const p = record(), f = finish(p, claim(p, start(p))), r = runs.buildHttpEvalRunRecord(realm({ plan: p, ledger: f.ledger, events: [f.event] }));
  assert.equal(r.ledger.status, "running"); assert.equal(r.execution.results.length, 2); assert.equal(r.execution.gates.length, 0); assert.deepEqual(plain(runs.parseHttpEvalRunRecord(r)), plain(r));
});
test("HTTP28 terminal gates cover all eight levels and use actual dataset and unique rows", () => {
  const r = complete(), levels = [...new Set(r.execution.gates.map(g => g.level))].sort();
  assert.deepEqual(levels, ["field", "item_row", "row", "dataset", "eval_set", "target", "criticality", "run"].sort());
  assert.equal(r.execution.results.length, 4); assert.equal(r.execution.gates.filter(g => g.level === "row").length, 2);
  assert.equal(r.execution.gates.find(g => g.level === "dataset").scopeId, "authored-version"); assert.equal(r.execution.gates.find(g => g.level === "dataset").score, 100);
  assert.equal(r.execution.gates.every(g => g.passed), true); assert.deepEqual(plain(runs.parseHttpEvalRunRecord(r)), plain(r));
});
test("HTTP29 multi-set pass rates are computed from actual row coverage, not result count", () => {
  const r = complete(record({}, dataset(), [savedSet(10), savedSet(11, "ready")]), ["approved ready", "approved"]);
  assert.equal(r.execution.gates.find(g => g.level === "dataset").score, 50);
  const sets = r.execution.gates.filter(g => g.level === "eval_set"); assert.equal(sets.find(g => g.scopeId === uuid(10)).score, 100); assert.equal(sets.find(g => g.scopeId === uuid(11)).score, 50);
  assert.equal(r.execution.gates.find(g => g.level === "run").passed, false); assert.equal(r.execution.gates.find(g => g.level === "criticality").passed, false);
});
test("HTTP30 owner stop immediately marks only pending rows and blocks further dispatch", () => {
  const p = record(), c = claim(p, start(p)), stop = runs.stopHttpEvalRun(realm({ plan: p, ledger: c.ledger, leaseToken: c.ledger.leaseToken, now: LATER, reasonCode: "http_eval_execution_stopped" }));
  assert.equal(stop.events.length, 1); assert.equal(stop.events[0].status, "not_sent"); assert.equal(stop.ledger.rows[0].status, "claimed"); assert.equal(stop.ledger.rows[1].status, "not_sent");
  fail(() => claim(p, stop.ledger, 1), 409); const f = finish(p, { ...c, ledger: stop.ledger }, "approved ready", "2026-11-09T00:00:06.000Z"); assert.equal(f.ledger.status, "failed");
  const r = runs.buildHttpEvalRunRecord(realm({ plan: p, ledger: f.ledger, events: [...stop.events, f.event] })); assert.equal(r.execution.gates.find(g => g.level === "run").passed, false);
});
test("HTTP31 recovery requires expiry, preserves completed evidence and never reclaims a call", () => {
  const p = record(), first = finish(p, claim(p, start(p))), c = claim(p, first.ledger, 1);
  fail(() => runs.recoverHttpEvalRun(realm({ plan: p, ledger: c.ledger, now: "2026-11-09T00:00:19.999Z" })), 409);
  const recovered = runs.recoverHttpEvalRun(realm({ plan: p, ledger: c.ledger, now: "2026-11-09T00:00:20.000Z" }));
  assert.equal(recovered.events.length, 1); assert.equal(recovered.events[0].status, "outcome_unknown"); assert.equal(recovered.ledger.rows[0].eventFingerprint, first.event.fingerprint);
  fail(() => claim(p, recovered.ledger, 1), 409); const r = runs.buildHttpEvalRunRecord(realm({ plan: p, ledger: recovered.ledger, events: [first.event, ...recovered.events] })); assert.equal(r.ledger.status, "outcome_unknown"); assert.equal(r.execution.gates.find(g => g.level === "run").passed, false);
});
test("HTTP32 recovery marks never-claimed rows not_sent with no invented response or claim", () => {
  const p = record(), l = start(p), recovered = runs.recoverHttpEvalRun(realm({ plan: p, ledger: l, now: l.leaseExpiresAt }));
  assert.equal(recovered.ledger.status, "interrupted"); assert.equal(recovered.events.every(e => e.status === "not_sent" && e.claim === null && e.response === null), true);
  assert.equal(runs.buildHttpEvalRunRecord(realm({ plan: p, ...recovered })).execution.results.length, 0);
});
test("HTTP33 readback detects missing, duplicate and tampered immutable row events", () => {
  const r = complete(); fail(() => runs.buildHttpEvalRunRecord(realm({ plan: r.plan, ledger: r.ledger, events: r.events.slice(1) })));
  fail(() => runs.buildHttpEvalRunRecord(realm({ plan: r.plan, ledger: r.ledger, events: [r.events[0], r.events[0]] })));
  const altered = plain(r); altered.events[0].response.output = "changed"; rehash(altered.events[0]); rehash(altered); fail(() => runs.parseHttpEvalRunRecord(realm(altered)));
});
test("HTTP34 rehashed result/gate/ledger corruption cannot override recomputed execution", () => {
  const r = complete();
  for (const mutate of [v => { v.execution.results[0].fields[0].value = false; }, v => { v.execution.gates.find(g => g.level === "dataset").scopeId = "demo-dataset-v1"; }, v => { v.ledger.requestFingerprint = "f".repeat(64); }]) { const v = plain(r); mutate(v); rehash(v); fail(() => runs.parseHttpEvalRunRecord(realm(v))); }
});
test("HTTP35 run and row-item result identities remain workspace/run scoped and collision-free", () => {
  const a = runs.httpEvalRunStorageIds(WS, uuid(20)), b = runs.httpEvalRunStorageIds(WS, uuid(22)); assert.notEqual(a.runId, b.runId);
  assert.notEqual(a.runId, runs.httpEvalRunStorageIds("other", uuid(20)).runId);
  assert.equal(runs.httpEvalResultId(WS, uuid(20), "row", "item"), `http_eval_result_${hash({ workspaceId: WS, runId: uuid(20), rowId: "row", evalItemVersionId: "item" })}`);
  assert.notEqual(runs.httpEvalResultId(WS, uuid(20), "row", "item"), runs.httpEvalResultId(WS, uuid(20), "row", "other-item"));
});
test("HTTP36 pure preview/read/replay code needs no ambient network capability", () => {
  assert.equal(runInContext("typeof fetch", context), "undefined"); const r = complete();
  assert.equal(runs.parseHttpEvalRunRecord(r).fingerprint, r.fingerprint); assert.equal(plans.parseHttpEvalPlanVersionRecord(r.plan).fingerprint, r.plan.fingerprint);
});
test("HTTP37 full 100-row near-1MiB input and eight real saved sets fit the complete worst-case record allowance", () => {
  const data = dataset(100); for (const row of data.rows) row.input = "x".repeat(9800);
  const currentBytes = Buffer.byteLength(canonical(data)); assert.ok(currentBytes < 1048000);
  data.rows[0].input += "x".repeat(1048000 - currentBytes); assert.equal(Buffer.byteLength(canonical(data)), 1048000);
  const sets = Array.from({ length: 8 }, (_, i) => savedSet(10 + i)), p = preview({ evalSetVersionIds: sets.map(s => s.contract.id) }, data, sets);
  assert.equal(p.content.samples.length, 100); assert.equal(p.content.items.length, 8); assert.ok(p.recordByteAllowance < 16777216); assert.ok(p.recordByteAllowance > 100 * 65536 + 1048000);
  const small = complete(); assert.ok(Buffer.byteLength(canonical(small)) <= preview().recordByteAllowance);
});
test("HTTP38 static endpoint rules match the native no-query/no-fragment and reserved-host boundary", () => {
  const endpoints = ["https://authored.example.com/eval?", "https://authored.example.com/eval#", "https://singlelabel/eval", "https://service.internal/eval", "https://service.lan/eval", "https://service.home/eval", "https://service.onion/eval", "https://service.test/eval", "https://service.invalid/eval", "https://service.example/eval", "https://service.home.arpa/eval", "https://bad_label.example.com/eval", "https://-bad.example.com/eval"];
  for (const endpoint of endpoints) fail(() => preview({ target: { ...draft().target, endpoint } }), 422, "http_eval_endpoint_invalid");
});

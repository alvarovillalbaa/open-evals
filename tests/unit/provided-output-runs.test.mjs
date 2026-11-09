// T1: actual pure core modules, bounded authored JSON only; no app, database, network or provider.
// Node's built-in TypeScript eraser is a test loader, not a TypeScript/build check.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, openSync, fstatSync, lstatSync, readSync, closeSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { createContext, runInContext, SourceTextModule, SyntheticModule } from "node:vm";

function readSource(name) {
  const path = new URL(`../../packages/core/src/${name}`, import.meta.url);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true });
    assert.ok(before.isFile() && before.size <= 65_536n, "bounded regular source required");
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let count = 0;
    while (count < buffer.length) {
      const size = readSync(fd, buffer, count, buffer.length - count, null);
      if (!size) break;
      count += size;
    }
    assert.equal(count, Number(before.size));
    for (const after of [fstatSync(fd, { bigint: true }), lstatSync(path, { bigint: true })]) {
      for (const key of ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"]) assert.equal(after[key], before[key]);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, count));
  } finally { closeSync(fd); }
}

const context = createContext({ TextEncoder }, { codeGeneration: { strings: false, wasm: false } });
const crypto = new SyntheticModule(["createHash"], function () { this.setExport("createHash", createHash); }, { context });
const modules = new Map();
for (const name of ["hash", "custom-evals", "eval-engine", "provided-output-runs"]) {
  modules.set(`./${name}`, new SourceTextModule(stripTypeScriptTypes(readSource(`${name}.ts`), { mode: "strip", sourceMap: false }), {
    context, identifier: `actual-core:${name}.ts`
  }));
}
await modules.get("./provided-output-runs").link(specifier => {
  if (specifier === "node:crypto") return crypto;
  assert.ok(modules.has(specifier), `unexpected runtime import: ${specifier}`);
  return modules.get(specifier);
});
await modules.get("./provided-output-runs").evaluate();
const core = modules.get("./provided-output-runs").namespace;
const custom = modules.get("./custom-evals").namespace;
const hashing = modules.get("./hash").namespace;
const realmParse = runInContext("JSON.parse", context);
const realm = value => realmParse(JSON.stringify(value));
const plain = value => JSON.parse(JSON.stringify(value));
const clone = value => realm(plain(value));
const RUN = "11111111-1111-4111-8111-111111111111";
const NEXT_RUN = "22222222-2222-4222-8222-222222222222";
const SET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VERSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const absent = () => ({ present: false, value: null });
function dataset() {
  return realm({ dataset: { id: "saved-dataset", name: "Owned inputs", kind: "user" },
    version: { id: "saved-version-7", datasetId: "saved-dataset", version: 7, fingerprint: "legacy-declared-digest", createdAt: "2026-11-09T00:00:00.000Z" },
    rows: ["a", "b"].map(id => ({ id: `saved-row-${id}`, rowKey: id, input: { question: `Input ${id}` },
      expectedOutput: { present: true, value: "APPROVED reference answer" }, context: absent(), history: absent(), traceFixture: absent(),
      metadata: { cohort: "authored" }, reviewStatus: "reviewed" })) });
}
function evalSet(threshold = 100) {
  const contract = custom.prepareCustomEvalSet(realm({ schemaVersion: "custom-eval-set-draft-v1", setId: SET, versionId: VERSION,
    version: 1, expectedVersionId: null, name: "Approved text", contains: "APPROVED", datasetPassRateThreshold: threshold })).contract;
  return realm({ contract, members: [{ evalSetVersionId: VERSION, evalItemVersionId: contract.itemVersions[0].item.id,
    position: 0, weight: 1, criticality: "critical", itemFingerprint: contract.itemVersions[0].item.fingerprint }] });
}
function draft(outputs = ["APPROVED actual a", "approved actual b"]) {
  return realm({ schemaVersion: "provided-output-run-draft-v1", runId: RUN, datasetVersionId: "saved-version-7", evalSetVersionId: VERSION,
    outputs: outputs.map((output, index) => ({ rowId: `saved-row-${String.fromCharCode(97 + index)}`, output })) });
}
function resolve(options = {}) {
  return core.resolveProvidedOutputRun(realm({ workspaceId: "workspace-one", draft: draft(), dataset: dataset(), evalSet: evalSet(), ...options }));
}
function request(plan) {
  return realm({ schemaVersion: "provided-output-run-request-v1", draft: plan.draft, expectedPlanFingerprint: plan.fingerprint });
}
function record(plan = resolve()) {
  return core.prepareProvidedOutputRunRecord({ workspaceId: plan.workspaceId, request: request(plan), dataset: plan.dataset, evalSet: plan.evalSet });
}
function invalid(fn, code) {
  assert.throws(fn, error => error instanceof core.ProvidedOutputRunError && error.status === 422 && (!code || error.code === code));
}
function rehash(value) {
  const { fingerprint, ...base } = value;
  value.fingerprint = hashing.stableHash(base, 64);
  return value;
}

test("PO01 canonical output ordering preserves exact actual text, including an empty response", () => {
  const value = draft(["", "  APPROVED\n😀  "]);
  value.outputs.reverse();
  const prepared = core.prepareProvidedOutputRunDraft(value);
  assert.deepEqual(plain(prepared.outputs), [{ rowId: "saved-row-a", output: "" }, { rowId: "saved-row-b", output: "  APPROVED\n😀  " }]);
  assert.equal(core.providedOutputRequestFingerprint("workspace-one", request(resolve({ draft: value }))),
    core.providedOutputRequestFingerprint("workspace-one", request(resolve({ draft: clone(prepared) }))));
});

test("PO02 actual outputs are evaluated without substituting stored reference answers", () => {
  const plan = resolve({ draft: draft(["", "unrelated actual response"]) });
  assert.equal(plan.dataset.rows[0].expectedOutput.value, "APPROVED reference answer");
  assert.equal(plan.policy.expectedOutputVisibility, "visible");
  const execution = core.executeProvidedOutputRun(plan);
  assert.deepEqual(plain(execution.results.map(result => result.fields[0].value)), [false, false]);
  assert.equal(execution.gates.find(gate => gate.level === "run").passed, false);
  assert.equal(Object.hasOwn(plan.sampleManifest.rows[0], "expectedOutput"), false);
});

test("PO03 missing, duplicate and foreign output memberships fail closed", () => {
  const missing = draft(); missing.outputs.pop();
  const duplicate = draft(); duplicate.outputs[1].rowId = duplicate.outputs[0].rowId;
  const foreign = draft(); foreign.outputs[1].rowId = "another-dataset-row";
  for (const value of [missing, duplicate, foreign]) invalid(() => resolve({ draft: value }), "provided_output_coverage_invalid");
});

test("PO04 strict draft/request shapes reject coercions, invalid Unicode and accessor execution", () => {
  for (const change of [value => { value.extra = true; }, value => { value.runId = RUN.toUpperCase().replace("1", "A"); },
    value => { value.runId = "11111111-1111-4111-111111111111"; }, value => { value.evalSetVersionId = "bbbbbbbb-bbbb-4bbb-bbbbbbbbbbbb"; },
    value => { value.outputs[0].output = null; }, value => { value.outputs[0].output = "\ud800"; },
    value => { value.outputs[0].output = "NUL\0"; }, value => { value.outputs[0].extra = true; }]) {
    const value = draft(); change(value); invalid(() => core.prepareProvidedOutputRunDraft(value));
  }
  let accessed = false;
  const accessor = draft(); Object.defineProperty(accessor, "outputs", { enumerable: true, get() { accessed = true; throw new Error("must not execute"); } });
  invalid(() => core.prepareProvidedOutputRunDraft(accessor)); assert.equal(accessed, false);
  const badRequest = request(resolve()); badRequest.execute = true;
  invalid(() => core.prepareProvidedOutputRunRequest(badRequest));
});

test("PO05 output byte, aggregate and population bounds are enforced without truncation", () => {
  const boundary = draft(["😀".repeat(16_384), ""]);
  assert.equal(Buffer.byteLength(core.prepareProvidedOutputRunDraft(boundary).outputs[0].output), 65_536);
  boundary.outputs[0].output += "x"; invalid(() => core.prepareProvidedOutputRunDraft(boundary));
  const aggregate = draft(); aggregate.outputs = realm(Array.from({ length: 17 }, (_, index) => ({ rowId: `row-${index}`, output: "x".repeat(65_536) })));
  invalid(() => core.prepareProvidedOutputRunDraft(aggregate));
  const tooMany = draft(); tooMany.outputs = realm(Array.from({ length: 101 }, (_, index) => ({ rowId: `row-${index}`, output: "" })));
  invalid(() => core.prepareProvidedOutputRunDraft(tooMany));
});

test("PO06 complete saved rows use UTF-8 row-key ordering, independent of input arrays", () => {
  const source = dataset(); source.rows[0].rowKey = "😀"; source.rows[1].rowKey = "\ue000";
  const plan = resolve({ dataset: source });
  assert.deepEqual(plain(plan.sampleManifest.rows.map(row => row.sourceId)), ["saved-row-b", "saved-row-a"]);
  assert.deepEqual(plain(plan.sampleManifest.rows.map(row => row.rowIndex)), [0, 1]);
  source.rows.reverse();
  assert.equal(resolve({ dataset: source }).fingerprint, plan.fingerprint);
  assert.deepEqual(plain(plan.sampleManifest.rows.map(row => row.output)), ["approved actual b", "APPROVED actual a"]);
});

test("PO07 every saved source field and declared version fingerprint binds the pinned plan", () => {
  const original = resolve();
  const changes = [source => { source.rows[0].input.question = "changed"; }, source => { source.rows[0].expectedOutput.value = "changed"; },
    source => { source.rows[0].context = { present: true, value: { context: 1 } }; }, source => { source.rows[0].history = { present: true, value: ["changed"] }; },
    source => { source.rows[0].traceFixture = { present: true, value: { trace: "changed" } }; }, source => { source.rows[0].metadata.cohort = "changed"; },
    source => { source.rows[0].reviewStatus = "golden"; }, source => { source.rows[0].rowKey = "new-key"; },
    source => { source.version.fingerprint = "new-declared-digest"; }, source => { source.dataset.name = "Renamed"; }];
  for (const change of changes) {
    const source = dataset(); change(source); const changed = resolve({ dataset: source });
    assert.notEqual(changed.datasetFingerprint, original.datasetFingerprint);
    assert.notEqual(changed.fingerprint, original.fingerprint);
  }
  const independent = createHash("sha256").update(hashing.stableStringify(original.dataset)).digest("hex");
  assert.equal(original.datasetFingerprint, independent);
  assert.match(original.rowFingerprints[0].fingerprint, /^[a-f0-9]{64}$/);
});

test("PO08 SQL absence and present JSON null remain distinct immutable snapshots", () => {
  const absentSource = dataset(), nullSource = dataset();
  nullSource.rows[0].context = realm({ present: true, value: null });
  const absentPlan = resolve({ dataset: absentSource }), nullPlan = resolve({ dataset: nullSource });
  assert.notEqual(absentPlan.rowFingerprints[0].fingerprint, nullPlan.rowFingerprints[0].fingerprint);
  assert.notEqual(absentPlan.fingerprint, nullPlan.fingerprint);
  assert.deepEqual(plain(core.parseProvidedOutputDatasetSnapshot(nullSource).rows[0].context), { present: true, value: null });
});

test("PO09 malformed saved source rows, presence, bounds and JSON fail before execution", () => {
  const changes = [source => { source.rows[0].reviewStatus = "unknown"; }, source => { source.rows[1].id = source.rows[0].id; },
    source => { source.rows[1].rowKey = source.rows[0].rowKey; }, source => { source.rows[0].context = { present: false, value: "concealed" }; },
    source => { source.version.datasetId = "foreign"; }, source => { source.version.createdAt = "2026-11-09"; },
    source => { source.rows[0].input = Infinity; }, source => { source.rows[0].metadata = []; },
    source => { source.rows[0].input = "x".repeat(1_048_576); }];
  for (const change of changes) { const source = dataset(); change(source); invalid(() => core.parseProvidedOutputDatasetSnapshot(source)); }
  const deep = dataset(); let nested = "leaf"; for (let depth = 0; depth < 35; depth++) nested = [nested]; deep.rows[0].input = realm(nested);
  invalid(() => core.parseProvidedOutputDatasetSnapshot(deep));
});

test("PO10 persisted member proof must match every exact pinned custom member", () => {
  const changes = [source => { source.members = []; }, source => { source.members[0].position = 1; }, source => { source.members[0].weight = 0; },
    source => { source.members[0].criticality = "standard"; }, source => { source.members[0].itemFingerprint = "a".repeat(64); },
    source => { source.members[0].evalItemVersionId = "another-item"; }, source => { source.contract.itemVersions[0].item.type = "llm_judge"; }];
  for (const change of changes) { const source = evalSet(); change(source); invalid(() => resolve({ evalSet: source }), "provided_output_eval_set_invalid"); }
  const foreign = draft(); foreign.evalSetVersionId = NEXT_RUN;
  invalid(() => resolve({ draft: foreign }), "provided_output_source_mismatch");
});

test("PO11 workspace and public run identity namespace plan, run, result and gate storage IDs", () => {
  const first = resolve(), otherWorkspace = resolve({ workspaceId: "workspace-two" }), nextDraft = draft(); nextDraft.runId = NEXT_RUN;
  const next = resolve({ draft: nextDraft });
  for (const changed of [otherWorkspace, next]) {
    assert.notEqual(changed.id, first.id); assert.notEqual(changed.runId, first.runId); assert.notEqual(changed.fingerprint, first.fingerprint);
    const before = core.executeProvidedOutputRun(first), after = core.executeProvidedOutputRun(changed);
    assert.equal(after.results.some(result => before.results.some(old => old.id === result.id)), false);
    assert.equal(after.gates.some(gate => before.gates.some(old => old.id === gate.id)), false);
  }
  const identity = hashing.stableHash(realm({ workspaceId: "workspace-one", runId: RUN }), 64);
  assert.equal(first.id, `provided_output_plan_${identity}`); assert.equal(first.runId, `provided_output_run_${identity}`); assert.equal(first.publicRunId, RUN);
});

test("PO12 actual configured text checks produce all eight real-scoped gate levels and provenance", () => {
  const plan = resolve(), execution = core.executeProvidedOutputRun(plan);
  assert.equal(execution.results.length, 2); assert.equal(execution.gates.length, 11);
  assert.deepEqual([...new Set(execution.gates.map(gate => gate.level))].sort(), ["criticality", "dataset", "eval_set", "field", "item_row", "row", "run", "target"]);
  assert.equal(execution.gates.every(gate => gate.passed), true);
  assert.equal(execution.gates.find(gate => gate.level === "dataset").scopeId, "saved-version-7");
  for (const result of execution.results) {
    assert.equal(result.model, "deterministic-string-check-v1"); assert.equal(result.provider, "local");
    assert.equal(result.evaluatorVersion, plan.evalSet.contract.itemVersions[0].item.fingerprint);
    assert.equal(result.conciseRationale.includes("fixture"), false);
    assert.equal(result.evidenceRefs.includes("dataset-version:saved-version-7"), true);
  }
  assert.equal(execution.gates.every(gate => gate.thresholdVersion === plan.evalSet.contract.fingerprint && gate.runId === plan.runId), true);
});

test("PO13 a dataset pass rate may pass while one critical failure fails the authoritative run", () => {
  const plan = resolve({ draft: draft(["approved", "no matching actual text"]), evalSet: evalSet(50) });
  const execution = core.executeProvidedOutputRun(plan), byLevel = level => execution.gates.find(gate => gate.level === level);
  assert.equal(byLevel("dataset").score, 50); assert.equal(byLevel("dataset").passed, true);
  for (const level of ["eval_set", "target", "criticality", "run"]) { assert.equal(byLevel(level).passed, false); assert.equal(byLevel(level).decision, "hard_fail"); }
  assert.equal(byLevel("run").failedCriticalComponents.length, 1);
  const known = new Set(execution.results.map(result => result.id));
  for (const gate of execution.gates) { assert.equal(gate.sourceResultIds.every(id => known.has(id)), true); known.add(gate.id); }
});

test("PO14 every all-pass gate and execution digest uses its complete canonical preimage", () => {
  const plan = resolve(), execution = core.executeProvidedOutputRun(plan);
  for (const value of [plan, plan.sampleManifest, execution, ...execution.gates]) {
    const { fingerprint, ...base } = value;
    assert.equal(fingerprint, createHash("sha256").update(hashing.stableStringify(base)).digest("hex"));
  }
  assert.equal(new Set(execution.gates.map(gate => gate.id)).size, execution.gates.length);
  assert.equal(execution.gates.find(gate => gate.level === "run").score, 100);
});

test("PO15 result cells join by row and member IDs and reject missing, foreign, duplicate or altered cells", () => {
  const plan = resolve(), results = core.executeProvidedOutputRun(plan).results;
  assert.deepEqual(plain(core.validateProvidedOutputResults(plan, clone([...results].reverse()))), plain(results));
  const missing = clone(results); missing.pop();
  const duplicate = clone(results); duplicate[1] = clone(duplicate[0]);
  const foreign = clone(results); foreign[0].rowId = "foreign";
  const member = clone(results); member[0].evalItemVersionId = "unpinned-member";
  const altered = clone(results); altered[0].fields[0].value = false;
  for (const value of [missing, duplicate, foreign, member, altered]) invalid(() => core.validateProvidedOutputResults(plan, value), "provided_output_results_invalid");
});

test("PO16 strict plan reparse rebuilds sources, samples, policies and all fingerprints", () => {
  const plan = resolve(); assert.deepEqual(plain(core.parseProvidedOutputRunPlan(clone(plan))), plain(plan));
  const changes = [value => { value.extra = true; }, value => { value.dataset.rows[0].input.question = "changed"; },
    value => { value.sampleManifest.rows[0].output = "different actual"; }, value => { value.policy.maxTargetCalls = 1; },
    value => { value.evalSet.members[0].weight = 2; }, value => { value.rowFingerprints[0].fingerprint = "0".repeat(64); },
    value => { value.target.version = "unversioned"; }, value => { value.workspaceId = "workspace-two"; }];
  for (const change of changes) { const value = clone(plan); change(value); rehash(value); invalid(() => core.parseProvidedOutputRunPlan(value)); }
});

test("PO17 immutable record replay rebuilds frozen execution after original saved sources mutate", () => {
  const source = dataset(), selected = evalSet(), plan = resolve({ dataset: source, evalSet: selected });
  const saved = record(plan), frozen = plain(saved);
  source.rows[0].input.question = "changed after commit"; selected.members.length = 0;
  assert.deepEqual(plain(core.parseProvidedOutputRunRecord(clone(saved))), frozen);
  assert.deepEqual(plain(record(plan)), frozen);
  assert.equal(saved.requestFingerprint, core.providedOutputRequestFingerprint(plan.workspaceId, request(plan)));
  const { fingerprint, ...body } = saved;
  assert.equal(fingerprint, hashing.stableHash(body, 64));
});

test("PO18 explicit execution refuses preview drift while request intent stays independently hashable", () => {
  const plan = resolve(), originalRequest = request(plan), changed = dataset(); changed.rows[0].metadata.changed = true;
  const requestHash = core.providedOutputRequestFingerprint("workspace-one", originalRequest);
  assert.throws(() => core.prepareProvidedOutputRunRecord({ workspaceId: "workspace-one", request: originalRequest, dataset: changed, evalSet: evalSet() }),
    error => error instanceof core.ProvidedOutputRunError && error.status === 409 && error.code === "provided_output_preview_changed");
  assert.equal(core.providedOutputRequestFingerprint("workspace-one", clone(originalRequest)), requestHash);
  const changedRequest = clone(originalRequest); changedRequest.draft.outputs[0].output = "new actual response";
  assert.notEqual(core.providedOutputRequestFingerprint("workspace-one", changedRequest), requestHash);
  assert.notEqual(core.providedOutputRequestFingerprint("workspace-two", originalRequest), requestHash);
});

test("PO19 outer record rehashing cannot conceal corrupted results, gates, provenance or scope", () => {
  const saved = record();
  const changes = [value => { value.workspaceId = "workspace-two"; }, value => { value.requestFingerprint = "0".repeat(64); },
    value => { value.execution.results[0].fields[0].value = false; }, value => { value.execution.results[0].evidenceRefs = []; },
    value => { value.execution.results.pop(); }, value => { value.execution.gates[0].sourceResultIds = []; },
    value => { value.execution.gates.find(gate => gate.level === "run").passed = false; }, value => { value.execution.fingerprint = "0".repeat(64); },
    value => { value.extra = true; }];
  for (const change of changes) { const value = clone(saved); change(value); rehash(value); invalid(() => core.parseProvidedOutputRunRecord(value)); }
});

test("PO20 hostile JSON containers and oversized stored records are rejected rather than repaired", () => {
  const cyclic = draft(); cyclic.outputs[0].cycle = cyclic;
  invalid(() => core.prepareProvidedOutputRunDraft(cyclic));
  const sparse = draft(); delete sparse.outputs[0]; invalid(() => core.prepareProvidedOutputRunDraft(sparse));
  const symbol = draft(); symbol[Symbol("hidden")] = true; invalid(() => core.prepareProvidedOutputRunDraft(symbol));
  const recordValue = clone(record()); recordValue.extra = "x".repeat(8_388_609);
  invalid(() => core.parseProvidedOutputRunRecord(recordValue));
  const source = dataset(); source.rows[0].metadata.id = "\udfff";
  invalid(() => core.parseProvidedOutputDatasetSnapshot(source));
});

test("PO21 legal near-depth and near-node saved snapshots roundtrip through plan and record wrappers", () => {
  const deep = dataset(); let nested = "leaf";
  for (let depth = 0; depth < 29; depth++) nested = [nested];
  deep.rows[0].input = realm(nested);
  const broad = dataset();
  broad.rows[0].input = realm(Array(74_900).fill(null)); broad.rows[1].input = realm(Array(74_900).fill(null));
  for (const source of [deep, broad]) {
    const plan = resolve({ dataset: source }), saved = record(plan);
    assert.equal(core.parseProvidedOutputDatasetSnapshot(source).rows.length, 2);
    assert.equal(core.parseProvidedOutputRunPlan(clone(plan)).fingerprint, plan.fingerprint);
    assert.equal(core.parseProvidedOutputRunRecord(clone(saved)).fingerprint, saved.fingerprint);
  }
});

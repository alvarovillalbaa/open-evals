// T1 actual-source compatibility against values frozen from published parent894.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, openSync, closeSync, fstatSync, lstatSync, readSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test, { after } from "node:test";
import { createContext, runInContext, SourceTextModule, SyntheticModule } from "node:vm";

const pins = new Map();
function readStable(url, maximum = 131072) {
  const fd = openSync(url, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true });
    assert.ok(before.isFile() && before.size <= BigInt(maximum));
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let count = 0;
    while (count < buffer.length) {
      const size = readSync(fd, buffer, count, buffer.length - count, null);
      if (!size) break;
      count += size;
    }
    assert.equal(count, Number(before.size));
    for (const actual of [fstatSync(fd, { bigint: true }), lstatSync(url, { bigint: true })]) {
      for (const key of ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"]) assert.equal(actual[key], before[key]);
    }
    const bytes = buffer.subarray(0, count);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (pins.has(url.href)) assert.equal(digest, pins.get(url.href));
    else pins.set(url.href, digest);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally { closeSync(fd); }
}

const golden = JSON.parse(readStable(new URL("../fixtures/http-eval-v1-golden.json", import.meta.url)));
assert.equal(golden.parent, "894025656a7d264b3b2d573c90e67c40aba57fcf");
const context = createContext({ TextEncoder, TextDecoder, URL }, { codeGeneration: { strings: false, wasm: false } });
const crypto = new SyntheticModule(["createHash"], function () { this.setExport("createHash", createHash); }, { context });
const modules = new Map();
function coreModule(name) {
  assert.match(name, /^[a-z0-9-]+$/);
  if (!modules.has(name)) {
    const code = stripTypeScriptTypes(readStable(new URL(`../../packages/core/src/${name}.ts`, import.meta.url)), { mode: "strip", sourceMap: false });
    modules.set(name, new SourceTextModule(code, { context, identifier: `actual-core:${name}.ts` }));
  }
  return modules.get(name);
}
const entry = coreModule("http-eval-runs");
await entry.link(specifier => {
  if (specifier === "node:crypto") return crypto;
  assert.match(specifier, /^\.\/[a-z0-9-]+$/);
  return coreModule(specifier.slice(2));
});
await entry.evaluate();
const plans = modules.get("http-eval-plans").namespace, runs = entry.namespace;
const realmParse = runInContext("JSON.parse", context);
const realm = value => realmParse(JSON.stringify(value));
const plain = value => JSON.parse(JSON.stringify(value));
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
function check(name, value) {
  const body = canonical(plain(value)), expected = golden.hashes[name];
  assert.equal(value.fingerprint, expected.fingerprint);
  assert.equal(Buffer.byteLength(body), expected.bytes);
  assert.equal(createHash("sha256").update(body).digest("hex"), expected.canonicalSha256);
}

const f = golden.fixture;
const source = { workspaceId: f.workspaceId, draft: f.draft, dataset: f.dataset, evalSets: f.evalSets, head: null };
const preview = plans.resolveHttpEvalPlanPreview(realm(source));
const plan = plans.prepareHttpEvalPlanVersionRecord(realm({ ...source,
  request: { schemaVersion: "http-eval-plan-save-v1", draft: preview.draft, expectedPreviewFingerprint: preview.fingerprint }, createdAt: f.createdAt }));
const initialLedger = runs.createHttpEvalRunLedger(realm({ workspaceId: f.workspaceId,
  request: { schemaVersion: "http-eval-start-v1", runId: f.runId, planVersionId: plan.storage.versionId, expectedPlanFingerprint: plan.fingerprint },
  plan, startedAt: f.createdAt, leaseToken: f.leaseToken }));
let ledger = initialLedger;
const events = [];
for (let index = 0; index < plan.content.samples.length; index++) {
  const claimed = runs.claimHttpEvalRow(realm({ plan, ledger, rowId: plan.content.samples[index].rowId,
    leaseToken: ledger.leaseToken, claimToken: f.claimTokens[index], now: f.createdAt }));
  const finished = runs.finalizeHttpEvalRow(realm({ plan, ledger: claimed.ledger, rowId: claimed.claim.rowId,
    claimToken: claimed.claim.claimToken, completedAt: f.completedAt,
    responseText: JSON.stringify({ schemaVersion: "http-json-target-response-v1", requestFingerprint: claimed.claim.requestFingerprint, output: f.outputs[index] }) }));
  ledger = finished.ledger;
  events.push(finished.event);
}
const run = runs.buildHttpEvalRunRecord(realm({ plan, ledger, events }));

test("V1-COMPAT01 preview retains published canonical bytes and fingerprint", () => check("preview", preview));
test("V1-COMPAT02 plan retains published canonical bytes and fingerprint", () => check("plan", plan));
test("V1-COMPAT03 initial ledger retains published canonical bytes and fingerprint", () => check("ledger", initialLedger));
test("V1-COMPAT04 execution retains published canonical bytes, result IDs and gate IDs", () => {
  check("execution", run.execution);
  assert.deepEqual(plain(run.execution.results.map(result => result.id)), golden.resultIds);
  assert.deepEqual(plain(run.execution.gates.map(gate => gate.id)), golden.gateIds);
});
test("V1-COMPAT05 complete run retains published canonical bytes and fingerprint", () => check("run", run));
after(() => { for (const url of pins.keys()) readStable(new URL(url)); });

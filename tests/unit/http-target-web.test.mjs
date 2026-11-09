// T2: actual web/core source with authored auth, database, clock and transport seams.
// Node's built-in TypeScript transformation plus VM loading is not a framework/type check.
// Dated receipts identify actual runs. No native DB, DNS, socket, TLS or provider proof.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, openSync, fstatSync, lstatSync, readSync, closeSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { createContext, runInContext, SourceTextModule, SyntheticModule } from "node:vm";

const root = new URL("../../", import.meta.url);
const WORKSPACE = "authored-http-web-workspace", ACTOR = "authored-http-web-owner";
const CREATED = "2026-11-09T00:00:00.000Z", MAX = 16 * 1024 * 1024 + 4096;
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const plain = value => JSON.parse(JSON.stringify(value));
const sourceNames = [
  "packages/core/src/hash.ts", "packages/core/src/custom-evals.ts", "packages/core/src/eval-engine.ts",
  "packages/core/src/provided-output-runs.ts", "packages/core/src/http-eval-plans.ts", "packages/core/src/http-eval-runs.ts",
  "apps/web/lib/custom-eval-access.ts", "apps/web/lib/custom-evals.ts", "apps/web/lib/instruction-request.ts",
  "apps/web/lib/http-target-plans.ts", "apps/web/lib/http-target-runs.ts",
  "apps/web/app/api/v1/http-target-plans/route.ts", "apps/web/app/api/v1/http-target-plans/preview/route.ts",
  "apps/web/app/api/v1/http-target-plans/[planId]/route.ts",
  "apps/web/app/api/v1/http-target-plans/[planId]/versions/[versionId]/route.ts",
  "apps/web/app/api/v1/http-target-plans/[planId]/versions/[versionId]/runs/route.ts",
  "apps/web/app/api/v1/http-target-plans/runs/[runId]/route.ts",
  "apps/web/app/api/v1/http-target-plans/runs/[runId]/recover/route.ts"
];
function readActual(name) {
  const path = new URL(name, root), fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true }); assert.ok(before.isFile() && before.size <= 131072n);
    const bytes = Buffer.alloc(Number(before.size) + 1); let count = 0;
    while (count < bytes.length) { const size = readSync(fd, bytes, count, bytes.length - count, null); if (!size) break; count += size; }
    assert.equal(count, Number(before.size));
    for (const after of [fstatSync(fd, { bigint: true }), lstatSync(path, { bigint: true })])
      for (const key of ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"]) assert.equal(after[key], before[key]);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count));
  } finally { closeSync(fd); }
}
const sources = new Map(sourceNames.map(name => [name, readActual(name)]));

async function harness(rowCount = 2) {
  const state = { now: Date.parse(CREATED), logs: [], calls: [], active: 0, maximumActive: 0,
    transaction: false, rows: rowCount, auth: { authKind: "session", role: "owner", scopes: ["evals:read", "evals:write"] },
    sequence: 1000, runs: new Map(), timers: new Map(), failFinalize: false, invalidReservationReply: false, native: undefined };
  class Clock extends Date { static now() { return state.now; } }
  const context = createContext({ Buffer, URL, TextEncoder, TextDecoder, Request, Response, ReadableStream,
    AbortController, AbortSignal, Date: Clock, process: { env: { NODE_ENV: "production" } },
    setTimeout(callback, milliseconds) { const token = ++state.sequence; state.timers.set(token, { callback, at: state.now + milliseconds }); return token; },
    clearTimeout(token) { state.timers.delete(token); }
  }, { codeGeneration: { strings: false, wasm: false } });
  const realmParse = runInContext("JSON.parse", context), realm = value => realmParse(JSON.stringify(value));
  const error = (status, message) => {
    const value = runInContext("new Error()", context); value.message = message; value.status = status; value.code = message; return value;
  };
  const modules = new Map(), synthetic = new Map();
  const makeSynthetic = (name, values) => {
    const module = new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context, identifier: name });
    synthetic.set(name, module); return module;
  };
  makeSynthetic("node:crypto", { createHash });
  function actual(name) {
    if (modules.has(name)) return modules.get(name);
    assert.ok(sources.has(name), `unapproved source module: ${name}`);
    const module = new SourceTextModule(stripTypeScriptTypes(sources.get(name), { mode: "transform", sourceMap: false }), { context, identifier: name });
    modules.set(name, module); return module;
  }
  async function link(specifier, parent) {
    if (synthetic.has(specifier)) return synthetic.get(specifier);
    if (specifier.startsWith("@/lib/")) return actual("apps/web/lib/" + specifier.slice(6) + ".ts");
    assert.ok(specifier.startsWith("./"), `unapproved runtime import: ${specifier}`);
    const base = parent.identifier.slice(0, parent.identifier.lastIndexOf("/") + 1);
    return actual(base + specifier.slice(2) + ".ts");
  }
  for (const name of ["packages/core/src/http-eval-plans.ts", "packages/core/src/http-eval-runs.ts"]) {
    const module = actual(name); if (module.status === "unlinked") await module.link(link); if (module.status === "linked") await module.evaluate();
  }
  const core = Object.assign({}, modules.get("packages/core/src/custom-evals.ts").namespace,
    modules.get("packages/core/src/http-eval-plans.ts").namespace, modules.get("packages/core/src/http-eval-runs.ts").namespace);
  makeSynthetic("@open-evals/core", core);
  const timestamp = () => new Date(state.now).toISOString();
  const evaluator = core.prepareCustomEvalSet(realm({ schemaVersion: "custom-eval-set-draft-v1", setId: id(1), versionId: id(2),
    version: 1, expectedVersionId: null, name: "Authored contains evaluator", contains: "APPROVED", datasetPassRateThreshold: 50 }));
  const contract = evaluator.contract;
  const set = realm({ contract, members: contract.itemVersions.map((member, position) => ({ evalSetVersionId: contract.id,
    evalItemVersionId: member.item.id, position, weight: member.weight, criticality: member.criticality, itemFingerprint: member.item.fingerprint })) });
  const metadata = JSON.parse('{"__proto__":{"authored":"retained"},"constructor":"own data","toJSON":"literal"}');
  const dataset = realm({ dataset: { id: "authored-dataset", name: "Authored input rows", kind: "user" },
    version: { id: "authored-dataset-version", datasetId: "authored-dataset", version: 1, fingerprint: "authored-source", createdAt: CREATED },
    rows: Array.from({ length: rowCount }, (_, index) => ({ id: `authored-row-${index}`, rowKey: `Row ${index}`, input: { prompt: `Authored ${index}` },
      expectedOutput: { present: true, value: "reference must not leave" }, context: { present: index === 0, value: index === 0 ? false : null },
      history: { present: false, value: null }, traceFixture: { present: false, value: null }, metadata, reviewStatus: "reviewed" })) });
  const draft = realm({ schemaVersion: "http-eval-plan-draft-v1", planId: id(3), versionId: id(4), version: 1, expectedVersionId: null,
    name: "Authored HTTP plan", datasetVersionId: dataset.version.id, evalSetVersionIds: [contract.id],
    target: { targetId: "authored-target", targetVersion: "v1", endpoint: "https://target.example.com/evaluate", timeoutMs: 1000 },
    limits: { concurrency: 2, maxDurationSeconds: 5 } });
  const preview = core.resolveHttpEvalPlanPreview(realm({ workspaceId: WORKSPACE, draft, dataset, evalSets: [set], head: null }));
  const saveRequest = realm({ schemaVersion: "http-eval-plan-save-v1", draft, expectedPreviewFingerprint: preview.fingerprint });
  const plan = core.prepareHttpEvalPlanVersionRecord(realm({ workspaceId: WORKSPACE, request: saveRequest, dataset, evalSets: [set], head: null, createdAt: CREATED }));
  const auth = () => realm({ ...state.auth, workspaceId: WORKSPACE, user: { id: ACTOR } });
  // Each fake transaction is synchronous through commit. This tests the coordinator seam,
  // not PostgreSQL locking, rollback, SQL parity or membership enforcement.
  const atomic = callback => {
    assert.equal(state.transaction, false); state.transaction = true;
    try { return callback(); } finally { state.transaction = false; }
  };
  const stored = runId => { const value = state.runs.get(runId); if (!value) throw error(404, "http_eval_not_found"); return value; };
  const db = {
    isDatabaseUnavailable: value => value?.status === 503,
    async getHttpEvalPlanSources(workspaceId, selection) { state.logs.push("read_sources"); return workspaceId === WORKSPACE && selection.datasetVersionId === dataset.version.id ? realm({ dataset, evalSets: [set] }) : undefined; },
    async getHttpEvalPlanHead() { return null; },
    async listHttpEvalPlans() { return { plans: [], hasMore: false }; },
    async listProvidedOutputSources() { return { datasets: [], evalSets: [], datasetsHasMore: false, evalSetsHasMore: false }; },
    async getHttpEvalPlan() { return { planId: draft.planId, versions: [{ planId: draft.planId, versionId: draft.versionId, storageVersionId: plan.storage.versionId, version: 1, name: draft.name, fingerprint: plan.fingerprint, createdAt: CREATED }], hasMore: false }; },
    async getHttpEvalPlanVersion(workspaceId, publicPlanId, publicVersionId, parse) { return workspaceId === WORKSPACE && publicPlanId === draft.planId && publicVersionId === draft.versionId ? parse(plan) : undefined; },
    async saveHttpEvalPlanVersion(scope, request, cb) {
      assert.equal(state.calls.length, 0); state.logs.push("plan_save_committed");
      return { record: cb.prepare(realm({ workspaceId: scope.workspaceId, request, dataset, evalSets: [set], head: null, createdAt: CREATED })), replayed: false };
    },
    async reserveHttpEvalRun(scope, request, cb) {
      return atomic(() => {
        const existing = state.runs.get(request.runId);
        if (existing) { state.logs.push("reservation_replay"); return { record: cb.parse(existing), created: false }; }
        const ledger = cb.create(realm({ workspaceId: scope.workspaceId, request, plan, startedAt: timestamp(), leaseToken: id(++state.sequence) }));
        const record = cb.build(realm({ plan, ledger, events: [] })); state.runs.set(request.runId, record); state.logs.push("reservation_committed");
        return { record: state.invalidReservationReply ? realm({ ...record, fingerprint: "0".repeat(64) }) : record, created: true };
      });
    },
    async claimHttpEvalRunRow(workspaceId, runId, intent, cb) {
      return atomic(() => {
        const previous = stored(runId), result = cb.claim(realm({ plan, ledger: previous.ledger, ...intent, claimToken: id(++state.sequence), now: timestamp() }));
        state.runs.set(runId, cb.build(realm({ plan, ledger: result.ledger, events: previous.events })));
        state.logs.push(`claim_committed:${intent.rowId}`); return { claim: result.claim, request: result.request };
      });
    },
    async finalizeHttpEvalRunRow(workspaceId, runId, intent, cb) {
      return atomic(() => {
        if (state.failFinalize) throw error(503, "database_unavailable");
        const previous = stored(runId), result = cb.finalize(realm({ plan, ledger: previous.ledger, ...intent, completedAt: timestamp() }));
        const record = cb.build(realm({ plan, ledger: result.ledger, events: [...previous.events, result.event] }));
        state.runs.set(runId, record); state.logs.push(`outcome_committed:${intent.rowId}`); return { record, replayed: false };
      });
    },
    async stopHttpEvalRun(workspaceId, runId, intent, cb) {
      return atomic(() => {
        const previous = stored(runId), result = cb.stop(realm({ plan, ledger: previous.ledger, ...intent, now: timestamp() }));
        const record = cb.build(realm({ plan, ledger: result.ledger, events: [...previous.events, ...result.events] }));
        state.runs.set(runId, record); state.logs.push("stop_committed"); return record;
      });
    },
    async recoverHttpEvalRun(scope, runId, cb) {
      return atomic(() => {
        const previous = stored(runId), result = cb.recover(realm({ plan, ledger: previous.ledger, now: timestamp() }));
        const record = cb.build(realm({ plan, ledger: result.ledger, events: [...previous.events, ...result.events] }));
        state.runs.set(runId, record); state.logs.push("recovery_committed"); return record;
      });
    },
    async getHttpEvalRun(workspaceId, runId, cb) { state.logs.push("run_read"); return workspaceId === WORKSPACE && state.runs.has(runId) ? cb.parse(stored(runId)) : undefined; },
    async listHttpEvalRuns() { return { runs: [], hasMore: false }; }
  };
  for (const name of ["getCustomEvalSet", "listCustomEvalSets", "saveCustomEvalSet"]) db[name] = () => { throw new Error("unapproved legacy store invocation"); };
  makeSynthetic("@open-evals/db", db);
  makeSynthetic("apps/web/lib/auth.ts", { requireRouteAuth: async minimumRole => {
    state.logs.push("auth_checked"); const roles = ["viewer", "editor", "admin", "owner"];
    if (roles.indexOf(state.auth.role) < roles.indexOf(minimumRole)) throw error(403, "workspace_role_forbidden");
    return auth();
  } });
  class TransportError extends Error { constructor(code, outcome) { super(code); this.code = code; this.outcome = outcome; } }
  makeSynthetic("@open-evals/adapters", { HttpTargetTransportError: TransportError, invokePublicHttpTarget: async request => {
    assert.equal(state.transaction, false, "target must be outside a store transaction");
    const body = JSON.parse(request.body), row = [...state.runs.values()].flatMap(record => record.ledger.rows).find(row => row.rowId === body.rowId && row.claim?.requestFingerprint === request.requestFingerprint);
    assert.ok(row?.claim && row.status === "claimed", "target requires a committed exact row claim");
    assert.ok(state.logs.includes("reservation_committed")); assert.ok(state.logs.includes(`claim_committed:${body.rowId}`));
    state.calls.push({ ...request, parsedBody: body }); state.active++; state.maximumActive = Math.max(state.maximumActive, state.active);
    try { return state.native ? await state.native(request) : { bodyText: JSON.stringify({ schemaVersion: "http-json-target-response-v1", requestFingerprint: request.requestFingerprint, output: "APPROVED authored actual response" }), statusCode: 200, bytes: 1, elapsedMs: 1 }; }
    finally { state.active--; }
  } });
  // Alias synthetic auth without loading the real database/auth provider implementation.
  synthetic.set("@/lib/auth", synthetic.get("apps/web/lib/auth.ts"));
  const realLink = async (specifier, parent) => {
    if (specifier === "./auth") return synthetic.get("apps/web/lib/auth.ts");
    return link(specifier, parent);
  };
  const namespaces = {};
  for (const name of ["apps/web/lib/http-target-plans.ts", "apps/web/lib/http-target-runs.ts", ...sourceNames.filter(name => name.startsWith("apps/web/app/api/"))]) {
    const module = actual(name); if (module.status === "unlinked") await module.link(realLink); if (module.status === "linked") await module.evaluate(); namespaces[name] = module.namespace;
  }
  const request = (body, patch = {}) => new Request("http://owned.test/api", { method: "POST", headers: { "Content-Type": "application/json", ...patch.headers }, body: typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body), ...patch });
  const start = (number = 10) => realm({ schemaVersion: "http-eval-start-v1", runId: id(number), planVersionId: plan.storage.versionId, expectedPlanFingerprint: plan.fingerprint });
  return { state, core, realm, auth, plan, draft, saveRequest, dataset, set, TransportError, request, start,
    plans: namespaces["apps/web/lib/http-target-plans.ts"], runs: namespaces["apps/web/lib/http-target-runs.ts"],
    route: suffix => namespaces[`apps/web/app/api/v1/http-target-plans/${suffix ? suffix + "/" : ""}route.ts`],
    ordinaryPrototype: runInContext("Object.prototype", context),
    advance(milliseconds) { state.now += milliseconds; for (const [key, value] of [...state.timers]) if (value.at <= state.now) { state.timers.delete(key); value.callback(); } }
  };
}

test("HT-WEB01 streamed JSON retains more than 4.5 MiB of Unicode without content length or truncation [T2]", async () => {
  const h = await harness(), value = { text: "🧭".repeat(1_310_720), zero: 0, flag: false };
  const response = h.plans.httpTargetJson(value, 201);
  assert.equal(response.status, 201); assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("content-length"), null);
  const reader = response.body.getReader(), pieces = []; let bytes = 0;
  for (;;) { const item = await reader.read(); if (item.done) break; assert.ok(item.value.byteLength <= 65536); pieces.push(item.value); bytes += item.value.byteLength; }
  assert.ok(bytes > 4.5 * 1024 * 1024); assert.deepEqual(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(pieces))), value);
});
test("HT-WEB02 the complete serialized envelope is bounded and cancellation stops delivery [T2]", async () => {
  const h = await harness();
  assert.throws(() => h.plans.httpTargetJson({ text: "x".repeat(MAX) }), error => error.status === 500 && error.message === "http_eval_response_too_large");
  const response = h.plans.httpTargetJson({ text: "x".repeat(131072) }), reader = response.body.getReader();
  assert.equal((await reader.read()).value.byteLength, 65536); await reader.cancel(); assert.equal((await reader.read()).done, true);
});
test("HT-WEB03 raw request parsing rejects duplicate fields, numeric loss, BOM and malformed UTF-8 [T2]", async () => {
  const h = await harness();
  for (const body of ['{"limits":1,"limits":2}', '{"limits":0.10000000000000001}', '\ufeff{"valid":true}', new Uint8Array([0xc3, 0x28])])
    await assert.rejects(h.plans.readHttpTargetJson(h.request(body)), error => [400, 422].includes(error.status));
  assert.deepEqual(plain(await h.plans.readHttpTargetJson(h.request('{"zero":0,"flag":false,"nil":null}'))), { zero: 0, flag: false, nil: null });
});
test("HT-WEB04 streamed request size is enforced independently of declared length [T2]", async () => {
  const h = await harness(); let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
  await assert.rejects(h.plans.readHttpTargetJson(new Request("http://owned.test", { method: "POST", headers: { "content-type": "application/json", "content-length": "1" }, body, duplex: "half" })), error => error.status === 413);
  assert.equal(cancelled, true); assert.equal(h.state.calls.length, 0);
});
test("HT-WEB05 workspace API-key and hosted-local denial precede any POST body access [T2]", async () => {
  const h = await harness();
  const routes = [h.route(""), h.route("preview"), h.route("[planId]/versions/[versionId]/runs"), h.route("runs/[runId]/recover")];
  for (const kind of ["api_key", "local"]) for (const route of routes) {
    h.state.auth.authKind = kind; let reads = 0;
    const body = { get headers() { reads++; throw new Error("body inspected before auth"); } };
    const response = await route.POST(body, { params: Promise.resolve({ planId: id(3), versionId: id(4), runId: id(10) }) });
    assert.equal(response.status, 403); assert.equal(reads, 0);
  }
  assert.equal(h.state.calls.length, 0);
});
test("HT-WEB06 a viewer previews exact sources but cannot save, execute or recover [T2]", async () => {
  const h = await harness(); h.state.auth.role = "viewer";
  const preview = await h.route("preview").POST(h.request(h.draft)); assert.equal(preview.status, 200);
  assert.equal((await preview.json()).preview.fingerprint.length, 64);
  for (const suffix of ["", "[planId]/versions/[versionId]/runs", "runs/[runId]/recover"])
    assert.equal((await h.route(suffix).POST(h.request("{"), { params: Promise.resolve({ planId: id(3), versionId: id(4), runId: id(10) }) })).status, 403);
  assert.equal(h.state.calls.length, 0);
});
test("HT-WEB07 preview and immutable save invoke zero targets; client props are ordinary JSON with own metadata keys [T2]", async () => {
  const h = await harness(); const preview = await h.plans.previewHttpTargetPlan(WORKSPACE, h.draft);
  assert.equal(preview.content.samples.length, 2); assert.equal(h.state.calls.length, 0);
  const saved = await h.plans.saveHttpTargetPlan(h.auth(), h.saveRequest); assert.equal(saved.replayed, false); assert.equal(h.state.calls.length, 0);
  const loaded = await h.plans.loadHttpTargetPlan(h.draft.planId); assert.equal(loaded.status, "ready");
  const metadata = loaded.data.detail.record.content.dataset.rows[0].metadata;
  assert.equal(Object.getPrototypeOf(metadata), h.ordinaryPrototype); assert.equal(Object.hasOwn(metadata, "__proto__"), true);
  assert.deepEqual(plain(metadata), { ["__proto__"]: { authored: "retained" }, constructor: "own data", toJSON: "literal" });
  assert.equal(loaded.data.detail.record.fingerprint, h.plan.fingerprint);
});
test("HT-WEB08 an unsupported evaluator is refused by real core preview before any dispatch [T2]", async () => {
  const h = await harness(); h.set.contract.itemVersions[0].item.type = "llm_judge";
  await assert.rejects(h.plans.previewHttpTargetPlan(WORKSPACE, h.draft)); assert.equal(h.state.calls.length, 0);
});
test("HT-WEB09 creator execution commits reservation and unique row claims before native seam calls [T2]", async () => {
  const h = await harness(), request = h.start();
  const result = await h.runs.executeHttpTargetPlan(h.auth(), h.draft.planId, h.draft.versionId, request);
  assert.equal(result.replayed, false); assert.equal(result.record.ledger.status, "completed"); assert.equal(h.state.calls.length, 2);
  assert.equal(result.record.execution.results.length, 2); assert.equal(new Set(result.record.execution.gates.map(gate => gate.level)).size, 8);
  assert.ok(result.record.execution.gates.every(gate => gate.passed));
  for (const call of h.state.calls) {
    assert.deepEqual(Object.keys(call.parsedBody).sort(), ["input", "requestFingerprint", "rowId", "runId", "schemaVersion", ...(call.parsedBody.context === false ? ["context"] : [])].sort());
    assert.equal(JSON.stringify(call.parsedBody).includes("reference must not leave"), false);
    assert.equal(JSON.stringify(call.parsedBody).includes("APPROVED"), false);
  }
});
test("HT-WEB10 identical execution replay and exact GET never redispatch or mutate recovery [T2]", async () => {
  const h = await harness(), request = h.start();
  const first = await h.runs.executeHttpTargetPlan(h.auth(), h.draft.planId, h.draft.versionId, request);
  const replay = await h.runs.executeHttpTargetPlan(h.auth(), h.draft.planId, h.draft.versionId, request);
  assert.equal(replay.replayed, true); assert.deepEqual(plain(replay.record), plain(first.record));
  assert.deepEqual(plain(await h.runs.readHttpTargetRun(WORKSPACE, request.runId)), plain(first.record));
  assert.equal(h.state.calls.length, 2); assert.equal(h.state.logs.includes("recovery_committed"), false);
});
test("HT-WEB11 a path/start version mismatch is rejected before reservation or dispatch [T2]", async () => {
  const h = await harness(); await assert.rejects(h.runs.executeHttpTargetPlan(h.auth(), h.draft.planId, id(999), h.start()), error => error.status === 409);
  assert.equal(h.state.runs.size, 0); assert.equal(h.state.calls.length, 0);
});
test("HT-WEB12 invalid actual target JSON is recorded as failure and cannot pass gates [T2]", async () => {
  const h = await harness(); h.state.native = async () => ({ bodyText: '{"output":"invented incomplete protocol"}', statusCode: 200, bytes: 39, elapsedMs: 1 });
  const result = await h.runs.executeHttpTargetPlan(h.auth(), h.draft.planId, h.draft.versionId, h.start());
  assert.equal(result.record.ledger.status, "failed"); assert.ok(result.record.events.every(event => event.status === "failed" && event.rawResponseHash && event.response === null));
  assert.equal(result.record.execution.results.length, 0); assert.equal(result.record.execution.gates.find(gate => gate.level === "run").passed, false);
});
test("HT-WEB13 native not-sent and unknown outcomes remain distinct with no invented responses [T2]", async () => {
  const h = await harness(); let count = 0;
  h.state.native = async () => { throw new h.TransportError("http_target_aborted", count++ === 0 ? "not_sent" : "unknown"); };
  const result = await h.runs.executeHttpTargetPlan(h.auth(), h.draft.planId, h.draft.versionId, h.start());
  assert.deepEqual(result.record.events.map(event => event.status), ["not_sent", "outcome_unknown"]);
  assert.equal(result.record.ledger.status, "outcome_unknown"); assert.equal(result.record.execution.results.length, 0);
  assert.equal(result.record.execution.gates.find(gate => gate.level === "run").passed, false);
});
test("HT-WEB14 a deadline stops never-claimed rows and preserves an already-sent unknown outcome [T2]", async () => {
  const h = await harness(3);
  // Recreate the immutable plan after changing its authored concurrency.
  h.draft.limits.concurrency = 1;
  const preview = h.core.resolveHttpEvalPlanPreview(h.realm({ workspaceId: WORKSPACE, draft: h.draft, dataset: h.dataset, evalSets: [h.set], head: null }));
  const corrected = h.core.prepareHttpEvalPlanVersionRecord(h.realm({ workspaceId: WORKSPACE, request: { schemaVersion: "http-eval-plan-save-v1", draft: h.draft, expectedPreviewFingerprint: preview.fingerprint }, dataset: h.dataset, evalSets: [h.set], head: null, createdAt: CREATED }));
  Object.assign(h.plan, corrected);
  h.state.native = async () => { h.advance(5000); throw new h.TransportError("http_target_aborted", "unknown"); };
  const result = await h.runs.executeHttpTargetPlan(h.auth(), h.draft.planId, h.draft.versionId, h.start());
  assert.equal(h.state.calls.length, 1); assert.deepEqual(result.record.events.map(event => event.status), ["outcome_unknown", "not_sent", "not_sent"]);
  assert.equal(result.record.ledger.stopReason, "http_eval_deadline_exceeded"); assert.equal(result.record.execution.gates.find(gate => gate.level === "run").passed, false);
});
test("HT-WEB15 a finalize store failure cannot dispatch remaining rows or resend the committed claim [T2]", async () => {
  const h = await harness(4); h.state.failFinalize = true; const request = h.start();
  await assert.rejects(h.runs.executeHttpTargetPlan(h.auth(), h.draft.planId, h.draft.versionId, request), error => error.status === 500);
  const sent = h.state.calls.length; assert.ok(sent >= 1 && sent <= 2); assert.equal(h.state.runs.size, 1);
  h.state.failFinalize = false;
  const replay = await h.runs.executeHttpTargetPlan(h.auth(), h.draft.planId, h.draft.versionId, request);
  assert.equal(replay.replayed, true); assert.equal(h.state.calls.length, sent); assert.equal(replay.record.ledger.status, "running");
  h.advance(20000);
  const recovered = await h.runs.recoverHttpTargetRun(h.auth(), request.runId, h.realm({ schemaVersion: "http-eval-recover-v1" }));
  assert.ok(recovered.ledger.rows.every(row => ["outcome_unknown", "not_sent"].includes(row.status)));
  assert.equal(h.state.calls.length, sent); assert.equal(recovered.execution.gates.find(gate => gate.level === "run").passed, false);
});
test("HT-WEB16 recovery is explicit and too-early recovery cannot silently dispatch or finalize [T2]", async () => {
  const h = await harness(); h.state.failFinalize = true; const request = h.start();
  await assert.rejects(h.runs.executeHttpTargetPlan(h.auth(), h.draft.planId, h.draft.versionId, request));
  const before = plain(h.state.runs.get(request.runId)), calls = h.state.calls.length;
  await assert.rejects(h.runs.recoverHttpTargetRun(h.auth(), request.runId, h.realm({ schemaVersion: "http-eval-recover-v1" })), error => error.status === 409);
  assert.deepEqual(plain(h.state.runs.get(request.runId)), before); assert.equal(h.state.calls.length, calls);
});

function actualResponse(request) {
  const bodyText = JSON.stringify({ schemaVersion: "http-json-target-response-v1", requestFingerprint: request.requestFingerprint, output: "APPROVED authored actual response" });
  return { bodyText, statusCode: 200, bytes: Buffer.byteLength(bodyText), elapsedMs: 1 };
}
async function microtasksUntil(predicate) {
  for (let attempt = 0; attempt < 1000; attempt++) { if (predicate()) return; await Promise.resolve(); }
  assert.ok(predicate(), "the authored asynchronous barrier must be reached");
}
test("HT-WEB17 the bounded worker pool waits for outcomes before claiming another batch [T2]", { timeout: 10000 }, async () => {
  const h = await harness(4), waiting = []; let releaseImmediately = false;
  h.state.native = request => releaseImmediately ? actualResponse(request) : new Promise(resolve => waiting.push({ request, resolve }));
  const work = h.runs.executeHttpTargetPlan(h.auth(), h.draft.planId, h.draft.versionId, h.start());
  // Attach an early observer so an unexpected coordinator rejection is never unhandled.
  work.catch(() => undefined);
  try {
    await microtasksUntil(() => waiting.length === 2);
    assert.equal(h.state.calls.length, 2); assert.equal(h.state.maximumActive, 2);
    for (const item of waiting.splice(0)) item.resolve(actualResponse(item.request));
    await microtasksUntil(() => waiting.length === 2);
    assert.equal(h.state.calls.length, 4); assert.equal(h.state.maximumActive, 2);
    for (const item of waiting.splice(0)) item.resolve(actualResponse(item.request));
    const result = await work; assert.equal(result.record.ledger.status, "completed");
    assert.equal(new Set(h.state.calls.map(call => call.parsedBody.rowId)).size, 4);
  } finally {
    releaseImmediately = true; for (const item of waiting.splice(0)) item.resolve(actualResponse(item.request));
    await work.catch(() => undefined);
  }
});
test("HT-WEB18 a same-ID POST during live coordination returns recorded claims without a second coordinator [T2]", { timeout: 10000 }, async () => {
  const h = await harness(), request = h.start(), waiting = []; let releaseImmediately = false;
  h.state.native = call => releaseImmediately ? actualResponse(call) : new Promise(resolve => waiting.push({ request: call, resolve }));
  const work = h.runs.executeHttpTargetPlan(h.auth(), h.draft.planId, h.draft.versionId, request); work.catch(() => undefined);
  try {
    await microtasksUntil(() => waiting.length === 2);
    const replay = await h.runs.executeHttpTargetPlan(h.auth(), h.draft.planId, h.draft.versionId, request);
    assert.equal(replay.replayed, true); assert.equal(replay.record.ledger.status, "running");
    assert.ok(replay.record.ledger.rows.every(row => row.status === "claimed")); assert.equal(h.state.calls.length, 2);
    const read = await h.runs.readHttpTargetRun(WORKSPACE, request.runId); assert.deepEqual(plain(read), plain(replay.record));
    assert.equal(h.state.calls.length, 2); assert.equal(h.state.logs.includes("recovery_committed"), false);
    for (const item of waiting.splice(0)) item.resolve(actualResponse(item.request));
    assert.equal((await work).record.ledger.status, "completed"); assert.equal(h.state.calls.length, 2);
  } finally {
    releaseImmediately = true; for (const item of waiting.splice(0)) item.resolve(actualResponse(item.request));
    await work.catch(() => undefined);
  }
});
test("HT-WEB19 invalid post-reservation readback stays an unknown outcome and never gains a replay coordinator [T2]", async () => {
  const h = await harness(), request = h.start(); h.state.invalidReservationReply = true;
  await assert.rejects(h.runs.executeHttpTargetPlan(h.auth(), h.draft.planId, h.draft.versionId, request), error => error.status === 500);
  assert.equal(h.state.runs.size, 1); assert.equal(h.state.calls.length, 0);
  h.state.invalidReservationReply = false;
  const replay = await h.runs.executeHttpTargetPlan(h.auth(), h.draft.planId, h.draft.versionId, request);
  assert.equal(replay.replayed, true); assert.ok(replay.record.ledger.rows.every(row => row.status === "pending"));
  assert.equal(h.state.calls.length, 0); h.advance(20000);
  const recovered = await h.runs.recoverHttpTargetRun(h.auth(), request.runId, h.realm({ schemaVersion: "http-eval-recover-v1" }));
  assert.ok(recovered.ledger.rows.every(row => row.status === "not_sent")); assert.equal(h.state.calls.length, 0);
  assert.equal(recovered.execution.gates.find(gate => gate.level === "run").passed, false);
});
test("HT-WEB20 unexpected transport diagnostics become safe unknown events instead of escaping or being scored [T2]", async () => {
  const h = await harness(); h.state.native = async () => { throw new Error("authored private diagnostic must not escape"); };
  const result = await h.runs.executeHttpTargetPlan(h.auth(), h.draft.planId, h.draft.versionId, h.start());
  assert.equal(result.record.ledger.status, "outcome_unknown");
  assert.ok(result.record.events.every(event => event.errorCode === "http_target_transport_unknown" && event.response === null));
  assert.equal(JSON.stringify(result.record).includes("authored private diagnostic"), false);
  assert.equal(result.record.execution.gates.find(gate => gate.level === "run").passed, false);
});

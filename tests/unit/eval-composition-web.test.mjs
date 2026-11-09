// T2: actual composition/HTTP modules with authored auth, database, clock and transport seams. Authored UNRUN.
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
  "packages/core/src/provided-output-runs.ts", "packages/core/src/eval-composition.ts", "packages/core/src/http-eval-plans.ts", "packages/core/src/http-eval-runs.ts",
  "apps/web/lib/custom-eval-access.ts", "apps/web/lib/custom-evals.ts", "apps/web/lib/instruction-request.ts",
  "apps/web/lib/http-target-plans.ts", "apps/web/lib/http-target-runs.ts", "apps/web/lib/eval-composition.ts", "apps/web/lib/eval-composition-types.ts",
  "apps/web/app/api/v2/eval-items/route.ts", "apps/web/app/api/v2/eval-items/preview/route.ts",
  "apps/web/app/api/v2/eval-items/[itemId]/route.ts", "apps/web/app/api/v2/eval-items/[itemId]/versions/[versionId]/route.ts",
  "apps/web/app/api/v2/eval-sets/route.ts", "apps/web/app/api/v2/eval-sets/preview/route.ts",
  "apps/web/app/api/v2/eval-sets/[setId]/route.ts", "apps/web/app/api/v2/eval-sets/[setId]/versions/[versionId]/route.ts",
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
    sequence: 1000, runs: new Map(), timers: new Map(), failFinalize: false, invalidReservationReply: false, native: undefined,
    resourceRecords: new Map(), planRecords: new Map(), badReadback: null, badHead: false, brokenHeads: false, wrongVersion: false, badFamily: false, allowTargetSeam: false, saveRequests: [], scopes: [] };
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
    modules.get("packages/core/src/http-eval-plans.ts").namespace, modules.get("packages/core/src/http-eval-runs.ts").namespace,
    modules.get("packages/core/src/eval-composition.ts").namespace);
  makeSynthetic("@open-evals/core", core);
  const timestamp = () => new Date(state.now).toISOString();
  const resourceKey = (kind, workspaceId, publicId, versionId) => [kind, workspaceId, publicId, versionId].join("/");
  const resourceVersions = (kind, workspaceId, publicId) => [...state.resourceRecords.values()].filter(r => r.workspaceId === workspaceId && (kind === "item" ? r.draft.itemId : r.draft.setId) === publicId && r.schemaVersion === "custom-eval-" + kind + "-record-v2").sort((a, b) => b.draft.version - a.draft.version);
  const resourceHead = (kind, record) => kind === "item" ? core.customEvalItemHeadV2(record) : core.customEvalSetHeadV2(record);
  const storeResource = (kind, record) => { state.resourceRecords.set(resourceKey(kind, record.workspaceId, kind === "item" ? record.draft.itemId : record.draft.setId, record.draft.versionId), record); return record; };
  function makeItem(number, contains) {
    const d = realm({ schemaVersion: "custom-eval-item-draft-v2", itemId: id(number), versionId: id(number + 100), version: 1, expectedVersionId: null, name: "Authored item " + number, contains });
    const p = core.resolveCustomEvalItemPreviewV2(realm({ workspaceId: WORKSPACE, draft: d, head: null }));
    return storeResource("item", core.prepareCustomEvalItemVersionRecordV2(realm({ workspaceId: WORKSPACE, request: { schemaVersion: "custom-eval-item-save-v2", draft: d, expectedPreviewFingerprint: p.fingerprint }, head: null, createdAt: CREATED })));
  }
  const itemRecords = [makeItem(101, "red"), makeItem(102, "blue"), makeItem(103, "green")];
  const itemRef = r => ({ itemId: r.draft.itemId, versionId: r.draft.versionId, fingerprint: r.contract.fingerprint });
  function makeSet(number, items) {
    const d = realm({ schemaVersion: "custom-eval-set-draft-v2", setId: id(number), versionId: id(number + 100), version: 1, expectedVersionId: null, name: "Authored set " + number, members: items.map(itemRef), datasetPassRateThreshold: 100 });
    const p = core.resolveCustomEvalSetPreviewV2(realm({ workspaceId: WORKSPACE, draft: d, head: null, items }));
    return storeResource("set", core.prepareCustomEvalSetVersionRecordV2(realm({ workspaceId: WORKSPACE, request: { schemaVersion: "custom-eval-set-save-v2", draft: d, expectedPreviewFingerprint: p.fingerprint }, head: null, items, createdAt: CREATED })));
  }
  const setRecords = [makeSet(201, itemRecords.slice(0, 2)), makeSet(202, itemRecords.slice(1))];
  const asSource = record => realm({ ref: { schemaVersion: "custom-eval-set-ref-v2", setId: record.draft.setId, versionId: record.draft.versionId, fingerprint: record.contract.fingerprint }, contract: record.contract, members: record.members, sourceRecordFingerprint: record.fingerprint });
  const compositionSources = setRecords.map(asSource);
  const evaluator = core.prepareCustomEvalSet(realm({ schemaVersion: "custom-eval-set-draft-v1", setId: id(1), versionId: id(2), version: 1, expectedVersionId: null, name: "Authored legacy evaluator", contains: "red", datasetPassRateThreshold: 50 }));
  const contract = evaluator.contract;
  const set = realm({ contract, members: contract.itemVersions.map((member, position) => ({ evalSetVersionId: contract.id, evalItemVersionId: member.item.id, position, weight: member.weight, criticality: member.criticality, itemFingerprint: member.item.fingerprint })) });
  const legacySource = realm({ ref: { schemaVersion: "custom-eval-set-ref-v1", setId: contract.setId, versionId: contract.id, fingerprint: contract.fingerprint }, ...set, sourceRecordFingerprint: null });
  const metadata = JSON.parse('{"__proto__":{"authored":"retained"},"constructor":"own data","toJSON":"literal"}');
  const dataset = realm({ dataset: { id: "authored-dataset", name: "Authored input rows", kind: "user" }, version: { id: "authored-dataset-version", datasetId: "authored-dataset", version: 1, fingerprint: "authored-source", createdAt: CREATED },
    rows: Array.from({ length: rowCount }, (_, index) => ({ id: "authored-row-" + index, rowKey: "Row " + index, input: { prompt: "Authored " + index }, expectedOutput: { present: true, value: "reference must not leave" }, context: { present: index === 0, value: index === 0 ? false : null }, history: { present: false, value: null }, traceFixture: { present: false, value: null }, metadata, reviewStatus: "reviewed" })) });
  const draft = realm({ schemaVersion: "http-eval-plan-draft-v2", planId: id(3), versionId: id(4), version: 1, expectedVersionId: null, name: "Authored composed HTTP plan", datasetVersionId: dataset.version.id, evalSetVersions: compositionSources.map(s => s.ref),
    target: { targetId: "authored-target", targetVersion: "v1", endpoint: "https://target.example.com/evaluate", timeoutMs: 1000 }, limits: { concurrency: 2, maxDurationSeconds: 5 } });
  const preview = core.resolveHttpEvalPlanPreview(realm({ workspaceId: WORKSPACE, draft, dataset, evalSets: compositionSources, head: null }));
  const saveRequest = realm({ schemaVersion: "http-eval-plan-save-v2", draft, expectedPreviewFingerprint: preview.fingerprint });
  const plan = core.prepareHttpEvalPlanVersionRecord(realm({ workspaceId: WORKSPACE, request: saveRequest, dataset, evalSets: compositionSources, head: null, createdAt: CREATED }));
  const { evalSetVersions, ...oldBase } = plain(draft), legacyDraft = realm({ ...oldBase, schemaVersion: "http-eval-plan-draft-v1", planId: id(30), versionId: id(31), evalSetVersionIds: [contract.id] });
  const oldPreview = core.resolveHttpEvalPlanPreview(realm({ workspaceId: WORKSPACE, draft: legacyDraft, dataset, evalSets: [set], head: null }));
  const legacyPlan = core.prepareHttpEvalPlanVersionRecord(realm({ workspaceId: WORKSPACE, request: { schemaVersion: "http-eval-plan-save-v1", draft: legacyDraft, expectedPreviewFingerprint: oldPreview.fingerprint }, dataset, evalSets: [set], head: null, createdAt: CREATED }));
  for (const r of [plan, legacyPlan]) state.planRecords.set(r.content.draft.planId + "/" + r.content.draft.versionId, r);
  const plansFor = (workspaceId, publicPlanId) => [...state.planRecords.values()].filter(r => r.workspaceId === workspaceId && r.content.draft.planId === publicPlanId).sort((a, b) => b.content.draft.version - a.content.draft.version);
  const planSummary = r => ({ planId: r.content.draft.planId, versionId: r.content.draft.versionId, storageVersionId: r.storage.versionId, version: r.content.draft.version, name: r.content.draft.name, fingerprint: r.fingerprint, createdAt: r.createdAt, family: state.badFamily && r === plan ? "http-target-eval-v1" : r.content.schemaVersion });
  const auth = () => realm({ ...state.auth, workspaceId: state.auth.workspaceId ?? WORKSPACE, user: { id: ACTOR } });
  // Each fake transaction is synchronous through commit. This tests the coordinator seam,
  // not PostgreSQL locking, rollback, SQL parity or membership enforcement.
  const atomic = callback => {
    assert.equal(state.transaction, false); state.transaction = true;
    try { return callback(); } finally { state.transaction = false; }
  };
  const stored = runId => { const value = state.runs.get(runId); if (!value) throw error(404, "http_eval_not_found"); return value; };
  function checkScope(scope) { state.scopes.push(plain(scope)); assert.equal(scope.actorId, ACTOR); }
  function resourceRecord(kind, workspaceId, publicId, versionId) {
    state.logs.push("exact_" + kind + ":" + publicId + "/" + versionId);
    if (state.wrongVersion) return itemRecords[0];
    return state.resourceRecords.get(resourceKey(kind, workspaceId, publicId, versionId));
  }
  function headFor(kind, workspaceId, publicId) {
    state.logs.push("head_" + kind); if (state.brokenHeads) throw error(500, "authored_private_broken_head");
    const r = resourceVersions(kind, workspaceId, publicId)[0]; return r ? resourceHead(kind, r) : null;
  }
  function detailFor(kind, workspaceId, publicId) {
    const versions = resourceVersions(kind, workspaceId, publicId); if (!versions.length) return undefined;
    const h = plain(resourceHead(kind, versions[0])); if (state.badHead) h.recordFingerprint = "0".repeat(64);
    return realm({ schemaVersion: "custom-eval-" + kind + "-detail-v2", [kind + "Id"]: publicId, head: h,
      versions: versions.slice(0, 20).map(r => ({ ...resourceHead(kind, r), createdAt: r.createdAt, ...(kind === "set" ? { memberCount: r.members.length } : {}) })), hasMore: versions.length > 20 });
  }
  function resourceList(kind, workspaceId) {
    const heads = new Map();
    for (const r of state.resourceRecords.values()) if (r.workspaceId === workspaceId && r.schemaVersion === "custom-eval-" + kind + "-record-v2") {
      const id = kind === "item" ? r.draft.itemId : r.draft.setId, prior = heads.get(id); if (!prior || prior.draft.version < r.draft.version) heads.set(id, r);
    }
    return realm([...heads.values()].map(r => ({ [kind + "Id"]: kind === "item" ? r.draft.itemId : r.draft.setId, name: r.draft.name, versionCount: resourceVersions(kind, workspaceId, kind === "item" ? r.draft.itemId : r.draft.setId).length,
      head: resourceHead(kind, r), ...(kind === "set" ? { memberCount: r.members.length } : {}) })));
  }
  function selectedItems(workspaceId, refs) {
    const values = refs.map(ref => state.resourceRecords.get(resourceKey("item", workspaceId, ref.itemId, ref.versionId)));
    if (values.some(v => !v)) return undefined;
    if (values.some((v, i) => v.contract.fingerprint !== refs[i].fingerprint)) throw error(409, "eval_composition_source_conflict");
    return realm(values);
  }
  function saveResource(kind, scope, request, cb) {
    return atomic(() => {
      checkScope(scope); state.saveRequests.push(plain(request)); state.logs.push("save_" + kind);
      const publicId = kind === "item" ? request.draft.itemId : request.draft.setId, key = resourceKey(kind, scope.workspaceId, publicId, request.draft.versionId), previous = state.resourceRecords.get(key);
      if (previous) {
        const expected = kind === "item" ? core.customEvalItemRequestFingerprintV2(scope.workspaceId, request) : core.customEvalSetRequestFingerprintV2(scope.workspaceId, request);
        if (previous.requestFingerprint !== expected) throw error(409, "eval_composition_identity_conflict");
        state.logs.push("resource_replay"); return { record: previous, replayed: true };
      }
      const head = headFor(kind, scope.workspaceId, publicId), items = kind === "set" ? selectedItems(scope.workspaceId, request.draft.members) : [];
      if (!items) throw error(404, "eval_composition_source_not_found");
      const record = cb.prepare(realm({ workspaceId: scope.workspaceId, request, head, createdAt: timestamp(), items }));
      storeResource(kind, record); state.logs.push("resource_commit");
      return { record: state.badReadback === kind ? realm({ ...record, fingerprint: "0".repeat(64) }) : record, replayed: false };
    });
  }
  const db = {
    isDatabaseUnavailable: value => value?.status === 503,
    async listCustomEvalItemsV2(workspaceId) { state.logs.push("list_item"); return resourceList("item", workspaceId); },
    async listCustomEvalSetsV2(workspaceId) { state.logs.push("list_set"); return resourceList("set", workspaceId); },
    async getCustomEvalItemHeadV2(workspaceId, publicId) { return headFor("item", workspaceId, publicId); },
    async getCustomEvalSetHeadV2(workspaceId, publicId) { return headFor("set", workspaceId, publicId); },
    async getCustomEvalItemVersionV2(workspaceId, publicId, versionId) { return resourceRecord("item", workspaceId, publicId, versionId); },
    async getCustomEvalSetVersionV2(workspaceId, publicId, versionId) { return resourceRecord("set", workspaceId, publicId, versionId); },
    async getCustomEvalItemV2(workspaceId, publicId) { return detailFor("item", workspaceId, publicId); },
    async getCustomEvalSetV2(workspaceId, publicId) { return detailFor("set", workspaceId, publicId); },
    async getCustomEvalSetItemsV2(workspaceId, refs) { state.logs.push("source_items"); return selectedItems(workspaceId, refs); },
    async saveCustomEvalItemVersionV2(scope, request, cb) { return saveResource("item", scope, request, cb); },
    async saveCustomEvalSetVersionV2(scope, request, cb) { return saveResource("set", scope, request, cb); },
    async getHttpEvalPlanSources(workspaceId, selection) {
      state.logs.push("read_sources");
      if (workspaceId !== WORKSPACE || selection.datasetVersionId !== dataset.version.id) return undefined;
      if (selection.schemaVersion === "http-eval-plan-draft-v1") return realm({ dataset, evalSets: [set] });
      const refs = selection.evalSetVersions;
      const values = refs.map(ref => ref.schemaVersion === "custom-eval-set-ref-v1" ? (ref.setId === contract.setId && ref.versionId === contract.id ? legacySource : undefined)
        : (() => { const r = state.resourceRecords.get(resourceKey("set", workspaceId, ref.setId, ref.versionId)); return r ? asSource(r) : undefined; })());
      if (values.some(v => !v)) return undefined; return realm({ dataset, evalSets: values });
    },
    async getHttpEvalPlanHead(workspaceId, publicId) { const r = plansFor(workspaceId, publicId)[0]; return r ? core.httpEvalPlanHeadFromRecord(r) : null; },
    async listHttpEvalPlans(workspaceId) { return realm({ plans: [...state.planRecords.values()].filter(r => r.workspaceId === workspaceId).map(planSummary), hasMore: false }); },
    async listHttpEvalSources(workspaceId) { return realm({ datasets: workspaceId === WORKSPACE ? [{ versionId: dataset.version.id, name: dataset.dataset.name }] : [], datasetsHasMore: false,
      evalSets: workspaceId === WORKSPACE ? [legacySource, ...compositionSources].map(s => ({ ref: s.ref, name: s.contract.name, version: 1 })) : [], evalSetsHasMore: false }); },
    async getHttpEvalPlan(workspaceId, publicId) { const records = plansFor(workspaceId, publicId); return records.length ? realm({ planId: publicId, versions: records.map(planSummary), hasMore: false }) : undefined; },
    async getHttpEvalPlanVersion(workspaceId, publicId, versionId, parse) { const r = state.planRecords.get(publicId + "/" + versionId); return r && r.workspaceId === workspaceId ? parse(r) : undefined; },
    async saveHttpEvalPlanVersion(scope, request, cb) {
      return atomic(() => {
        checkScope(scope); state.logs.push("plan_save"); state.saveRequests.push(plain(request));
        const key = request.draft.planId + "/" + request.draft.versionId, existing = state.planRecords.get(key);
        if (existing) { if (existing.requestFingerprint !== core.httpEvalPlanRequestFingerprint(scope.workspaceId, request)) throw error(409, "http_eval_plan_conflict"); return { record: existing, replayed: true }; }
        const prior = plansFor(scope.workspaceId, request.draft.planId)[0], head = prior ? core.httpEvalPlanHeadFromRecord(prior) : null;
        const selected = request.draft.schemaVersion === "http-eval-plan-draft-v1" ? [set] : request.draft.evalSetVersions.map(ref => {
          if (ref.schemaVersion === "custom-eval-set-ref-v1") return legacySource;
          const r = state.resourceRecords.get(resourceKey("set", scope.workspaceId, ref.setId, ref.versionId)); if (!r) throw error(404, "http_eval_sources_not_found"); return asSource(r);
        });
        const record = cb.prepare(realm({ workspaceId: scope.workspaceId, request, dataset, evalSets: selected, head, createdAt: timestamp() }));
        state.planRecords.set(key, record); state.logs.push("plan_commit"); return { record, replayed: false };
      });
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
        const previous = stored(runId); if (previous.ledger.status !== "running") return previous;
        const result = cb.recover(realm({ plan, ledger: previous.ledger, now: timestamp() }));
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
    state.logs.push("auth_checked"); if (state.auth.failure) throw error(state.auth.failure, "authored_auth_denied"); const roles = ["viewer", "editor", "admin", "owner"];
    if (roles.indexOf(state.auth.role) < roles.indexOf(minimumRole)) throw error(403, "workspace_role_forbidden");
    return auth();
  } });
  class TransportError extends Error { constructor(code, outcome) { super(code); this.code = code; this.outcome = outcome; } }
  makeSynthetic("@open-evals/adapters", { HttpTargetTransportError: TransportError, invokePublicHttpTarget: async request => {
    assert.equal(state.allowTargetSeam, true, "only the explicitly authored execution case may call the transport seam");
    assert.equal(state.transaction, false, "target must be outside a store transaction");
    const body = JSON.parse(request.body), row = [...state.runs.values()].flatMap(record => record.ledger.rows).find(row => row.rowId === body.rowId && row.claim?.requestFingerprint === request.requestFingerprint);
    assert.ok(row?.claim && row.status === "claimed", "target requires a committed exact row claim");
    assert.ok(state.logs.includes("reservation_committed")); assert.ok(state.logs.includes(`claim_committed:${body.rowId}`));
    state.calls.push({ ...request, parsedBody: body }); state.active++; state.maximumActive = Math.max(state.maximumActive, state.active);
    try { return state.native ? await state.native(request) : { bodyText: JSON.stringify({ schemaVersion: "http-json-target-response-v1", requestFingerprint: request.requestFingerprint, output: "red blue green authored response" }), statusCode: 200, bytes: 1, elapsedMs: 1 }; }
    finally { state.active--; }
  } });
  // Alias synthetic auth without loading the real database/auth provider implementation.
  synthetic.set("@/lib/auth", synthetic.get("apps/web/lib/auth.ts"));
  const realLink = async (specifier, parent) => {
    if (specifier === "./auth") return synthetic.get("apps/web/lib/auth.ts");
    return link(specifier, parent);
  };
  const namespaces = {};
  for (const name of ["apps/web/lib/http-target-plans.ts", "apps/web/lib/http-target-runs.ts", "apps/web/lib/eval-composition.ts", "apps/web/lib/eval-composition-types.ts", ...sourceNames.filter(name => name.startsWith("apps/web/app/api/"))]) {
    const module = actual(name); if (module.status === "unlinked") await module.link(realLink); if (module.status === "linked") await module.evaluate(); namespaces[name] = module.namespace;
  }
  const request = (body, patch = {}) => new Request("http://owned.test/api", { method: "POST", headers: { "Content-Type": "application/json", ...patch.headers }, body: typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body), ...patch });
  const start = (number = 10) => realm({ schemaVersion: "http-eval-start-v2", runId: id(number), planVersionId: plan.storage.versionId, expectedPlanFingerprint: plan.fingerprint });
  return { state, core, realm, auth, plan, draft, saveRequest, dataset, set, itemRecords, setRecords, compositionSources, legacySource, legacyPlan, itemRef, resourceVersions, TransportError, request, start,
    plans: namespaces["apps/web/lib/http-target-plans.ts"], runs: namespaces["apps/web/lib/http-target-runs.ts"], composition: namespaces["apps/web/lib/eval-composition.ts"],
    compositionRoute: (kind, suffix = "") => namespaces["apps/web/app/api/v2/eval-" + (kind === "item" ? "items" : "sets") + "/" + (suffix ? suffix + "/" : "") + "route.ts"],
    route: suffix => namespaces[`apps/web/app/api/v1/http-target-plans/${suffix ? suffix + "/" : ""}route.ts`],
    ordinaryPrototype: runInContext("Object.prototype", context),
    advance(milliseconds) { state.now += milliseconds; for (const [key, value] of [...state.timers]) if (value.at <= state.now) { state.timers.delete(key); value.callback(); } }
  };
}


const resourceDraft = (h, kind, patch = {}) => kind === "item"
  ? { schemaVersion: "custom-eval-item-draft-v2", itemId: id(6000), versionId: id(6001), version: 1, expectedVersionId: null, name: "New café item", contains: "  authored needle 😀\n ", ...patch }
  : { schemaVersion: "custom-eval-set-draft-v2", setId: id(6100), versionId: id(6101), version: 1, expectedVersionId: null, name: "New composed set", members: h.itemRecords.slice(0, 2).map(h.itemRef), datasetPassRateThreshold: 100, ...patch };
const publicId = (kind, draft) => kind === "item" ? draft.itemId : draft.setId;
const contextFor = (kind, publicId, versionId) => ({ params: Promise.resolve({ [kind === "item" ? "itemId" : "setId"]: publicId, ...(versionId ? { versionId } : {}) }) });
async function prepareResource(h, kind, draft = resourceDraft(h, kind)) {
  const response = await h.compositionRoute(kind, "preview").POST(h.request(draft)); assert.equal(response.status, 200);
  const value = await response.json(); assert.equal(value.preview.draft.schemaVersion, "custom-eval-" + kind + "-draft-v2");
  return { preview: value.preview, request: { schemaVersion: "custom-eval-" + kind + "-save-v2", draft: value.preview.draft, expectedPreviewFingerprint: value.preview.fingerprint } };
}
async function saveResource(h, kind, request, expected = 201) {
  const response = await h.compositionRoute(kind).POST(h.request(request)); assert.equal(response.status, expected);
  assert.equal(response.headers.get("cache-control"), "no-store"); return { response, value: await response.json() };
}
async function createdResource(h, kind, patch = {}) {
  const prepared = await prepareResource(h, kind, resourceDraft(h, kind, patch)), saved = await saveResource(h, kind, prepared.request);
  return { ...prepared, ...saved.value };
}
const resourceCount = h => h.state.resourceRecords.size;
const postRoutes = h => ["item", "set"].flatMap(kind => [h.compositionRoute(kind), h.compositionRoute(kind, "preview")]);

test("CP-WEB01 every new handler denies project keys before body or scoped store access [T2]", async () => {
  const h = await harness(); h.state.auth.authKind = "api_key"; let bodyReads = 0;
  const body = { get headers() { bodyReads++; throw new Error("body_before_auth"); } };
  for (const kind of ["item", "set"]) {
    for (const suffix of ["", "preview"]) assert.equal((await h.compositionRoute(kind, suffix).POST(body)).status, 403);
    for (const suffix of ["", kind === "item" ? "[itemId]" : "[setId]", kind === "item" ? "[itemId]/versions/[versionId]" : "[setId]/versions/[versionId]"]) {
      const route = h.compositionRoute(kind, suffix); assert.equal((await route.GET(undefined, contextFor(kind, id(101), id(201)))).status, 403);
    }
  }
  assert.equal(bodyReads, 0); assert.equal(h.state.logs.some(value => value.startsWith("head_") || value.startsWith("list_") || value.startsWith("exact_")), false); assert.equal(h.state.calls.length, 0);
});
test("CP-WEB02 hosted-local ownership is refused before both new preview and save bodies [T2]", async () => {
  const h = await harness(); h.state.auth.authKind = "local"; let reads = 0;
  for (const route of postRoutes(h)) assert.equal((await route.POST({ get headers() { reads++; throw new Error("body_before_auth"); } })).status, 403);
  assert.equal(reads, 0); assert.equal(h.state.saveRequests.length, 0);
});
test("CP-WEB03 viewers can inspect and preview both resources but cannot save or dispatch [T2]", async () => {
  const h = await harness(); h.state.auth.role = "viewer"; const before = resourceCount(h);
  for (const kind of ["item", "set"]) {
    const p = await prepareResource(h, kind); assert.equal(p.preview.workspaceId, WORKSPACE);
    assert.equal((await h.compositionRoute(kind).GET()).status, 200);
    assert.equal((await h.compositionRoute(kind).POST(h.request("{"))).status, 403);
  }
  assert.equal(resourceCount(h), before); assert.equal(h.state.calls.length, 0); assert.equal(h.state.saveRequests.length, 0);
});
test("CP-WEB04 editor session writes complete item and set records with private exact-version readback [T2]", async () => {
  const h = await harness(); h.state.auth.role = "editor";
  for (const kind of ["item", "set"]) {
    const saved = await createdResource(h, kind), d = saved.record.draft, suffix = kind === "item" ? "[itemId]/versions/[versionId]" : "[setId]/versions/[versionId]";
    const response = await h.compositionRoute(kind, suffix).GET(undefined, contextFor(kind, publicId(kind, d), d.versionId));
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store"); assert.deepEqual((await response.json()).record, saved.record);
    assert.equal(saved.replayed, false); assert.equal(saved.record.schemaVersion, "custom-eval-" + kind + "-record-v2");
  }
  assert.ok(h.state.scopes.every(scope => scope.workspaceId === WORKSPACE && scope.actorId === ACTOR)); assert.equal(h.state.calls.length, 0);
});
test("CP-WEB05 preview freezes exact refs and complete full proofs without any save operation [T2]", async () => {
  const h = await harness(), before = resourceCount(h), p = await prepareResource(h, "set");
  assert.deepEqual(p.preview.draft.members, h.itemRecords.slice(0, 2).map(r => plain(h.itemRef(r))));
  assert.deepEqual(p.preview.members, p.preview.contract.memberProofs); assert.deepEqual(p.preview.members.map(m => m.position), [0, 1]);
  assert.ok(p.preview.members.every(m => m.publicItemId && m.publicItemVersionId && m.itemRecordFingerprint)); assert.equal(Object.hasOwn(p.preview, "createdAt"), false);
  assert.equal(resourceCount(h), before); assert.equal(h.state.logs.includes("save_set"), false); assert.equal(h.state.calls.length, 0);
});
test("CP-WEB06 missing sessions and missing eval scopes fail before streamed body admission [T2]", async () => {
  const h = await harness(); let reads = 0; const body = { get headers() { reads++; throw new Error("body_before_auth"); } };
  h.state.auth.failure = 401; for (const route of postRoutes(h)) assert.equal((await route.POST(body)).status, 401);
  h.state.auth.failure = undefined; h.state.auth.scopes = [];
  for (const route of postRoutes(h)) assert.equal((await route.POST(body)).status, 403);
  assert.equal(reads, 0); assert.equal(h.state.saveRequests.length, 0);
  h.state.auth.failure = 401; assert.equal((await h.composition.loadComposition()).status, "auth_required");
});
test("CP-WEB07 exact resource paths and optional prefills remain bound to the authorized workspace [T2]", async () => {
  const h = await harness(), source = h.itemRecords[0]; h.state.auth.workspaceId = "authored-foreign-workspace";
  const response = await h.compositionRoute("item", "[itemId]/versions/[versionId]").GET(undefined, contextFor("item", source.draft.itemId, source.draft.versionId)); assert.equal(response.status, 404);
  const loaded = await h.composition.loadComposition({ itemId: source.draft.itemId, itemVersionId: source.draft.versionId });
  assert.equal(loaded.status, "ready"); assert.equal(loaded.data.workspaceId, "authored-foreign-workspace"); assert.equal(loaded.data.initialMember, undefined); assert.equal(loaded.data.requestedSourceUnavailable, true);
  assert.deepEqual(plain(loaded.data.items), []); assert.equal(h.state.saveRequests.length, 0);
});
test("CP-WEB08 item Unicode and contains whitespace survive preview save and exact read without hidden normalization [T2]", async () => {
  const h = await harness(), saved = await createdResource(h, "item", { name: "  café 😀  ", contains: "  needle 😀\n  " });
  assert.equal(saved.record.draft.name, "café 😀"); assert.equal(saved.record.contract.config.contains, "  needle 😀\n  "); assert.equal(saved.record.previewFingerprint, saved.preview.fingerprint);
  const malformed = resourceDraft(h, "item", { itemId: id(6200), versionId: id(6201), contains: "\u0000" }); const response = await h.compositionRoute("item", "preview").POST(h.request(malformed)); assert.equal(response.status, 422);
  assert.equal(h.state.logs.filter(v => v === "resource_commit").length, 1);
});
test("CP-WEB09 duplicate raw fields lossy decimal tokens BOM and malformed UTF8 fail before source lookup [T2]", async () => {
  for (const kind of ["item", "set"]) {
    const h = await harness(), raw = JSON.stringify(resourceDraft(h, kind, { name: "Authored raw request" }));
    const duplicate = raw.replace('"version":1,', '"\\u0076ersion":2,"version":1,'), precision = raw.replace('"version":1,', '"version":1.00000000000000001,');
    assert.notEqual(duplicate, raw); assert.notEqual(precision, raw);
    const nameStart = raw.indexOf('"name":"') + '"name":"'.length;
    assert.ok(nameStart >= '"name":"'.length);
    const invalidUtf8 = Buffer.concat([Buffer.from(raw.slice(0, nameStart)), Buffer.from([0xc3, 0x28]), Buffer.from(raw.slice(nameStart))]);
    // Every permissively decoded counterpart is a complete valid draft: later
    // shape validation must not be able to satisfy a raw-reader rejection oracle.
    const mutations = [
      { body: duplicate, control: JSON.stringify(JSON.parse(duplicate)), status: 422, code: "http_eval_json_duplicate_key" },
      { body: precision, control: JSON.stringify(JSON.parse(precision)), status: 422, code: "http_eval_json_precision" },
      { body: "\ufeff" + raw, control: raw, status: 422, code: "http_eval_json_invalid" },
      { body: invalidUtf8, control: JSON.stringify(JSON.parse(new TextDecoder("utf-8").decode(invalidUtf8))), status: 400, code: "http_eval_utf8_invalid" }
    ];
    for (const mutation of mutations) {
      const positive = await h.compositionRoute(kind, "preview").POST(h.request(mutation.control)); assert.equal(positive.status, 200);
      assert.equal((await positive.json()).preview.draft.schemaVersion, "custom-eval-" + kind + "-draft-v2");
      const before = { log: h.state.logs.length, writes: h.state.saveRequests.length, records: resourceCount(h) };
      const response = await h.compositionRoute(kind, "preview").POST(h.request(mutation.body)); assert.equal(response.status, mutation.status); assert.deepEqual(await response.json(), { error: mutation.code });
      assert.equal(h.state.logs.slice(before.log).some(v => v.startsWith("head_") || v === "source_items"), false);
      assert.equal(h.state.saveRequests.length, before.writes); assert.equal(resourceCount(h), before.records);
    }
    assert.equal(h.state.calls.length, 0);
  }
});
test("CP-WEB10 both resource preview handlers enforce the streamed2MiB cap and cancel a misleading body [T2]", async () => {
  for (const kind of ["item", "set"]) {
    const h = await harness(); let cancelled = false;
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
    const request = new Request("http://owned.test/api", { method: "POST", headers: { "content-type": "application/json", "content-length": "1" }, body, duplex: "half" });
    assert.equal((await h.compositionRoute(kind, "preview").POST(request)).status, 413); assert.equal(cancelled, true); assert.equal(h.state.saveRequests.length, 0);
  }
});
test("CP-WEB11 an item stale-head conflict preserves the submitted draft and does not commit a third version [T2]", async () => {
  const h = await harness(), first = await createdResource(h, "item"), patch = { itemId: first.record.draft.itemId, version: 2, expectedVersionId: first.record.draft.versionId };
  const left = await prepareResource(h, "item", resourceDraft(h, "item", { ...patch, versionId: id(6301), name: "Left" })), right = await prepareResource(h, "item", resourceDraft(h, "item", { ...patch, versionId: id(6302), name: "Right" }));
  await saveResource(h, "item", left.request); const before = JSON.stringify(right.request), result = await h.compositionRoute("item").POST(h.request(right.request));
  assert.equal(result.status, 409); assert.equal(JSON.stringify(right.request), before); assert.equal(h.resourceVersions("item", WORKSPACE, first.record.draft.itemId).length, 2);
  assert.equal((await result.json()).error, "eval_composition_stale");
});
test("CP-WEB12 a set stale-head conflict preserves explicit item version order and rejects a competing revision [T2]", async () => {
  const h = await harness(), first = await createdResource(h, "set"), patch = { setId: first.record.draft.setId, version: 2, expectedVersionId: first.record.draft.versionId };
  const left = await prepareResource(h, "set", resourceDraft(h, "set", { ...patch, versionId: id(6401) })), right = await prepareResource(h, "set", resourceDraft(h, "set", { ...patch, versionId: id(6402), members: [...resourceDraft(h, "set").members].reverse() }));
  await saveResource(h, "set", left.request); const before = JSON.stringify(right.request);
  assert.equal((await h.compositionRoute("set").POST(h.request(right.request))).status, 409); assert.equal(JSON.stringify(right.request), before); assert.equal(h.resourceVersions("set", WORKSPACE, first.record.draft.setId).length, 2);
});
test("CP-WEB13 committed invalid item readback remains500 unknown and identical retry returns the exact original record [T2]", async () => {
  const h = await harness(), prepared = await prepareResource(h, "item"), before = resourceCount(h); h.state.badReadback = "item";
  const failed = await h.compositionRoute("item").POST(h.request(prepared.request)); assert.equal(failed.status, 500); assert.equal(resourceCount(h), before + 1);
  h.state.badReadback = null; const recovered = await saveResource(h, "item", prepared.request, 200);
  assert.equal(recovered.value.replayed, true); assert.equal(recovered.value.record.previewFingerprint, prepared.preview.fingerprint); assert.equal(resourceCount(h), before + 1);
  assert.deepEqual(h.state.saveRequests, [prepared.request, prepared.request]);
});
test("CP-WEB14 committed invalid set readback remains500 unknown with full proof-preserving same-intent replay [T2]", async () => {
  const h = await harness(), prepared = await prepareResource(h, "set"), before = resourceCount(h); h.state.badReadback = "set";
  assert.equal((await h.compositionRoute("set").POST(h.request(prepared.request))).status, 500); h.state.badReadback = null;
  const recovered = await saveResource(h, "set", prepared.request, 200); assert.equal(recovered.value.replayed, true); assert.equal(resourceCount(h), before + 1);
  assert.deepEqual(recovered.value.record.members, prepared.preview.members); assert.deepEqual(h.state.saveRequests, [prepared.request, prepared.request]);
});
test("CP-WEB15 original item save replay reaches no newer head lookup after later versions exist [T2]", async () => {
  const h = await harness(), first = await createdResource(h, "item");
  await createdResource(h, "item", { itemId: first.record.draft.itemId, versionId: id(6501), version: 2, expectedVersionId: first.record.draft.versionId, name: "New head" });
  h.state.brokenHeads = true; const before = h.state.logs.filter(v => v === "head_item").length, replay = await saveResource(h, "item", first.request, 200);
  assert.equal(replay.value.replayed, true); assert.deepEqual(replay.value.record, first.record); assert.equal(h.state.logs.filter(v => v === "head_item").length, before);
});
test("CP-WEB16 item and set historical names/configs remain exact after both current heads rename [T2]", async () => {
  const h = await harness(), first = await createdResource(h, "item"), oldSet = await createdResource(h, "set", { members: [{ itemId: first.record.draft.itemId, versionId: first.record.draft.versionId, fingerprint: first.record.contract.fingerprint }] });
  await createdResource(h, "item", { itemId: first.record.draft.itemId, versionId: id(6601), version: 2, expectedVersionId: first.record.draft.versionId, name: "Renamed item", contains: "later" });
  await createdResource(h, "set", { setId: oldSet.record.draft.setId, versionId: id(6602), version: 2, expectedVersionId: oldSet.record.draft.versionId, name: "Renamed set" });
  for (const [kind, original] of [["item", first], ["set", oldSet]]) {
    const exact = await h.composition.readCompositionVersion(WORKSPACE, kind, publicId(kind, original.record.draft), original.record.draft.versionId); assert.deepEqual(plain(exact), original.record);
  }
  const detail = await h.composition.readCompositionResource(WORKSPACE, "item", first.record.draft.itemId); assert.equal(detail.record.draft.name, "Renamed item"); assert.equal(detail.detail.versions.length, 2);
  assert.equal(Object.hasOwn(detail.detail.versions[0], "contract"), false);
});
test("CP-WEB17 a valid stored record under the wrong requested identity is hidden as an internal readback failure [T2]", async () => {
  const h = await harness(); h.state.wrongVersion = true;
  const response = await h.compositionRoute("item", "[itemId]/versions/[versionId]").GET(undefined, contextFor("item", id(9990), id(9991)));
  assert.equal(response.status, 500); assert.deepEqual(await response.json(), { error: "http_eval_request_failed" });
});
test("CP-WEB18 resource detail refuses mixed head metadata instead of silently choosing another version [T2]", async () => {
  const h = await harness(); h.state.badHead = true; const r = h.itemRecords[0];
  const response = await h.compositionRoute("item", "[itemId]").GET(undefined, contextFor("item", r.draft.itemId));
  assert.equal(response.status, 500); assert.deepEqual(await response.json(), { error: "http_eval_request_failed" });
});
test("CP-WEB19 server loads return ordinary JSON props and scoped exact source-prefills without creating work [T2]", async () => {
  const h = await harness(), r = h.itemRecords[0], loaded = await h.composition.loadComposition({ itemId: r.draft.itemId, itemVersionId: r.draft.versionId });
  assert.equal(loaded.status, "ready"); assert.deepEqual(plain(loaded.data.initialMember), { itemId: r.draft.itemId, versionId: r.draft.versionId, fingerprint: r.contract.fingerprint, name: r.draft.name, version: 1 });
  const plan = await h.plans.loadHttpTargetPlan(h.draft.planId), metadata = plan.data.detail.record.content.dataset.rows[0].metadata;
  assert.equal(Object.getPrototypeOf(metadata), h.ordinaryPrototype); assert.deepEqual(plain(metadata), { ["__proto__"]: { authored: "retained" }, constructor: "own data", toJSON: "literal" });
  assert.equal(h.state.saveRequests.length, 0); assert.equal(h.state.calls.length, 0);
});
test("CP-WEB20 shared HTTP preview/save handles exact mixed v1/v2 refs without broadening v1 drafts [T2]", async () => {
  const h = await harness(), d = { ...plain(h.draft), planId: id(7000), versionId: id(7001), evalSetVersions: [plain(h.legacySource.ref), plain(h.compositionSources[0].ref)] };
  const response = await h.route("preview").POST(h.request(d)); assert.equal(response.status, 200); const p = (await response.json()).preview;
  assert.deepEqual(p.counts, { rowCount: 2, evalSetCount: 2, uniqueItemCount: 3, resultPairs: 6, targetCalls: 2 });
  const saved = await h.route("").POST(h.request({ schemaVersion: "http-eval-plan-save-v2", draft: p.draft, expectedPreviewFingerprint: p.fingerprint })); assert.equal(saved.status, 201);
  assert.equal((await saved.json()).record.content.schemaVersion, "http-target-eval-v2");
  const bad = await h.route("preview").POST(h.request({ ...d, schemaVersion: "http-eval-plan-draft-v1" })); assert.equal(bad.status, 422); assert.equal(h.state.calls.length, 0);
});
test("CP-WEB21 historical v1 plans remain v1 while explicit composition copy only prefills exact frozen selections [T2]", async () => {
  const h = await harness(), d = h.legacyPlan.content.draft, original = await h.plans.readHttpTargetPlanVersion(WORKSPACE, d.planId, d.versionId);
  assert.equal(original.schemaVersion, "http-eval-plan-record-v1"); assert.equal(original.fingerprint, h.legacyPlan.fingerprint);
  const loaded = await h.plans.loadHttpTargetPlans({ composition: true, copyPlanId: d.planId, copyVersionId: d.versionId, sourceRequested: true }); assert.equal(loaded.status, "ready");
  assert.equal(loaded.data.initialFamily, "http-target-eval-v2"); assert.equal(loaded.data.initialDatasetId, d.datasetVersionId); assert.deepEqual(plain(loaded.data.initialSetRefs), [plain(h.legacySource.ref)]);
  assert.equal(h.state.planRecords.size, 2); assert.equal(h.state.saveRequests.length, 0); assert.equal(h.state.calls.length, 0);
});
test("CP-WEB22 shared HTTP detail rejects a wrong family summary and foreign copy-prefills remain unavailable [T2]", async () => {
  const h = await harness(); h.state.badFamily = true; await assert.rejects(h.plans.readHttpTargetPlanDetail(WORKSPACE, h.draft.planId), error => error.status === 500 && error.message === "http_eval_head_invalid");
  h.state.badFamily = false; h.state.auth.workspaceId = "foreign-workspace";
  const loaded = await h.plans.loadHttpTargetPlans({ composition: true, copyPlanId: h.draft.planId, copyVersionId: h.draft.versionId, sourceRequested: true });
  assert.equal(loaded.status, "ready"); assert.equal(loaded.data.requestedSourceUnavailable, true); assert.deepEqual(plain(loaded.data.initialSetRefs), []); assert.equal(h.state.calls.length, 0);
});
test("CP-WEB23 actual v2 coordinator commits reservation and two claims before authored transport seams score six pairs [T2]", async () => {
  const h = await harness(); h.state.allowTargetSeam = true;
  const response = await h.route("[planId]/versions/[versionId]/runs").POST(h.request(h.start()), { params: Promise.resolve({ planId: h.draft.planId, versionId: h.draft.versionId }) });
  assert.equal(response.status, 201); const result = await response.json(); assert.equal(result.record.schemaVersion, "http-eval-run-record-v2"); assert.equal(result.record.ledger.status, "completed");
  assert.equal(h.state.calls.length, 2); assert.equal(result.record.execution.results.length, 6); assert.equal(result.record.execution.gates.length, 20); assert.ok(result.record.execution.gates.every(g => g.passed));
  for (const call of h.state.calls) { assert.equal(call.parsedBody.schemaVersion, "http-json-target-request-v1"); assert.equal(JSON.stringify(call.parsedBody).includes("reference must not leave"), false); assert.equal(call.requestFingerprint, call.idempotencyKey); }
  assert.ok(h.state.maximumActive <= h.draft.limits.concurrency); assert.equal(h.state.logs.filter(v => v.startsWith("claim_committed:")).length, 2);
});
test("CP-WEB24 completed start replay reads and shared recovery operation do not invoke another authored target [T2]", async () => {
  const h = await harness(); h.state.allowTargetSeam = true; const intent = h.start(20), params = { params: Promise.resolve({ planId: h.draft.planId, versionId: h.draft.versionId }) };
  const first = await h.route("[planId]/versions/[versionId]/runs").POST(h.request(intent), params); assert.equal(first.status, 201); const original = (await first.json()).record;
  const replay = await h.route("[planId]/versions/[versionId]/runs").POST(h.request(intent), params); assert.equal(replay.status, 200); assert.equal((await replay.json()).record.fingerprint, original.fingerprint);
  const context = { params: Promise.resolve({ runId: intent.runId }) }, read = await h.route("runs/[runId]").GET(undefined, context); assert.equal(read.status, 200); assert.equal((await read.json()).record.fingerprint, original.fingerprint);
  const recovered = await h.route("runs/[runId]/recover").POST(h.request({ schemaVersion: "http-eval-recover-v1" }), context); assert.equal(recovered.status, 200); assert.equal((await recovered.json()).record.schemaVersion, "http-eval-run-record-v2");
  assert.equal(h.state.calls.length, 2); assert.equal(h.state.logs.filter(v => v === "reservation_committed").length, 1);
});

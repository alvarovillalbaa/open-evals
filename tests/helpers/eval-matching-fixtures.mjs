// T2: real deterministic core with authored data only. No transport, database or model.
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
export const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
export const BASELINE = process.env.OE_EXACT_BASELINE_DIR;
const roots = [ROOT, ...(BASELINE ? [BASELINE] : [])].map(value => pathToFileURL(path.resolve(value) + path.sep).href);
registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL && roots.some(root => context.parentURL.startsWith(root)) && /^\.\.?\//.test(specifier) && !path.extname(new URL(specifier, context.parentURL).pathname)) return nextResolve(specifier + ".ts", context);
  return nextResolve(specifier, context);
} });
export const composition = await import("../../packages/core/src/eval-composition.ts");
export const matching = await import("../../packages/core/src/eval-matching.ts");
export const plans = await import("../../packages/core/src/http-eval-plans.ts");
export const runs = await import("../../packages/core/src/http-eval-runs.ts");
const custom = await import("../../packages/core/src/custom-evals.ts");
export const plain = value => JSON.parse(JSON.stringify(value)), realm = value => value;
export function canonical(value) { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`; }
export const hash = value => createHash("sha256").update(canonical(value)).digest("hex");
export const uuid = n => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
export const WS = "authored-matching-workspace", NOW = "2026-11-12T00:00:00.000Z", LATER = "2026-11-12T00:00:01.000Z";
export function itemDraft(n, contains = "red", patch = {}) { return { schemaVersion: "custom-eval-item-draft-v2", itemId: uuid(n), versionId: uuid(n + 1000), version: 1, expectedVersionId: null, name: `Item ${n}`, contains, ...patch }; }
export function item(n, contains = "red", patch = {}, head = null, workspaceId = WS) {
  const draft = itemDraft(n, contains, patch), p = composition.resolveCustomEvalItemPreviewV2(realm({ workspaceId, draft, head }));
  return plain(composition.prepareCustomEvalItemVersionRecordV2(realm({ workspaceId, request: { schemaVersion: "custom-eval-item-save-v2", draft, expectedPreviewFingerprint: p.fingerprint }, head, createdAt: NOW })));
}
export const ref = record => ({ schemaVersion: record.schemaVersion === "custom-eval-item-record-v2" ? "custom-eval-item-ref-v2" : "custom-eval-item-ref-v3", itemId: record.draft.itemId, versionId: record.draft.versionId, fingerprint: record.contract.fingerprint });
export function setDraft(n, items, patch = {}) { return { schemaVersion: "custom-eval-set-draft-v3", setId: uuid(n), versionId: uuid(n + 2000), version: 1, expectedVersionId: null, name: `Set ${n}`, members: items.map(ref), datasetPassRateThreshold: 100, ...patch }; }
export function set(n, items, patch = {}, head = null, workspaceId = WS) {
  const draft = setDraft(n, items, patch), p = matching.resolveCustomEvalSetPreviewV3(realm({ workspaceId, draft, head, items }));
  return plain(matching.prepareCustomEvalSetVersionRecordV3(realm({ workspaceId, request: { schemaVersion: "custom-eval-set-save-v3", draft, expectedPreviewFingerprint: p.fingerprint }, head, createdAt: NOW, items })));
}
export function source(record) { return { ref: { schemaVersion: record.schemaVersion === "custom-eval-set-record-v2" ? "custom-eval-set-ref-v2" : "custom-eval-set-ref-v3", setId: record.draft.setId, versionId: record.draft.versionId, fingerprint: record.contract.fingerprint }, contract: record.contract, members: record.members, sourceRecordFingerprint: record.fingerprint }; }
export function legacy(n, contains = "red", threshold = 100) {
  const { contract } = plain(custom.prepareCustomEvalSet(realm({ schemaVersion: "custom-eval-set-draft-v1", setId: uuid(n + 100), versionId: uuid(n), version: 1, expectedVersionId: null, name: `Legacy ${n}`, contains, datasetPassRateThreshold: threshold }))), item = contract.itemVersions[0].item;
  return { ref: { schemaVersion: "custom-eval-set-ref-v1", setId: contract.setId, versionId: contract.id, fingerprint: contract.fingerprint }, contract,
    members: [{ evalSetVersionId: contract.id, evalItemVersionId: item.id, position: 0, weight: 1, criticality: "critical", itemFingerprint: item.fingerprint }], sourceRecordFingerprint: null };
}
export function dataset(n = 2) { return { dataset: { id: "authored-dataset", name: "Authored", kind: "custom-dataset-v1" }, version: { id: "authored-version", datasetId: "authored-dataset", version: 1, fingerprint: "a".repeat(64), createdAt: NOW },
  rows: Array.from({ length: n }, (_, i) => ({ id: `row-${i}`, rowKey: `key-${i}`, input: { prompt: `authored input ${i}` }, expectedOutput: { present: true, value: "SECRET_REFERENCE" }, context: { present: true, value: null }, history: { present: false, value: null }, traceFixture: { present: true, value: "SECRET_TRACE_REFERENCE" }, metadata: { origin: "authored" }, reviewStatus: "reviewed" })) }; }
export function draft(sources, patch = {}) { return { schemaVersion: "http-eval-plan-draft-v3", planId: uuid(8000), versionId: uuid(8001), version: 1, expectedVersionId: null, name: "Composition plan", datasetVersionId: "authored-version", evalSetVersions: sources.map(s => s.ref), target: { targetId: "authored-target", targetVersion: "1", endpoint: "https://authored.example.com/evaluate", timeoutMs: 1000 }, limits: { concurrency: 1, maxDurationSeconds: 5 }, ...patch }; }
export function preview(sources, data = dataset(), patch = {}, head = null) { return plans.resolveHttpEvalPlanPreview(realm({ workspaceId: WS, draft: draft(sources, patch), dataset: data, evalSets: sources, head })); }
export function plan(sources, data = dataset(), patch = {}, head = null) {
  const p = preview(sources, data, patch, head); return plain(plans.prepareHttpEvalPlanVersionRecord(realm({ workspaceId: WS, request: { schemaVersion: `http-eval-plan-save-${p.draft.schemaVersion.slice(-2)}`, draft: p.draft, expectedPreviewFingerprint: p.fingerprint }, dataset: data, evalSets: sources, head, createdAt: NOW })));
}
export function start(plan, runId = uuid(9000)) { return runs.createHttpEvalRunLedger(realm({ workspaceId: WS, request: { schemaVersion: `http-eval-start-${plan.content.schemaVersion.slice(-2)}`, runId, planVersionId: plan.storage.versionId, expectedPlanFingerprint: plan.fingerprint }, plan, startedAt: NOW, leaseToken: uuid(9001) })); }
export function claim(plan, ledger, i = 0) { return runs.claimHttpEvalRow(realm({ plan, ledger, rowId: plan.content.samples[i].rowId, leaseToken: ledger.leaseToken, claimToken: uuid(9100 + i), now: NOW })); }
export function finish(plan, claimed, output) { return runs.finalizeHttpEvalRow(realm({ plan, ledger: claimed.ledger, rowId: claimed.claim.rowId, claimToken: claimed.claim.claimToken, completedAt: LATER,
  responseText: JSON.stringify({ schemaVersion: "http-json-target-response-v1", requestFingerprint: claimed.claim.requestFingerprint, output }) })); }
export function complete(plan, outputs) { let ledger = start(plan); const events = [], calls = []; for (let i = 0; i < plan.content.samples.length; i++) { const c = claim(plan, ledger, i); calls.push(plain(c.request)); const f = finish(plan, c, outputs[i]); ledger = f.ledger; events.push(f.event); } return { record: plain(runs.buildHttpEvalRunRecord(realm({ plan, ledger, events }))), calls }; }

export function exact(n, expected = "APPROVED", patch = {}, head = null, workspaceId = WS) {
  const draft = { schemaVersion: "custom-eval-item-draft-v3", itemId: uuid(n), versionId: uuid(n + 1000), version: 1, expectedVersionId: null, name: `Exact ${n}`, expected, ...patch };
  const p = matching.resolveCustomEvalItemPreviewV3({ workspaceId, draft, head });
  return matching.prepareCustomEvalItemVersionRecordV3({ workspaceId, request: { schemaVersion: "custom-eval-item-save-v3", draft, expectedPreviewFingerprint: p.fingerprint }, head, createdAt: NOW });
}
export function containsSet(n, items, threshold = 100, module = composition) {
  const draft = { schemaVersion: "custom-eval-set-draft-v2", setId: uuid(n), versionId: uuid(n + 2000), version: 1, expectedVersionId: null, name: `Contains set ${n}`,
    members: items.map(r => ({ itemId: r.draft.itemId, versionId: r.draft.versionId, fingerprint: r.contract.fingerprint })), datasetPassRateThreshold: threshold };
  const p = module.resolveCustomEvalSetPreviewV2({ workspaceId: WS, draft, head: null, items });
  return module.prepareCustomEvalSetVersionRecordV2({ workspaceId: WS, request: { schemaVersion: "custom-eval-set-save-v2", draft, expectedPreviewFingerprint: p.fingerprint }, head: null, createdAt: NOW, items });
}

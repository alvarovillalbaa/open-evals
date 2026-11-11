// TEST-ONLY process preload. Never imported by application code or enabled by an app flag.
// Authored DNS/HTTPS request doubles are not native DNS, socket, TLS or provider proof.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { constants, openSync, fstatSync, readSync, closeSync, writeSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { dirname, resolve } from "node:path";

const COHORT = "open-evals-matching-v3-browser-20261112";
const MARKER = "open-evals-matching-v3-20261112-created-disposable-v1";
const HOST = "composition-target.example.com";
const SECRET = "authored_open_evals_matching_v3_20261112_fixture_only";
const PEPPER = "authored_matching_v3_browser_pepper_20261112_fixture_only";
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
assert.equal(process.env.EVAL_MATCHING_BROWSER_ALLOW, "owned-disposable");
assert.equal(process.env.AUTH_SECRET, SECRET); assert.equal(process.env.API_KEY_PEPPER, PEPPER);
const dbUrl = new URL(process.env.EVAL_MATCHING_BROWSER_DATABASE_URL ?? "");
assert.ok(["postgres:", "postgresql:"].includes(dbUrl.protocol));
assert.equal(dbUrl.hostname, "127.0.0.1"); assert.equal(dbUrl.port, "65432"); assert.equal(dbUrl.username, "postgres");
assert.match(dbUrl.pathname, /^\/oe_matching_v3_test_[0-9]+_[0-9]+$/); assert.equal(dbUrl.search, ""); assert.equal(dbUrl.hash, "");
assert.equal(process.env.DATABASE_URL, dbUrl.href);
const evidenceRoot = resolve(process.env.RUNNER_TEMP ?? "", "open-evals-matching-v3-evidence");
assert.ok(process.env.RUNNER_TEMP && evidenceRoot.startsWith(resolve(process.env.RUNNER_TEMP) + "/"));
const bindingPath = resolve(process.env.EVAL_MATCHING_BROWSER_BINDING_FILE ?? "");
const journalPath = resolve(process.env.EVAL_MATCHING_BROWSER_TRANSPORT_JOURNAL ?? "");
assert.equal(dirname(bindingPath), evidenceRoot); assert.equal(dirname(journalPath), evidenceRoot);
assert.equal(bindingPath, resolve(evidenceRoot, "transport-binding.json"));
assert.equal(journalPath, resolve(evidenceRoot, "transport-journal.jsonl"));
const require = createRequire(new URL("../../packages/db/package.json", import.meta.url));
const { Client } = require("pg");
const stable = value => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value)
  ? `[${value.map(stable).join(",")}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
const sha = value => createHash("sha256").update(value).digest("hex");
const journalFd = openSync(journalPath, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
// These fail-fast counters are process-local. Acceptance also checks the shared
// append-only journal totals across every preload instance, without filtering PID.
let entries = 0, dnsCalls = 0, targetCalls = 0;
const observedRows = new Set();
function journal(value) {
  const stat = fstatSync(journalFd);
  assert.ok(stat.isFile() && stat.uid === process.getuid() && stat.nlink === 1 && (stat.mode & 0o077) === 0);
  const line = JSON.stringify({ schemaVersion: "eval-matching-transport-observation-v1", cohort: COHORT, processId: process.pid, counterScope: "process-local", ...value }) + "\n";
  assert.ok(++entries <= 16 && stat.size + Buffer.byteLength(line) <= 65536);
  writeSync(journalFd, line);
}
function binding() {
  const fd = openSync(bindingPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    assert.ok(before.isFile() && before.uid === process.getuid() && before.nlink === 1 && (before.mode & 0o077) === 0 && before.size > 0 && before.size <= 8192);
    const bytes = Buffer.alloc(before.size + 1); let length = 0;
    while (length < bytes.length) { const count = readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
    assert.equal(length, before.size);
    const after = fstatSync(fd); for (const key of ["dev", "ino", "size", "mtimeMs", "ctimeMs"]) assert.equal(after[key], before[key]);
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
    assert.equal(value.schemaVersion, "eval-matching-transport-binding-v1"); assert.equal(value.cohort, COHORT);
    assert.equal(value.database, dbUrl.pathname.slice(1)); assert.equal(value.marker, MARKER);
    assert.match(value.workspaceId, UUID); assert.match(value.actorId, UUID); assert.match(value.identity, UUID); assert.match(value.runId, UUID);
    assert.equal(value.workspaceName, `${COHORT}:${value.identity}`); assert.equal(value.actorName, `${value.workspaceName}:${value.actorId}`);
    assert.match(value.planVersionId, /^http_eval_plan_version_[0-9a-f]{64}$/); assert.match(value.planFingerprint, HASH);
    assert.equal(value.maxCalls, 2); assert.ok(Array.isArray(value.rowIds) && value.rowIds.length === 2 && new Set(value.rowIds).size === 2);
    assert.ok(value.rowIds.every(id => typeof id === "string" && id.length > 0 && id.length <= 4096));
    const expires = Date.parse(value.expiresAt);
    assert.ok(Number.isFinite(expires) && expires > Date.now() && expires <= Date.now() + 5 * 60 * 1000);
    return value;
  } finally { closeSync(fd); }
}
function client() {
  return new Client({ connectionString: dbUrl.href, ssl: false, application_name: COHORT + ":transport-seam", connectionTimeoutMillis: 1000, statement_timeout: 1000, query_timeout: 1500, options: "-c search_path=public" });
}
async function databaseIdentity(connection) {
  const result = await connection.query(`select current_database() as name, current_user as actor,
    pg_get_userbyid(d.datdba) as owner, shobj_description(d.oid,'pg_database') as marker,
    host(inet_server_addr()) as address,inet_server_port() as port from pg_database d where d.datname=current_database()`);
  assert.equal(result.rows.length, 1); const value = result.rows[0];
  assert.equal(value.name, dbUrl.pathname.slice(1)); assert.equal(value.actor, "postgres"); assert.equal(value.owner, "postgres");
  assert.equal(value.marker, MARKER); assert.equal(value.port, 65432); assert.ok(["127.0.0.1", "::ffff:127.0.0.1"].includes(value.address));
}
const initial = client();
try { await initial.connect(); await databaseIdentity(initial); } finally { await initial.end(); }
journal({ phase: "guard_ready", nativeDnsSocketTlsChecked: false, actualExternalTargetCalls: 0 });

async function committedRequest(bound, source, fingerprint) {
  const connection = client();
  try {
    await connection.connect(); await databaseIdentity(connection);
    const result = await connection.query(`select w.output as ledger, w.input as reservation, p.resolved_plan as storage,
      e.payload as claim, s.status as sample_status from workflow_runs w
      join eval_runs r on r.id=w.subject_id and r.workspace_id=w.workspace_id
      join run_plans p on p.id=r.run_plan_id and p.workspace_id=w.workspace_id
      join run_samples s on s.eval_run_id=r.id
      join workflow_events e on e.workflow_run_id=w.id and e.event_type='http_eval.row.claimed' and e.payload->'claim'->>'rowId'=s.row_id
      join workspaces ws on ws.id=w.workspace_id join workspace_memberships m on m.workspace_id=ws.id and m.user_id=$3 and m.role='owner'
      join users u on u.id=m.user_id
      where w.workspace_id=$1 and w.workflow_id='http-target-eval-v3' and w.input->'request'->>'runId'=$2
        and r.run_plan_id=$4 and ws.name=$5 and u.name=$6 and s.row_id=$7 limit 2`,
    [bound.workspaceId, bound.runId, bound.actorId, bound.planVersionId, bound.workspaceName, bound.actorName, source.rowId]);
    assert.equal(result.rows.length, 1); const found = result.rows[0];
    assert.equal(found.storage.schemaVersion, "http-eval-plan-storage-v3"); assert.equal(typeof found.storage.recordText, "string");
    assert.ok(Buffer.byteLength(found.storage.recordText) < 262144);
    const plan = JSON.parse(found.storage.recordText);
    assert.equal(plan.schemaVersion, "http-eval-plan-record-v3"); assert.equal(plan.fingerprint, bound.planFingerprint);
    assert.equal(plan.workspaceId, bound.workspaceId); assert.equal(plan.storage.versionId, bound.planVersionId);
    assert.equal(found.reservation.actorId, bound.actorId); assert.equal(found.reservation.planFingerprint, bound.planFingerprint);
    assert.equal(found.ledger.schemaVersion, "http-eval-run-ledger-v3"); assert.equal(found.ledger.publicRunId, bound.runId);
    assert.equal(found.sample_status, "claimed");
    const row = found.ledger.rows.find(row => row.rowId === source.rowId);
    assert.equal(row?.status, "claimed"); assert.match(row.claim.claimToken, UUID); assert.equal(row.claim.requestFingerprint, fingerprint);
    assert.equal(found.claim.schemaVersion, "http-eval-claim-event-v3"); assert.equal(found.claim.workspaceId, bound.workspaceId);
    assert.equal(found.claim.publicRunId, bound.runId); assert.deepEqual(found.claim.claim, row.claim);
    const sample = plan.content.samples.find(sample => sample.rowId === source.rowId);
    const input = plan.content.dataset.rows.find(row => row.id === sample?.datasetRowId);
    assert.ok(input && input.input && ["all", "omit_shared"].includes(input.input.fixtureCase));
    const body = { schemaVersion: "http-json-target-request-v1", runId: bound.runId, rowId: source.rowId, input: input.input,
      ...(input.context.present ? { context: input.context.value } : {}), ...(input.history.present ? { history: input.history.value } : {}) };
    const expected = sha(stable({ schemaVersion: "http-json-target-request-fingerprint-v1", workspaceId: bound.workspaceId, planFingerprint: bound.planFingerprint, body }));
    assert.equal(fingerprint, expected); assert.deepEqual(source, { ...body, requestFingerprint: expected });
    assert.equal(plan.content.target.endpoint, `https://${HOST}/evaluate`);
    return { claimToken: row.claim.claimToken, output: input.input.fixtureCase === "all" ? "APPROVED" : "approved" };
  } finally { await connection.end(); }
}

const https = require("node:https"), dns = require("node:dns/promises");
dns.lookup = async (hostname, options) => {
  try {
    binding(); assert.equal(hostname, HOST); assert.equal(options?.all, true); assert.ok(++dnsCalls <= 2);
    journal({ phase: "authored_dns", sequence: dnsCalls, hostname: HOST });
    return [{ address: "8.8.8.8", family: 4 }];
  } catch {
    journal({ phase: "unexpected_dns", hostnameHash: sha(String(hostname)), nativeDnsSocketTlsChecked: false });
    throw new Error("eval_composition_fixture_dns_refused");
  }
};
https.request = (options, callback) => {
  if (!options || options.hostname !== HOST || options.path !== "/evaluate" || options.method !== "POST") {
    journal({ phase: "unexpected_https", hostnameHash: sha(String(options?.hostname)), nativeDnsSocketTlsChecked: false });
    throw new Error("eval_composition_fixture_https_refused");
  }
  const request = new EventEmitter(); request.destroyed = false;
  request.destroy = () => { request.destroyed = true; return request; };
  request.end = body => {
    void (async () => {
      try {
        const bound = binding(), sequence = ++targetCalls; assert.ok(sequence <= 2);
        assert.equal(options?.protocol, "https:"); assert.equal(options.hostname, HOST); assert.equal(options.port, 443);
        assert.equal(options.path, "/evaluate"); assert.equal(options.method, "POST"); assert.equal(options.agent, false);
        assert.equal(options.autoSelectFamily, false); assert.equal(options.family, 4); assert.equal(options.servername, HOST);
        assert.equal(options.rejectUnauthorized, true); assert.equal(options.insecureHTTPParser, false);
        options.lookup(HOST, {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, "8.8.8.8"); assert.equal(family, 4); });
        assert.ok(Buffer.isBuffer(body) && body.length <= 1024 * 1024 + 8192);
        const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body), source = JSON.parse(text);
        assert.equal(stable(source), text); assert.equal(source.schemaVersion, "http-json-target-request-v1");
        assert.equal(source.runId, bound.runId); assert.ok(bound.rowIds.includes(source.rowId)); assert.match(source.requestFingerprint, HASH);
        const rowKey = `${bound.runId}/${source.rowId}`; assert.equal(observedRows.has(rowKey), false); observedRows.add(rowKey);
        assert.equal(options.headers["idempotency-key"], source.requestFingerprint); assert.equal(options.headers["x-open-evals-request-sha256"], source.requestFingerprint);
        assert.equal(options.headers["content-length"], String(body.length)); assert.equal(options.headers["content-type"], "application/json");
        assert.deepEqual(Object.keys(options.headers).sort(), ["accept", "accept-encoding", "content-type", "content-length", "connection", "user-agent", "idempotency-key", "x-open-evals-request-sha256"].sort());
        assert.equal(options.headers.accept, "application/json"); assert.equal(options.headers["accept-encoding"], "identity");
        assert.equal(options.headers.connection, "close"); assert.equal(options.headers["user-agent"], "OpenEvals-HTTP-Target/1");
        assert.equal(options.headers.authorization, undefined); assert.equal(options.headers.cookie, undefined);
        const actual = await committedRequest(bound, source, source.requestFingerprint);
        const responseBody = Buffer.from(JSON.stringify({ schemaVersion: "http-json-target-response-v1", requestFingerprint: source.requestFingerprint, output: actual.output }));
        journal({ phase: "committed_claim_before_authored_response", sequence, workspaceId: bound.workspaceId, runId: bound.runId,
          planVersionId: bound.planVersionId, planFingerprint: bound.planFingerprint, rowId: source.rowId, claimToken: actual.claimToken,
          requestFingerprint: source.requestFingerprint, idempotencyKey: source.requestFingerprint, requestBodySha256: sha(body), requestBytes: body.length,
          responseBodySha256: sha(responseBody), responseBytes: responseBody.length, nativeDnsSocketTlsChecked: false, actualExternalTargetCalls: 0 });
        if (request.destroyed) return;
        const response = new EventEmitter(); response.statusCode = 200; response.complete = false;
        response.headers = { "content-type": "application/json; charset=utf-8", "content-length": String(responseBody.length) };
        response.rawHeaders = Object.entries(response.headers).flat(); response.destroy = () => { response.destroyed = true; return response; };
        callback(response);
        if (request.destroyed || response.destroyed) return;
        response.emit("data", responseBody); response.complete = true; response.emit("end"); response.emit("close");
      } catch {
        journal({ phase: "unexpected_target_request", attempt: targetCalls, nativeDnsSocketTlsChecked: false, actualExternalTargetCalls: 0 });
        if (!request.destroyed) request.emit("error", new Error("eval_composition_fixture_request_refused"));
      }
    })();
    return request;
  };
  return request;
};
https.get = () => {
  journal({ phase: "unexpected_https_get", nativeDnsSocketTlsChecked: false });
  throw new Error("eval_composition_fixture_https_get_refused");
};
syncBuiltinESMExports();

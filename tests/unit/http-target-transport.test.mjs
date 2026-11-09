// T2: actual transport source, authored DNS/request doubles, no real DNS/socket/TLS calls.
// This is neither a TypeScript compilation nor native network-boundary assurance.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { constants, openSync, fstatSync, lstatSync, readSync, closeSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { isIP } from "node:net";
import test from "node:test";
import { createContext, runInContext, SourceTextModule, SyntheticModule } from "node:vm";

const sourcePath = new URL("../../packages/adapters/src/http-target.ts", import.meta.url);
function actualSource() {
  const fd = openSync(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true });
    assert.ok(before.isFile() && before.size <= 65536n);
    const bytes = Buffer.alloc(Number(before.size) + 1); let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!count) break;
      offset += count;
    }
    assert.equal(offset, Number(before.size));
    for (const after of [fstatSync(fd, { bigint: true }), lstatSync(sourcePath, { bigint: true })]) {
      for (const key of ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"]) assert.equal(after[key], before[key]);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset));
  } finally { closeSync(fd); }
}
const context = createContext({ Buffer, URL, TextDecoder, AbortController, AbortSignal, performance, setTimeout, clearTimeout },
  { codeGeneration: { strings: false, wasm: false } });
let unexpectedNativeCalls = 0;
const prohibitedNative = () => { unexpectedNativeCalls++; throw new Error("real_network_prohibited_by_authored_test"); };
const dependencies = new Map([
  ["node:dns/promises", { lookup: prohibitedNative }],
  ["node:https", { request: prohibitedNative }],
  ["node:net", { isIP }]
]);
const module = new SourceTextModule(stripTypeScriptTypes(actualSource(), { mode: "strip", sourceMap: false }),
  { context, identifier: "actual-adapter:http-target.ts" });
await module.link(specifier => {
  assert.ok(dependencies.has(specifier), `unexpected runtime import: ${specifier}`);
  const exports = dependencies.get(specifier);
  return new SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context });
});
await module.evaluate();
const native = module.namespace;
const realmParse = runInContext("JSON.parse", context);
const realm = value => realmParse(JSON.stringify(value));
const FP = "a".repeat(64), KEY = "b".repeat(64);
function input(patch = {}) {
  return realm({ endpoint: "https://target.example.com/evaluate", timeoutMs: 1000,
    body: JSON.stringify({ schemaVersion: "authored-transport-fixture", input: "authored input" }),
    requestFingerprint: FP, idempotencyKey: KEY, ...patch });
}
function double(settings = {}) {
  const observed = { lookups: [], requests: [], destroyedRequests: 0, destroyedResponses: 0 };
  const invoke = native.createPublicHttpTargetTransport({
    async lookupAll(hostname) {
      observed.lookups.push(hostname);
      if (settings.lookupThrow) throw new Error("private DNS diagnostic must not escape");
      if (settings.lookupNever) return new Promise(() => {});
      return typeof settings.addresses === "function" ? settings.addresses(observed.lookups.length)
        : settings.addresses ?? [{ address: "1.1.1.1", family: 4 }];
    },
    request(options, callback) {
      if (settings.requestThrow) throw new Error("private request diagnostic must not escape");
      const request = new EventEmitter();
      const row = { options, body: null, pin: null }; observed.requests.push(row);
      request.destroy = () => { if (!request.destroyed) observed.destroyedRequests++; request.destroyed = true; return request; };
      request.end = bytes => {
        row.body = Buffer.from(bytes);
        options.lookup(options.hostname, { all: false }, (error, address, family) => { row.pin = { error, address, family }; });
        if (settings.endThrow) throw new Error("private end diagnostic must not escape");
        if (settings.afterEnd) settings.afterEnd();
        if (settings.noResponse) return request;
        queueMicrotask(() => {
          if (request.destroyed) return;
          if (settings.requestError) { request.emit("error", new Error("private network diagnostic must not escape")); return; }
          const response = new EventEmitter();
          response.statusCode = settings.statusCode ?? 200;
          response.headers = settings.headers ?? { "content-type": "application/json; charset=utf-8" };
          response.rawHeaders = settings.rawHeaders ?? Object.entries(response.headers).flatMap(([key, value]) => [key, value]);
          response.complete = false;
          response.destroy = () => { if (!response.destroyed) observed.destroyedResponses++; response.destroyed = true; response.emit("close"); return response; };
          callback(response);
          if (response.destroyed) return;
          const chunks = settings.chunks ?? [Buffer.from(settings.body ?? '{"output":"actual authored target response"}')];
          for (const chunk of chunks) { response.emit("data", chunk); if (response.destroyed) return; }
          if (settings.responseError) response.emit("error", new Error("private response diagnostic must not escape"));
          else if (settings.aborted) response.emit("aborted");
          else if (settings.incomplete) response.emit("close");
          else { response.complete = true; response.emit("end"); response.emit("close"); }
        });
        return request;
      };
      return request;
    }
  });
  return { invoke, observed };
}
async function rejects(invoke, request, code, outcome) {
  await assert.rejects(invoke(request), error => error instanceof native.HttpTargetTransportError
    && (!code || error.code === code) && (!outcome || error.outcome === outcome)
    && error.message === error.code && !error.message.includes("private"));
}

test("HT-NT01 endpoint validation requires public HTTPS and excludes credential/query/fragment variants [T2]", () => {
  for (const endpoint of ["http://target.example.com/", "file:///tmp/authored", "//target.example.com/", "https://user:pass@target.example.com/",
    "https://target.example.com:8443/", "https://target.example.com/?token=authored", "https://target.example.com/?", "https://target.example.com/#",
    "https://localhost/", "https://host.local/", "https://host.internal/", "https://host.home.arpa/", "https://target.example.com./",
    " https://target.example.com/", "https://target.example.com/\n", "https://target.example.com/\\x", "https://target.example.com/\ud800"]) {
    assert.throws(() => native.parsePublicHttpTargetEndpoint(endpoint), error => error instanceof native.HttpTargetTransportError && error.outcome === "not_sent");
  }
  assert.equal(native.parsePublicHttpTargetEndpoint("https://target.example.com/score").href, "https://target.example.com/score");
});
test("HT-NT02 IPv4 numeric URL spellings are normalized and cannot name a private destination [T2]", () => {
  for (const endpoint of ["https://127.0.0.1/", "https://2130706433/", "https://0x7f000001/", "https://0177.0.0.1/",
    "https://169.254.169.254/", "https://168.63.129.16/", "https://10.0.0.1/"]) assert.throws(() => native.parsePublicHttpTargetEndpoint(endpoint));
});
test("HT-NT03 IPv4 policy denies private, metadata, shared, documentation and non-unicast ranges [T2]", () => {
  for (const address of ["0.0.0.1", "10.255.0.1", "100.64.0.1", "100.127.255.254", "127.2.3.4", "169.254.0.1", "172.16.0.1",
    "172.31.255.254", "192.0.0.1", "192.0.2.1", "192.31.196.1", "192.52.193.1", "192.88.99.1", "192.168.2.1", "192.175.48.1",
    "198.18.1.1", "198.19.255.254", "198.51.100.1", "203.0.113.1", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255",
    "168.63.129.16"]) assert.equal(native.isPublicHttpTargetAddress(address), false, address);
  for (const address of ["1.1.1.1", "8.8.8.8", "100.128.0.1", "172.15.255.254", "172.32.0.1"]) assert.equal(native.isPublicHttpTargetAddress(address), true, address);
});
test("HT-NT04 IPv6 policy refuses local, mapped, scoped, transition and documentation destinations [T2]", () => {
  for (const address of ["::", "::1", "fe80::1", "fe80::1%en0", "fc00::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8",
    "64:ff9b::1", "2001::1", "2001:db8::1", "2001:20::1", "2002:0a00:0001::1", "3ffe::1", "3fff::1", "2620:4f:8000::1"]) {
    assert.equal(native.isPublicHttpTargetAddress(address), false, address);
  }
  for (const address of ["2606:4700:4700::1111", "2001:4860:4860::8888"]) assert.equal(native.isPublicHttpTargetAddress(address), true, address);
});
test("HT-NT05 any nonpublic DNS answer rejects the entire inventory before request creation [T2]", async () => {
  for (const privateAddress of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "2002:7f00:1::1"]) {
    const { invoke, observed } = double({ addresses: [{ address: "1.1.1.1", family: 4 }, { address: privateAddress, family: isIP(privateAddress) }] });
    await rejects(invoke, input(), "http_target_destination_not_public", "not_sent"); assert.equal(observed.requests.length, 0);
  }
});
test("HT-NT06 empty, mismatched and excessive DNS inventories are refused without a request [T2]", async () => {
  for (const addresses of [[], [{ address: "1.1.1.1", family: 6 }], [{ address: "not-an-address", family: 4 }], Array(17).fill({ address: "1.1.1.1", family: 4 })]) {
    const { invoke, observed } = double({ addresses });
    await rejects(invoke, input(), "http_target_destination_not_public", "not_sent"); assert.equal(observed.requests.length, 0);
  }
});
test("HT-NT07 the fixed native request pins DNS while retaining TLS hostname checks and no shared agent [T2]", async () => {
  const { invoke, observed } = double(); const result = await invoke(input()); const row = observed.requests[0];
  assert.equal(result.bodyText, '{"output":"actual authored target response"}'); assert.equal(result.statusCode, 200);
  assert.equal(result.bytes, Buffer.byteLength(result.bodyText)); assert.ok(result.elapsedMs >= 0);
  assert.deepEqual(observed.lookups, ["target.example.com"]); assert.equal(row.options.hostname, "target.example.com");
  assert.equal(row.options.servername, "target.example.com"); assert.equal(row.options.rejectUnauthorized, true);
  assert.equal(row.options.agent, false); assert.equal(row.options.autoSelectFamily, false); assert.equal(row.options.family, 4);
  assert.deepEqual(row.pin, { error: null, address: "1.1.1.1", family: 4 });
  assert.equal(row.options.path, "/evaluate"); assert.equal(row.options.method, "POST");
  assert.equal(row.options.headers["idempotency-key"], KEY); assert.equal(row.options.headers["x-open-evals-request-sha256"], FP);
  assert.equal(row.options.headers["content-length"], String(row.body.length));
  assert.equal(row.options.headers.cookie, undefined); assert.equal(row.options.headers.authorization, undefined);
  assert.equal(row.body.toString(), input().body);
});
test("HT-NT08 a public literal uses that address without a DNS lookup [T2]", async () => {
  const { invoke, observed } = double(); await invoke(input({ endpoint: "https://1.1.1.1/score" }));
  assert.equal(observed.lookups.length, 0); assert.equal(observed.requests[0].pin.address, "1.1.1.1");
  assert.equal(observed.requests[0].options.servername, undefined);
});
test("HT-NT09 redirects never dispatch another request and retain unknown remote outcome [T2]", async () => {
  for (const statusCode of [301, 302, 303, 307, 308]) {
    const { invoke, observed } = double({ statusCode, headers: { location: "https://127.0.0.1/private" } });
    await rejects(invoke, input(), "http_target_status_failed", "unknown"); assert.equal(observed.requests.length, 1);
  }
});
test("HT-NT10 unsuccessful HTTP status cannot be scored as a successful target output [T2]", async () => {
  for (const statusCode of [400, 401, 404, 429, 500, 503]) {
    const { invoke } = double({ statusCode }); await rejects(invoke, input(), "http_target_status_failed", "unknown");
  }
});
test("HT-NT11 invalid media types, charsets, duplicate singleton headers and compressed bodies fail [T2]", async () => {
  for (const settings of [{ headers: {} }, { headers: { "content-type": "text/html" } }, { headers: { "content-type": "application/json; charset=latin1" } },
    { headers: { "content-type": 'application/json; charset="utf-8' } },
    { headers: { "content-type": "application/json" }, rawHeaders: ["Content-Type", "application/json", "content-type", "text/html"] },
    { headers: { "content-type": "application/json", "content-encoding": "gzip" } },
    { headers: { "content-type": "application/json", "content-length": "1" }, rawHeaders: ["content-type", "application/json", "content-length", "1", "Content-Length", "1"] }]) {
    await rejects(double(settings).invoke, input(), "http_target_headers_invalid", "unknown");
  }
});
test("HT-NT12 invalid and excessive declared lengths fail before collecting target body chunks [T2]", async () => {
  for (const length of ["65537", "-1", "01", "1.0", "Infinity", "999999999999999999999999999999999999999"])
    await rejects(double({ headers: { "content-type": "application/json", "content-length": length } }).invoke, input(), "http_target_headers_invalid", "unknown");
});
test("HT-NT13 streaming response bytes are bounded even without content length [T2]", async () => {
  const { invoke, observed } = double({ chunks: [Buffer.alloc(65536, "x"), Buffer.from("x")] });
  await rejects(invoke, input(), "http_target_response_too_large", "unknown"); assert.equal(observed.destroyedResponses, 1);
});
test("HT-NT14 the exact response byte boundary is retained without truncation [T2]", async () => {
  const body = '{"output":"' + "x".repeat(65523) + '"}'; assert.equal(Buffer.byteLength(body), 65536);
  const result = await double({ body }).invoke(input()); assert.equal(result.bytes, 65536); assert.equal(result.bodyText, body);
});
test("HT-NT15 malformed UTF-8 is refused rather than replaced [T2]", async () => {
  await rejects(double({ chunks: [Buffer.from([0xc3, 0x28])] }).invoke, input(), "http_target_response_utf8_invalid", "unknown");
});
test("HT-NT16 truncated length, aborted response and premature close retain uncertainty [T2]", async () => {
  for (const settings of [{ body: "{}", headers: { "content-type": "application/json", "content-length": "3" } }, { aborted: true }, { incomplete: true }])
    await rejects(double(settings).invoke, input(), "http_target_response_incomplete", "unknown");
});
test("HT-NT17 empty, failed and non-buffer response streams are explicit failures [T2]", async () => {
  await rejects(double({ body: "" }).invoke, input(), "http_target_response_empty", "unknown");
  await rejects(double({ responseError: true }).invoke, input(), "http_target_response_failed", "unknown");
  await rejects(double({ chunks: ["not a native byte chunk"] }).invoke, input(), "http_target_response_too_large", "unknown");
});
test("HT-NT18 the total deadline includes DNS and prevents late dispatch [T2]", async () => {
  const { invoke, observed } = double({ lookupNever: true });
  await rejects(invoke, input({ timeoutMs: 10 }), "http_target_aborted", "not_sent"); assert.equal(observed.requests.length, 0);
});
test("HT-NT19 a deadline after end records unknown outcome and closes its request [T2]", async () => {
  const { invoke, observed } = double({ noResponse: true });
  await rejects(invoke, input({ timeoutMs: 10 }), "http_target_aborted", "unknown"); assert.equal(observed.destroyedRequests, 1);
});
test("HT-NT20 external cancellation distinguishes before-dispatch from already-dispatched calls [T2]", async () => {
  const before = new AbortController(); before.abort(); const first = double(); const a = input(); a.signal = before.signal;
  await rejects(first.invoke, a, "http_target_aborted", "not_sent"); assert.equal(first.observed.requests.length, 0);
  const after = new AbortController(); const second = double({ noResponse: true, afterEnd: () => queueMicrotask(() => after.abort()) });
  const b = input(); b.signal = after.signal; await rejects(second.invoke, b, "http_target_aborted", "unknown");
});
test("HT-NT21 hostile input containers/getters and unexpected transport options are refused [T2]", async () => {
  const { invoke, observed } = double(); let getterCalls = 0;
  const value = input(); Object.defineProperty(value, "endpoint", { get() { getterCalls++; return "https://target.example.com/"; }, enumerable: true });
  await rejects(invoke, value, "http_target_request_invalid", "not_sent"); assert.equal(getterCalls, 0);
  await rejects(invoke, input({ headers: { authorization: "authored-secret" } }), "http_target_request_invalid", "not_sent");
  await rejects(invoke, Object.create(input()), "http_target_request_invalid", "not_sent"); assert.equal(observed.requests.length, 0);
});
test("HT-NT22 request bytes and Unicode are bounded before DNS or request creation [T2]", async () => {
  const { invoke, observed } = double();
  await rejects(invoke, input({ body: "x".repeat(1024 * 1024 + 8193) }), "http_target_request_invalid", "not_sent");
  await rejects(invoke, input({ body: "\ud800" }), "http_target_request_invalid", "not_sent");
  assert.equal(observed.lookups.length, 0); assert.equal(observed.requests.length, 0);
  const exact = input({ body: "x".repeat(1024 * 1024 + 8192) }); await invoke(exact); assert.equal(observed.requests[0].body.length, 1024 * 1024 + 8192);
});
test("HT-NT23 invalid fingerprints and timeout bounds cannot reach a request [T2]", async () => {
  for (const patch of [{ requestFingerprint: "a\r\nb" }, { idempotencyKey: "invalid" }, { timeoutMs: 0 }, { timeoutMs: 10001 }, { timeoutMs: 1.5 }])
    await rejects(double().invoke, input(patch), "http_target_request_invalid", "not_sent");
});
test("HT-NT24 private network diagnostics are replaced by safe codes [T2]", async () => {
  await rejects(double({ lookupThrow: true }).invoke, input(), "http_target_dns_failed", "not_sent");
  await rejects(double({ requestThrow: true }).invoke, input(), "http_target_request_failed", "not_sent");
  await rejects(double({ requestError: true }).invoke, input(), "http_target_request_failed", "unknown");
  await rejects(double({ endThrow: true }).invoke, input(), "http_target_request_failed", "unknown");
});
test("HT-NT25 requests resolve afresh and pin each call without a pooled connection [T2]", async () => {
  const { invoke, observed } = double({ addresses: count => [{ address: count === 1 ? "1.1.1.1" : "8.8.8.8", family: 4 }] });
  await invoke(input()); await invoke(input()); assert.equal(observed.lookups.length, 2);
  assert.deepEqual(observed.requests.map(row => row.pin.address), ["1.1.1.1", "8.8.8.8"]);
  assert.ok(observed.requests.every(row => row.options.agent === false));
});
test("HT-NT26 no real DNS lookup or native request was invoked by the authored transport packet [T2]", () => {
  assert.equal(unexpectedNativeCalls, 0);
});

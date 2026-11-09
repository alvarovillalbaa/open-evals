// T2: actual CLI/MCP/retired-route modules with authored import and transport seams.
// No installed executable, SDK transport, production Auth, server or network acceptance.
import assert from "node:assert/strict";
import { constants, fstatSync, lstatSync, openSync, readSync, closeSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import test from "node:test";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";

const SOURCE_LIMIT = 64 * 1024;
const TRANSFORMED_LIMIT = 256 * 1024;
// This explicitly supplied test-transpiler profile is separate from the application build.
const swcPath = process.env.OPEN_EVALS_TEST_SWC;
assert.ok(typeof swcPath === "string" && isAbsolute(swcPath) && swcPath.endsWith(".node"), "OPEN_EVALS_TEST_SWC must name an existing native SWC addon");
const nativeSwc = createRequire(import.meta.url)(swcPath);
assert.equal(typeof nativeSwc.transformSync, "function", "Native SWC transformSync is required; no fallback is available");
const CLI = "apps/cli/src/program.ts";
const MCP = "packages/mcp/src/index.ts";
const OTLP = "apps/web/app/api/v1/otlp/v1/traces/route.ts";
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function sourceText(relative) {
  const file = new URL(`../../${relative}`, import.meta.url);
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    assert.ok(before.isFile() && before.size <= BigInt(SOURCE_LIMIT), "bounded regular source required");
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = readSync(descriptor, buffer, bytes, buffer.length - bytes, null);
      if (!count) break;
      bytes += count;
    }
    assert.equal(bytes, Number(before.size), "source size changed during read");
    for (const after of [fstatSync(descriptor, { bigint: true }), lstatSync(file, { bigint: true })]) {
      for (const key of ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"]) assert.equal(after[key], before[key], "source identity changed");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytes));
  } finally { closeSync(descriptor); }
}

async function loadActual(relative, bindings = {}, fetchFixture) {
  const env = Object.create(null), fetchCalls = [];
  const context = createContext({
    process: { env }, Response,
    fetch: async (url, options) => {
      fetchCalls.push({ url, options: plain(options) });
      assert.ok(fetchFixture, "unexpected fixture fetch");
      return fetchFixture(url, options, fetchCalls.length - 1);
    }
  }, { codeGeneration: { strings: false, wasm: false } });
  const linked = [];
  const transformed = nativeSwc.transformSync(sourceText(relative), false, Buffer.from(JSON.stringify({
    filename: relative, swcrc: false, configFile: false, sourceMaps: false,
    jsc: { parser: { syntax: "typescript", tsx: false }, target: "es2022" }, module: { type: "es6" }
  })));
  assert.ok(transformed && typeof transformed.code === "string" && Buffer.byteLength(transformed.code) > 0
    && Buffer.byteLength(transformed.code) <= TRANSFORMED_LIMIT, "Bounded native SWC JavaScript output required");
  const module = new SourceTextModule(transformed.code, { context, identifier: relative });
  await module.link(specifier => {
    linked.push(specifier);
    assert.ok(Object.hasOwn(bindings, specifier), `Unexpected module import: ${specifier}`);
    const exports = bindings[specifier];
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context, identifier: `authored-fixture:${specifier}` });
  });
  await module.evaluate();
  assert.deepEqual(new Set(linked), new Set(Object.keys(bindings)), "actual module imports changed");
  return { namespace: module.namespace, env, fetchCalls };
}

async function cli(args) {
  const calls = [], stdout = [], stderr = [];
  const forbidden = name => (..._arguments) => { calls.push(name); throw new Error(`Forbidden dependency: ${name}`); };
  class OpenEvalsClient { constructor() { forbidden("sdk:client")(); } }
  class OpenEvalsHttpError extends Error { constructor() { super("authored SDK error"); forbidden("sdk:error")(); } }
  class PromptFileError extends Error { constructor() { super("authored prompt error"); forbidden("prompt:error")(); } }
  const promptNames = ["diffPromptDetails", "makePromptReviewFile", "readPromptDefinitionFile", "readPromptDetailFile",
    "readPromptDraftFile", "readPromptReviewFile", "writePromptJsonFile"];
  const promptFiles = { PromptFileError, ...Object.fromEntries(promptNames.map(name => [name, forbidden(`prompt:${name}`)])) };
  const loaded = await loadActual(CLI, {
    "node:fs/promises": { readFile: forbidden("file:read") },
    "@open-evals/sdk": { OpenEvalsClient, OpenEvalsHttpError, normalizePromptEndpoint: forbidden("sdk:normalize") },
    "./prompt-files": promptFiles
  });
  const code = await loaded.namespace.runCli(args, { stdout: text => stdout.push(text), stderr: text => stderr.push(text), env: {} });
  assert.deepEqual(loaded.fetchCalls, [], "CLI unexpectedly fetched");
  assert.deepEqual(calls, [], "CLI touched a file or SDK dependency");
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

const readTools = [
  ["list_runs", "/api/v1/run-batches"], ["list_benchmarks", "/api/v1/benchmarks"],
  ["list_scenarios", "/api/v1/scenarios"], ["list_instructions", "/api/v1/instructions"],
  ["list_campaigns", "/api/v1/campaigns"]
];

function toolPayload(value) {
  const result = plain(value);
  assert.deepEqual(Object.keys(result).sort(), Object.hasOwn(result, "requiresApproval") ? ["content", "requiresApproval"] : ["content"]);
  assert.equal(result.content.length, 1);
  assert.deepEqual(Object.keys(result.content[0]).sort(), ["text", "type"]);
  assert.equal(result.content[0].type, "text");
  return { result, payload: JSON.parse(result.content[0].text) };
}

function unreadBody() {
  const reads = [];
  const request = Object.defineProperties({}, Object.fromEntries(["json", "text", "arrayBuffer", "formData", "body"].map(name => [name, {
    get() { reads.push(name); throw new Error("The retired route must not read a body"); }
  }])));
  return { request, reads };
}

test("SW01 retired ingest file is unknown before reading files configuring clients or fetching", async () => {
  const result = await cli(["ingest", "file", "--file", "authored-traces.jsonl", "--json"]);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr), { ok: false, error: "unknown_command" });
});

test("SW02 retired ingest otlp is unknown before any file client or transport action", async () => {
  const result = await cli(["ingest", "otlp", "--file", "authored-otlp.json", "--json"]);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr), { ok: false, error: "unknown_command" });
});

test("SW03 retired ingest group help is unknown rather than a surviving ingestion entry point", async () => {
  const result = await cli(["ingest", "--help", "--json"]);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr), { ok: false, error: "unknown_command" });
});

test("SW04 actual global CLI help advertises retained workflows and SDK guidance without ingestion commands", async () => {
  const result = await cli(["--help", "--json"]);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  const help = JSON.parse(result.stdout);
  for (const command of ["eval run --file PATH", "scenario run --file PATH", "benchmark run --file PATH", "benchmark list",
    "prompt create --file definition.json", "prompt preview --definition-id ID --file draft.json --out reviewed.json",
    "prompt push --file reviewed.json", "prompt diff --left left-pull.json --right right-pull.json"]) {
    assert.ok(help.commands.includes(command), command);
  }
  assert.ok(help.commands.some(command => command.startsWith("prompt pull ")));
  assert.ok(help.commands.some(command => command.startsWith("prompt resolve ")));
  assert.ok(![...help.commands, ...help.notImplemented].some(command => command.split(" ")[0] === "ingest"));
  assert.ok(help.notes.some(note => note.includes("SDK") && note.includes("/evals/sdk")));
});

test("SW05 eval scenario benchmark and prompt group help remain usable without side effects", async () => {
  for (const group of ["eval", "scenario", "benchmark", "prompt"]) {
    const result = await cli([group, "--help", "--json"]);
    assert.equal(result.code, 0, group);
    assert.equal(result.stderr, "", group);
    assert.ok(JSON.parse(result.stdout).commands.some(command => command.startsWith(`${group} `)), group);
  }
});

test("SW06 actual MCP registry exposes exactly five reads and three preparation tools without ingest", async () => {
  const loaded = await loadActual(MCP);
  assert.deepEqual(Object.keys(loaded.namespace.tools).sort(), [...readTools.map(([name]) => name),
    "create_draft_run_plan", "create_draft_optimization_campaign", "start_eval_run"].sort());
  assert.ok(Object.values(loaded.namespace.tools).every(tool => typeof tool === "function"));
  assert.deepEqual(loaded.fetchCalls, []);
  assert.deepEqual(Object.keys(loaded.env), []);
});

test("SW07 all five actual MCP reads preserve paths authored authorization and complete JSON result envelopes", async () => {
  const payloads = readTools.map(([name]) => ({ authored: name, zero: 0, falseValue: false, next: null }));
  const loaded = await loadActual(MCP, {}, (_url, _options, index) => new Response(JSON.stringify(payloads[index]), { status: 200 }));
  loaded.env.OPEN_EVALS_URL = "https://service.example.invalid/";
  loaded.env.OPEN_EVALS_API_KEY = "authored-fixture-key";
  for (const [index, [name]] of readTools.entries()) {
    const actual = toolPayload(await loaded.namespace.tools[name]());
    assert.deepEqual(actual.payload, payloads[index]);
    assert.equal(Object.hasOwn(actual.result, "requiresApproval"), false);
  }
  assert.deepEqual(loaded.fetchCalls, readTools.map(([_name, path]) => ({
    url: `https://service.example.invalid${path}`, options: { headers: { authorization: "Bearer authored-fixture-key" } }
  })));
});

test("SW08 missing MCP endpoint reports the existing configuration requirement without fetching", async () => {
  const loaded = await loadActual(MCP);
  for (const [name] of readTools) assert.deepEqual(toolPayload(await loaded.namespace.tools[name]()).payload, { error: "OPEN_EVALS_URL_required" });
  assert.deepEqual(loaded.fetchCalls, []);
});

test("SW09 the three MCP preparation tools preserve approval flags and do not execute transport", async () => {
  const loaded = await loadActual(MCP);
  loaded.env.OPEN_EVALS_URL = "https://service.example.invalid";
  const plan = toolPayload(await loaded.namespace.tools.create_draft_run_plan());
  assert.deepEqual(plan.payload, { status: "requires_rows_eval_set_and_target", endpoint: "/api/v1/run-plans/resolve" });
  assert.equal(Object.hasOwn(plan.result, "requiresApproval"), false);
  const campaign = toolPayload(await loaded.namespace.tools.create_draft_optimization_campaign());
  assert.deepEqual(campaign.payload, { status: "approval_required", resource: "optimization_campaign" });
  assert.equal(campaign.result.requiresApproval, true);
  const run = toolPayload(await loaded.namespace.tools.start_eval_run());
  assert.deepEqual(run.payload, { status: "approval_required", endpoint: "/api/v1/eval-runs" });
  assert.equal(run.result.requiresApproval, true);
  assert.deepEqual(loaded.fetchCalls, []);
});

test("SW10 authorized retired OTLP POST keeps its editor scope and returns 410 without reading a body", async () => {
  const authCalls = [], failures = [], input = unreadBody();
  const loaded = await loadActual(OTLP, { "@/lib/auth": {
    requireRouteAuth: async (...args) => { authCalls.push(args); return { workspaceId: "authored-workspace" }; },
    authErrorResponse: error => { failures.push(error); throw new Error("Unexpected auth failure response"); }
  } });
  const response = await loaded.namespace.POST(input.request);
  assert.equal(response.status, 410);
  assert.match(response.headers.get("content-type"), /^application\/json/);
  assert.deepEqual(await response.json(), { error: "trace_import_retired", message: "Send execution evidence through the SDK. See /evals/sdk." });
  assert.deepEqual(authCalls, [["editor", "traces:write"]]);
  assert.deepEqual(failures, []);
  assert.deepEqual(input.reads, []);
  assert.deepEqual(loaded.fetchCalls, []);
});

test("SW11 retired OTLP POST preserves authored 401 and 403 Auth responses and never reads a body", async () => {
  for (const status of [401, 403]) {
    const denial = new Error("Authored authentication denial"), authCalls = [], failures = [], input = unreadBody();
    const loaded = await loadActual(OTLP, { "@/lib/auth": {
      requireRouteAuth: async (...args) => { authCalls.push(args); throw denial; },
      authErrorResponse: error => { failures.push(error); return Response.json({ error: "authored_auth_denial" }, { status }); }
    } });
    const response = await loaded.namespace.POST(input.request);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: "authored_auth_denial" });
    assert.deepEqual(authCalls, [["editor", "traces:write"]]);
    assert.equal(failures.length, 1);
    assert.equal(failures[0], denial);
    assert.deepEqual(input.reads, []);
    assert.deepEqual(loaded.fetchCalls, []);
  }
});

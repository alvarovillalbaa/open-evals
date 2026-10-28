import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { preparePromptDraft, resolvePromptRelease, stableStringify } from "@open-evals/core";

// Authored only. These spawn the actual manifest bin against loopback fixture HTTP,
// not the Next application, PostgreSQL, a provider, or a production service.
const cliDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const privateFixtureKey = "native-bin-private-fixture-key";
const childTimeoutMs = 20_000;
const outputLimit = 256 * 1024;

describe("native manifest executable without a TypeScript preload", () => {
  it("bootstraps JSON help through plain process.execPath and the declared bin", async () => {
    const result = await runBin(["--help", "--json"]);
    const help = success(result);
    expect(help.commands).toContain("prompt create --file definition.json");
    expect(help.commands).toContain("prompt push --file reviewed.json");
    expect(help.notImplemented).toContain("release promote");
    expect(result.command[0]).toBe(process.execPath);
    expect(result.command.slice(1)).not.toContain("--import");
    expect(result.cwd).toBe(cliDirectory);
  }, 30_000);

  it("doctor reports configuration only without HTTP requests or revealing a key", async () => {
    let requests = 0;
    await withServer((_request, response) => { requests += 1; send(response, 500, { error: "fixture_no_health_request_expected" }); }, async endpoint => {
      const result = await runBin(["doctor", "--json"], { OPEN_EVALS_URL: endpoint, OPEN_EVALS_API_KEY: privateFixtureKey });
      expect(success(result)).toEqual({ status: "configuration_only", endpoint, apiKeyConfigured: true, networkChecked: false });
      expect(requests).toBe(0);
      expect(result.stdout + result.stderr).not.toContain(privateFixtureKey);
    });
  }, 30_000);

  it("creates, previews, pushes, replays, pulls and resolves exact authored source through fixture HTTP", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "open-evals-native-bin-"));
    const identity = randomUUID();
    const definition = { id: `native-${identity}`, stableKey: `stable-${identity}`, targetId: "fixture-target" };
    const input = {
      versionId: `version-${identity}`,
      components: [{ id: "role", kind: "role", locked: false, operations: [{ op: "include", name: "greeting" }] }],
      composition: { schemaVersion: "prompt-composition-v1", bindings: { name: { type: "string", value: "Ada" }, unused: { type: "json", value: { preserved: "unrendered input" } } },
        blocks: { greeting: [{ op: "text", template: "Hello {{name}}." }], unused: [{ op: "text", template: "Keep this unused source." }] } }
    };
    const reviewed = preparePromptDraft(input, { workspaceId: "fixture-workspace", actorId: "fixture-actor", definitionId: definition.id });
    const saved = {
      id: input.versionId, status: "draft", createdAt: "2026-10-28T12:00:00.000Z", parentVersionIds: [], contentHash: reviewed.version.contentHash,
      authoring: "composition", compiledText: reviewed.version.compiledText, version: reviewed.version
    };
    const { compiledText, version, ...summary } = saved;
    const detail = { definition, versions: [summary], selectedVersion: saved, canWrite: true };
    const requests = [], saveBodies = [];
    let fixtureWrites = 0, previewCalls = 0;
    try {
      const definitionFile = join(temporary, "definition.json"), inputFile = join(temporary, "draft.json");
      const reviewFile = join(temporary, "reviewed.json"), pullFile = join(temporary, "pulled.json");
      await writeFile(definitionFile, JSON.stringify(definition), { mode: 0o600 });
      await writeFile(inputFile, JSON.stringify(input), { mode: 0o600 });
      await withServer(async (request, response) => {
        expect(request.headers.authorization).toBe(`Bearer ${privateFixtureKey}`);
        const url = new URL(request.url, "http://fixture.invalid");
        requests.push(`${request.method} ${url.pathname}${url.search}`);
        const body = request.method === "POST" ? await requestJson(request) : undefined;
        if (request.method === "POST" && url.pathname === "/api/v1/instructions") {
          expect(body).toEqual(definition); return send(response, 201, { definition, replayed: false });
        }
        if (request.method === "POST" && url.pathname === `/api/v1/instructions/${definition.id}/preview`) {
          previewCalls += 1; expect(body).toEqual(input); return send(response, 200, reviewed);
        }
        if (request.method === "POST" && url.pathname === `/api/v1/instructions/${definition.id}/versions`) {
          expect(body).toEqual({ ...input, previewFingerprint: reviewed.previewFingerprint });
          saveBodies.push(body);
          const replayed = fixtureWrites === 1;
          if (!replayed) fixtureWrites += 1;
          return send(response, replayed ? 200 : 201, { version: saved, replayed });
        }
        if (request.method === "GET" && url.pathname === `/api/v1/instructions/${definition.id}`) {
          expect(url.searchParams.get("versionId")).toBe(input.versionId); return send(response, 200, detail);
        }
        if (request.method === "POST" && url.pathname === "/api/v1/prompts/resolve") {
          expect(body).toEqual({ definitionId: definition.id, candidateVersionId: input.versionId });
          return send(response, 200, { ...resolvePromptRelease({ definitionId: definition.id, releases: [], baselineVersionId: "",
            explicitCandidateVersionId: input.versionId, scopes: {} }), compiledText, contentHash: saved.contentHash });
        }
        return send(response, 404, { error: "fixture_route_not_found" });
      }, async endpoint => {
        const env = { OPEN_EVALS_URL: endpoint, OPEN_EVALS_API_KEY: privateFixtureKey };
        const created = success(await runBin(["prompt", "create", "--file", definitionFile, "--endpoint", endpoint, "--api-key", privateFixtureKey, "--json"], {
          OPEN_EVALS_URL: "http://127.0.0.1:1/unused", OPEN_EVALS_API_KEY: "fixture-overridden-environment-key"
        }));
        expect(created).toEqual({ definition, replayed: false });
        const previewResult = success(await runBin(["prompt", "preview", "--definition-id", definition.id, "--file", inputFile, "--out", reviewFile, "--json"], env));
        expect(previewResult.versionId).toBe(input.versionId);
        const review = JSON.parse(await readFile(reviewFile, "utf8"));
        expect(review).toEqual({ schemaVersion: "open-evals-prompt-review-v1", endpoint, definitionId: definition.id, input, preview: reviewed });
        const first = success(await runBin(["prompt", "push", "--file", reviewFile, "--json"], env));
        const replay = success(await runBin(["prompt", "push", "--file", reviewFile, "--json"], env));
        expect(first).toEqual({ version: saved, replayed: false });
        expect(replay).toEqual({ version: saved, replayed: true });
        expect(stableStringify(saveBodies[0])).toBe(stableStringify(saveBodies[1]));
        expect(previewCalls).toBe(1);
        expect(fixtureWrites).toBe(1);
        const pull = success(await runBin(["prompt", "pull", "--definition-id", definition.id, "--version-id", input.versionId, "--out", pullFile, "--json"], env));
        expect(pull.versionId).toBe(input.versionId);
        const pulled = JSON.parse(await readFile(pullFile, "utf8"));
        expect(pulled).toEqual(detail);
        expect(pulled.selectedVersion.version.compositionSnapshot.blocks.unused).toEqual(input.composition.blocks.unused);
        expect(pulled.selectedVersion.version.compositionSnapshot.bindings.unused).toEqual(input.composition.bindings.unused);
        const resolved = success(await runBin(["prompt", "resolve", "--definition-id", definition.id, "--candidate-version-id", input.versionId, "--json"], env));
        expect(resolved.versionId).toBe(input.versionId);
        expect(resolved.compiledText).toBe(saved.compiledText);
        expect(resolved.contentHash).toBe(saved.contentHash);
        expect(resolved.appliedReleaseIds).toEqual(["explicit_eval_candidate_override"]);
        expect(requests).toEqual([
          "POST /api/v1/instructions", `POST /api/v1/instructions/${definition.id}/preview`,
          `POST /api/v1/instructions/${definition.id}/versions`, `POST /api/v1/instructions/${definition.id}/versions`,
          `GET /api/v1/instructions/${definition.id}?versionId=${input.versionId}`, "POST /api/v1/prompts/resolve"
        ]);
      });
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }, 150_000);

  it("returns nonzero safe failures for HTTP errors, refused redirects and unsupported operations", async () => {
    let redirectedRequests = 0, requests = 0;
    await withServer((request, response) => {
      requests += 1;
      const url = new URL(request.url, "http://fixture.invalid");
      if (url.pathname.endsWith("/redirect")) { response.writeHead(302, { location: "/must-not-follow" }); response.end(); return; }
      if (url.pathname === "/must-not-follow") { redirectedRequests += 1; return send(response, 200, {}); }
      return send(response, 403, { error: privateFixtureKey, privateBody: privateFixtureKey });
    }, async endpoint => {
      const env = { OPEN_EVALS_URL: endpoint, OPEN_EVALS_API_KEY: privateFixtureKey };
      const denied = await runBin(["prompt", "pull", "--definition-id", "denied", "--json"], env);
      expect(failure(denied)).toEqual({ ok: false, error: "prompt_http_error", status: 403 });
      const redirect = await runBin(["prompt", "pull", "--definition-id", "redirect", "--json"], env);
      expect(failure(redirect)).toEqual({ ok: false, error: "prompt_network_error", status: 0 });
      expect(redirectedRequests).toBe(0);
      const unsupported = await runBin(["release", "promote", "--json"], env);
      expect(failure(unsupported)).toEqual({ ok: false, error: "command_not_implemented" });
      expect(requests).toBe(2);
      for (const result of [denied, redirect, unsupported]) expect(result.stdout + result.stderr).not.toContain(privateFixtureKey);
    });
  }, 90_000);
});

async function runBin(args, overrides = {}) {
  const manifest = JSON.parse(await readFile(join(cliDirectory, "package.json"), "utf8"));
  expect(typeof manifest.bin?.["open-evals"]).toBe("string");
  const executable = resolve(cliDirectory, manifest.bin["open-evals"]);
  expect(executable.startsWith(`${cliDirectory}${sep}`)).toBe(true);
  const env = { ...process.env, OPEN_EVALS_URL: "http://127.0.0.1:1", ...overrides };
  for (const name of ["NODE_OPTIONS", "NODE_PATH", "NODE_USE_ENV_PROXY", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete env[name];
  if (!Object.hasOwn(overrides, "OPEN_EVALS_API_KEY")) delete env.OPEN_EVALS_API_KEY;
  return new Promise((resolveResult, reject) => {
    const command = [process.execPath, executable, ...args];
    const child = spawn(command[0], command.slice(1), { cwd: cliDirectory, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    let bytes = 0, problem;
    const timeout = setTimeout(() => { problem = new Error("native_bin_timeout"); child.kill("SIGKILL"); }, childTimeoutMs);
    const collect = target => chunk => {
      bytes += chunk.length;
      if (bytes > outputLimit) { problem = new Error("native_bin_output_limit"); child.kill("SIGKILL"); return; }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (problem) return reject(problem);
      resolveResult({ code, signal, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), command, cwd: cliDirectory });
    });
  });
}

function success(result) {
  expect(result.signal).toBe(null);
  expect(result.code, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}
function failure(result) {
  expect(result.signal).toBe(null);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  return JSON.parse(result.stderr);
}
function send(response, status, value) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}
async function requestJson(request) {
  const chunks = []; let bytes = 0;
  for await (const chunk of request) { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) throw new Error("fixture_request_limit"); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function withServer(handler, operation) {
  const errors = [];
  const server = createServer((request, response) => {
    Promise.resolve().then(() => handler(request, response)).catch(error => { errors.push(error); if (!response.headersSent) send(response, 500, { error: "fixture_handler_failed" }); else response.destroy(); });
  });
  try {
    await new Promise((done, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", done); });
    const address = server.address();
    expect(address && typeof address !== "string").toBe(true);
    await operation(`http://127.0.0.1:${address.port}`);
    expect(errors).toEqual([]);
  } finally {
    server.closeAllConnections();
    await new Promise((done, fail) => server.close(error => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? fail(error) : done()));
  }
}

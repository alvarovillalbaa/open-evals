import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { preparePromptDraft, type InstructionDetailDTO, type PromptDraftInput, type PromptDraftPreview, type StoredVersionDTO } from "@open-evals/core";
import { runCli } from "../src/program";
import { makePromptReviewFile } from "../src/prompt-files";

// T2: real command/SDK/file logic, authored files and a mocked fetch boundary. No network or provider.
const endpoint = "http://127.0.0.1:3216";
let directory: string | undefined;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "open-evals-prompt-cli-"));
  fetchMock = vi.fn(async () => { throw new Error("unexpected authored fetch"); });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});
function path(name: string) { return join(directory!, name); }
async function jsonFile(name: string, value: unknown) { const file = path(name); await writeFile(file, JSON.stringify(value), { mode: 0o600 }); return file; }
async function invoke(args: string[], env: Readonly<Record<string, string | undefined>> = {}) {
  let stdout = "", stderr = "";
  const code = await runCli(args, { stdout: value => { stdout += value; }, stderr: value => { stderr += value; }, env });
  return { code, stdout, stderr };
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
function reply(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => handler(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init ?? {}));
}
function requestAt(index = 0) {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return { url, init, headers: new Headers(init.headers), body: init.body === undefined ? undefined : JSON.parse(String(init.body)) };
}
function input(versionId = "draft-version"): PromptDraftInput {
  return { versionId, components: [{ id: "role", kind: "role", locked: false, content: "Hello {{name}}." }], composition: {
    schemaVersion: "prompt-composition-v1", bindings: { name: { type: "string", value: "Ada" } }, blocks: { unused: [{ op: "text", template: "Unused source." }] }
  } };
}
function preview(draft = input()): PromptDraftPreview { return preparePromptDraft(draft, { workspaceId: "workspace", actorId: "actor", definitionId: "definition" }); }
function stored(reviewed = preview()): StoredVersionDTO {
  const version = reviewed.version;
  return { id: version.id, status: version.status, createdAt: "2026-10-28T00:00:00.000Z", parentVersionIds: version.parentVersionIds, contentHash: version.contentHash, authoring: "composition", compiledText: version.compiledText, version };
}
function detail(reviewed = preview()): InstructionDetailDTO {
  const selectedVersion = stored(reviewed);
  const { compiledText: _, version: __, ...summary } = selectedVersion;
  return { definition: { id: "definition", stableKey: "instruction" }, versions: [summary], selectedVersion, canWrite: true };
}
const resolution = { versionId: "resolved", appliedReleaseIds: ["baseline"], resolutionFingerprint: "a".repeat(24), compiledText: "Stored text.", contentHash: "original-stored-hash" };

describe("prompt CLI", () => {
  it("shows help without reading endpoint/key configuration or mutating process.exitCode", async () => {
    const env = new Proxy({}, { get() { throw new Error("help must not inspect environment"); } });
    const before = process.exitCode;
    for (const args of [[], ["--help"], ["prompt", "--help"], ["--json"]]) {
      const result = await invoke(args, env);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("prompt preview");
    }
    expect(process.exitCode).toBe(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("labels doctor as configuration-only without printing an API key", async () => {
    const result = await invoke(["doctor", "--json"], { OPEN_EVALS_URL: `${endpoint}/`, OPEN_EVALS_API_KEY: "private-doctor-key" });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ status: "configuration_only", endpoint, apiKeyConfigured: true, networkChecked: false });
    expect(result.stdout + result.stderr).not.toContain("private-doctor-key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("consumes repeated command-like flag values without losing command words", async () => {
    reply(() => json(resolution));
    const result = await invoke(["--api-key", "prompt", "prompt", "resolve", "--definition-id", "prompt", "--json"]);
    expect(result.code).toBe(0);
    expect(requestAt()).toMatchObject({ url: `${endpoint}/api/v1/prompts/resolve`, body: { definitionId: "prompt" } });
    expect(requestAt().headers.get("authorization")).toBe("Bearer prompt");
    expect(JSON.parse(result.stdout)).toEqual(resolution);
  });

  it.each([
    { label: "missing value", args: ["prompt", "preview", "--definition-id", "--json"], error: "missing_flag_value" },
    { label: "duplicate value flag", args: ["prompt", "pull", "--definition-id", "private-first", "--definition-id", "private-second", "--json"], error: "duplicate_flag" },
    { label: "unknown flag", args: ["prompt", "pull", "--definition-id", "definition", "--api-key=private-secret", "--json"], error: "unknown_flag" },
    { label: "unsupported flag", args: ["prompt", "push", "--file", "private-file", "--version-id", "private-version", "--json"], error: "unsupported_flag" },
    { label: "missing required flag", args: ["prompt", "preview", "--definition-id", "definition", "--file", "private-file", "--json"], error: "missing_required_flag" },
    { label: "duplicate boolean flag", args: ["doctor", "--json", "--json"], error: "duplicate_flag" },
    { label: "extra positional argument", args: ["doctor", "private-extra", "--json"], error: "unknown_command" },
    { label: "prototype command", args: ["__proto__", "--json"], error: "unknown_command" }
  ])("rejects $label arguments before file/network work without echoing values", async ({ args, error }) => {
    const result = await invoke(args);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ ok: false, error });
    expect(result.stderr).not.toContain("private-");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns nonzero instead of fictional outcomes for every unfinished command", async () => {
    for (const command of ["login", "eval status", "eval cancel", "eval export", "calibration run", "benchmark import", "optimize start", "optimize status", "experiment status", "release promote", "release rollback"]) {
      const result = await invoke([...command.split(" "), "--json"]);
      expect(result).toMatchObject({ code: 1, stdout: "" });
      expect(JSON.parse(result.stderr)).toEqual({ ok: false, error: "command_not_implemented" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates and replays the same definition identity from the same authored file", async () => {
    const definition = { id: "definition", stableKey: "instruction", targetId: "target" };
    const file = await jsonFile("definition.json", definition);
    let calls = 0;
    reply(() => { const replayed = calls++ > 0; return json({ definition, replayed }, replayed ? 200 : 201); });
    expect((await invoke(["prompt", "create", "--file", file, "--json"])).code).toBe(0);
    expect((await invoke(["prompt", "create", "--file", file, "--json"])).code).toBe(0);
    expect(requestAt(0).body).toEqual(definition);
    expect(requestAt(1).body).toEqual(definition);
    expect(requestAt(0).url).toBe(`${endpoint}/api/v1/instructions`);
  });

  it("previews the exact source and writes a complete endpoint-bound reviewed artifact", async () => {
    const draft = input(), reviewed = preview(draft);
    const file = await jsonFile("draft.json", draft);
    reply(() => json(reviewed));
    const result = await invoke(["prompt", "preview", "--definition-id", "definition", "--file", file, "--out", path("reviewed.json"), "--endpoint", `${endpoint}/`, "--json"]);
    expect(result.code).toBe(0);
    expect(requestAt()).toMatchObject({ url: `${endpoint}/api/v1/instructions/definition/preview`, body: draft });
    const artifact = JSON.parse(await readFile(path("reviewed.json"), "utf8"));
    expect(artifact).toEqual(makePromptReviewFile(endpoint, "definition", draft, reviewed));
    expect(JSON.parse(result.stdout)).toMatchObject({ artifactWrite: "created", versionId: draft.versionId, previewFingerprint: reviewed.previewFingerprint });
  });

  it("retries a lost push response with the same saved review and never previews again", async () => {
    const draft = input(), reviewed = preview(draft);
    const file = await jsonFile("reviewed.json", makePromptReviewFile(endpoint, "definition", draft, reviewed));
    const originalBytes = await readFile(file, "utf8");
    let calls = 0;
    reply(() => { if (calls++ === 0) throw new TypeError("private-server-detail"); return json({ version: stored(reviewed), replayed: true }, 200); });
    const first = await invoke(["prompt", "push", "--file", file, "--json"]);
    expect(first.code).toBe(1);
    expect(JSON.parse(first.stderr)).toMatchObject({ error: "prompt_network_error" });
    expect(first.stdout + first.stderr).not.toContain("private-server-detail");
    const retry = await invoke(["prompt", "push", "--file", file, "--json"]);
    expect(retry.code).toBe(0);
    expect(JSON.parse(retry.stdout).replayed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestAt(0).url).toBe(`${endpoint}/api/v1/instructions/definition/versions`);
    expect(requestAt(1).url).toBe(requestAt(0).url);
    expect(requestAt(1).init.body).toBe(requestAt(0).init.body);
    expect(requestAt(0).body).toEqual({ ...draft, previewFingerprint: reviewed.previewFingerprint });
    expect(await readFile(file, "utf8")).toBe(originalBytes);
  });

  it("rejects a reviewed endpoint mismatch before any SDK save request", async () => {
    const draft = input(), reviewed = preview(draft);
    const file = await jsonFile("reviewed.json", makePromptReviewFile("http://127.0.0.1:9999", "definition", draft, reviewed));
    const result = await invoke(["prompt", "push", "--file", file, "--endpoint", endpoint, "--json"]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({ ok: false, error: "prompt_review_endpoint_mismatch" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pulls the checked selected snapshot to a file or stdout using the requested version", async () => {
    const expected = detail();
    reply(() => json(expected));
    const args = ["prompt", "pull", "--definition-id", "definition", "--version-id", expected.selectedVersion!.id];
    const written = await invoke([...args, "--out", path("pulled.json"), "--json"]);
    expect(written.code).toBe(0);
    expect(JSON.parse(await readFile(path("pulled.json"), "utf8"))).toEqual(expected);
    expect(requestAt().url).toBe(`${endpoint}/api/v1/instructions/definition?versionId=${expected.selectedVersion!.id}`);
    expect(requestAt().init.method).toBe("GET");
    const printed = await invoke([...args, "--json"]);
    expect(printed.code).toBe(0);
    expect(JSON.parse(printed.stdout)).toEqual(expected);
  });

  it("diffs unused source offline without inspecting endpoint/key environment", async () => {
    const left = detail();
    const changed: PromptDraftInput = { ...input("right"), composition: { ...input().composition!, blocks: { unused: [{ op: "text", template: "Changed unused source." }] } } };
    const right = detail(preview(changed));
    const env = new Proxy({}, { get() { throw new Error("offline diff must not read configuration"); } });
    const result = await invoke(["prompt", "diff", "--left", await jsonFile("left.json", left), "--right", await jsonFile("right.json", right), "--json"], env);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ hasDifferences: true, compiledTextChanged: false, contentHashChanged: false, sourceChanged: true });
    expect(JSON.parse(result.stdout).sourceChanges.blocks[0].name).toBe("unused");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves with exactly the exposed selection fields and explicit flag credentials", async () => {
    reply(() => json(resolution));
    const result = await invoke(["prompt", "resolve", "--definition-id", "definition", "--candidate-version-id", "candidate", "--experiment-version-id", "experiment", "--project-id", "project", "--session-id", "session", "--api-key", "flag-key", "--json"], { OPEN_EVALS_API_KEY: "environment-key" });
    expect(result.code).toBe(0);
    expect(requestAt().body).toEqual({ definitionId: "definition", candidateVersionId: "candidate", experimentVersionId: "experiment", projectId: "project", sessionId: "session" });
    expect(requestAt().headers.get("authorization")).toBe("Bearer flag-key");
    expect(result.stdout + result.stderr).not.toContain("flag-key");
    expect(result.stdout + result.stderr).not.toContain("environment-key");
  });

  it("reports prompt HTTP failures without printing producer bodies or credentials", async () => {
    reply(() => json({ error: "private-response-body" }, 403));
    const result = await invoke(["prompt", "resolve", "--definition-id", "definition", "--api-key", "private-api-key", "--json"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ ok: false, status: 403, error: "prompt_http_error" });
    expect(result.stderr).not.toContain("private-");
  });

  it("rejects a credential-bearing endpoint before reading files or sending a request", async () => {
    const result = await invoke(["prompt", "create", "--file", path("missing.json"), "--endpoint", "https://private-user:private-key@example.invalid/?private-token", "--json"]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({ ok: false, error: "prompt_endpoint_invalid", status: 0 });
    expect(result.stderr).not.toContain("private-");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps local read failures controlled and omits private file paths from stderr", async () => {
    const result = await invoke(["prompt", "create", "--file", path("private-missing.json"), "--json"]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({ ok: false, error: "prompt_file_read_failed" });
    expect(result.stderr).not.toContain("private-missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails real ingest on HTTP errors without consuming the private failure body", async () => {
    await writeFile(path("traces.jsonl"), '{"id":"authored-trace"}\n');
    const failure = json({ error: "private-ingest-detail" }, 401);
    reply(() => failure);
    const result = await invoke(["ingest", "file", "--file", path("traces.jsonl"), "--api-key", "flag-key", "--json"], { OPEN_EVALS_API_KEY: "env-key" });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({ ok: false, error: "http_request_failed", status: 401 });
    expect(requestAt().headers.get("authorization")).toBe("Bearer flag-key");
    expect(failure.bodyUsed).toBe(false);
    expect(result.stderr).not.toContain("private-ingest-detail");
  });

  it("preserves real eval aliases and sends their authored payloads through the SDK", async () => {
    const payload = { targetId: "target", datasetVersionIds: ["dataset"] };
    const file = await jsonFile("eval.json", payload);
    reply(() => json({ id: "server-run", status: "queued" }));
    for (const command of ["eval run", "scenario run", "benchmark run"]) {
      const result = await invoke([...command.split(" "), "--file", file, "--json"], { OPEN_EVALS_API_KEY: "env-key" });
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ id: "server-run", status: "queued" });
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (let index = 0; index < 3; index++) {
      expect(requestAt(index)).toMatchObject({ url: `${endpoint}/api/v1/eval-runs`, body: payload });
      expect(requestAt(index).headers.get("authorization")).toBe("Bearer env-key");
    }
  });

  it("rejects invalid eval JSON before network and fails non-JSON successful responses", async () => {
    await writeFile(path("invalid.json"), "not JSON");
    const invalid = await invoke(["eval", "run", "--file", path("invalid.json"), "--json"]);
    expect(JSON.parse(invalid.stderr)).toEqual({ ok: false, error: "input_json_invalid" });
    expect(invalid.code).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    const file = await jsonFile("valid.json", { targetId: "target" });
    reply(() => new Response("not JSON", { status: 200 }));
    const malformed = await invoke(["eval", "run", "--file", file, "--json"]);
    expect(malformed.code).toBe(1);
    expect(JSON.parse(malformed.stderr)).toEqual({ ok: false, error: "invalid_response" });
  });

  it("uses the explicit key and normalized endpoint for benchmark GET and fails HTTP errors", async () => {
    const failure = json({ error: "private-benchmark-detail" }, 503);
    reply(() => failure);
    const result = await invoke(["benchmark", "list", "--endpoint", `${endpoint}/base/`, "--api-key", "flag-key", "--json"], { OPEN_EVALS_API_KEY: "env-key" });
    expect(result.code).toBe(1);
    expect(requestAt().url).toBe(`${endpoint}/base/api/v1/benchmarks`);
    expect(requestAt().headers.get("authorization")).toBe("Bearer flag-key");
    expect(requestAt().init.redirect).toBe("error");
    expect(JSON.parse(result.stderr)).toEqual({ ok: false, error: "http_request_failed", status: 503 });
    expect(failure.bodyUsed).toBe(false);
    expect(result.stderr).not.toContain("private-benchmark-detail");
  });
});

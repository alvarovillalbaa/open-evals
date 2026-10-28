import { afterEach, describe, expect, it, vi } from "vitest";
import { compilePromptVersion } from "@open-evals/core";
import {
  OpenEvalsHttpError, PromptClient, normalizePromptEndpoint, parsePromptDefinitionDetail,
  parsePromptDraftPreview, parsePromptSaveResult, parsePromptResolution
} from "../src/prompts";

// Authored only. Execution needs its own approved client-check scope.
const clone = value => structuredClone(value);
const input = (versionId = "version") => ({ versionId, components: [{ id: "role", kind: "role", locked: false, content: "Hello." }] });
const composed = () => ({
  versionId: "version", components: [{ id: "role", kind: "role", locked: false, operations: [{ op: "include", name: "greet" }] }],
  composition: { schemaVersion: "prompt-composition-v1", bindings: { name: { type: "string", value: "Ada" }, unused: { type: "number", value: 1 } },
    blocks: { greet: [{ op: "text", template: "Hello {{name}}." }], unused: [{ op: "text", template: "Source A" }] } }
});
function preview(draft = input(), definitionId = "definition", status = "draft") {
  return { version: compilePromptVersion({ id: draft.versionId, definitionId, components: draft.components,
    parentVersionIds: draft.baseVersionId ? [draft.baseVersionId] : [], status,
    ...(draft.composition ? { composition: draft.composition } : {}) }), requestFingerprint: "1".repeat(64), previewFingerprint: "2".repeat(64) };
}
function stored(review = preview()) {
  return { id: review.version.id, status: review.version.status, createdAt: "2026-10-28T12:00:00.000Z", parentVersionIds: [...review.version.parentVersionIds],
    contentHash: review.version.contentHash, authoring: review.version.compositionSnapshot ? "composition" : "literal", compiledText: review.version.compiledText, version: review.version };
}
function detail(saved = stored()) {
  const { compiledText, version, readOnlyReason, ...summary } = saved;
  return { definition: { id: "definition", stableKey: "stable", targetId: "target" }, versions: [summary], selectedVersion: saved, canWrite: true };
}
const resolution = () => ({ versionId: "version", appliedReleaseIds: ["baseline"], resolutionFingerprint: "3".repeat(24), compiledText: "Legacy bytes {{literal}}", contentHash: "original-legacy-hash" });
const jsonResponse = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const rejectsProtocol = operation => expect(operation).toThrowError("open_evals_http_error:0:prompt_protocol_error");
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("checked prompt response parsers", () => {
  it("normalizes absolute endpoints and retains an explicit base path", () => {
    expect(normalizePromptEndpoint("HTTPS://EXAMPLE.INVALID:443/base///")).toBe("https://example.invalid/base");
    expect(normalizePromptEndpoint("http://127.0.0.1:3216/")).toBe("http://127.0.0.1:3216");
  });
  it("rejects credential, query, fragment, relative and backslash endpoints safely", () => {
    for (const endpoint of ["/relative", "https://user:private@example.invalid", "https://example.invalid/?", "https://example.invalid/#", "https://example.invalid/a\\b", " https://example.invalid"]) {
      expect(() => normalizePromptEndpoint(endpoint)).toThrowError("open_evals_http_error:0:prompt_endpoint_invalid");
    }
  });
  it("validates and detaches a literal preview with its complete expected identity", () => {
    const raw = clone(preview()), parsed = parsePromptDraftPreview(raw, "definition", input());
    expect(parsed).toEqual(raw);
    expect(Object.isFrozen(parsed.version.components[0])).toBe(true);
    raw.version.components[0].content = "Later mutation";
    expect(parsed.version.components[0].content).toBe("Hello.");
  });
  it("rejects unused-source changes even when rendered content hashes match", () => {
    const draft = composed(), changed = composed(); changed.composition.blocks.unused[0].template = "Source B";
    expect(preview(draft).version.contentHash).toBe(preview(changed).version.contentHash);
    rejectsProtocol(() => parsePromptDraftPreview(preview(changed), "definition", draft));
    changed.composition.blocks.unused[0].template = "Source A"; changed.composition.bindings.unused.value = 2;
    rejectsProtocol(() => parsePromptDraftPreview(preview(changed), "definition", draft));
  });
  it("rejects mismatched compiled source, identity, parents and fingerprints", () => {
    for (const alter of [value => { value.version.compiledText += "tamper"; }, value => { value.version.id = "other"; },
      value => { value.version.definitionId = "other"; }, value => { value.version.parentVersionIds = ["other"]; }, value => { value.previewFingerprint = "short"; }]) {
      const value = clone(preview()); alter(value);
      rejectsProtocol(() => parsePromptDraftPreview(value, "definition", input()));
    }
  });
  it("accepts valid newline-heavy composition beyond a one-MiB serialized response", () => {
    const draft = { versionId: "large", components: [{ id: "role", kind: "role", locked: false, content: "{{name}}{{name}}" }],
      composition: { schemaVersion: "prompt-composition-v1", bindings: { name: { type: "string", value: "\n".repeat(300000) } } } };
    const review = preview(draft);
    expect(JSON.stringify(review).length).toBeGreaterThan(1024 * 1024);
    expect(parsePromptDraftPreview(review, "definition", draft)).toEqual(review);
  });
  it("rejects accessors, cycles, sparse arrays and unknown producer fields", () => {
    const getter = vi.fn(() => preview().version), accessor = { requestFingerprint: "1".repeat(64), previewFingerprint: "2".repeat(64) };
    Object.defineProperty(accessor, "version", { enumerable: true, get: getter });
    rejectsProtocol(() => parsePromptDraftPreview(accessor));
    expect(getter).not.toHaveBeenCalled();
    const cycle = {}; cycle.version = cycle;
    rejectsProtocol(() => parsePromptDraftPreview(cycle));
    const sparse = detail(); sparse.versions = new Array(1);
    rejectsProtocol(() => parsePromptDefinitionDetail(sparse));
    rejectsProtocol(() => parsePromptDraftPreview({ ...preview(), extra: true }));
  });
  it("preserves legacy read-only bytes and demonstration hashes without reconstruction", () => {
    const legacy = { id: "legacy", status: "legacy status with spaces", createdAt: "2026-10-28T12:00:00.000Z", parentVersionIds: [],
      contentHash: "original-demo-hash".repeat(16), authoring: "legacy", compiledText: "Keep {{literal}} exactly", readOnlyReason: "legacy_prompt_version" };
    expect(parsePromptDefinitionDetail(detail(legacy), "definition", "legacy").selectedVersion).toEqual(legacy);
    expect(parsePromptDefinitionDetail(detail(legacy)).selectedVersion.version).toBeUndefined();
    legacy.status = "";
    expect(parsePromptDefinitionDetail(detail(legacy)).selectedVersion.status).toBe("");
    legacy.parentVersionIds = ["legacy", "legacy"];
    legacy.readOnlyReason = "invalid_authored_version";
    expect(parsePromptDefinitionDetail(detail(legacy)).selectedVersion.parentVersionIds).toEqual(["legacy", "legacy"]);
  });
  it("requires selected versions to agree with their containing definition and catalog", () => {
    const missing = detail(); missing.versions[0].id = "different";
    rejectsProtocol(() => parsePromptDefinitionDetail(missing));
    const duplicate = detail(); duplicate.versions.push(duplicate.versions[0]);
    rejectsProtocol(() => parsePromptDefinitionDetail(duplicate));
    const wrongMetadata = detail(); wrongMetadata.versions[0].contentHash = "different";
    rejectsProtocol(() => parsePromptDefinitionDetail(wrongMetadata));
    rejectsProtocol(() => parsePromptDefinitionDetail(detail(), "other"));
    rejectsProtocol(() => parsePromptDefinitionDetail(detail(), "definition", "other"));
  });
  it("requires fresh saves to be drafts but permits a canonical replay lifecycle transition", () => {
    const active = stored(preview(input(), "definition", "active"));
    expect(parsePromptSaveResult({ version: active, replayed: true }, "definition", input()).version.status).toBe("active");
    rejectsProtocol(() => parsePromptSaveResult({ version: active, replayed: false }, "definition", input()));
    rejectsProtocol(() => parsePromptSaveResult({ version: { ...active, version: undefined }, replayed: true }));
  });
  it("checks saved source programs rather than only materialized hashes", () => {
    const original = composed(), changed = composed(); changed.composition.bindings.unused.value = 2;
    rejectsProtocol(() => parsePromptSaveResult({ version: stored(preview(changed)), replayed: true }, "definition", original));
    expect(parsePromptSaveResult({ version: stored(preview(original)), replayed: false }, "definition", original).version.authoring).toBe("composition");
  });
  it("preserves legacy resolve bytes while rejecting malformed resolution contracts", () => {
    expect(parsePromptResolution(resolution())).toEqual(resolution());
    rejectsProtocol(() => parsePromptResolution({ ...resolution(), appliedReleaseIds: [] }));
    rejectsProtocol(() => parsePromptResolution({ ...resolution(), resolutionFingerprint: "wrong" }));
    rejectsProtocol(() => parsePromptResolution({ ...resolution(), extra: "private" }));
  });
  it("never exposes arbitrary backend codes through the public error constructor", () => {
    const error = new OpenEvalsHttpError(403, "private_credential_value");
    expect(error.code).toBe("prompt_http_error");
    expect(error.message).not.toContain("private_credential_value");
  });
});

describe("checked prompt transport without real network access", () => {
  it("creates through the existing authenticated route and checks replay status correspondence", async () => {
    const definition = { id: "definition", stableKey: "stable", targetId: "target" };
    const fetch = vi.fn(async () => jsonResponse({ definition, replayed: false }, 201)); vi.stubGlobal("fetch", fetch);
    const client = new PromptClient("https://example.invalid", "fixture-only-key");
    expect(await client.createPromptDefinition(definition)).toEqual({ definition, replayed: false });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://example.invalid/api/v1/instructions");
    expect(options.redirect).toBe("error"); expect(options.headers.authorization).toBe("Bearer fixture-only-key");
    expect(JSON.parse(options.body)).toEqual(definition);
    fetch.mockImplementationOnce(async () => jsonResponse({ definition, replayed: false }, 200));
    await expect(client.createPromptDefinition(definition)).rejects.toMatchObject({ code: "prompt_protocol_error" });
  });
  it("encodes definition and selected-version paths and rejects dot segments before fetch", async () => {
    const saved = stored(preview(input(), "def/a?b")), raw = detail(saved); raw.definition.id = "def/a?b";
    const fetch = vi.fn(async () => jsonResponse(raw)); vi.stubGlobal("fetch", fetch);
    const client = new PromptClient("https://example.invalid/base/");
    await client.getPromptDefinition("def/a?b", "version");
    expect(fetch.mock.calls[0][0]).toBe("https://example.invalid/base/api/v1/instructions/def%2Fa%3Fb?versionId=version");
    for (const id of [".", ".."]) await expect(client.getPromptDefinition(id)).rejects.toMatchObject({ code: "prompt_request_invalid" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const dotSaved = stored(preview(input("."), "def/a?b")), dotDetail = detail(dotSaved); dotDetail.definition.id = "def/a?b";
    fetch.mockImplementationOnce(async () => jsonResponse(dotDetail));
    expect((await client.getPromptDefinition("def/a?b", ".")).selectedVersion.id).toBe(".");
    expect(fetch.mock.calls[1][0]).toBe("https://example.invalid/base/api/v1/instructions/def%2Fa%3Fb?versionId=.");
    fetch.mockImplementationOnce(async () => jsonResponse({ ...resolution(), versionId: ".." }));
    expect((await client.resolvePromptJson({ definitionId: ".", candidateVersionId: ".." })).versionId).toBe("..");
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ definitionId: ".", candidateVersionId: ".." });
  });
  it("posts normalized preview source and rejects a mismatched producer version", async () => {
    const fetch = vi.fn(async () => jsonResponse(preview())); vi.stubGlobal("fetch", fetch);
    const client = new PromptClient("https://example.invalid");
    expect(await client.previewPromptVersion("definition", input())).toEqual(preview());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(input());
    fetch.mockImplementationOnce(async () => jsonResponse(preview(input("other"))));
    await expect(client.previewPromptVersion("definition", input())).rejects.toMatchObject({ code: "prompt_protocol_error" });
  });
  it("sends one exact reviewed save request without creating IDs or retrying", async () => {
    const fetch = vi.fn(async () => jsonResponse({ version: stored(), replayed: false }, 201)); vi.stubGlobal("fetch", fetch);
    const client = new PromptClient("https://example.invalid");
    await client.savePromptVersion("definition", input(), "2".repeat(64));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ ...input(), previewFingerprint: "2".repeat(64) });
  });
  it("checks resolve JSON and never treats an HTTP error body as success", async () => {
    const fetch = vi.fn(async () => jsonResponse(resolution())); vi.stubGlobal("fetch", fetch);
    const client = new PromptClient("https://example.invalid");
    expect(await client.resolvePromptJson({ definitionId: "definition" })).toEqual(resolution());
    fetch.mockImplementationOnce(async () => jsonResponse({ error: "prompt_no_active_version" }, 409));
    await expect(client.resolvePromptJson({ definitionId: "definition" })).rejects.toMatchObject({ status: 409, code: "prompt_no_active_version" });
  });
  it("redacts unrecognized error bodies and transport exceptions", async () => {
    const fetch = vi.fn(async () => jsonResponse({ error: "private_credential_value" }, 403)); vi.stubGlobal("fetch", fetch);
    const client = new PromptClient("https://example.invalid");
    await expect(client.getPromptDefinition("definition")).rejects.toMatchObject({ status: 403, code: "prompt_http_error", message: "open_evals_http_error:403:prompt_http_error" });
    fetch.mockRejectedValueOnce(new Error("private_credential_value"));
    await expect(client.getPromptDefinition("definition")).rejects.toMatchObject({ status: 0, code: "prompt_network_error", message: "open_evals_http_error:0:prompt_network_error" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("propagates caller cancellation and a bounded transport deadline", async () => {
    const deadline = new AbortController(); vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    const fetch = vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("private_abort")), { once: true })));
    vi.stubGlobal("fetch", fetch);
    const client = new PromptClient("https://example.invalid"), caller = new AbortController();
    const cancelled = client.getPromptDefinition("definition", undefined, { signal: caller.signal }); caller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: "prompt_request_cancelled" });
    const timedOut = client.getPromptDefinition("definition"); deadline.abort();
    await expect(timedOut).rejects.toMatchObject({ code: "prompt_request_timeout" });
    expect(AbortSignal.timeout).toHaveBeenCalledWith(30000);
  });
  it("rejects non-JSON, malformed JSON and unexpected successful statuses", async () => {
    const fetch = vi.fn(async () => new Response("private html", { headers: { "content-type": "text/html" } })); vi.stubGlobal("fetch", fetch);
    const client = new PromptClient("https://example.invalid");
    await expect(client.getPromptDefinition("definition")).rejects.toMatchObject({ code: "prompt_protocol_error" });
    fetch.mockImplementationOnce(async () => new Response("{", { headers: { "content-type": "application/json" } }));
    await expect(client.getPromptDefinition("definition")).rejects.toMatchObject({ code: "prompt_protocol_error" });
    fetch.mockImplementationOnce(async () => jsonResponse(detail(), 201));
    await expect(client.getPromptDefinition("definition")).rejects.toMatchObject({ code: "prompt_protocol_error" });
  });
  it("enforces declared and streamed response byte limits and cancels oversized streams", async () => {
    const fetch = vi.fn(async () => jsonResponse(detail(), 200, { "content-length": String(33 * 1024 * 1024) })); vi.stubGlobal("fetch", fetch);
    const client = new PromptClient("https://example.invalid");
    await expect(client.getPromptDefinition("definition")).rejects.toMatchObject({ code: "prompt_response_too_large" });
    const cancel = vi.fn(), chunk = new Uint8Array(1024 * 1024); let sent = 0;
    // Pull only for reader demand, keeping the finite producer open until SDK cancellation.
    const stream = new ReadableStream({ pull(controller) { if (sent++ < 33) controller.enqueue(chunk); else controller.close(); }, cancel }, { highWaterMark: 0 });
    fetch.mockImplementationOnce(async () => new Response(stream, { headers: { "content-type": "application/json" } }));
    await expect(client.getPromptDefinition("definition")).rejects.toMatchObject({ code: "prompt_response_too_large" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

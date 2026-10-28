import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lstat, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  preparePromptDraft, type InstructionDetailDTO, type PromptDraftInput, type PromptDraftPreview, type StoredVersionDTO
} from "@open-evals/core";
import {
  PromptFileError, diffPromptDetails, makePromptReviewFile, readPromptDefinitionFile, readPromptDetailFile,
  readPromptDraftFile, readPromptReviewFile, writePromptJsonFile
} from "../src/prompt-files";

// T2: authored local files only. No server, provider or database calls.
let directory: string | undefined;
const endpoint = "http://127.0.0.1:3216";
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "open-evals-prompt-files-")); });
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });
function path(name: string) { return join(directory!, name); }
async function jsonFile(name: string, value: unknown) { const file = path(name); await writeFile(file, JSON.stringify(value), { mode: 0o600 }); return file; }
function draft(versionId = "version-a"): PromptDraftInput {
  return {
    versionId,
    components: [{ id: "role", kind: "role", locked: false, content: "Hello {{name}}." }],
    composition: {
      schemaVersion: "prompt-composition-v1",
      bindings: { name: { type: "string", value: "Ada" }, unused: { type: "string", value: "original" } },
      blocks: { unused: [{ op: "text", template: "Original unused block." }] }
    }
  };
}
function preview(input: PromptDraftInput): PromptDraftPreview {
  return preparePromptDraft(input, { workspaceId: "workspace", actorId: "actor", definitionId: "definition" });
}
function detail(input: PromptDraftInput): InstructionDetailDTO {
  const { version } = preview(input);
  const summary = { id: version.id, status: version.status, createdAt: "2026-10-28T00:00:00.000Z", parentVersionIds: version.parentVersionIds, contentHash: version.contentHash, authoring: version.compositionSnapshot ? "composition" as const : "literal" as const };
  return { definition: { id: "definition", stableKey: "instruction" }, versions: [summary], selectedVersion: { ...summary, compiledText: version.compiledText, version }, canWrite: true };
}
function legacy(text: string, hash: string): InstructionDetailDTO {
  const selectedVersion: StoredVersionDTO = { id: "legacy-version", status: "active", createdAt: "2026-10-28T00:00:00.000Z", parentVersionIds: [], contentHash: hash, authoring: "legacy", compiledText: text, readOnlyReason: "legacy_prompt_version" };
  const { compiledText: _, readOnlyReason: __, ...summary } = selectedVersion;
  return { definition: { id: "definition", stableKey: "instruction" }, versions: [summary], selectedVersion, canWrite: true };
}

describe("prompt files", () => {
  it("retains explicit creation identity and rejects server-owned creation fields", async () => {
    const input = { id: "definition", stableKey: "instruction", targetId: "target" };
    expect(await readPromptDefinitionFile(await jsonFile("definition.json", input))).toEqual(input);
    await expect(readPromptDefinitionFile(await jsonFile("owned.json", { ...input, workspaceId: "other" }))).rejects.toMatchObject({ code: "prompt_file_invalid" });
  });

  it("reads composed draft inputs without inventing IDs or parent/status fields", async () => {
    const input = draft();
    expect(await readPromptDraftFile(await jsonFile("draft.json", input))).toEqual(input);
    await expect(readPromptDraftFile(await jsonFile("status.json", { ...input, status: "active" }))).rejects.toMatchObject({ code: "prompt_file_invalid" });
  });

  it("rejects malformed JSON with a controlled error", async () => {
    await writeFile(path("broken.json"), '{"id":');
    await expect(readPromptDefinitionFile(path("broken.json"))).rejects.toMatchObject({ code: "prompt_file_json_invalid" });
  });

  it("rejects invalid UTF-8 that replacement decoding would turn into otherwise valid JSON", async () => {
    const bytes = Buffer.concat([Buffer.from('{"id":"definition","stableKey":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')]);
    await writeFile(path("utf8.json"), bytes);
    await expect(readPromptDefinitionFile(path("utf8.json"))).rejects.toMatchObject({ code: "prompt_file_json_invalid" });
  });

  it("bounds both input and reviewed-artifact file sizes before parsing", async () => {
    await writeFile(path("large-input.json"), Buffer.alloc(2 * 1024 * 1024 + 1));
    await writeFile(path("large-review.json"), Buffer.alloc(32 * 1024 * 1024 + 1));
    await expect(readPromptDraftFile(path("large-input.json"))).rejects.toMatchObject({ code: "prompt_file_too_large" });
    await expect(readPromptReviewFile(path("large-review.json"), endpoint)).rejects.toMatchObject({ code: "prompt_file_too_large" });
  });

  it("refuses symlink inputs and directory inputs", async () => {
    const file = await jsonFile("real.json", { id: "definition", stableKey: "instruction" });
    await symlink(file, path("linked.json"));
    await expect(readPromptDefinitionFile(path("linked.json"))).rejects.toMatchObject({ code: "prompt_file_read_failed" });
    await expect(readPromptDefinitionFile(directory!)).rejects.toMatchObject({ code: "prompt_file_read_failed" });
  });

  it("publishes a complete 0600 JSON artifact without leftover temporary files", async () => {
    const value = { source: "Authored private source." };
    expect(await writePromptJsonFile(path("out.json"), value)).toBe("created");
    expect(await readFile(path("out.json"), "utf8")).toBe(`${JSON.stringify(value, null, 2)}\n`);
    expect((await stat(path("out.json"))).mode & 0o777).toBe(0o600);
    expect(await readdir(directory!)).toEqual(["out.json"]);
  });

  it("replays identical private output bytes without replacing the inode", async () => {
    const value = { id: "stable" };
    await writePromptJsonFile(path("out.json"), value);
    const before = await stat(path("out.json"));
    expect(await writePromptJsonFile(path("out.json"), value)).toBe("unchanged");
    expect((await stat(path("out.json"))).ino).toBe(before.ino);
    expect(await readdir(directory!)).toEqual(["out.json"]);
  });

  it("never overwrites different existing contents and removes its own temporary file", async () => {
    await writeFile(path("out.json"), "keep original", { mode: 0o600 });
    await expect(writePromptJsonFile(path("out.json"), { replacement: true })).rejects.toMatchObject({ code: "prompt_file_exists" });
    expect(await readFile(path("out.json"), "utf8")).toBe("keep original");
    expect(await readdir(directory!)).toEqual(["out.json"]);
  });

  it("preserves an existing symlink destination and its target", async () => {
    await writeFile(path("target.json"), "keep target", { mode: 0o600 });
    await symlink(path("target.json"), path("out.json"));
    await expect(writePromptJsonFile(path("out.json"), { replacement: true })).rejects.toBeInstanceOf(PromptFileError);
    expect((await lstat(path("out.json"))).isSymbolicLink()).toBe(true);
    expect(await readFile(path("target.json"), "utf8")).toBe("keep target");
    expect((await readdir(directory!)).sort()).toEqual(["out.json", "target.json"]);
  });

  it("allows one complete winner when different writers race for the same path", async () => {
    const values = [{ winner: "first" }, { winner: "second" }];
    const attempts = await Promise.allSettled(values.map(value => writePromptJsonFile(path("out.json"), value)));
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(result => result.status === "rejected")).toHaveLength(1);
    const actual = JSON.parse(await readFile(path("out.json"), "utf8"));
    expect(values).toContainEqual(actual);
    expect((await stat(path("out.json"))).mode & 0o777).toBe(0o600);
    expect(await readdir(directory!)).toEqual(["out.json"]);
  });

  it("binds reviews to the normalized independently configured endpoint", async () => {
    const input = draft(), reviewed = makePromptReviewFile(`${endpoint}/`, "definition", input, preview(input));
    const file = await jsonFile("review.json", reviewed);
    expect(await readPromptReviewFile(file, endpoint)).toEqual(reviewed);
    await expect(readPromptReviewFile(file, "http://127.0.0.1:9999")).rejects.toMatchObject({ code: "prompt_review_endpoint_mismatch" });
  });

  it("rejects a review whose unused input binding no longer matches its server preview", async () => {
    const input = draft(), reviewed = JSON.parse(JSON.stringify(makePromptReviewFile(endpoint, "definition", input, preview(input))));
    reviewed.input.composition.bindings.unused.value = "altered";
    await expect(readPromptReviewFile(await jsonFile("tampered.json", reviewed), endpoint)).rejects.toMatchObject({ code: "prompt_file_invalid" });
  });

  it("loads historical text and demonstration hashes without reconstructing source", async () => {
    const original = legacy("Historical text.", "original-demo-hash");
    const loaded = await readPromptDetailFile(await jsonFile("pull.json", original));
    expect(loaded).toEqual(original);
    expect(loaded.selectedVersion?.version).toBeUndefined();
  });

  it("diffs an unused binding even when the rendered text and hash match", () => {
    const left = draft("left"), right: PromptDraftInput = { ...draft("right"), composition: { ...draft().composition!, bindings: { ...draft().composition!.bindings, unused: { type: "string", value: "changed" } } } };
    const difference = diffPromptDetails(detail(left), detail(right));
    expect(difference).toMatchObject({ hasDifferences: true, compiledTextChanged: false, contentHashChanged: false, sourceComparison: "verified", sourceChanged: true });
    expect(difference.sourceChanges?.bindings).toEqual([{ name: "unused", before: { type: "string", value: "original" }, after: { type: "string", value: "changed" } }]);
  });

  it("diffs unused library entries independently of the compiled result", () => {
    const left = draft("left"), right: PromptDraftInput = { ...draft("right"), composition: { ...draft().composition!, blocks: { unused: [{ op: "text", template: "Changed unused block." }] } } };
    const difference = diffPromptDetails(detail(left), detail(right));
    expect(difference).toMatchObject({ compiledTextChanged: false, contentHashChanged: false, sourceChanged: true });
    expect(difference.sourceChanges?.blocks).toEqual([{ name: "unused", before: [{ op: "text", template: "Original unused block." }], after: [{ op: "text", template: "Changed unused block." }] }]);
  });

  it("reports real component order changes with before and after positions", () => {
    const components = [{ id: "first", kind: "role", locked: false, content: "First." }, { id: "second", kind: "rules", locked: false, content: "Second." }];
    const difference = diffPromptDetails(detail({ versionId: "left", components }), detail({ versionId: "right", components: [...components].reverse() }));
    expect(difference.compiledTextChanged).toBe(true);
    expect(difference.componentChanges?.map(change => [change.id, change.beforeIndex, change.afterIndex])).toEqual([["first", 0, 1], ["second", 1, 0]]);
    expect(difference.sourceChanges?.components).toHaveLength(2);
  });

  it("reports literal-to-composition source mode changes with identical rendered output", () => {
    const literal: PromptDraftInput = { versionId: "literal", components: [{ id: "role", kind: "role", locked: false, content: "Same text." }] };
    const composed: PromptDraftInput = { ...literal, versionId: "composed", composition: { schemaVersion: "prompt-composition-v1", bindings: {}, blocks: {} } };
    expect(diffPromptDetails(detail(literal), detail(composed))).toMatchObject({ compiledTextChanged: false, contentHashChanged: false, sourceChanged: true, sourceChanges: { modeChanged: true } });
  });

  it("keeps source comparison explicitly unknown for legacy records", () => {
    const difference = diffPromptDetails(legacy("Before.", "old-hash"), legacy("After.", "new-hash"));
    expect(difference).toMatchObject({ hasDifferences: true, compiledTextChanged: true, contentHashChanged: true, sourceComparison: "unavailable_legacy", sourceChanged: null, componentChanges: null, sourceChanges: null });
  });
});

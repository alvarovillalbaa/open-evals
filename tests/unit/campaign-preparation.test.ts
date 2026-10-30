import { describe, expect, it } from "vitest";
import {
  preparePromptCampaignRequest, validateCampaignPreparationInput
} from "../../packages/core/src/campaign-preparation";
import { stableHash, stableStringify } from "../../packages/core/src/hash";
import { compilePromptVersion } from "../../packages/core/src/prompt";
import { promptVersionSemanticFingerprint, type PromptAuthoringContext } from "../../packages/core/src/prompt-authoring";
import type { PromptVersion } from "../../packages/core/src/types";

const requestId = "11111111-2222-4333-8444-555555555555";
const context: PromptAuthoringContext = { workspaceId: "workspace-a", actorId: "actor-a", definitionId: "definition-a" };
const request = { requestId, baselineVersionId: "baseline-a", componentId: "decision-rules", objective: "Clarify incomplete tool actions." };
const expectedOperations = [
  "delete_one_instruction", "split_instruction", "rewrite_one_instruction",
  "strictness_tighten", "strictness_relax", "order_test"
];

function baseline(options: { id?: string; definitionId?: string; content?: string; status?: PromptVersion["status"] } = {}): PromptVersion {
  return compilePromptVersion({
    id: options.id ?? "baseline-a", definitionId: options.definitionId ?? "definition-a", status: options.status ?? "active",
    components: [
      { id: "safety", kind: "policy", locked: true, content: "SECRET SAFETY TEXT: Never claim unconfirmed completion." },
      { id: "decision-rules", kind: "instruction", locked: false, content: options.content ?? "SECRET PROMPT TEXT: Check tools. Explain failures." },
      { id: "response", kind: "style", locked: false, content: "SECRET RESPONSE TEXT: Be concise." }
    ]
  });
}

function composed(binding = "SECRET UNUSED BINDING"): PromptVersion {
  return compilePromptVersion({
    id: "baseline-a", definitionId: "definition-a",
    components: [{ id: "decision-rules", kind: "instruction", locked: false, operations: [{ op: "text", template: "PRIVATE COMPOSITION SOURCE" }] }],
    composition: { schemaVersion: "prompt-composition-v1", bindings: { unused: { type: "string", value: binding } }, blocks: {} }
  });
}

describe("campaign preparation input", () => {
  it("returns a detached frozen exact request", () => {
    const source = { ...request };
    const input = validateCampaignPreparationInput(source);
    expect(input).toEqual(request);
    expect(input).not.toBe(source);
    expect(Object.isFrozen(input)).toBe(true);
    source.objective = "changed after validation";
    expect(input.objective).toBe(request.objective);
  });

  it("accepts a data-only null-prototype request", () => {
    const source = Object.assign(Object.create(null), request);
    expect(validateCampaignPreparationInput(source)).toEqual(request);
  });

  it("rejects non-record request shapes", () => {
    for (const value of [null, undefined, [], "request", 1, new Date(), () => request]) {
      expect(() => validateCampaignPreparationInput(value)).toThrow();
    }
  });

  it("requires every field and rejects unknown or symbol properties", () => {
    for (const key of Object.keys(request)) {
      const value: Record<string, unknown> = { ...request };
      delete value[key];
      expect(() => validateCampaignPreparationInput(value)).toThrow();
    }
    expect(() => validateCampaignPreparationInput({ ...request, workspaceId: "spoofed" })).toThrow();
    expect(() => validateCampaignPreparationInput({ ...request, [Symbol("extra")]: true })).toThrow();
  });

  it("rejects accessors without evaluating them and rejects hidden properties", () => {
    let calls = 0;
    const accessor = { ...request };
    Object.defineProperty(accessor, "objective", { enumerable: true, get() { calls++; return "injected"; } });
    expect(() => validateCampaignPreparationInput(accessor)).toThrow();
    expect(calls).toBe(0);
    expect(() => validateCampaignPreparationInput(Object.defineProperty({ ...request }, "objective", { value: "hidden", enumerable: false }))).toThrow();
  });

  it("requires a lowercase hyphenated UUID", () => {
    for (const value of [requestId.toUpperCase().replace("11111111", "ABCDEFAB"), "not-a-uuid", `{${requestId}}`, requestId.replaceAll("-", ""), "", 7]) {
      expect(() => validateCampaignPreparationInput({ ...request, requestId: value })).toThrow();
    }
  });

  it("rejects invalid baseline and component identities", () => {
    for (const key of ["baselineVersionId", "componentId"]) {
      for (const value of ["", " leading", "trailing ", "constructor", "x".repeat(129), "a\nb", "a\u0000b", "a\ud800", "a\udc00", null]) {
        expect(() => validateCampaignPreparationInput({ ...request, [key]: value })).toThrow();
      }
    }
  });

  it("rejects absent non-string and empty objectives", () => {
    for (const objective of [undefined, null, {}, [], 1, ""]) {
      expect(() => validateCampaignPreparationInput({ ...request, objective })).toThrow();
    }
  });

  it("enforces the inclusive 2048-byte ASCII objective limit", () => {
    expect(validateCampaignPreparationInput({ ...request, objective: "a".repeat(2048) }).objective).toHaveLength(2048);
    expect(() => validateCampaignPreparationInput({ ...request, objective: "a".repeat(2049) })).toThrow();
  });

  it("charges objective UTF-8 bytes rather than UTF-16 length", () => {
    expect(validateCampaignPreparationInput({ ...request, objective: "🌱".repeat(512) }).objective).toBe("🌱".repeat(512));
    expect(() => validateCampaignPreparationInput({ ...request, objective: "🌱".repeat(512) + "a" })).toThrow();
    expect(() => validateCampaignPreparationInput({ ...request, objective: "é".repeat(1025) })).toThrow();
  });

  it("rejects NUL and unpaired surrogates before persistence", () => {
    for (const objective of ["a\u0000b", "a\ud800", "a\udc00", "\ud800x", "\ud800\ud800"]) {
      expect(() => validateCampaignPreparationInput({ ...request, objective })).toThrow();
    }
    expect(validateCampaignPreparationInput({ ...request, objective: "Évaluer 🌱" }).objective).toBe("Évaluer 🌱");
  });

  it("preserves valid objective whitespace and line breaks exactly", () => {
    const objective = "  Focus on tool failures.\nKeep safety intact.  ";
    expect(validateCampaignPreparationInput({ ...request, objective }).objective).toBe(objective);
  });
});

describe("pending prompt campaign preparation", () => {
  it("describes exactly six draft hypothesis operations with zero execution limits", () => {
    const prepared = preparePromptCampaignRequest(request, context, baseline());
    expect(prepared.approvalId).toBe(`campaign_request_${requestId}`);
    expect(prepared.payloadPreview).toMatchObject({
      schemaVersion: "prompt-ablation-request-v1", ...context, ...request,
      requestedOperations: expectedOperations,
      limits: { providerCalls: 0, targetCalls: 0, judgeCalls: 0, releaseChanges: 0 },
      candidateStatus: "draft", evidenceLevel: "hypothesis only"
    });
    expect(prepared.payloadPreview.requestedOperations).toHaveLength(6);
    expect(prepared).not.toHaveProperty("status");
    expect(prepared).not.toHaveProperty("createdAt");
    expect(prepared).not.toHaveProperty("candidates");
  });

  it("binds canonical baseline semantics and hashes the complete payload", () => {
    const base = baseline();
    const prepared = preparePromptCampaignRequest(request, context, base);
    expect(prepared.payloadPreview.baselineSemanticFingerprint).toBe(promptVersionSemanticFingerprint(base));
    expect(prepared.payloadPreview.baselineContentHash).toBe(base.contentHash);
    const { requestFingerprint, ...intent } = prepared.payloadPreview;
    expect(requestFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(requestFingerprint).toBe(stableHash(intent, 64));
    expect(prepared.requestFingerprint).toBe(requestFingerprint);
    expect(prepared.payloadHash).toBe(stableHash(prepared.payloadPreview, 64));
  });

  it("is deterministic across equivalent objects and key order", () => {
    const first = preparePromptCampaignRequest(request, context, baseline());
    const second = preparePromptCampaignRequest({ objective: request.objective, componentId: request.componentId, baselineVersionId: request.baselineVersionId, requestId }, { definitionId: context.definitionId, actorId: context.actorId, workspaceId: context.workspaceId }, baseline());
    expect(second).toEqual(first);
  });

  it("binds the server workspace and actor to review fingerprints", () => {
    const prepared = preparePromptCampaignRequest(request, context, baseline());
    for (const owner of [{ ...context, workspaceId: "workspace-b" }, { ...context, actorId: "actor-b" }]) {
      const changed = preparePromptCampaignRequest(request, owner, baseline());
      expect(changed.requestFingerprint).not.toBe(prepared.requestFingerprint);
      expect(changed.payloadHash).not.toBe(prepared.payloadHash);
      expect(changed.approvalId).toBe(prepared.approvalId);
    }
  });

  it("binds request identity objective component and baseline identity", () => {
    const first = preparePromptCampaignRequest(request, context, baseline());
    const changed = [
      preparePromptCampaignRequest({ ...request, requestId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }, context, baseline()),
      preparePromptCampaignRequest({ ...request, objective: "Different objective" }, context, baseline()),
      preparePromptCampaignRequest({ ...request, componentId: "response" }, context, baseline()),
      preparePromptCampaignRequest({ ...request, baselineVersionId: "baseline-b" }, context, baseline({ id: "baseline-b" }))
    ];
    for (const next of changed) expect(next.requestFingerprint).not.toBe(first.requestFingerprint);
  });

  it("changes the reviewed fingerprint when canonical baseline semantics change", () => {
    const first = preparePromptCampaignRequest(request, context, baseline());
    const changed = preparePromptCampaignRequest(request, context, baseline({ content: "A revised canonical instruction." }));
    expect(changed.requestFingerprint).not.toBe(first.requestFingerprint);
    expect(changed.payloadPreview.baselineSemanticFingerprint).not.toBe(first.payloadPreview.baselineSemanticFingerprint);
    expect(changed.payloadHash).not.toBe(first.payloadHash);
  });

  it("keeps review identity stable through lifecycle-only transitions", () => {
    const active = preparePromptCampaignRequest(request, context, baseline({ status: "active" }));
    const retired = preparePromptCampaignRequest(request, context, baseline({ status: "retired" }));
    expect(retired).toEqual(active);
  });

  it("rejects a different baseline version or definition", () => {
    expect(() => preparePromptCampaignRequest(request, context, baseline({ id: "baseline-b" }))).toThrow("baseline_identity_mismatch");
    expect(() => preparePromptCampaignRequest(request, context, baseline({ definitionId: "definition-b" }))).toThrow("baseline_definition_mismatch");
  });

  it("rejects missing and locked selected components", () => {
    expect(() => preparePromptCampaignRequest({ ...request, componentId: "missing" }, context, baseline())).toThrow("component_not_found");
    expect(() => preparePromptCampaignRequest({ ...request, componentId: "safety" }, context, baseline())).toThrow("locked_component");
  });

  it("rejects stale hashes malformed source and accessor baselines", () => {
    const base = baseline();
    expect(() => preparePromptCampaignRequest(request, context, { ...base, contentHash: "stale" })).toThrow();
    expect(() => preparePromptCampaignRequest(request, context, { ...base, compiledText: "different" })).toThrow();
    expect(() => preparePromptCampaignRequest(request, context, { ...base, extra: true } as PromptVersion)).toThrow();
    let calls = 0;
    const accessor = { ...base };
    Object.defineProperty(accessor, "components", { enumerable: true, get() { calls++; return base.components; } });
    expect(() => preparePromptCampaignRequest(request, context, accessor)).toThrow();
    expect(calls).toBe(0);
  });

  it("binds unused composition source even when rendered prompt text is unchanged", () => {
    const firstBase = composed(), secondBase = composed("CHANGED UNUSED BINDING");
    expect(secondBase.contentHash).toBe(firstBase.contentHash);
    const first = preparePromptCampaignRequest(request, context, firstBase);
    const second = preparePromptCampaignRequest(request, context, secondBase);
    expect(second.payloadPreview.baselineSemanticFingerprint).not.toBe(first.payloadPreview.baselineSemanticFingerprint);
    expect(second.requestFingerprint).not.toBe(first.requestFingerprint);
  });

  it("omits raw prompt source bindings and candidate bodies from persisted metadata", () => {
    const literal = preparePromptCampaignRequest(request, context, baseline());
    const composition = preparePromptCampaignRequest(request, context, composed());
    for (const prepared of [literal, composition]) {
      expect(Object.keys(prepared.payloadPreview).sort()).toEqual([
        "schemaVersion", "workspaceId", "actorId", "definitionId", "requestId", "baselineVersionId", "componentId", "objective",
        "baselineSemanticFingerprint", "baselineContentHash", "requestedOperations", "limits", "candidateStatus", "evidenceLevel", "requestFingerprint"
      ].sort());
      const json = JSON.stringify(prepared.payloadPreview);
      expect(json).not.toContain("SECRET");
      expect(json).not.toContain("PRIVATE COMPOSITION SOURCE");
      expect(prepared.payloadPreview).not.toHaveProperty("compiledText");
      expect(prepared.payloadPreview).not.toHaveProperty("components");
      expect(prepared.payloadPreview).not.toHaveProperty("bindings");
    }
  });

  it("rejects malformed server contexts without evaluating getters", () => {
    const base = baseline();
    for (const owner of [null, { ...context, projectId: "spoof" }, { ...context, actorId: "a\ud800" }, { ...context, workspaceId: "x\u0000y" }, { ...context, definitionId: undefined }]) {
      expect(() => preparePromptCampaignRequest(request, owner as PromptAuthoringContext, base)).toThrow();
    }
    let calls = 0;
    const owner = { ...context };
    Object.defineProperty(owner, "actorId", { enumerable: true, get() { calls++; return "spoof"; } });
    expect(() => preparePromptCampaignRequest(request, owner, base)).toThrow();
    expect(calls).toBe(0);
  });

  it("deeply freezes preparation without mutating the supplied intent or baseline", () => {
    const source = { ...request }, owner = { ...context }, base = baseline();
    const before = stableStringify({ source, owner, base });
    const prepared = preparePromptCampaignRequest(source, owner, base);
    expect(stableStringify({ source, owner, base })).toBe(before);
    for (const value of [prepared, prepared.input, prepared.payloadPreview, prepared.payloadPreview.requestedOperations, prepared.payloadPreview.limits]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    source.objective = "changed";
    owner.actorId = "changed";
    expect(prepared.payloadPreview.objective).toBe(request.objective);
    expect(prepared.payloadPreview.actorId).toBe(context.actorId);
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(owner)).toBe(false);
  });
});

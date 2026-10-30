import type { PromptAuthoringContext } from "./prompt-authoring";
import type { PromptVersion } from "./types";
import { stableHash } from "./hash";
import { promptVersionSemanticFingerprint } from "./prompt-authoring";
import { freezePromptValue, promptField, promptIdentity, promptRecord } from "./prompt-composition";

const SCHEMA = "prompt-ablation-request-v1";
const encoder = new TextEncoder();
const operations = [
  "delete_one_instruction", "split_instruction", "rewrite_one_instruction",
  "strictness_tighten", "strictness_relax", "order_test"
] as const;

export type CampaignPreparationOperation = typeof operations[number];

export interface CampaignPreparationInput {
  readonly requestId: string;
  readonly baselineVersionId: string;
  readonly componentId: string;
  readonly objective: string;
}

export interface CampaignPreparationLimits {
  readonly providerCalls: 0;
  readonly targetCalls: 0;
  readonly judgeCalls: 0;
  readonly releaseChanges: 0;
}

export interface CampaignRequestPayload extends CampaignPreparationInput, PromptAuthoringContext {
  readonly schemaVersion: "prompt-ablation-request-v1";
  readonly baselineSemanticFingerprint: string;
  readonly baselineContentHash: string;
  readonly requestedOperations: readonly CampaignPreparationOperation[];
  readonly limits: CampaignPreparationLimits;
  readonly candidateStatus: "draft";
  readonly evidenceLevel: "hypothesis only";
  readonly requestFingerprint: string;
}

export interface PreparedPromptCampaignRequest {
  readonly input: CampaignPreparationInput;
  readonly approvalId: string;
  readonly requestFingerprint: string;
  readonly payloadHash: string;
  readonly payloadPreview: CampaignRequestPayload;
}

/** Public projection; storage supplies the decision state and creation time. */
export interface CampaignRequestDTO {
  readonly id: string;
  readonly requestId: string;
  readonly definitionId: string;
  readonly baselineVersionId: string;
  readonly componentId: string;
  readonly objective: string;
  readonly payloadHash: string;
  readonly requestFingerprint: string;
  readonly baselineContentHash: string;
  readonly baselineSemanticFingerprint: string;
  readonly requestedOperations: readonly CampaignPreparationOperation[];
  readonly limits: CampaignPreparationLimits;
  readonly status: "pending" | "approved" | "rejected" | "expired";
  readonly createdAt: string;
  readonly baselineVerified: boolean;
}

function persistableString(value: string): string {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0) throw new TypeError("campaign_request:unpersistable_unicode");
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError("campaign_request:unpersistable_unicode");
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new TypeError("campaign_request:unpersistable_unicode");
  }
  return value;
}

function identity(value: unknown, label: string): string {
  return persistableString(promptIdentity(value, label));
}

/** Validates exact request intent without retaining caller-owned objects. */
export function validateCampaignPreparationInput(value: unknown): CampaignPreparationInput {
  const input = promptRecord(value, "campaign_request", ["requestId", "baselineVersionId", "componentId", "objective"]);
  const requestId = promptField(input, "requestId", "campaign_request");
  if (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId)) {
    throw new TypeError("campaign_request:lowercase_uuid_required");
  }
  const objective = promptField(input, "objective", "campaign_request");
  if (typeof objective !== "string") throw new TypeError("campaign_request:objective_string_required");
  // Bound allocation before UTF-8 encoding; every UTF-16 code unit needs at least one byte.
  if (!objective.length || objective.length > 2048) throw new RangeError("campaign_request:objective_byte_budget");
  persistableString(objective);
  if (encoder.encode(objective).length > 2048) throw new RangeError("campaign_request:objective_byte_budget");
  return freezePromptValue({
    requestId,
    baselineVersionId: identity(promptField(input, "baselineVersionId", "campaign_request"), "baseline_version_id"),
    componentId: identity(promptField(input, "componentId", "campaign_request"), "component_id"),
    objective
  });
}

/** Describes a pending review only; it does not decide, start, or generate a campaign. */
export function preparePromptCampaignRequest(
  value: unknown, context: PromptAuthoringContext, base: PromptVersion
): PreparedPromptCampaignRequest {
  const input = validateCampaignPreparationInput(value);
  const record = promptRecord(context, "authoring_context", ["workspaceId", "actorId", "definitionId"]);
  const owner = {
    workspaceId: identity(promptField(record, "workspaceId", "authoring_context"), "workspace_id"),
    actorId: identity(promptField(record, "actorId", "authoring_context"), "actor_id"),
    definitionId: identity(promptField(record, "definitionId", "authoring_context"), "definition_id")
  };
  // This helper reconstitutes canonical source, checks its hashes and PostgreSQL-safe strings.
  const baselineSemanticFingerprint = promptVersionSemanticFingerprint(base);
  if (base.definitionId !== owner.definitionId) throw new TypeError("campaign_request:baseline_definition_mismatch");
  if (base.id !== input.baselineVersionId) throw new TypeError("campaign_request:baseline_identity_mismatch");
  const component = base.components.find(item => item.id === input.componentId);
  if (!component) throw new TypeError("campaign_request:component_not_found");
  if (component.locked) throw new TypeError("campaign_request:locked_component");
  const intent = {
    schemaVersion: SCHEMA, ...owner, ...input,
    baselineSemanticFingerprint, baselineContentHash: base.contentHash,
    requestedOperations: [...operations],
    limits: { providerCalls: 0, targetCalls: 0, judgeCalls: 0, releaseChanges: 0 },
    candidateStatus: "draft", evidenceLevel: "hypothesis only"
  } as const;
  const requestFingerprint = stableHash(intent, 64);
  const payloadPreview: CampaignRequestPayload = { ...intent, requestFingerprint };
  return freezePromptValue({
    input, approvalId: `campaign_request_${input.requestId}`, requestFingerprint,
    payloadHash: stableHash(payloadPreview, 64), payloadPreview
  });
}

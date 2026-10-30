import {
  decodePromptVersionRow, preparePromptCampaignRequest, stableHash, stableStringify,
  validateCampaignPreparationInput,
  type CampaignRequestDTO, type PreparedPromptCampaignRequest, type PromptVersion,
} from "@open-evals/core";
import {
  getPromptAuthoringDetail, listPromptCampaignRequests, savePromptCampaignRequest,
  type PromptAuthoringScope, type PromptCampaignRequestRow, type PromptVersionRow,
} from "@open-evals/db";
import { InstructionRequestError } from "./instruction-request";

export async function previewCampaignRequest(scope: PromptAuthoringScope, definitionId: string, value: unknown) {
  const input = requestInput(value);
  const base = await loadBase(scope, definitionId, input.baselineVersionId);
  return prepare(input, scope, definitionId, base);
}

export async function saveCampaignRequest(scope: PromptAuthoringScope, definitionId: string, value: unknown) {
  if (!object(value)) throw new InstructionRequestError(400, "campaign_request_object_required");
  const body = value as Record<string, unknown>;
  if (typeof body.previewFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(body.previewFingerprint)) {
    throw new InstructionRequestError(400, "campaign_preview_fingerprint_required");
  }
  const input = requestInput(Object.fromEntries(Object.entries(body).filter(([key]) => key !== "previewFingerprint")));
  let base: PromptVersion | undefined;
  const saved = await savePromptCampaignRequest({
    scope, definitionId, baselineVersionId: input.baselineVersionId, requestId: input.requestId,
    previewFingerprint: body.previewFingerprint,
    prepare(row) {
      base = canonicalBase(row);
      const reviewed = prepare(input, scope, definitionId, base);
      if (reviewed.payloadHash !== body.previewFingerprint) throw new InstructionRequestError(409, "campaign_preview_stale");
      return { payloadHash: reviewed.payloadHash, requestFingerprint: reviewed.requestFingerprint, payloadPreview: { ...reviewed.payloadPreview } };
    },
    verifyReplay(row, prepared) {
      if (stableHash(row.payloadPreview, 64) !== prepared.payloadHash
        || stableStringify(row.payloadPreview) !== stableStringify(prepared.payloadPreview)) {
        throw new InstructionRequestError(409, "campaign_request_identity_conflict");
      }
    },
  });
  if (!base) throw new InstructionRequestError(500, "campaign_request_failed");
  return { request: projectRequest(saved.row, scope, definitionId, base), replayed: saved.replayed };
}

export async function loadCampaignRequests(
  scope: PromptAuthoringScope, definitionId: string, baselineVersionId: string, requestId?: string,
) {
  const base = await loadBase(scope, definitionId, baselineVersionId);
  const result = await listPromptCampaignRequests({ scope, definitionId, baselineVersionId, ...(requestId === undefined ? {} : { requestId }) });
  return { requests: result.rows.map(row => projectRequest(row, scope, definitionId, base)), hasMore: result.hasMore };
}

async function loadBase(scope: PromptAuthoringScope, definitionId: string, versionId: string) {
  const detail = await getPromptAuthoringDetail({ scope, definitionId, versionId });
  if (!detail) throw new InstructionRequestError(404, "prompt_definition_not_found");
  if (!detail.selectedVersion) throw new InstructionRequestError(404, "prompt_base_version_not_found");
  return canonicalBase(detail.selectedVersion);
}

function canonicalBase(row: PromptVersionRow): PromptVersion {
  const version = decodePromptVersionRow(row).version;
  if (!version) throw new InstructionRequestError(422, "prompt_base_version_read_only");
  return version;
}

function requestInput(value: unknown) {
  try { return validateCampaignPreparationInput(value); }
  catch { throw new InstructionRequestError(422, "campaign_request_input_invalid"); }
}

function prepare(value: unknown, scope: PromptAuthoringScope, definitionId: string, base: PromptVersion): PreparedPromptCampaignRequest {
  try {
    return preparePromptCampaignRequest(value, { workspaceId: scope.workspaceId, actorId: scope.actorId, definitionId }, base);
  } catch { throw new InstructionRequestError(422, "campaign_request_baseline_or_component_invalid"); }
}

/** A saved status is evidence only; this projection never grants execution authority. */
function projectRequest(row: PromptCampaignRequestRow, scope: PromptAuthoringScope, definitionId: string, base: PromptVersion): CampaignRequestDTO {
  try {
    const payload = object(row.payloadPreview);
    if (!payload || row.workspaceId !== scope.workspaceId || row.action !== "start_optimization_campaign"
      || !["pending", "approved", "rejected", "expired"].includes(row.status)) throw new Error();
    const reviewed = preparePromptCampaignRequest({
      requestId: payload.requestId, baselineVersionId: payload.baselineVersionId,
      componentId: payload.componentId, objective: payload.objective,
    }, { workspaceId: scope.workspaceId, actorId: row.requesterId, definitionId }, base);
    if (reviewed.approvalId !== row.id || reviewed.payloadHash !== row.payloadHash
      || stableHash(payload, 64) !== row.payloadHash || stableStringify(payload) !== stableStringify(reviewed.payloadPreview)) throw new Error();
    const time = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
    if (!Number.isFinite(time.getTime())) throw new Error();
    return {
      id: row.id, requestId: reviewed.input.requestId, definitionId,
      baselineVersionId: reviewed.input.baselineVersionId, componentId: reviewed.input.componentId,
      objective: reviewed.input.objective, payloadHash: row.payloadHash, requestFingerprint: reviewed.requestFingerprint,
      baselineContentHash: reviewed.payloadPreview.baselineContentHash,
      baselineSemanticFingerprint: reviewed.payloadPreview.baselineSemanticFingerprint,
      requestedOperations: reviewed.payloadPreview.requestedOperations, limits: reviewed.payloadPreview.limits,
      status: row.status as CampaignRequestDTO["status"], createdAt: time.toISOString(), baselineVerified: true,
    };
  } catch { throw new InstructionRequestError(409, "campaign_request_invalid_or_stale"); }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

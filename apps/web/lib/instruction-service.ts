import {
  decodePromptVersionRow,
  encodePromptVersionStorage,
  fingerprintPromptDraftRequest,
  inspectPromptVersionStorage,
  preparePromptDraft,
  promptDraftInputFromVersion,
  validatePromptDraftInput,
  type InstructionDetailDTO,
  type PromptDraftInput,
  type PromptVersion,
  type StoredVersionDTO,
  type VersionSummary
} from "@open-evals/core";
import {
  getPromptAuthoringDetail,
  savePromptAuthoringVersion,
  type PromptAuthoringScope,
  type PromptVersionRow,
  type PromptVersionSummaryRow
} from "@open-evals/db";
import { InstructionRequestError } from "./instruction-request";

/** These functions accept only a server-authorized scope, never request identity fields. */
export async function getInstructionDetail(
  scope: PromptAuthoringScope,
  definitionId: string,
  versionId: string | undefined,
  canWrite: boolean
): Promise<InstructionDetailDTO> {
  const detail = await getPromptAuthoringDetail({ scope, definitionId, versionId });
  if (!detail) throw new InstructionRequestError(404, "prompt_definition_not_found");
  if (versionId && !detail.selectedVersion) throw new InstructionRequestError(404, "prompt_version_not_found");
  return {
    definition: {
      id: detail.definition.id,
      stableKey: detail.definition.stableKey,
      ...(detail.definition.targetId ? { targetId: detail.definition.targetId } : {})
    },
    versions: detail.versions.map(versionSummary),
    selectedVersion: detail.selectedVersion ? decodePromptVersionRow(detail.selectedVersion) : null,
    canWrite
  };
}

export async function previewInstructionVersion(scope: PromptAuthoringScope, definitionId: string, value: unknown) {
  const input = draftInput(value);
  const detail = await getPromptAuthoringDetail({ scope, definitionId, versionId: input.baseVersionId });
  if (!detail) throw new InstructionRequestError(404, "prompt_definition_not_found");
  if (!input.baseVersionId && detail.versions.length) throw new InstructionRequestError(409, "prompt_base_version_required");
  const base = input.baseVersionId ? canonicalBase(detail.selectedVersion) : undefined;
  return compileDraft(input, scope, definitionId, base);
}

export async function saveInstructionVersion(scope: PromptAuthoringScope, definitionId: string, value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InstructionRequestError(400, "prompt_save_object_required");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.previewFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(record.previewFingerprint)) {
    throw new InstructionRequestError(400, "prompt_preview_fingerprint_required");
  }
  const input = draftInput(Object.fromEntries(Object.entries(record).filter(([key]) => key !== "previewFingerprint")));
  const context = { workspaceId: scope.workspaceId, actorId: scope.actorId, definitionId };
  let requestFingerprint: string;
  try {
    requestFingerprint = fingerprintPromptDraftRequest(input, context);
  } catch {
    throw new InstructionRequestError(422, "prompt_source_invalid");
  }
  const previewFingerprint = record.previewFingerprint;
  const result = await savePromptAuthoringVersion({
    scope,
    definitionId,
    versionId: input.versionId,
    baseVersionId: input.baseVersionId,
    requestFingerprint,
    previewFingerprint,
    verifyReplay(row) {
      const dto = decodePromptVersionRow(row);
      if (!dto.version) throw new InstructionRequestError(409, "prompt_version_identity_conflict");
      const storage = inspectPromptVersionStorage(row.components);
      if (storage.write.actorId !== scope.actorId
        || storage.write.requestFingerprint !== requestFingerprint
        || storage.write.previewFingerprint !== previewFingerprint
        || fingerprintPromptDraftRequest(promptDraftInputFromVersion(dto.version), context) !== requestFingerprint) {
        throw new InstructionRequestError(409, "prompt_version_identity_conflict");
      }
    },
    prepare(baseRow) {
      const base = input.baseVersionId ? canonicalBase(baseRow) : undefined;
      const preview = compileDraft(input, scope, definitionId, base);
      if (preview.previewFingerprint !== previewFingerprint) throw new InstructionRequestError(409, "prompt_preview_stale");
      const storage = encodePromptVersionStorage(preview, context);
      return {
        compiledText: preview.version.compiledText,
        components: storage,
        parentVersionIds: [...preview.version.parentVersionIds],
        contentHash: preview.version.contentHash,
        requestFingerprint: preview.requestFingerprint,
        previewFingerprint: preview.previewFingerprint,
        auditMetadata: { sourceFingerprint: storage.sourceFingerprint, componentCount: preview.version.components.length }
      };
    }
  });
  const version: StoredVersionDTO = decodePromptVersionRow(result.row);
  if (!version.version) throw new InstructionRequestError(500, "prompt_saved_version_invalid");
  return { version, replayed: result.replayed };
}

function draftInput(value: unknown): PromptDraftInput {
  try {
    return validatePromptDraftInput(value);
  } catch {
    throw new InstructionRequestError(422, "prompt_source_invalid");
  }
}

function canonicalBase(row: PromptVersionRow | null | undefined): PromptVersion {
  if (!row) throw new InstructionRequestError(404, "prompt_base_version_not_found");
  const dto = decodePromptVersionRow(row);
  if (!dto.version) throw new InstructionRequestError(422, "prompt_base_version_read_only");
  return dto.version;
}

function compileDraft(input: PromptDraftInput, scope: PromptAuthoringScope, definitionId: string, base?: PromptVersion) {
  try {
    return preparePromptDraft(input, { workspaceId: scope.workspaceId, actorId: scope.actorId, definitionId }, base);
  } catch {
    throw new InstructionRequestError(422, "prompt_source_or_locked_components_invalid");
  }
}

function versionSummary(row: PromptVersionSummaryRow): VersionSummary {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    parentVersionIds: row.parentVersionIds,
    contentHash: row.contentHash,
    authoring: row.componentsSchemaVersion === "prompt-version-storage-v1" && row.sourceMode === "composition"
      ? "composition"
      : row.componentsSchemaVersion === "prompt-version-storage-v1" && row.sourceMode === "literal" ? "literal" : "legacy"
  };
}

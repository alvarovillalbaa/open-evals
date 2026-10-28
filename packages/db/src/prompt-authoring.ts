import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { queryRows, withTransaction } from "./service";

export interface PromptAuthoringScope {
  workspaceId: string;
  actorId: string;
  projectId?: string;
}

export interface PromptDefinitionRow {
  id: string;
  workspaceId: string;
  stableKey: string;
  targetId: string | null;
  variableSchema: unknown;
  componentSchema: unknown;
}

export interface PromptVersionRow {
  id: string;
  definitionId: string;
  compiledText: string;
  components: unknown;
  parentVersionIds: string[];
  contentHash: string;
  status: string;
  createdAt: Date | string;
}

export interface PromptVersionSummaryRow {
  id: string;
  definitionId: string;
  parentVersionIds: string[];
  contentHash: string;
  status: string;
  createdAt: Date | string;
  componentsSchemaVersion: string | null;
  sourceMode: string | null;
}

export interface PreparedPromptAuthoringVersion {
  compiledText: string;
  components: unknown;
  parentVersionIds: readonly string[];
  contentHash: string;
  requestFingerprint: string;
  previewFingerprint: string;
  auditMetadata: { sourceFingerprint: string; componentCount: number };
}

export class PromptAuthoringStoreError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
    this.name = "PromptAuthoringStoreError";
  }
}

const DEFINITION_COLUMNS = `d.id, d.workspace_id as "workspaceId", d.stable_key as "stableKey",
  d.target_id as "targetId", d.variable_schema as "variableSchema", d.component_schema as "componentSchema"`;
const VERSION_COLUMNS = `v.id, v.prompt_definition_id as "definitionId", v.compiled_text as "compiledText",
  v.components, v.parent_version_ids as "parentVersionIds", v.content_hash as "contentHash",
  v.status, v.created_at as "createdAt"`;
const SCOPED_DEFINITION = `from prompt_definitions d
  left join targets t on t.id = d.target_id and t.workspace_id = d.workspace_id
  left join projects p on p.id = t.project_id and p.workspace_id = d.workspace_id
  where d.workspace_id = $1 and d.id = $2
    and (d.target_id is null or (t.id is not null and (t.project_id is null or p.id is not null)))
    and ($3::text is null or p.id = $3)`;

/** Scope is supplied by the authorized server, never by a request body. */
export async function createPromptDefinition(input: {
  scope: PromptAuthoringScope;
  id: string;
  stableKey: string;
  targetId?: string;
}): Promise<{ definition: PromptDefinitionRow; replayed: boolean }> {
  validateScope(input.scope);
  identifier(input.id);
  identifier(input.stableKey);
  if (input.targetId !== undefined) identifier(input.targetId);
  if (input.scope.projectId && !input.targetId) fail(403, "prompt_target_required");
  const intentFingerprint = hash([input.id, input.stableKey, input.targetId ?? null]);
  return storeOperation(() => withTransaction(async (client) => {
    // All definition creates through this API share the stable-key lock.
    const workspace = await client.query("select id from workspaces where id = $1 for update", [input.scope.workspaceId]);
    if (!workspace.rows.length) fail(404, "prompt_workspace_not_found");
    if (input.targetId) await requireTarget(client, input.scope, input.targetId);

    const existing = (await client.query<PromptDefinitionRow>(
      `select ${DEFINITION_COLUMNS} ${SCOPED_DEFINITION} for update of d`,
      [input.scope.workspaceId, input.id, input.scope.projectId ?? null]
    )).rows[0];
    const stableMatches = await client.query<{ id: string }>(
      "select id from prompt_definitions where workspace_id = $1 and stable_key = $2 order by id",
      [input.scope.workspaceId, input.stableKey]
    );
    if (stableMatches.rows.length > 1 || stableMatches.rows.some((row) => row.id !== input.id)) {
      fail(409, "prompt_definition_identity_conflict");
    }
    if (existing) {
      if (existing.stableKey !== input.stableKey || existing.targetId !== (input.targetId ?? null)) {
        fail(409, "prompt_definition_identity_conflict");
      }
      const intent = await client.query<{ metadata: unknown }>(
        `select metadata from audit_events where workspace_id = $1 and resource_type = 'prompt_definition'
          and resource_id = $2 and action = 'prompt.definition.created' order by created_at, id`,
        [input.scope.workspaceId, input.id]
      );
      if (intent.rows.length !== 1 || object(intent.rows[0].metadata)?.creationIntentFingerprint !== intentFingerprint) {
        fail(409, "prompt_definition_identity_conflict");
      }
      return { definition: existing, replayed: true };
    }

    const inserted = await client.query<PromptDefinitionRow>(
      `insert into prompt_definitions as d (id, workspace_id, target_id, stable_key, variable_schema, component_schema)
        values ($1, $2, $3, $4, '{}'::jsonb, '{}'::jsonb) on conflict (id) do nothing
        returning ${DEFINITION_COLUMNS}`,
      [input.id, input.scope.workspaceId, input.targetId ?? null, input.stableKey]
    );
    if (!inserted.rows[0]) fail(409, "prompt_definition_identity_conflict");
    await audit(client, input.scope, "prompt.definition.created", "prompt_definition", input.id, {
      definitionId: input.id,
      creationIntentFingerprint: intentFingerprint,
      ...(input.targetId ? { targetId: input.targetId } : {})
    });
    return { definition: inserted.rows[0], replayed: false };
  }));
}

export async function getPromptAuthoringDetail(input: {
  scope: PromptAuthoringScope;
  definitionId: string;
  versionId?: string;
}): Promise<{
  definition: PromptDefinitionRow;
  versions: PromptVersionSummaryRow[];
  selectedVersion: PromptVersionRow | null;
} | undefined> {
  validateScope(input.scope);
  identifier(input.definitionId);
  if (input.versionId !== undefined) identifier(input.versionId);
  return storeOperation(async () => {
    const definition = (await queryRows<PromptDefinitionRow>(
      `select ${DEFINITION_COLUMNS} ${SCOPED_DEFINITION}`,
      [input.scope.workspaceId, input.definitionId, input.scope.projectId ?? null]
    ))[0];
    if (!definition) return undefined;
    const versions = await queryRows<PromptVersionSummaryRow>(
      `select v.id, v.prompt_definition_id as "definitionId", v.parent_version_ids as "parentVersionIds",
        v.content_hash as "contentHash", v.status, v.created_at as "createdAt",
        v.components ->> 'schemaVersion' as "componentsSchemaVersion",
        v.components -> 'source' ->> 'mode' as "sourceMode"
        from prompt_versions v where v.prompt_definition_id = $1 order by v.created_at desc, v.id desc`,
      [input.definitionId]
    );
    const selectedId = input.versionId ?? versions[0]?.id;
    const selectedVersion = selectedId ? (await queryRows<PromptVersionRow>(
      `select ${VERSION_COLUMNS} from prompt_versions v where v.prompt_definition_id = $1 and v.id = $2`,
      [input.definitionId, selectedId]
    ))[0] ?? null : null;
    return { definition, versions, selectedVersion };
  });
}

export async function savePromptAuthoringVersion(input: {
  scope: PromptAuthoringScope;
  definitionId: string;
  versionId: string;
  baseVersionId?: string;
  requestFingerprint: string;
  previewFingerprint: string;
  verifyReplay: (row: PromptVersionRow) => void | Promise<void>;
  prepare: (baseRow?: PromptVersionRow) => PreparedPromptAuthoringVersion | Promise<PreparedPromptAuthoringVersion>;
}): Promise<{ row: PromptVersionRow; replayed: boolean }> {
  validateScope(input.scope);
  identifier(input.definitionId);
  identifier(input.versionId);
  if (input.baseVersionId !== undefined) identifier(input.baseVersionId);
  fingerprint(input.requestFingerprint);
  fingerprint(input.previewFingerprint);
  if (typeof input.verifyReplay !== "function" || typeof input.prepare !== "function") fail(422, "prompt_preparation_required");
  return storeOperation(() => withTransaction(async (client) => {
    const definition = (await client.query<PromptDefinitionRow>(
      `select ${DEFINITION_COLUMNS} ${SCOPED_DEFINITION} for update of d`,
      [input.scope.workspaceId, input.definitionId, input.scope.projectId ?? null]
    )).rows[0];
    if (!definition) fail(404, "prompt_definition_not_found");
    if (definition.targetId) await requireTarget(client, input.scope, definition.targetId);

    const existing = (await client.query<PromptVersionRow>(
      `select ${VERSION_COLUMNS} from prompt_versions v where v.prompt_definition_id = $1 and v.id = $2`,
      [input.definitionId, input.versionId]
    )).rows[0];
    if (existing) {
      await input.verifyReplay(existing);
      assertWriteIdentity(existing.components, input.scope.actorId, input.requestFingerprint, input.previewFingerprint);
      return { row: existing, replayed: true };
    }
    // A global identity collision must reveal neither the row nor its source.
    if ((await client.query("select 1 from prompt_versions where id = $1", [input.versionId])).rows.length) {
      fail(409, "prompt_version_identity_conflict");
    }
    let baseRow: PromptVersionRow | undefined;
    if (input.baseVersionId) {
      baseRow = (await client.query<PromptVersionRow>(
        `select ${VERSION_COLUMNS} from prompt_versions v where v.prompt_definition_id = $1 and v.id = $2`,
        [input.definitionId, input.baseVersionId]
      )).rows[0];
      if (!baseRow) fail(404, "prompt_base_version_not_found");
    } else if ((await client.query("select 1 from prompt_versions where prompt_definition_id = $1 limit 1", [input.definitionId])).rows.length) {
      fail(409, "prompt_base_version_required");
    }

    const prepared = await input.prepare(baseRow);
    const parents = input.baseVersionId ? [input.baseVersionId] : [];
    if (input.baseVersionId === input.versionId || !Array.isArray(prepared.parentVersionIds)
      || prepared.parentVersionIds.length !== parents.length
      || prepared.parentVersionIds.some((id, index) => id !== parents[index])) fail(422, "prompt_parents_invalid");
    if (prepared.requestFingerprint !== input.requestFingerprint || prepared.previewFingerprint !== input.previewFingerprint) {
      fail(409, "prompt_preview_stale");
    }
    if (typeof prepared.compiledText !== "string" || prepared.compiledText.length > 1024 * 1024
      || Buffer.byteLength(prepared.compiledText, "utf8") > 1024 * 1024 || !databaseText(prepared.compiledText)
      || !/^[a-f0-9]{24}$/.test(prepared.contentHash)) fail(422, "prompt_prepared_version_invalid");
    fingerprint(prepared.auditMetadata.sourceFingerprint);
    if (!Number.isSafeInteger(prepared.auditMetadata.componentCount) || prepared.auditMetadata.componentCount < 0
      || prepared.auditMetadata.componentCount > 2048) fail(422, "prompt_prepared_version_invalid");
    assertWriteIdentity(prepared.components, input.scope.actorId, input.requestFingerprint, input.previewFingerprint);
    const components = JSON.stringify(prepared.components);
    if (!components || Buffer.byteLength(components, "utf8") > 16 * 1024 * 1024) fail(422, "prompt_prepared_version_invalid");
    const inserted = await client.query<PromptVersionRow>(
      `insert into prompt_versions as v
        (id, prompt_definition_id, compiled_text, components, parent_version_ids, content_hash, status)
        values ($1, $2, $3, $4::jsonb, $5::text[], $6, 'draft') on conflict (id) do nothing
        returning ${VERSION_COLUMNS}`,
      [input.versionId, input.definitionId, prepared.compiledText, components, parents, prepared.contentHash]
    );
    if (!inserted.rows[0]) fail(409, "prompt_version_identity_conflict");
    await audit(client, input.scope, "prompt.version.created", "prompt_version", input.versionId, {
      definitionId: input.definitionId,
      versionId: input.versionId,
      parentVersionIds: parents,
      requestFingerprint: input.requestFingerprint,
      previewFingerprint: input.previewFingerprint,
      contentHash: prepared.contentHash,
      sourceFingerprint: prepared.auditMetadata.sourceFingerprint,
      componentCount: prepared.auditMetadata.componentCount
    });
    return { row: inserted.rows[0], replayed: false };
  }));
}

async function requireTarget(client: PoolClient, scope: PromptAuthoringScope, targetId: string) {
  const target = (await client.query<{ projectId: string | null }>(
    `select project_id as "projectId" from targets where id = $1 and workspace_id = $2 for share`,
    [targetId, scope.workspaceId]
  )).rows[0];
  if (!target || (scope.projectId && target.projectId !== scope.projectId)) fail(404, "prompt_target_not_found");
  if (!target.projectId) return;
  const project = await client.query(
    "select id from projects where id = $1 and workspace_id = $2 for share",
    [target.projectId, scope.workspaceId]
  );
  if (!project.rows.length) fail(404, "prompt_target_not_found");
}

async function audit(client: PoolClient, scope: PromptAuthoringScope, action: string, resourceType: string,
  resourceId: string, metadata: Record<string, unknown>) {
  const json = JSON.stringify(metadata);
  await client.query(
    `insert into audit_events (id, workspace_id, actor_user_id, action, resource_type, resource_id, metadata_hash, metadata)
      values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [`audit_${randomUUID()}`, scope.workspaceId, scope.actorId, action, resourceType, resourceId, hash(metadata), json]
  );
}

function assertWriteIdentity(components: unknown, actorId: string, requestFingerprint: string, previewFingerprint: string) {
  const envelope = object(components);
  const write = object(envelope?.write);
  if (envelope?.schemaVersion !== "prompt-version-storage-v1" || write?.actorId !== actorId
    || write.requestFingerprint !== requestFingerprint || write.previewFingerprint !== previewFingerprint) {
    fail(409, "prompt_version_identity_conflict");
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function validateScope(scope: PromptAuthoringScope) {
  identifier(scope.workspaceId);
  identifier(scope.actorId);
  if (scope.projectId !== undefined) identifier(scope.projectId);
}

function identifier(value: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 128 || value !== value.trim()
    || ["__proto__", "prototype", "constructor"].includes(value)
    || /[\u0000-\u001f\u007f]/.test(value) || !databaseText(value)) fail(422, "prompt_identifier_invalid");
}

function fingerprint(value: string) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail(422, "prompt_fingerprint_invalid");
}

function databaseText(value: string) {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit === 0) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fail(status: number, code: string): never {
  throw new PromptAuthoringStoreError(status, code);
}

async function storeOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    // Trusted compilation callbacks keep their intentional HTTP-safe failures.
    if (error instanceof Error && typeof (error as Error & { status?: unknown }).status === "number") throw error;
    const code = object(error)?.code;
    if (code === "23505") fail(409, "prompt_identity_conflict");
    fail(503, "prompt_storage_unavailable");
  }
}

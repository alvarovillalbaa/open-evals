import { createHash, randomUUID } from "node:crypto";
import { queryRows, withTransaction } from "./service";

export interface CustomEvalScope {
  workspaceId: string;
  actorId: string;
}

export interface CustomEvalSetDraft {
  schemaVersion: "custom-eval-set-draft-v1";
  setId: string;
  versionId: string;
  version: number;
  expectedVersionId: string | null;
  name: string;
  contains: string;
  datasetPassRateThreshold: number;
}

export interface PreparedCustomEvalSet {
  draft: CustomEvalSetDraft;
  requestFingerprint: string;
  contract: unknown;
}

export interface CustomEvalSetContract {
  schemaVersion: "custom-eval-set-v1";
  id: string;
  setId: string;
  name: string;
  itemVersions: Array<{
    item: {
      id: string;
      itemId: string;
      name: string;
      type: "string_check";
      evaluationUnits: string[];
      outputSchema: { fields: Array<{
        key: string;
        displayName: string;
        type: "boolean";
        criticality: "critical";
        gating: boolean;
      }> };
      criticality: "critical";
      config: { contains: string };
      version: number;
      fingerprint: string;
    };
    weight: number;
    criticality: "critical";
  }>;
  gates: {
    rowThreshold: number;
    datasetPassRateThreshold: number;
    evalSetThreshold: number;
    runThreshold: number;
  };
  authoring: { requestFingerprint: string; expectedVersionId: string | null; version: number };
  fingerprint: string;
}

export interface CustomEvalSetVersionRow {
  id: string;
  version: number;
  fingerprint: string;
  createdAt: Date | string;
  contract: CustomEvalSetContract;
}

export interface CustomEvalSetSummary {
  id: string;
  name: string;
  versionCount: number;
  latestVersionId: string;
}

export interface CustomEvalSetDetail {
  id: string;
  name: string;
  versions: CustomEvalSetVersionRow[];
  hasMore: boolean;
}

export class CustomEvalStoreError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
    this.name = "CustomEvalStoreError";
  }
}

interface StoredVersion {
  id: string;
  setId: string;
  version: number;
  fingerprint: string;
  createdAt: Date | string;
  contract: unknown;
  previousVersionId: string | null;
  members: unknown;
}

interface StoredSetVersion extends StoredVersion {
  setName: string;
  versionCount: string;
  minimumVersion: number;
}

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const DRAFT_KEYS = ["schemaVersion", "setId", "versionId", "version", "expectedVersionId", "name", "contains", "datasetPassRateThreshold"];
const VERSION_COLUMNS = `v.id, v.eval_set_id as "setId", v.version, v.fingerprint,
  v.created_at as "createdAt", v.contract,
  (select previous.id from eval_set_versions previous
    where previous.eval_set_id = v.eval_set_id and previous.version = v.version - 1) as "previousVersionId",
  (select coalesce(jsonb_agg(to_jsonb(member)), '[]'::jsonb) from (
    select membership.position, membership.weight, membership.criticality,
      item_version.id as "itemVersionId", item_version.eval_item_id as "itemId",
      item_version.version, item_version.output_schema as "outputSchema", item_version.config,
      item_version.fingerprint, item.workspace_id as "workspaceId", item.name as "itemName", item.type
    from eval_set_item_versions membership
    left join eval_item_versions item_version on item_version.id = membership.eval_item_version_id
    left join eval_items item on item.id = item_version.eval_item_id
    where membership.eval_set_version_id = v.id
    order by membership.position, membership.eval_item_version_id limit 2
  ) member) as members`;
const SET_STATISTICS = `cross join lateral (
  select count(*)::text as "versionCount", min(version) as "minimumVersion", max(version) as "maximumVersion"
  from eval_set_versions where eval_set_id = s.id
) statistics`;

/** The authorized server supplies scope; the prepared body cannot choose a workspace or actor. */
export async function saveCustomEvalSet(scope: CustomEvalScope, prepared: PreparedCustomEvalSet): Promise<{
  id: string;
  name: string;
  version: CustomEvalSetVersionRow;
  replayed: boolean;
}> {
  validateScope(scope);
  scope = { workspaceId: scope.workspaceId, actorId: scope.actorId };
  const valid = validatePrepared(prepared);
  const { draft, contract } = valid;
  return storeOperation(() => withTransaction(async (client) => {
    // Serialize this writer's create/CAS operations, including previously absent set IDs.
    const workspace = await client.query("select id from workspaces where id = $1 for update", [scope.workspaceId]);
    if (!workspace.rows.length) fail(404, "custom_eval_workspace_not_found");
    const existing = (await client.query<{ id: string; name: string }>(
      "select id, name from eval_sets where workspace_id = $1 and id = $2 for update",
      [scope.workspaceId, draft.setId]
    )).rows[0];

    if (existing) {
      const replay = (await client.query<StoredVersion>(
        `select ${VERSION_COLUMNS} from eval_set_versions v where v.eval_set_id = $1 and v.id = $2`,
        [draft.setId, draft.versionId]
      )).rows[0];
      if (replay) {
        const version = validateStoredVersion(scope.workspaceId, replay);
        if (!sameJson(version.contract, contract)) fail(409, "custom_eval_identity_conflict");
        const current = (await client.query<StoredSetVersion>(
          `select ${VERSION_COLUMNS}, s.name as "setName", statistics."versionCount", statistics."minimumVersion"
            from eval_sets s ${SET_STATISTICS}
            join eval_set_versions v on v.eval_set_id = s.id and v.version = statistics."maximumVersion"
            where s.workspace_id = $1 and s.id = $2`,
          [scope.workspaceId, draft.setId]
        )).rows[0];
        if (!current) fail(409, "custom_eval_storage_conflict");
        validateHead(scope.workspaceId, current);
        // A retry remains valid after a later version has advanced the head.
        return { id: draft.setId, name: current.setName, version, replayed: true };
      }

      const head = (await client.query<StoredSetVersion>(
        `select ${VERSION_COLUMNS}, s.name as "setName", statistics."versionCount", statistics."minimumVersion"
          from eval_sets s ${SET_STATISTICS}
          join eval_set_versions v on v.eval_set_id = s.id and v.version = statistics."maximumVersion"
          where s.workspace_id = $1 and s.id = $2`,
        [scope.workspaceId, draft.setId]
      )).rows[0];
      if (!head) fail(409, "custom_eval_identity_conflict");
      validateHead(scope.workspaceId, head);
      if (draft.expectedVersionId !== head.id || draft.version !== head.version + 1) {
        fail(409, "custom_eval_version_conflict");
      }
    } else {
      if (draft.version !== 1 || draft.expectedVersionId !== null) fail(409, "custom_eval_version_conflict");
      const inserted = await client.query(
        `insert into eval_sets (id, workspace_id, name) values ($1, $2, $3)
          on conflict do nothing returning id`,
        [draft.setId, scope.workspaceId, draft.name]
      );
      if (inserted.rows.length !== 1) fail(409, "custom_eval_identity_conflict");
    }

    const item = contract.itemVersions[0].item;
    const existingItem = (await client.query<{ workspaceId: string; type: string }>(
      'select workspace_id as "workspaceId", type from eval_items where id = $1 for update', [item.itemId]
    )).rows[0];
    if (existingItem) {
      if (!existing || existingItem.workspaceId !== scope.workspaceId || existingItem.type !== "string_check") {
        fail(409, "custom_eval_identity_conflict");
      }
    } else {
      const inserted = await client.query(
        `insert into eval_items (id, workspace_id, name, type) values ($1, $2, $3, 'string_check')
          on conflict do nothing returning id`,
        [item.itemId, scope.workspaceId, draft.name]
      );
      if (inserted.rows.length !== 1) fail(409, "custom_eval_identity_conflict");
    }

    const insertedItemVersion = await client.query(
      `insert into eval_item_versions (id, eval_item_id, version, output_schema, config, fingerprint)
        values ($1, $2, $3, $4::jsonb, $5::jsonb, $6) on conflict do nothing returning id`,
      [item.id, item.itemId, item.version, JSON.stringify(item.outputSchema), JSON.stringify(item.config), item.fingerprint]
    );
    if (insertedItemVersion.rows.length !== 1) fail(409, "custom_eval_identity_conflict");
    const insertedVersion = await client.query(
      `insert into eval_set_versions (id, eval_set_id, version, contract, fingerprint)
        values ($1, $2, $3, $4::jsonb, $5) on conflict do nothing returning id`,
      [draft.versionId, draft.setId, draft.version, JSON.stringify(contract), contract.fingerprint]
    );
    if (insertedVersion.rows.length !== 1) fail(409, "custom_eval_identity_conflict");
    const insertedMembership = await client.query(
      `insert into eval_set_item_versions (eval_set_version_id, eval_item_version_id, position, weight, criticality)
        values ($1, $2, 0, 1, 'critical') on conflict do nothing returning eval_set_version_id`,
      [draft.versionId, item.id]
    );
    if (insertedMembership.rows.length !== 1) fail(409, "custom_eval_identity_conflict");

    const stored = (await client.query<StoredVersion>(
      `select ${VERSION_COLUMNS} from eval_set_versions v where v.eval_set_id = $1 and v.id = $2`,
      [draft.setId, draft.versionId]
    )).rows[0];
    if (!stored) fail(409, "custom_eval_storage_conflict");
    const version = validateStoredVersion(scope.workspaceId, stored);
    if (!sameJson(version.contract, contract)) fail(409, "custom_eval_storage_conflict");
    // Display names are mutable; immutable historical contracts retain their own version's name.
    const setUpdate = await client.query(
      "update eval_sets set name = $3 where id = $1 and workspace_id = $2 returning id",
      [draft.setId, scope.workspaceId, draft.name]
    );
    const itemUpdate = await client.query(
      "update eval_items set name = $3 where id = $1 and workspace_id = $2 and type = 'string_check' returning id",
      [item.itemId, scope.workspaceId, draft.name]
    );
    if (setUpdate.rows.length !== 1 || itemUpdate.rows.length !== 1) fail(409, "custom_eval_storage_conflict");
    const metadata = {
      setId: draft.setId,
      versionId: draft.versionId,
      version: draft.version,
      requestFingerprint: valid.requestFingerprint,
      contractFingerprint: contract.fingerprint,
      expectedVersionId: draft.expectedVersionId
    };
    await client.query(
      `insert into audit_events (id, workspace_id, actor_user_id, action, resource_type, resource_id, metadata_hash, metadata)
        values ($1, $2, $3, 'custom_eval.version.saved', 'custom_eval_set_version', $4, $5, $6::jsonb)`,
      [`audit_${randomUUID()}`, scope.workspaceId, scope.actorId, draft.versionId, hash(metadata), JSON.stringify(metadata)]
    );
    return { id: draft.setId, name: draft.name, version, replayed: false };
  }));
}

export async function listCustomEvalSets(workspaceId: string): Promise<CustomEvalSetSummary[]> {
  identifier(workspaceId);
  return storeOperation(async () => {
    // One statement keeps display name, head, count and membership on the same MVCC snapshot.
    const rows = await queryRows<StoredSetVersion>(
      `select ${VERSION_COLUMNS}, s.name as "setName", statistics."versionCount", statistics."minimumVersion"
        from eval_sets s ${SET_STATISTICS}
        join eval_set_versions v on v.eval_set_id = s.id and v.version = statistics."maximumVersion"
        where s.workspace_id = $1 and exists (
          select 1 from eval_set_versions owned where owned.eval_set_id = s.id
            and owned.contract ->> 'schemaVersion' = 'custom-eval-set-v1'
        ) order by s.id limit 100`,
      [workspaceId]
    );
    return rows.map((row) => {
      validateHead(workspaceId, row);
      return { id: row.setId, name: row.setName, versionCount: Number(row.versionCount), latestVersionId: row.id };
    });
  });
}

export async function getCustomEvalSet(workspaceId: string, setId: string): Promise<CustomEvalSetDetail | undefined> {
  identifier(workspaceId);
  if (typeof setId !== "string" || !UUID.test(setId)) fail(422, "custom_eval_set_id_invalid");
  return storeOperation(async () => {
    const rows = await queryRows<StoredSetVersion>(
      `select ${VERSION_COLUMNS}, s.name as "setName", statistics."versionCount", statistics."minimumVersion"
        from eval_sets s ${SET_STATISTICS}
        join lateral (
          select * from eval_set_versions where eval_set_id = s.id order by version desc limit 21
        ) v on true
        where s.workspace_id = $1 and s.id = $2 and exists (
          select 1 from eval_set_versions owned where owned.eval_set_id = s.id
            and owned.contract ->> 'schemaVersion' = 'custom-eval-set-v1'
        ) order by v.version desc`,
      [workspaceId, setId]
    );
    if (!rows.length) return undefined;
    validateHead(workspaceId, rows[0]);
    const versions = rows.map((row) => validateStoredVersion(workspaceId, row));
    return { id: setId, name: rows[0].setName, versions: versions.slice(0, 20), hasMore: rows.length > 20 };
  });
}

function validatePrepared(value: unknown): { draft: CustomEvalSetDraft; requestFingerprint: string; contract: CustomEvalSetContract } {
  const prepared = record(value);
  const rawDraft = record(prepared?.draft);
  if (!prepared || !exactKeys(prepared, ["draft", "requestFingerprint", "contract"])
    || !rawDraft || !exactKeys(rawDraft, DRAFT_KEYS)) fail(422, "custom_eval_prepared_invalid");
  const draft = validateDraft(rawDraft);
  const requestFingerprint = hash(draft);
  const contract = buildContract(draft, requestFingerprint);
  if (prepared.requestFingerprint !== requestFingerprint || !sameJson(prepared.contract, contract)) {
    fail(422, "custom_eval_prepared_invalid");
  }
  return { draft, requestFingerprint, contract };
}

function validateDraft(draft: Record<string, unknown>): CustomEvalSetDraft {
  if (draft.schemaVersion !== "custom-eval-set-draft-v1"
    || typeof draft.setId !== "string" || !UUID.test(draft.setId)
    || typeof draft.versionId !== "string" || !UUID.test(draft.versionId)
    || !Number.isInteger(draft.version) || (draft.version as number) < 1 || (draft.version as number) > 1_000_000
    || !(draft.expectedVersionId === null || (typeof draft.expectedVersionId === "string" && UUID.test(draft.expectedVersionId)))
    || draft.version === 1 && draft.expectedVersionId !== null
    || (draft.version as number) > 1 && draft.expectedVersionId === null
    || draft.versionId === draft.expectedVersionId
    || !validName(draft.name) || typeof draft.contains !== "string" || !draft.contains.trim()
    || !databaseText(draft.contains) || Buffer.byteLength(draft.contains, "utf8") > 4096
    || typeof draft.datasetPassRateThreshold !== "number" || !Number.isFinite(draft.datasetPassRateThreshold)
    || draft.datasetPassRateThreshold < 0 || draft.datasetPassRateThreshold > 100) {
    fail(422, "custom_eval_prepared_invalid");
  }
  return {
    schemaVersion: "custom-eval-set-draft-v1", setId: draft.setId, versionId: draft.versionId,
    version: draft.version as number, expectedVersionId: draft.expectedVersionId as string | null,
    name: draft.name as string, contains: draft.contains,
    datasetPassRateThreshold: draft.datasetPassRateThreshold === 0 ? 0 : draft.datasetPassRateThreshold
  };
}

function buildContract(draft: CustomEvalSetDraft, requestFingerprint: string): CustomEvalSetContract {
  const itemBase: Omit<CustomEvalSetContract["itemVersions"][number]["item"], "fingerprint"> = {
    id: `custom_item_version_${draft.versionId}`, itemId: `custom_item_${draft.setId}`, name: draft.name,
    type: "string_check", evaluationUnits: ["llm_call"],
    outputSchema: { fields: [{ key: "contains_expected", displayName: "Contains configured text", type: "boolean", criticality: "critical", gating: true }] },
    criticality: "critical", config: { contains: draft.contains }, version: draft.version
  };
  const base: Omit<CustomEvalSetContract, "fingerprint"> = {
    schemaVersion: "custom-eval-set-v1", id: draft.versionId, setId: draft.setId, name: draft.name,
    itemVersions: [{ item: { ...itemBase, fingerprint: hash(itemBase) }, weight: 1, criticality: "critical" }],
    gates: { rowThreshold: 100, datasetPassRateThreshold: draft.datasetPassRateThreshold,
      evalSetThreshold: draft.datasetPassRateThreshold, runThreshold: draft.datasetPassRateThreshold },
    authoring: { requestFingerprint, expectedVersionId: draft.expectedVersionId, version: draft.version }
  };
  return { ...base, fingerprint: hash(base) };
}

function validateStoredVersion(workspaceId: string, row: StoredVersion): CustomEvalSetVersionRow {
  try {
    const contract = record(row.contract);
    const authoring = record(contract?.authoring);
    const membership = Array.isArray(contract?.itemVersions) ? record(contract.itemVersions[0]) : undefined;
    const item = record(membership?.item);
    const config = record(item?.config);
    const gates = record(contract?.gates);
    const draft = validateDraft({
      schemaVersion: "custom-eval-set-draft-v1", setId: row.setId, versionId: row.id, version: row.version,
      expectedVersionId: authoring?.expectedVersionId, name: contract?.name, contains: config?.contains,
      datasetPassRateThreshold: gates?.datasetPassRateThreshold
    });
    const expected = buildContract(draft, hash(draft));
    if (!sameJson(row.contract, expected) || row.fingerprint !== expected.fingerprint
      || (row.version === 1 ? row.previousVersionId !== null || draft.expectedVersionId !== null
        : row.previousVersionId !== draft.expectedVersionId || !row.previousVersionId)
      || !(row.createdAt instanceof Date ? Number.isFinite(row.createdAt.getTime())
        : typeof row.createdAt === "string" && Number.isFinite(Date.parse(row.createdAt)))) {
      fail(409, "custom_eval_storage_conflict");
    }
    const members = row.members;
    const member = Array.isArray(members) && members.length === 1 ? record(members[0]) : undefined;
    const expectedItem = expected.itemVersions[0].item;
    if (!member || member.workspaceId !== workspaceId || member.itemId !== expectedItem.itemId
      || member.itemVersionId !== expectedItem.id || member.type !== expectedItem.type
      || member.version !== expectedItem.version || member.fingerprint !== expectedItem.fingerprint
      || member.position !== 0 || member.weight !== 1 || member.criticality !== "critical"
      || !validName(member.itemName) || !sameJson(member.outputSchema, expectedItem.outputSchema)
      || !sameJson(member.config, expectedItem.config)) fail(409, "custom_eval_storage_conflict");
    return { id: row.id, version: row.version, fingerprint: row.fingerprint, createdAt: row.createdAt, contract: expected };
  } catch (error) {
    if (error instanceof CustomEvalStoreError) fail(409, "custom_eval_storage_conflict");
    throw error;
  }
}

function validateHead(workspaceId: string, row: StoredSetVersion) {
  const version = validateStoredVersion(workspaceId, row);
  const count = Number(row.versionCount);
  const member = record((row.members as unknown[])[0]);
  if (!Number.isSafeInteger(count) || count < 1 || count > 1_000_000 || count !== row.version
    || row.minimumVersion !== 1 || row.setName !== version.contract.name || member?.itemName !== row.setName) {
    fail(409, "custom_eval_storage_conflict");
  }
}

function validateScope(scope: CustomEvalScope) {
  if (!record(scope)) fail(422, "custom_eval_scope_invalid");
  identifier(scope.workspaceId);
  identifier(scope.actorId);
}

function identifier(value: string) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 128
    || ["__proto__", "prototype", "constructor"].includes(value) || /[\u0000-\u001f\u007f]/.test(value)
    || !databaseText(value)) fail(422, "custom_eval_scope_invalid");
}

function validName(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim()) && value === value.trim()
    && [...value].length <= 120 && Buffer.byteLength(value, "utf8") <= 480 && databaseText(value);
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

function record(value: unknown): Record<string, unknown> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string"
      || !descriptors[key].enumerable || !("value" in descriptors[key]))) return undefined;
    return value as Record<string, unknown>;
  } catch { return undefined; }
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...keys].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

// Compare only the finite, known expected structure, rejecting extra keys before traversing input.
function sameJson(value: unknown, expected: unknown): boolean {
  try {
    if (expected === null || typeof expected !== "object") return value === expected;
    if (Array.isArray(expected)) {
      if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
      const descriptors = Object.getOwnPropertyDescriptors(value as object);
      const keys = Reflect.ownKeys(descriptors).filter((key) => key !== "length");
      return descriptors.length.value === expected.length && keys.length === expected.length
        && expected.every((item, index) => {
          const descriptor = descriptors[String(index)];
          return descriptor?.enumerable && "value" in descriptor && sameJson(descriptor.value, item);
        });
    }
    const actual = record(value);
    const wanted = expected as Record<string, unknown>;
    return Boolean(actual && exactKeys(actual, Object.keys(wanted))
      && Object.keys(wanted).every((key) => sameJson(actual[key], wanted[key])));
  } catch { return false; }
}

// Keep parity with core/hash.ts without adding a runtime dependency from db to core.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
}

function hash(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function fail(status: number, code: string): never {
  throw new CustomEvalStoreError(status, code);
}

async function storeOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CustomEvalStoreError) throw error;
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      fail(409, "custom_eval_identity_conflict");
    }
    fail(503, "custom_eval_storage_unavailable");
  }
}

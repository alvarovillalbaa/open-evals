import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encodePromptVersionStorage, preparePromptDraft } from "../../../core/src/prompt-authoring";
import { stableHash } from "../../../core/src/hash";
import type { CampaignPreparationInput } from "../../../core/src/campaign-preparation";
import type { PromptAuthoringScope } from "../../src/prompt-authoring";
import type { RouteAuthContext } from "../../../../apps/web/lib/auth";
import { loadCampaignRequests, previewCampaignRequest, saveCampaignRequest } from "../../../../apps/web/lib/campaign-request-service";
import { GET, POST } from "../../../../apps/web/app/api/v1/instructions/[definitionId]/campaign-requests/route";
import { POST as PREVIEW } from "../../../../apps/web/app/api/v1/instructions/[definitionId]/campaign-requests/preview/route";

const verifiedAuth = vi.hoisted(() => ({
  context: undefined as RouteAuthContext | undefined,
  failure: undefined as number | undefined,
  calls: [] as Array<[string, string | undefined]>,
}));

// Only the already-verified authentication boundary is substituted. Instruction ownership,
// services, route parsing, PostgreSQL transactions, constraints and queries remain actual code.
vi.mock("../../../../apps/web/lib/auth", () => ({
  requireRouteAuth: vi.fn(async (role: string, scope?: string) => {
    verifiedAuth.calls.push([role, scope]);
    if (verifiedAuth.failure || !verifiedAuth.context) {
      throw Object.assign(new Error("authentication_required"), { status: verifiedAuth.failure ?? 401 });
    }
    return verifiedAuth.context;
  }),
  getRouteAuthContext: vi.fn(async () => {
    if (!verifiedAuth.context) throw Object.assign(new Error("authentication_required"), { status: 401 });
    return verifiedAuth.context;
  }),
}));

const MARKER = "open-evals-campaign-requests-v1";
const DATABASE_NAME = "campaign_requests_test";
let database: Client | undefined;
let fixture: Fixture | undefined;

interface Fixture {
  token: string;
  workspaceIds: [string, string];
  actorId: string;
  otherActorId: string;
  projectIds: [string, string, string];
  targetIds: [string, string, string];
  definitionIds: [string, string, string, string];
  versionIds: [string, string, string, string, string, string, string];
  scope: PromptAuthoringScope;
  workspaceScope: PromptAuthoringScope;
  otherScope: PromptAuthoringScope;
  auditTrigger?: string;
}

function guardedDatabaseUrl(): string {
  if (process.env.CAMPAIGN_REQUEST_TEST_TARGET !== "local-disposable"
    || process.env.CAMPAIGN_REQUEST_TEST_MARKER !== MARKER) throw new Error("campaign_test_explicit_disposable_target_required");
  let url: URL;
  try { url = new URL(process.env.CAMPAIGN_REQUEST_TEST_DATABASE_URL ?? ""); }
  catch { throw new Error("campaign_test_database_url_required"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.pathname !== `/${DATABASE_NAME}` || url.search || url.hash) {
    throw new Error("campaign_test_loopback_database_required");
  }
  return url.toString();
}

function db(): Client {
  if (!database) throw new Error("campaign_test_database_not_ready");
  return database;
}

async function assertDatabaseMarker() {
  const row = (await db().query<{ name: string; marker: string | null }>(
    `select datname as name, obj_description(oid, 'pg_database') as marker
       from pg_database where datname = current_database()`,
  )).rows[0];
  if (row?.name !== DATABASE_NAME || row.marker !== MARKER) throw new Error("campaign_test_database_marker_required");
}

function active(): Fixture {
  if (!fixture) throw new Error("campaign_test_fixture_not_ready");
  return fixture;
}

function setAuth(scope = active().scope, overrides: Partial<RouteAuthContext> = {}) {
  verifiedAuth.failure = undefined;
  verifiedAuth.context = {
    user: { id: scope.actorId, name: "Authored disposable actor", authMode: "hosted" },
    workspaceId: scope.workspaceId, role: "editor", scopes: ["prompts:read", "prompts:write"],
    authKind: scope.projectId ? "api_key" : "session",
    ...(scope.projectId ? { projectId: scope.projectId } : {}), ...overrides,
  };
}

function input(overrides: Partial<CampaignPreparationInput> = {}): CampaignPreparationInput {
  return { requestId: randomUUID(), baselineVersionId: active().versionIds[0], componentId: "rules", objective: "Clarify authored tool failure examples.", ...overrides };
}

function params(definitionId = active().definitionIds[0]) {
  return { params: Promise.resolve({ definitionId }) };
}

function body(value: unknown) {
  return new Request("https://open-evals.invalid/api/request", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value),
  });
}

function query(values: Record<string, string> = { baselineVersionId: active().versionIds[0] }) {
  return new Request(`https://open-evals.invalid/api/request?${new URLSearchParams(values)}`);
}

async function reviewed(value = input(), scope = active().scope, definitionId = active().definitionIds[0]) {
  const preview = await previewCampaignRequest(scope, definitionId, value);
  return { value, preview, save: { ...value, previewFingerprint: preview.payloadHash } };
}

async function count(table: string, workspaceIds = active().workspaceIds) {
  // Every table name is a fixed authored literal supplied below, never request data.
  const allowed = ["approval_requests", "audit_events", "optimization_campaigns", "workflow_runs", "queue_messages", "eval_runs", "run_plans", "online_experiments"];
  if (!allowed.includes(table)) throw new Error("campaign_test_table_not_owned");
  return Number((await db().query<{ count: string }>(`select count(*) from ${table} where workspace_id = any($1::text[])`, [workspaceIds])).rows[0]!.count);
}

async function writeVersion(definitionId: string, versionId: string, options: { locked?: boolean; content?: string; legacy?: boolean } = {}) {
  const f = active();
  const workspaceId = definitionId === f.definitionIds[3] ? f.workspaceIds[1] : f.workspaceIds[0];
  const source = {
    versionId, components: [
      { id: "safety", kind: "policy", locked: true, content: "AUTHORED PRIVATE SAFETY: Never claim unconfirmed success." },
      { id: "rules", kind: "instruction", locked: options.locked ?? false, content: options.content ?? "AUTHORED PRIVATE BASE: Explain tool errors. Preserve safety." },
    ],
  };
  const context = { workspaceId, actorId: f.actorId, definitionId };
  const prepared = preparePromptDraft(source, context);
  const storage = options.legacy ? prepared.version.components : encodePromptVersionStorage(prepared, context);
  await db().query(
    `insert into prompt_versions (id, prompt_definition_id, compiled_text, components, parent_version_ids, content_hash, status)
       values ($1, $2, $3, $4::jsonb, '{}', $5, 'draft')`,
    [versionId, definitionId, prepared.version.compiledText, JSON.stringify(storage), prepared.version.contentHash],
  );
  return { prepared, storage };
}

async function seedFixture() {
  const token = randomUUID().replaceAll("-", "");
  const id = (name: string) => `cr_${token}_${name}`;
  const f: Fixture = {
    token, workspaceIds: [id("workspace_a"), id("workspace_b")], actorId: id("actor"), otherActorId: id("other_actor"),
    projectIds: [id("project_a"), id("project_b"), id("project_c")], targetIds: [id("target_a"), id("target_b"), id("target_c")],
    definitionIds: [id("definition_a"), id("definition_b"), id("untargeted"), id("definition_c")],
    versionIds: [id("base_a"), id("alternate_a"), id("base_b"), id("untargeted_base"), id("base_c"), id("legacy"), id("locked")],
    scope: { workspaceId: id("workspace_a"), actorId: id("actor"), projectId: id("project_a") },
    workspaceScope: { workspaceId: id("workspace_a"), actorId: id("actor") },
    otherScope: { workspaceId: id("workspace_b"), actorId: id("other_actor"), projectId: id("project_c") },
  };
  fixture = f;
  for (const workspaceId of f.workspaceIds) {
    await db().query("insert into workspaces (id, name) values ($1, $2)", [workspaceId, `${MARKER}:${token}`]);
  }
  for (let index = 0; index < 3; index++) {
    const workspaceId = f.workspaceIds[index === 2 ? 1 : 0];
    await db().query("insert into projects (id, workspace_id, name, environment) values ($1, $2, 'Authored disposable project', 'test')", [f.projectIds[index], workspaceId]);
    await db().query("insert into targets (id, workspace_id, project_id, name, kind) values ($1, $2, $3, 'Authored target', 'provided_output')", [f.targetIds[index], workspaceId, f.projectIds[index]]);
  }
  for (let index = 0; index < 4; index++) {
    const workspaceId = f.workspaceIds[index === 3 ? 1 : 0];
    const targetId = index === 2 ? null : f.targetIds[index === 3 ? 2 : index];
    await db().query("insert into prompt_definitions (id, workspace_id, target_id, stable_key) values ($1, $2, $3, $1)", [f.definitionIds[index], workspaceId, targetId]);
  }
  await writeVersion(f.definitionIds[0], f.versionIds[0]);
  await writeVersion(f.definitionIds[0], f.versionIds[1]);
  await writeVersion(f.definitionIds[1], f.versionIds[2]);
  await writeVersion(f.definitionIds[2], f.versionIds[3]);
  await writeVersion(f.definitionIds[3], f.versionIds[4]);
  await writeVersion(f.definitionIds[0], f.versionIds[5], { legacy: true });
  await writeVersion(f.definitionIds[0], f.versionIds[6], { locked: true });
  return f;
}

async function cleanupFixture(f: Fixture) {
  await assertDatabaseMarker();
  const owned = (await db().query<{ id: string; name: string }>("select id, name from workspaces where id = any($1::text[])", [f.workspaceIds])).rows;
  if (owned.some(row => row.name !== `${MARKER}:${f.token}`)) throw new Error("campaign_test_fixture_ownership_changed");
  if (f.auditTrigger) {
    await db().query(`drop trigger if exists ${f.auditTrigger} on audit_events`);
    await db().query(`drop function if exists ${f.auditTrigger}()`);
  }
  const ids = [f.workspaceIds];
  await db().query("delete from audit_events where workspace_id = any($1::text[])", ids);
  await db().query("delete from approval_requests where workspace_id = any($1::text[])", ids);
  await db().query("delete from candidate_evaluations where candidate_id in (select c.id from optimization_candidates c join optimization_campaigns p on p.id = c.campaign_id where p.workspace_id = any($1::text[]))", ids);
  await db().query("delete from optimization_candidates where campaign_id in (select id from optimization_campaigns where workspace_id = any($1::text[]))", ids);
  await db().query("delete from optimization_campaigns where workspace_id = any($1::text[])", ids);
  await db().query("delete from workflow_events where workflow_run_id in (select id from workflow_runs where workspace_id = any($1::text[]))", ids);
  await db().query("delete from workflow_runs where workspace_id = any($1::text[])", ids);
  await db().query("delete from queue_messages where workspace_id = any($1::text[])", ids);
  await db().query("delete from gate_results where eval_run_id in (select id from eval_runs where workspace_id = any($1::text[]))", ids);
  await db().query("delete from eval_results where eval_run_id in (select id from eval_runs where workspace_id = any($1::text[]))", ids);
  await db().query("delete from run_samples where eval_run_id in (select id from eval_runs where workspace_id = any($1::text[]))", ids);
  await db().query("delete from eval_runs where workspace_id = any($1::text[])", ids);
  await db().query("delete from run_plans where workspace_id = any($1::text[])", ids);
  await db().query("delete from prompt_versions where prompt_definition_id = any($1::text[])", [f.definitionIds]);
  await db().query("delete from prompt_definitions where id = any($1::text[])", [f.definitionIds]);
  await db().query("delete from targets where id = any($1::text[])", [f.targetIds]);
  await db().query("delete from projects where id = any($1::text[])", [f.projectIds]);
  await db().query("delete from workspaces where id = any($1::text[])", ids);
}

beforeAll(async () => {
  const url = guardedDatabaseUrl();
  vi.stubEnv("DATABASE_URL", url);
  vi.stubEnv("POSTGRES_URL", undefined);
  vi.stubEnv("SUPABASE_DB_URL", undefined);
  vi.stubEnv("DATABASE_SSL", "false");
  vi.stubEnv("SUPABASE_DB_SSL", "false");
  database = new Client({ connectionString: url, ssl: false });
  await database.connect();
  await assertDatabaseMarker();
  // The approved runner applies only the existing 0001/0002 migrations before this suite.
  const row = (await database.query("select to_regclass('approval_requests') as approvals, to_regclass('audit_events') as audits, to_regclass('prompt_versions') as versions")).rows[0];
  if (!row?.approvals || !row.audits || !row.versions) throw new Error("campaign_test_reviewed_schema_required");
}, 15_000);

beforeEach(async () => {
  verifiedAuth.calls.length = 0;
  verifiedAuth.failure = undefined;
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL", undefined);
  await seedFixture();
  setAuth();
});

afterEach(async () => {
  const owned = fixture;
  fixture = undefined;
  verifiedAuth.context = undefined;
  verifiedAuth.failure = undefined;
  if (owned) await cleanupFixture(owned);
});

afterAll(async () => {
  try { if (database) await database.end(); }
  finally { database = undefined; vi.unstubAllEnvs(); }
});

describe("campaign request PostgreSQL boundary", () => {
  it("previews a canonical saved baseline without persisting requests or audit events", async () => {
    const value = input();
    const response = await PREVIEW(body(value), params());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const preview = await response.json();
    expect(preview.payloadPreview).toMatchObject({ ...value, workspaceId: active().scope.workspaceId, actorId: active().actorId, definitionId: active().definitionIds[0] });
    expect(preview.payloadHash).toBe(stableHash(preview.payloadPreview, 64));
    expect(preview.payloadPreview.requestedOperations).toHaveLength(6);
    expect(await count("approval_requests")).toBe(0);
    expect(await count("audit_events")).toBe(0);
    expect(verifiedAuth.calls).toEqual([["editor", "prompts:write"]]);
  });

  it("atomically stores one pending approval and content-free audit through the route", async () => {
    const ready = await reviewed();
    const response = await POST(body(ready.save), params());
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const saved = await response.json();
    expect(saved).toMatchObject({ replayed: false, request: { id: ready.preview.approvalId, status: "pending", baselineVerified: true, payloadHash: ready.preview.payloadHash } });
    const row = (await db().query("select * from approval_requests where id = $1", [ready.preview.approvalId])).rows[0];
    expect(row).toMatchObject({ workspace_id: active().workspaceIds[0], requester_id: active().actorId, action: "start_optimization_campaign", status: "pending", risk: "medium" });
    expect(row.decided_at).toBeNull();
    expect(row.decided_by).toBeNull();
    expect(row.payload_preview).toEqual(ready.preview.payloadPreview);
    const audits = (await db().query("select * from audit_events where resource_id = $1 and workspace_id = $2", [row.id, active().workspaceIds[0]])).rows;
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_user_id: active().actorId, action: "prompt.campaign.requested", resource_type: "approval_request" });
    expect(audits[0]!.metadata).toMatchObject({ payloadHash: ready.preview.payloadHash, requestFingerprint: ready.preview.requestFingerprint, candidateCountRequested: 6 });
    expect(JSON.stringify([row.payload_preview, audits[0]!.metadata])).not.toContain("AUTHORED PRIVATE");
  });

  it("rolls back the pending insert when its fixture-scoped audit insert fails", async () => {
    const f = active(), ready = await reviewed();
    const name = `cr_audit_${f.token}`;
    f.auditTrigger = name;
    await db().query(`create function ${name}() returns trigger language plpgsql as $$ begin raise exception 'authored_campaign_audit_failure'; end $$`);
    await db().query(`create trigger ${name} before insert on audit_events for each row when (new.workspace_id = '${f.workspaceIds[0]}') execute function ${name}()`);
    try {
      const response = await POST(body(ready.save), params());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "database_unavailable" });
      expect(await count("approval_requests")).toBe(0);
      expect(await count("audit_events")).toBe(0);
    } finally {
      await db().query(`drop trigger ${name} on audit_events`);
      await db().query(`drop function ${name}()`);
      f.auditTrigger = undefined;
    }
  });

  it("replays identical saved intent without changing the row time or adding an audit", async () => {
    const ready = await reviewed();
    const first = await saveCampaignRequest(active().scope, active().definitionIds[0], ready.save);
    const before = (await db().query("select to_jsonb(a) as value from approval_requests a where id = $1", [first.request.id])).rows[0]!.value;
    const response = await POST(body(ready.save), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ request: first.request, replayed: true });
    const after = (await db().query("select to_jsonb(a) as value from approval_requests a where id = $1", [first.request.id])).rows[0]!.value;
    expect(after).toEqual(before);
    expect(await count("approval_requests")).toBe(1);
    expect(await count("audit_events")).toBe(1);
  });

  it("serializes concurrent identical saves into one creation and one replay", async () => {
    const ready = await reviewed();
    const responses = await Promise.all([POST(body(ready.save), params()), POST(body(ready.save), params())]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 201]);
    const results = await Promise.all(responses.map(response => response.json()));
    expect(results.map(result => result.replayed).sort()).toEqual([false, true]);
    expect(results[0]!.request).toEqual(results[1]!.request);
    expect(await count("approval_requests")).toBe(1);
    expect(await count("audit_events")).toBe(1);
  });

  it("rejects changed reviewed intent reusing a saved request identity", async () => {
    const ready = await reviewed();
    await saveCampaignRequest(active().scope, active().definitionIds[0], ready.save);
    const changed = await reviewed({ ...ready.value, objective: "A distinct reviewed objective." });
    const response = await POST(body(changed.save), params());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "campaign_request_identity_conflict" });
    const history = await loadCampaignRequests(active().scope, active().definitionIds[0], ready.value.baselineVersionId);
    expect(history.requests[0]!.objective).toBe(ready.value.objective);
    expect(await count("audit_events")).toBe(1);
  });

  it("rejects saved identity reuse by another actor or workspace without disclosing source", async () => {
    const f = active(), ready = await reviewed();
    await saveCampaignRequest(f.scope, f.definitionIds[0], ready.save);
    const otherActor = { ...f.scope, actorId: f.otherActorId };
    const actorReady = await reviewed(ready.value, otherActor);
    await expect(saveCampaignRequest(otherActor, f.definitionIds[0], actorReady.save)).rejects.toMatchObject({ status: 409, message: "campaign_request_identity_conflict" });
    const otherReady = await reviewed({ ...ready.value, baselineVersionId: f.versionIds[4] }, f.otherScope, f.definitionIds[3]);
    setAuth(f.otherScope);
    const response = await POST(body(otherReady.save), params(f.definitionIds[3]));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "campaign_request_identity_conflict" });
    expect(await count("approval_requests")).toBe(1);
    expect(await count("audit_events")).toBe(1);
  });

  it("requires the reviewed payload hash and rejects altered input with an old review", async () => {
    const ready = await reviewed();
    expect((await POST(body(ready.value), params())).status).toBe(400);
    expect((await POST(body({ ...ready.save, previewFingerprint: "bad" }), params())).status).toBe(400);
    expect((await POST(body({ ...ready.save, previewFingerprint: "0".repeat(64) }), params())).status).toBe(409);
    const response = await POST(body({ ...ready.save, objective: "Unreviewed replacement objective" }), params());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "campaign_preview_stale" });
    expect(await count("approval_requests")).toBe(0);
    expect(await count("audit_events")).toBe(0);
  });

  it("rejects a baseline changed after review and marks an existing request stale on read", async () => {
    const f = active(), savedReady = await reviewed(), pendingReady = await reviewed();
    await saveCampaignRequest(f.scope, f.definitionIds[0], savedReady.save);
    const replacement = preparePromptDraft({
      versionId: f.versionIds[0], components: [
        { id: "safety", kind: "policy", locked: true, content: "AUTHORED PRIVATE SAFETY: Never claim unconfirmed success." },
        { id: "rules", kind: "instruction", locked: false, content: "An authored replacement canonical baseline." },
      ],
    }, { workspaceId: f.workspaceIds[0], actorId: f.actorId, definitionId: f.definitionIds[0] });
    await db().query("update prompt_versions set compiled_text = $2, components = $3::jsonb, content_hash = $4 where id = $1 and prompt_definition_id = $5", [
      f.versionIds[0], replacement.version.compiledText,
      JSON.stringify(encodePromptVersionStorage(replacement, { workspaceId: f.workspaceIds[0], actorId: f.actorId, definitionId: f.definitionIds[0] })),
      replacement.version.contentHash, f.definitionIds[0],
    ]);
    expect((await POST(body(pendingReady.save), params())).status).toBe(409);
    await expect(loadCampaignRequests(f.scope, f.definitionIds[0], f.versionIds[0], savedReady.value.requestId)).rejects.toMatchObject({ status: 409, message: "campaign_request_invalid_or_stale" });
    expect(await count("approval_requests")).toBe(1);
    expect(await count("audit_events")).toBe(1);
  });

  it("creates no candidates campaigns jobs evaluations or release changes at any request step", async () => {
    const f = active();
    const beforeVersions = (await db().query("select to_jsonb(v) as value from prompt_versions v where prompt_definition_id = any($1::text[]) order by id", [f.definitionIds])).rows;
    const ready = await reviewed();
    await saveCampaignRequest(f.scope, f.definitionIds[0], ready.save);
    await saveCampaignRequest(f.scope, f.definitionIds[0], ready.save);
    await loadCampaignRequests(f.scope, f.definitionIds[0], ready.value.baselineVersionId);
    for (const table of ["optimization_campaigns", "workflow_runs", "queue_messages", "eval_runs", "run_plans", "online_experiments"]) expect(await count(table)).toBe(0);
    const children = (await db().query(`select
      (select count(*) from optimization_candidates c join optimization_campaigns p on p.id = c.campaign_id where p.workspace_id = any($1::text[])) as candidates,
      (select count(*) from candidate_evaluations e join optimization_candidates c on c.id = e.candidate_id join optimization_campaigns p on p.id = c.campaign_id where p.workspace_id = any($1::text[])) as evaluations,
      (select count(*) from prompt_releases r join prompt_definitions d on d.id = r.prompt_definition_id where d.workspace_id = any($1::text[])) as releases`, [f.workspaceIds])).rows[0];
    expect(children).toEqual({ candidates: "0", evaluations: "0", releases: "0" });
    expect((await db().query("select to_jsonb(v) as value from prompt_versions v where prompt_definition_id = any($1::text[]) order by id", [f.definitionIds])).rows).toEqual(beforeVersions);
  });

  it("enforces existing project ownership for foreign and untargeted instruction definitions", async () => {
    const f = active();
    for (const [definitionId, baselineVersionId] of [[f.definitionIds[1], f.versionIds[2]], [f.definitionIds[2], f.versionIds[3]]]) {
      const value = input({ baselineVersionId });
      expect((await PREVIEW(body(value), params(definitionId))).status).toBe(404);
      expect((await POST(body({ ...value, previewFingerprint: "0".repeat(64) }), params(definitionId))).status).toBe(404);
      expect((await GET(query({ baselineVersionId }), params(definitionId))).status).toBe(404);
    }
    setAuth(f.workspaceScope);
    const value = input({ baselineVersionId: f.versionIds[2] });
    expect((await PREVIEW(body(value), params(f.definitionIds[1]))).status).toBe(200);
    expect(await count("approval_requests")).toBe(0);
  });

  it("denies cross-workspace preview save and history even to an authenticated workspace session", async () => {
    const f = active();
    const own = await reviewed();
    await saveCampaignRequest(f.scope, f.definitionIds[0], own.save);
    setAuth({ ...f.otherScope, projectId: undefined }, { authKind: "session", projectId: undefined });
    const value = input();
    for (const response of [
      await PREVIEW(body(value), params()),
      await POST(body({ ...value, previewFingerprint: "0".repeat(64) }), params()),
      await GET(query({ baselineVersionId: f.versionIds[0], requestId: own.value.requestId }), params()),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "prompt_definition_not_found" });
    }
    expect(await count("approval_requests")).toBe(1);
    expect(await count("audit_events")).toBe(1);
  });

  it("rejects request-body actor workspace and definition overrides", async () => {
    const f = active(), ready = await reviewed();
    for (const field of ["actorId", "workspaceId", "definitionId", "status", "payloadPreview", "requestedOperations", "limits"]) {
      const response = await POST(body({ ...ready.save, [field]: field === "status" ? "approved" : "spoofed" }), params());
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "campaign_request_input_invalid" });
    }
    expect(await count("approval_requests")).toBe(0);
    expect(await count("audit_events")).toBe(0);
    expect(verifiedAuth.context?.user.id).toBe(f.actorId);
  });

  it("rejects missing legacy invalid and locked baseline selections without pending rows", async () => {
    const f = active();
    const cases: Array<[string, string, number]> = [
      [`cr_${f.token}_missing`, "rules", 404],
      [f.versionIds[5], "rules", 422],
      [f.versionIds[6], "rules", 422],
      [f.versionIds[0], "missing-component", 422],
      [f.versionIds[0], "safety", 422],
    ];
    await db().query("update prompt_versions set content_hash = 'stale' where id = $1", [f.versionIds[1]]);
    cases.push([f.versionIds[1], "rules", 422]);
    for (const [baselineVersionId, componentId, status] of cases) {
      const value = input({ baselineVersionId, componentId });
      expect((await PREVIEW(body(value), params())).status).toBe(status);
      expect((await POST(body({ ...value, previewFingerprint: "0".repeat(64) }), params())).status).toBe(status);
    }
    expect(await count("approval_requests")).toBe(0);
    expect(await count("audit_events")).toBe(0);
  });

  it("fails closed on stored payload tampering and never repairs it during replay", async () => {
    const f = active(), ready = await reviewed();
    await saveCampaignRequest(f.scope, f.definitionIds[0], ready.save);
    await db().query("update approval_requests set payload_preview = jsonb_set(payload_preview, '{objective}', to_jsonb('tampered authored objective'::text)) where id = $1 and workspace_id = $2", [ready.preview.approvalId, f.workspaceIds[0]]);
    const response = await GET(query({ baselineVersionId: f.versionIds[0], requestId: ready.value.requestId }), params());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "campaign_request_invalid_or_stale" });
    expect((await POST(body(ready.save), params())).status).toBe(409);
    const row = (await db().query("select payload_preview ->> 'objective' as objective from approval_requests where id = $1", [ready.preview.approvalId])).rows[0];
    expect(row.objective).toBe("tampered authored objective");
    expect(await count("audit_events")).toBe(1);
  });

  it("projects recorded decisions read-only and rejects invalid stored decision states", async () => {
    const f = active(), ready = await reviewed();
    await saveCampaignRequest(f.scope, f.definitionIds[0], ready.save);
    for (const status of ["approved", "rejected", "expired"]) {
      await db().query("update approval_requests set status = $2, decided_by = $3, decided_at = '2026-10-30T00:00:00Z', decision_reason = 'authored fixture decision' where id = $1", [ready.preview.approvalId, status, f.otherActorId]);
      const response = await POST(body(ready.save), params());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ replayed: true, request: { status, baselineVerified: true } });
      const history = await loadCampaignRequests(f.scope, f.definitionIds[0], f.versionIds[0], ready.value.requestId);
      expect(history.requests[0]!.status).toBe(status);
    }
    await db().query("update approval_requests set status = 'executing' where id = $1", [ready.preview.approvalId]);
    expect((await GET(query({ baselineVersionId: f.versionIds[0], requestId: ready.value.requestId }), params())).status).toBe(409);
    expect(await count("optimization_campaigns")).toBe(0);
    expect(await count("workflow_runs")).toBe(0);
    expect(await count("audit_events")).toBe(1);
  });

  it("filters history before paging and supports exact identity lookup outside the first page", async () => {
    const f = active();
    const ids: string[] = [];
    for (let index = 0; index < 21; index++) {
      const ready = await reviewed();
      await saveCampaignRequest(f.scope, f.definitionIds[0], ready.save);
      ids.push(ready.value.requestId);
      await db().query("update approval_requests set created_at = '2026-10-01T00:00:00Z'::timestamptz + $2::int * interval '1 minute' where id = $1", [ready.preview.approvalId, index]);
    }
    const alternate = await reviewed(input({ baselineVersionId: f.versionIds[1] }));
    await saveCampaignRequest(f.scope, f.definitionIds[0], alternate.save);
    const cloneId = `campaign_request_${randomUUID()}`;
    await db().query(`insert into approval_requests (id, workspace_id, action, requester_id, status, risk, summary, payload_hash, payload_preview)
      select $2, workspace_id, action, requester_id, status, risk, summary, payload_hash,
        jsonb_set(payload_preview, '{schemaVersion}', to_jsonb('unrelated-v1'::text)) from approval_requests where id = $1`, [`campaign_request_${ids[0]}`, cloneId]);
    await db().query(`insert into approval_requests (id, workspace_id, action, requester_id, status, risk, summary, payload_hash, payload_preview)
      select $2, workspace_id, 'start_eval_run', requester_id, status, risk, summary, payload_hash, payload_preview
        from approval_requests where id = $1`, [`campaign_request_${ids[0]}`, `campaign_request_${randomUUID()}`]);
    const response = await GET(query(), params());
    expect(response.status).toBe(200);
    const history = await response.json();
    expect(history.requests).toHaveLength(20);
    expect(history.hasMore).toBe(true);
    expect(history.requests[0]!.requestId).toBe(ids[20]);
    expect(history.requests.some((entry: { requestId: string }) => entry.requestId === ids[0])).toBe(false);
    expect(history.requests.every((entry: { baselineVersionId: string }) => entry.baselineVersionId === f.versionIds[0])).toBe(true);
    const exact = await GET(query({ baselineVersionId: f.versionIds[0], requestId: ids[0]! }), params());
    expect(await exact.json()).toMatchObject({ requests: [{ requestId: ids[0] }], hasMore: false });
    const absent = await GET(query({ baselineVersionId: f.versionIds[0], requestId: randomUUID() }), params());
    expect(await absent.json()).toEqual({ requests: [], hasMore: false });
  });

  it("rejects ambiguous or unknown history queries and uses the read authorization boundary", async () => {
    const f = active();
    for (const search of ["", `baselineVersionId=${f.versionIds[0]}&baselineVersionId=${f.versionIds[0]}`, `baselineVersionId=${f.versionIds[0]}&actorId=spoofed`]) {
      const response = await GET(new Request(`https://open-evals.invalid/api/request?${search}`), params());
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "campaign_request_query_invalid" });
    }
    const invalidId = await GET(query({ baselineVersionId: f.versionIds[0], requestId: "not-a-uuid" }), params());
    expect(invalidId.status).toBe(422);
    expect(verifiedAuth.calls.every(call => call[0] === "viewer" && call[1] === "prompts:read")).toBe(true);
    expect(await count("approval_requests")).toBe(0);
  });

  it("authenticates before reading bodies and retains existing instruction write restrictions", async () => {
    const f = active();
    verifiedAuth.failure = 401;
    let reads = 0;
    const unread = body(input());
    Object.defineProperty(unread, "body", { get() { reads++; throw new Error("body_must_not_be_read"); } });
    expect((await POST(unread, params())).status).toBe(401);
    expect(reads).toBe(0);
    setAuth(f.workspaceScope, { authKind: "api_key", projectId: undefined });
    expect((await PREVIEW(body(input()), params())).status).toBe(403);
    setAuth(f.workspaceScope, { role: "viewer" });
    expect((await PREVIEW(body(input()), params())).status).toBe(403);
    setAuth(f.workspaceScope, { scopes: ["prompts:read"] });
    expect((await PREVIEW(body(input()), params())).status).toBe(403);
    setAuth(f.workspaceScope, { authKind: "local" });
    vi.stubEnv("VERCEL", "authored-hosted-test");
    expect((await PREVIEW(body(input()), params())).status).toBe(403);
    expect(await count("approval_requests")).toBe(0);
    expect(await count("audit_events")).toBe(0);
  });
});

import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const { Pool } = createRequire(new URL("../../../packages/db/package.json", import.meta.url))("pg");

// Importing this module opens no database or HTTP connection. Call only in the approved disposable scope.
export function authoringBaseURL() {
  return loopback(process.env.INSTRUCTION_AUTHORING_TEST_URL ?? "http://127.0.0.1:3217");
}

export async function createInstructionFixture() {
  assert.equal(process.env.INSTRUCTION_AUTHORING_TEST_TARGET, "local-disposable");
  const baseURL = authoringBaseURL();
  const demoBaseURL = loopback(process.env.INSTRUCTION_AUTHORING_DEMO_URL ?? "http://127.0.0.1:3218");
  const databaseUrl = new URL(process.env.INSTRUCTION_AUTHORING_TEST_DATABASE_URL ?? "missing:");
  assert.ok(["postgres:", "postgresql:"].includes(databaseUrl.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(databaseUrl.hostname));
  assert.match(decodeURIComponent(databaseUrl.pathname.slice(1)), /^open_evals_authoring_test_[a-zA-Z0-9_]+$/);
  const secret = process.env.AUTH_SECRET, pepper = process.env.API_KEY_PEPPER;
  assert.ok(typeof secret === "string" && secret.length >= 16, "explicit disposable AUTH_SECRET required");
  assert.ok(typeof pepper === "string" && pepper.length >= 16, "explicit disposable API_KEY_PEPPER required");
  assert.equal(process.env.AUTH_MODE, "hosted");
  const pool = new Pool({ connectionString: databaseUrl.href, max: 4, statement_timeout: 10000 });
  const prefix = `oa_${randomUUID().replaceAll("-", "")}`;
  const id = label => `${prefix}_${label}`;
  const workspaceId = id("workspace"), otherWorkspaceId = id("other_workspace");
  const projectId = id("project"), otherProjectId = id("other_project"), foreignProjectId = id("foreign_project");
  const targetId = id("target"), otherTargetId = id("other_target"), foreignTargetId = id("foreign_target");
  const ownerId = id("owner"), editorId = id("editor"), viewerId = id("viewer");
  const rollbackFunction = `${prefix}_audit_fail`, rollbackTrigger = `${prefix}_audit_trigger`;
  const sessionCookie = (role = "editor") => {
    assert.ok(["owner", "editor", "viewer"].includes(role));
    return signedCookie(role === "owner" ? ownerId : role === "viewer" ? viewerId : editorId, workspaceId, role);
  };
  const owner = { cookie: `open_evals_session=${sessionCookie("owner")}` };
  const editor = { cookie: `open_evals_session=${sessionCookie("editor")}` };
  const viewer = { cookie: `open_evals_session=${sessionCookie("viewer")}` };
  const foreignOwner = { cookie: `open_evals_session=${signedCookie(ownerId, otherWorkspaceId, "owner")}` };
  const keys = {};
  let fixturesCreated = false, cleaned = false;

  async function sql(query, parameters = []) { return (await pool.query(query, parameters)).rows; }
  async function removeRollbackTrigger() {
    await sql(`drop trigger if exists ${rollbackTrigger} on audit_events`);
    await sql(`drop function if exists ${rollbackFunction}()`);
  }
  async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    try {
      if (!fixturesCreated) return;
      await removeRollbackTrigger();
      // Exact owned IDs in foreign-key order; never drop databases or existing rows.
      for (const query of [
        "delete from candidate_evaluations where candidate_id in (select c.id from optimization_candidates c join optimization_campaigns x on x.id = c.campaign_id where x.workspace_id = any($1::text[]))",
        "delete from optimization_candidates where campaign_id in (select id from optimization_campaigns where workspace_id = any($1::text[]))",
        "delete from optimization_campaigns where workspace_id = any($1::text[])",
        "delete from online_experiments where workspace_id = any($1::text[])",
        "delete from prompt_releases where prompt_definition_id in (select id from prompt_definitions where workspace_id = any($1::text[]))",
        "delete from prompt_components where prompt_definition_id in (select id from prompt_definitions where workspace_id = any($1::text[]))",
        "delete from prompt_versions where prompt_definition_id in (select id from prompt_definitions where workspace_id = any($1::text[]))",
        "delete from prompt_definitions where workspace_id = any($1::text[])",
        "delete from audit_events where workspace_id = any($1::text[])",
        "delete from targets where workspace_id = any($1::text[])",
        "delete from project_api_keys where project_id in (select id from projects where workspace_id = any($1::text[]))",
        "delete from projects where workspace_id = any($1::text[])",
        "delete from workspace_memberships where workspace_id = any($1::text[])",
        "delete from workspaces where id = any($1::text[])"
      ]) await sql(query, [[workspaceId, otherWorkspaceId]]);
      await sql("delete from users where id = any($1::text[])", [[ownerId, editorId, viewerId]]);
    } finally {
      await pool.end();
    }
  }

  try {
    const migration = await sql("select relrowsecurity from pg_class where oid = 'prompt_versions'::regclass");
    assert.equal(migration[0].relrowsecurity, true, "apply unchanged migrations 0001, 0002 and 0003 first");
    await sql("insert into workspaces (id, name, mode) values ($1, $2, 'hosted'), ($3, $4, 'hosted')", [workspaceId, prefix, otherWorkspaceId, `${prefix} other`]);
    fixturesCreated = true;
    for (const [userId, role] of [[ownerId, "owner"], [editorId, "editor"], [viewerId, "viewer"]]) {
      await sql("insert into users (id, email, name) values ($1, $2, $3)", [userId, `${userId}@example.invalid`, prefix]);
      await sql("insert into workspace_memberships (workspace_id, user_id, role) values ($1, $2, $3)", [workspaceId, userId, role]);
    }
    await sql("insert into workspace_memberships (workspace_id, user_id, role) values ($1, $2, 'owner')", [otherWorkspaceId, ownerId]);
    for (const [project, workspace] of [[projectId, workspaceId], [otherProjectId, workspaceId], [foreignProjectId, otherWorkspaceId]]) {
      await sql("insert into projects (id, workspace_id, name, environment) values ($1, $2, $3, 'test')", [project, workspace, prefix]);
    }
    for (const [target, project, workspace] of [[targetId, projectId, workspaceId], [otherTargetId, otherProjectId, workspaceId], [foreignTargetId, foreignProjectId, otherWorkspaceId]]) {
      await sql("insert into targets (id, workspace_id, project_id, name, kind) values ($1, $2, $3, $4, 'prompt')", [target, workspace, project, prefix]);
    }
    for (const [name, project, scopes] of [
      ["read", projectId, ["prompts:read"]], ["write", projectId, ["prompts:write"]],
      ["both", projectId, ["prompts:read", "prompts:write"]],
      ["other", otherProjectId, ["prompts:read", "prompts:write"]],
      ["foreign", foreignProjectId, ["prompts:read", "prompts:write"]],
      ["neither", projectId, ["evals:read"]]
    ]) {
      const plaintext = `${id(`key_${name}`)}.disposable_fixture_secret`;
      await sql("insert into project_api_keys (id, project_id, key_hash, scope, scopes, name, key_prefix) values ($1, $2, $3, 'test', $4::text[], $5, 'oe_test')", [id(`key_${name}`), project, createHmac("sha256", pepper).update(plaintext).digest("hex"), scopes, prefix]);
      keys[name] = { authorization: `Bearer ${plaintext}` };
    }
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }

  function signedCookie(userId, workspace, role) {
    const payload = Buffer.from(JSON.stringify({ userId, workspaceId: workspace, role, expiresAt: Date.now() + 60 * 60 * 1000 })).toString("base64url");
    return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
  }
  async function request(path, { method = "GET", body, raw, auth = owner, headers = {}, origin = baseURL } = {}) {
    assert.ok([baseURL, demoBaseURL].includes(origin));
    const url = new URL(path, origin);
    assert.equal(url.origin, origin);
    const response = await fetch(url, {
      method, headers: { ...(body !== undefined || raw !== undefined ? { "content-type": "application/json" } : {}), ...auth, ...headers },
      ...(body !== undefined || raw !== undefined ? { body: raw ?? JSON.stringify(body) } : {}),
      ...(raw instanceof ReadableStream ? { duplex: "half" } : {}),
      redirect: "error", signal: AbortSignal.timeout(30000)
    });
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  function definitionInput(label, target = targetId) { return { id: id(label), stableKey: id(`${label}_stable`), targetId: target }; }
  function definitionPath(definitionId, suffix = "") { return `/api/v1/instructions/${encodeURIComponent(definitionId)}${suffix}`; }
  function literal(label, content = "Read before writing.") {
    return { versionId: id(label), components: [
      { id: "role", kind: "role", locked: true, content: "Help carefully." },
      { id: "rules", kind: "rules", locked: false, content }
    ] };
  }
  async function preview(definitionId, input) {
    return expectStatus(await request(definitionPath(definitionId, "/preview"), { method: "POST", body: input }), 200);
  }
  async function save(definitionId, input, reviewed, status = 201) {
    return expectStatus(await request(definitionPath(definitionId, "/versions"), { method: "POST", body: { ...input, previewFingerprint: reviewed.previewFingerprint } }), status);
  }
  return {
    prefix, id, baseURL, demoBaseURL, workspaceId, otherWorkspaceId, projectId, otherProjectId, foreignProjectId,
    targetId, otherTargetId, foreignTargetId, ownerId, editorId, viewerId, owner, editor, viewer, foreignOwner, keys,
    sessionCookie, request, sql, definitionInput, definitionPath, literal, preview, save, cleanup,
    rollbackFunction, rollbackTrigger, removeRollbackTrigger
  };
}

export function expectStatus(response, status) {
  assert.equal(response.status, status, `expected HTTP ${status}; got ${response.status}: ${JSON.stringify(response.body)}`);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  return response.body;
}

function loopback(value) {
  const url = new URL(value);
  assert.equal(url.protocol, "http:");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.equal(url.username + url.password + url.search + url.hash, "");
  assert.equal(url.pathname, "/");
  return url.origin;
}

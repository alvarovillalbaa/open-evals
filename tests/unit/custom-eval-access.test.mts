// T1: dependency-free access decisions; no Auth provider, database, HTTP or browser proof.
import assert from "node:assert/strict";
import test from "node:test";
import { customEvalAccessAllowed } from "../../apps/web/lib/custom-eval-access.ts";

test("CEA01 workspace owner session can read and write with admin scope", () => {
  const auth = { authKind: "session", role: "owner", scopes: ["admin"] } as const;
  assert.equal(customEvalAccessAllowed({ ...auth, scopes: [...auth.scopes] }, "read", true), true);
  assert.equal(customEvalAccessAllowed({ ...auth, scopes: [...auth.scopes] }, "write", true), true);
});

test("CEA02 Supabase editor with evaluation scopes can read and write", () => {
  const auth = { authKind: "supabase", role: "editor", scopes: ["evals:read", "evals:write"] } as const;
  assert.equal(customEvalAccessAllowed({ ...auth, scopes: [...auth.scopes] }, "read", true), true);
  assert.equal(customEvalAccessAllowed({ ...auth, scopes: [...auth.scopes] }, "write", true), true);
});

test("CEA03 viewer workspace session can read with evals read scope", () => {
  assert.equal(customEvalAccessAllowed({ authKind: "session", role: "viewer", scopes: ["evals:read"] }, "read", true), true);
});

test("CEA04 viewer cannot write even with admin scope", () => {
  assert.equal(customEvalAccessAllowed({ authKind: "session", role: "viewer", scopes: ["admin"] }, "write", true), false);
});

test("CEA05 editor without evals write scope cannot write", () => {
  assert.equal(customEvalAccessAllowed({ authKind: "supabase", role: "editor", scopes: ["evals:read", "prompts:write"] }, "write", true), false);
});

test("CEA06 evals write scope does not silently grant read scope", () => {
  assert.equal(customEvalAccessAllowed({ authKind: "session", role: "editor", scopes: ["evals:write"] }, "read", true), false);
});

test("CEA07 prompt and trace scopes do not grant eval reads", () => {
  assert.equal(customEvalAccessAllowed({ authKind: "session", role: "owner", scopes: ["prompts:read", "traces:read"] }, "read", true), false);
});

test("CEA08 project API keys cannot read workspace-owned custom sets", () => {
  assert.equal(customEvalAccessAllowed({ authKind: "api_key", role: "editor", scopes: ["evals:read"] }, "read", true), false);
});

test("CEA09 project API keys cannot write workspace-owned custom sets", () => {
  assert.equal(customEvalAccessAllowed({ authKind: "api_key", role: "editor", scopes: ["evals:write"] }, "write", true), false);
});

test("CEA10 admin API scope cannot override the workspace-session boundary", () => {
  const auth = { authKind: "api_key", role: "owner", scopes: ["admin"] } as const;
  assert.equal(customEvalAccessAllowed({ ...auth, scopes: [...auth.scopes] }, "read", true), false);
  assert.equal(customEvalAccessAllowed({ ...auth, scopes: [...auth.scopes] }, "write", true), false);
});

test("CEA11 hosted local ownership cannot read custom sets", () => {
  assert.equal(customEvalAccessAllowed({ authKind: "local", role: "owner", scopes: ["admin"] }, "read", true), false);
});

test("CEA12 hosted local ownership cannot save custom sets", () => {
  assert.equal(customEvalAccessAllowed({ authKind: "local", role: "owner", scopes: ["admin"] }, "write", true), false);
});

test("CEA13 local development ownership retains local authoring", () => {
  const auth = { authKind: "local", role: "owner", scopes: ["admin"] } as const;
  assert.equal(customEvalAccessAllowed({ ...auth, scopes: [...auth.scopes] }, "read", false), true);
  assert.equal(customEvalAccessAllowed({ ...auth, scopes: [...auth.scopes] }, "write", false), true);
});

test("CEA14 local development viewer still cannot write", () => {
  assert.equal(customEvalAccessAllowed({ authKind: "local", role: "viewer", scopes: ["admin"] }, "write", false), false);
});

test("CEA15 workspace administrator still needs the evaluation scope", () => {
  assert.equal(customEvalAccessAllowed({ authKind: "session", role: "admin", scopes: [] }, "write", true), false);
});

test("CEA16 an editor write scope is sufficient for workspace-session authoring", () => {
  assert.equal(customEvalAccessAllowed({ authKind: "session", role: "editor", scopes: ["evals:write"] }, "write", true), true);
});

test("CEA17 policy evaluation leaves supplied context and scopes unchanged", () => {
  const auth = { authKind: "session", role: "editor", scopes: ["evals:read", "evals:write"] } as const;
  const value = { ...auth, scopes: [...auth.scopes] };
  const original = structuredClone(value);
  customEvalAccessAllowed(value, "read", true);
  customEvalAccessAllowed(value, "write", true);
  assert.deepEqual(value, original);
});

test("CEA18 API keys cannot acquire local-development ownership either", () => {
  assert.equal(customEvalAccessAllowed({ authKind: "api_key", role: "owner", scopes: ["admin"] }, "write", false), false);
});

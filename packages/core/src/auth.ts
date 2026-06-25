import { createHash, createHmac, timingSafeEqual, randomBytes } from "node:crypto";

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";
export type ApiKeyScope =
  | "traces:write"
  | "traces:read"
  | "evals:write"
  | "evals:read"
  | "prompts:write"
  | "prompts:read"
  | "experiments:write"
  | "admin";

export interface AuthenticatedUser {
  id: string;
  email?: string;
  name?: string;
  authMode: "local" | "hosted";
}

export interface WorkspaceMembership {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

export interface ApiKeyRecord {
  id: string;
  workspaceId: string;
  name: string;
  keyHash: string;
  scopes: ApiKeyScope[];
  prefix: string;
  revokedAt?: string;
}

const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4
};

export function canRoleAccess(actual: WorkspaceRole, required: WorkspaceRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export function requireWorkspaceRole(membership: WorkspaceMembership | undefined, required: WorkspaceRole): WorkspaceMembership {
  if (!membership) throw new Error("workspace_membership_required");
  if (!canRoleAccess(membership.role, required)) throw new Error(`workspace_role_forbidden:${required}`);
  return membership;
}

export function assertApiKeyScope(record: ApiKeyRecord | undefined, scope: ApiKeyScope): ApiKeyRecord {
  if (!record || record.revokedAt) throw new Error("api_key_invalid");
  if (!record.scopes.includes("admin") && !record.scopes.includes(scope)) throw new Error(`api_key_scope_forbidden:${scope}`);
  return record;
}

export function issueApiKey(prefix = "oe"): { plaintext: string; prefix: string } {
  const secret = randomBytes(24).toString("base64url");
  const visiblePrefix = `${prefix}_${randomBytes(4).toString("hex")}`;
  return { plaintext: `${visiblePrefix}.${secret}`, prefix: visiblePrefix };
}

export function hashApiKey(plaintext: string, pepper: string): string {
  return createHmac("sha256", pepper).update(plaintext).digest("hex");
}

export function verifyApiKey(plaintext: string, hash: string, pepper: string): boolean {
  const candidate = hashApiKey(plaintext, pepper);
  const left = Buffer.from(candidate, "hex");
  const right = Buffer.from(hash, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function sessionFingerprint(input: { userId: string; sessionId: string; secret: string }): string {
  return createHmac("sha256", input.secret).update(`${input.userId}:${input.sessionId}`).digest("hex");
}

export function contentSafeAuditHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}


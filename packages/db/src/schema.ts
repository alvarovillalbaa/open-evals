import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").unique(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  mode: text("mode").notNull().default("local"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const workspaceMemberships = pgTable(
  "workspace_memberships",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role").notNull()
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })]
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    accessTokenRef: text("access_token_ref"),
    refreshTokenRef: text("refresh_token_ref"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique("auth_accounts_provider_account").on(table.provider, table.providerAccountId)]
);

export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionHash: text("session_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  environment: text("environment").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const projectApiKeys = pgTable("project_api_keys", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  scopes: text("scopes").array().notNull().default([]),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const connections = pgTable("connections", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  config: jsonb("config").notNull().default({}),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const connectionSecrets = pgTable("connection_secrets", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull().references(() => connections.id, { onDelete: "cascade" }),
  secretRef: text("secret_ref"),
  encryptedPayload: jsonb("encrypted_payload"),
  keyHash: text("key_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const ingestJobs = pgTable(
  "ingest_jobs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").references(() => connections.id, { onDelete: "set null" }),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    cursorBefore: text("cursor_before"),
    cursorAfter: text("cursor_after"),
    report: jsonb("report").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique("ingest_jobs_idempotency").on(table.workspaceId, table.idempotencyKey)]
);

export const ingestCursors = pgTable(
  "ingest_cursors",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull().references(() => connections.id, { onDelete: "cascade" }),
    cursor: text("cursor").notNull(),
    state: jsonb("state").notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique("ingest_cursor_connection").on(table.connectionId)]
);

export const rawArtifacts = pgTable(
  "raw_artifacts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    driver: text("driver").notNull(),
    ref: text("ref").notNull(),
    contentHash: text("content_hash").notNull(),
    retentionUntil: timestamp("retention_until", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique("raw_artifacts_workspace_hash").on(table.workspaceId, table.contentHash)]
);

export const traces = pgTable(
  "traces",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    source: text("source").notNull(),
    externalTraceId: text("external_trace_id").notNull(),
    environment: text("environment").notNull(),
    targetId: text("target_id"),
    targetVersion: text("target_version"),
    targetFingerprint: text("target_fingerprint"),
    promptDefinitionId: text("prompt_definition_id"),
    promptVersionId: text("prompt_version_id"),
    promptHash: text("prompt_hash"),
    sessionId: text("session_id"),
    scopeKeys: jsonb("scope_keys").notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    status: text("status").notNull(),
    input: jsonb("input"),
    output: jsonb("output"),
    metadata: jsonb("metadata").notNull().default({}),
    tags: text("tags").array().notNull().default([]),
    usage: jsonb("usage"),
    costUsd: numeric("cost_usd"),
    latencyMs: integer("latency_ms"),
    rawArtifactId: text("raw_artifact_id").references(() => rawArtifacts.id, { onDelete: "set null" }),
    canonicalSchemaVersion: text("canonical_schema_version").notNull(),
    contentHash: text("content_hash").notNull(),
    redactionState: text("redaction_state").notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique("traces_deduplication_key").on(table.workspaceId, table.source, table.externalTraceId, table.contentHash)]
);

export const spans = pgTable(
  "spans",
  {
    id: text("id").primaryKey(),
    traceId: text("trace_id").notNull().references(() => traces.id, { onDelete: "cascade" }),
    externalSpanId: text("external_span_id").notNull(),
    parentSpanId: text("parent_span_id"),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    status: text("status").notNull(),
    error: text("error"),
    input: jsonb("input"),
    output: jsonb("output"),
    provider: text("provider"),
    model: text("model"),
    modelParameters: jsonb("model_parameters").notNull().default({}),
    messages: jsonb("messages"),
    usage: jsonb("usage"),
    costUsd: numeric("cost_usd"),
    toolName: text("tool_name"),
    toolCallId: text("tool_call_id"),
    toolArguments: jsonb("tool_arguments"),
    toolResult: jsonb("tool_result"),
    retrievalEvidence: jsonb("retrieval_evidence"),
    handoff: jsonb("handoff"),
    attributes: jsonb("attributes").notNull().default({}),
    events: jsonb("events").notNull().default([]),
    links: jsonb("links").notNull().default([]),
    promptVersionId: text("prompt_version_id"),
    promptHash: text("prompt_hash"),
    rawSourceRef: text("raw_source_ref")
  },
  (table) => [unique("spans_trace_external_id").on(table.traceId, table.externalSpanId)]
);

export const evalItems = pgTable("eval_items", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull()
});

export const evalItemVersions = pgTable(
  "eval_item_versions",
  {
    id: text("id").primaryKey(),
    evalItemId: text("eval_item_id").notNull().references(() => evalItems.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    outputSchema: jsonb("output_schema").notNull(),
    config: jsonb("config").notNull().default({}),
    fingerprint: text("fingerprint").notNull(),
    calibrationState: text("calibration_state").notNull().default("uncalibrated"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique("eval_item_version_number").on(table.evalItemId, table.version)]
);

export const runPlans = pgTable("run_plans", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  resolvedPlan: jsonb("resolved_plan").notNull(),
  fingerprint: text("fingerprint").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const evalRuns = pgTable(
  "eval_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
    runPlanId: text("run_plan_id").notNull().references(() => runPlans.id),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique("eval_runs_idempotency").on(table.workspaceId, table.idempotencyKey)]
);

export const runSamples = pgTable(
  "run_samples",
  {
    id: text("id").primaryKey(),
    evalRunId: text("eval_run_id").notNull().references(() => evalRuns.id, { onDelete: "cascade" }),
    rowId: text("row_id").notNull(),
    sourceKind: text("source_kind").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    status: text("status").notNull()
  },
  (table) => [unique("run_samples_row_id").on(table.evalRunId, table.rowId)]
);

export const promptDefinitions = pgTable("prompt_definitions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  targetId: text("target_id"),
  stableKey: text("stable_key").notNull(),
  variableSchema: jsonb("variable_schema").notNull().default({}),
  componentSchema: jsonb("component_schema").notNull().default({})
});

export const promptVersions = pgTable("prompt_versions", {
  id: text("id").primaryKey(),
  promptDefinitionId: text("prompt_definition_id").notNull().references(() => promptDefinitions.id),
  compiledText: text("compiled_text").notNull(),
  components: jsonb("components").notNull(),
  parentVersionIds: text("parent_version_ids").array().notNull().default([]),
  contentHash: text("content_hash").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const promptReleases = pgTable(
  "prompt_releases",
  {
    id: text("id").primaryKey(),
    promptDefinitionId: text("prompt_definition_id").notNull().references(() => promptDefinitions.id),
    promptVersionId: text("prompt_version_id").notNull().references(() => promptVersions.id),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    stage: text("stage").notNull(),
    active: boolean("active").notNull().default(true),
    previousReleaseId: text("previous_release_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("one_active_prompt_release_per_scope_drizzle").on(table.promptDefinitionId, table.scopeType, table.scopeId, table.stage).where(sql`${table.active}`)]
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    workflowId: text("workflow_id").notNull(),
    subjectId: text("subject_id"),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    input: jsonb("input").notNull().default({}),
    output: jsonb("output"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique("workflow_runs_idempotency").on(table.workspaceId, table.workflowId, table.idempotencyKey)]
);

export const workflowEvents = pgTable("workflow_events", {
  id: text("id").primaryKey(),
  workflowRunId: text("workflow_run_id").notNull().references(() => workflowRuns.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const queueMessages = pgTable(
  "queue_messages",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    queueName: text("queue_name").notNull(),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").notNull().default({}),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    claimedBy: text("claimed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [unique("queue_messages_idempotency").on(table.workspaceId, table.queueName, table.idempotencyKey)]
);

export const approvalRequests = pgTable("approval_requests", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  requesterId: text("requester_id").notNull(),
  status: text("status").notNull(),
  risk: text("risk").notNull(),
  summary: text("summary").notNull(),
  payloadHash: text("payload_hash").notNull(),
  payloadPreview: jsonb("payload_preview").notNull().default({}),
  decidedBy: text("decided_by"),
  decisionReason: text("decision_reason"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id"),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  metadataHash: text("metadata_hash"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

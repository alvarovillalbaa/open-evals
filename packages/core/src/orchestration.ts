import { stableHash } from "./hash";
import type { JsonValue } from "./types";

export type WorkflowId =
  | "ingestTraceWorkflow"
  | "evalRunWorkflow"
  | "calibrationWorkflow"
  | "benchmarkRunWorkflow"
  | "scenarioRunWorkflow"
  | "variantMatrixWorkflow"
  | "optimizationCampaignWorkflow"
  | "onlineExperimentAnalysisWorkflow"
  | "releasePromotionWorkflow"
  | "rollbackWorkflow"
  | "retentionCleanupWorkflow";

export type WorkflowStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type QueueMessageStatus = "available" | "claimed" | "completed" | "dead_lettered";

export interface WorkflowRunRecord {
  id: string;
  workflowId: WorkflowId;
  workspaceId: string;
  subjectId?: string;
  status: WorkflowStatus;
  idempotencyKey: string;
  input: Record<string, JsonValue>;
  output?: Record<string, JsonValue>;
  error?: string;
  attempts: number;
}

export interface WorkflowAdapter {
  kind: "local" | "vercel";
  start(input: StartWorkflowInput): Promise<WorkflowRunRecord>;
  resume(id: string, event: Record<string, JsonValue>): Promise<WorkflowRunRecord>;
  cancel(id: string, reason: string): Promise<WorkflowRunRecord>;
}

export interface StartWorkflowInput {
  workflowId: WorkflowId;
  workspaceId: string;
  subjectId?: string;
  idempotencyKey: string;
  input?: Record<string, JsonValue>;
}

export interface QueueEnvelope {
  id: string;
  queueName: string;
  workspaceId: string;
  idempotencyKey: string;
  payload: Record<string, JsonValue>;
  status: QueueMessageStatus;
  attempts: number;
}

export interface QueueAdapter {
  kind: "local" | "vercel";
  enqueue(input: EnqueueInput): Promise<QueueEnvelope>;
  claim(queueName: string, workerId: string): Promise<QueueEnvelope | undefined>;
  complete(id: string): Promise<QueueEnvelope>;
  deadLetter(id: string, reason: string): Promise<QueueEnvelope>;
}

export interface EnqueueInput {
  queueName: string;
  workspaceId: string;
  idempotencyKey: string;
  payload: Record<string, JsonValue>;
}

export class InMemoryWorkflowAdapter implements WorkflowAdapter {
  kind = "local" as const;
  private readonly runs = new Map<string, WorkflowRunRecord>();

  async start(input: StartWorkflowInput): Promise<WorkflowRunRecord> {
    const key = `${input.workspaceId}:${input.workflowId}:${input.idempotencyKey}`;
    const existing = this.runs.get(key);
    if (existing) return existing;
    const record: WorkflowRunRecord = {
      id: `wf_${stableHash(key, 18)}`,
      workflowId: input.workflowId,
      workspaceId: input.workspaceId,
      subjectId: input.subjectId,
      status: "queued",
      idempotencyKey: input.idempotencyKey,
      input: input.input ?? {},
      attempts: 0
    };
    this.runs.set(key, record);
    return record;
  }

  async resume(id: string, event: Record<string, JsonValue>): Promise<WorkflowRunRecord> {
    const record = this.find(id);
    const next = { ...record, status: "running" as const, attempts: record.attempts + 1, output: event };
    this.replace(next);
    return next;
  }

  async cancel(id: string, reason: string): Promise<WorkflowRunRecord> {
    const record = this.find(id);
    const next = { ...record, status: "cancelled" as const, error: reason };
    this.replace(next);
    return next;
  }

  private find(id: string): WorkflowRunRecord {
    for (const record of this.runs.values()) if (record.id === id) return record;
    throw new Error(`unknown_workflow_run:${id}`);
  }

  private replace(record: WorkflowRunRecord) {
    const key = `${record.workspaceId}:${record.workflowId}:${record.idempotencyKey}`;
    this.runs.set(key, record);
  }
}

export class InMemoryQueueAdapter implements QueueAdapter {
  kind = "local" as const;
  private readonly messages = new Map<string, QueueEnvelope>();

  async enqueue(input: EnqueueInput): Promise<QueueEnvelope> {
    const id = `qm_${stableHash({ queueName: input.queueName, workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey }, 18)}`;
    const existing = this.messages.get(id);
    if (existing) return existing;
    const message: QueueEnvelope = {
      id,
      queueName: input.queueName,
      workspaceId: input.workspaceId,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      status: "available",
      attempts: 0
    };
    this.messages.set(id, message);
    return message;
  }

  async claim(queueName: string, workerId: string): Promise<QueueEnvelope | undefined> {
    for (const message of this.messages.values()) {
      if (message.queueName !== queueName || message.status !== "available") continue;
      const next = { ...message, status: "claimed" as const, attempts: message.attempts + 1, payload: { ...message.payload, claimedBy: workerId } };
      this.messages.set(message.id, next);
      return next;
    }
    return undefined;
  }

  async complete(id: string): Promise<QueueEnvelope> {
    return this.update(id, "completed");
  }

  async deadLetter(id: string, reason: string): Promise<QueueEnvelope> {
    const message = await this.update(id, "dead_lettered");
    const next = { ...message, payload: { ...message.payload, deadLetterReason: reason } };
    this.messages.set(id, next);
    return next;
  }

  private async update(id: string, status: QueueMessageStatus): Promise<QueueEnvelope> {
    const message = this.messages.get(id);
    if (!message) throw new Error(`unknown_queue_message:${id}`);
    const next = { ...message, status };
    this.messages.set(id, next);
    return next;
  }
}

export function workflowIdempotencyKey(input: Pick<StartWorkflowInput, "workflowId" | "workspaceId" | "subjectId" | "input">): string {
  return stableHash(input, 48);
}

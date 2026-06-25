import { stableHash } from "./hash";
import type { JsonValue } from "./types";

export type ApprovalAction =
  | "start_eval_run"
  | "start_optimization_campaign"
  | "run_variant_matrix"
  | "start_online_experiment"
  | "promote_prompt_release"
  | "rollback_prompt_release"
  | "create_structural_work_order";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface ApprovalRequest {
  id: string;
  workspaceId: string;
  action: ApprovalAction;
  requesterId: string;
  status: ApprovalStatus;
  summary: string;
  risk: "low" | "medium" | "high";
  payloadHash: string;
  payloadPreview: Record<string, JsonValue>;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
}

export function createApprovalRequest(input: {
  workspaceId: string;
  action: ApprovalAction;
  requesterId: string;
  summary: string;
  risk: ApprovalRequest["risk"];
  payloadPreview: Record<string, JsonValue>;
  now?: string;
}): ApprovalRequest {
  const createdAt = input.now ?? new Date().toISOString();
  const payloadHash = stableHash(input.payloadPreview, 64);
  return {
    id: `approval_${stableHash({ ...input, createdAt, payloadHash }, 18)}`,
    workspaceId: input.workspaceId,
    action: input.action,
    requesterId: input.requesterId,
    status: "pending",
    summary: input.summary,
    risk: input.risk,
    payloadHash,
    payloadPreview: input.payloadPreview,
    createdAt
  };
}

export function approveRequest(request: ApprovalRequest, userId: string, reason: string, now = new Date().toISOString()): ApprovalRequest {
  if (request.status !== "pending") throw new Error(`approval_not_pending:${request.id}`);
  return { ...request, status: "approved", decidedAt: now, decidedBy: userId, decisionReason: reason };
}

export function rejectRequest(request: ApprovalRequest, userId: string, reason: string, now = new Date().toISOString()): ApprovalRequest {
  if (request.status !== "pending") throw new Error(`approval_not_pending:${request.id}`);
  return { ...request, status: "rejected", decidedAt: now, decidedBy: userId, decisionReason: reason };
}


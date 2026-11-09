import type { CustomEvalSetContract } from "./custom-evals";
import type { ProvidedOutputDatasetSnapshot, ProvidedOutputMemberProof } from "./provided-output-types";
import type { EvalItemVersion, EvalResult, GateResult, JsonValue, Usage } from "./types";

export interface HttpEvalTarget {
  targetId: string;
  targetVersion: string;
  endpoint: string;
  timeoutMs: number;
}
export interface HttpEvalLimits { concurrency: number; maxDurationSeconds: number }
export interface HttpEvalPlanDraft {
  schemaVersion: "http-eval-plan-draft-v1";
  planId: string;
  versionId: string;
  version: number;
  expectedVersionId: string | null;
  name: string;
  datasetVersionId: string;
  evalSetVersionIds: string[];
  target: HttpEvalTarget;
  limits: HttpEvalLimits;
}
export interface HttpEvalPlanSaveRequest {
  schemaVersion: "http-eval-plan-save-v1";
  draft: HttpEvalPlanDraft;
  expectedPreviewFingerprint: string;
}
export interface HttpEvalPlanHead {
  planId: string;
  versionId: string;
  version: number;
  name: string;
  fingerprint: string;
}
export interface HttpEvalSavedSet { contract: CustomEvalSetContract; members: ProvidedOutputMemberProof[] }
export interface HttpEvalSetSource { contract: unknown; members: ProvidedOutputMemberProof[] }
export interface HttpEvalPlanContent {
  schemaVersion: "http-target-eval-v1";
  draft: HttpEvalPlanDraft;
  dataset: ProvidedOutputDatasetSnapshot;
  datasetFingerprint: string;
  evalSets: HttpEvalSavedSet[];
  items: EvalItemVersion[];
  samples: Array<{ rowId: string; datasetRowId: string; rowKey: string; fingerprint: string }>;
  target: HttpEvalTarget & { protocol: "http-json-target-v1"; fingerprint: string };
  policy: { evaluator: "case_insensitive_contains_v1"; expectedOutputVisibility: "hidden"; maxTargetCalls: number; maxJudgeCalls: 0; codeVersion: "http-target-eval-v1" };
  fingerprint: string;
}
export interface HttpEvalPlanPreview {
  schemaVersion: "http-eval-plan-preview-v1";
  workspaceId: string;
  draft: HttpEvalPlanDraft;
  head: HttpEvalPlanHead | null;
  content: HttpEvalPlanContent;
  recordByteAllowance: number;
  fingerprint: string;
}
export interface HttpEvalPlanStorageIds { planId: string; versionId: string; auditId: string }
export interface HttpEvalPlanVersionRecord {
  schemaVersion: "http-eval-plan-record-v1";
  workspaceId: string;
  storage: HttpEvalPlanStorageIds;
  createdAt: string;
  head: HttpEvalPlanHead | null;
  content: HttpEvalPlanContent;
  previewFingerprint: string;
  requestFingerprint: string;
  fingerprint: string;
}
export interface ResolveHttpEvalPlanInput {
  workspaceId: string;
  draft: unknown;
  dataset: unknown;
  evalSets: unknown[];
  head: HttpEvalPlanHead | null;
}
export interface PrepareHttpEvalPlanRecordInput extends Omit<ResolveHttpEvalPlanInput, "draft"> {
  request: unknown;
  createdAt: string;
}

export interface HttpEvalStartRequest {
  schemaVersion: "http-eval-start-v1";
  runId: string;
  planVersionId: string;
  expectedPlanFingerprint: string;
}
export type HttpEvalRowStatus = "pending" | "claimed" | "succeeded" | "failed" | "outcome_unknown" | "not_sent";
export type HttpEvalRunStatus = "running" | "completed" | "failed" | "interrupted" | "outcome_unknown";
export interface HttpEvalClaim {
  rowId: string;
  claimToken: string;
  claimedAt: string;
  requestFingerprint: string;
}
export interface HttpEvalLedgerRow {
  rowId: string;
  status: HttpEvalRowStatus;
  claim: HttpEvalClaim | null;
  eventId: string | null;
  eventFingerprint: string | null;
}
export interface HttpEvalRunLedger {
  schemaVersion: "http-eval-run-ledger-v1";
  workspaceId: string;
  publicRunId: string;
  runId: string;
  workflowId: string;
  planVersionId: string;
  planFingerprint: string;
  requestFingerprint: string;
  leaseToken: string;
  startedAt: string;
  deadlineAt: string;
  leaseExpiresAt: string;
  stopReason: string | null;
  status: HttpEvalRunStatus;
  rows: HttpEvalLedgerRow[];
  fingerprint: string;
}
export interface HttpEvalCallBody {
  schemaVersion: "http-json-target-request-v1";
  requestFingerprint: string;
  runId: string;
  rowId: string;
  input: JsonValue;
  context?: JsonValue;
  history?: JsonValue;
}
export interface HttpEvalCallRequest {
  endpoint: string;
  timeoutMs: number;
  body: string;
  requestFingerprint: string;
  idempotencyKey: string;
}
export interface HttpEvalNativeResponse { bodyText: string; statusCode: number; bytes: number; elapsedMs: number }
export type HttpEvalNativeTransport = (request: HttpEvalCallRequest & { signal?: AbortSignal }) => Promise<HttpEvalNativeResponse>;
export interface HttpEvalTargetResponse {
  schemaVersion: "http-json-target-response-v1";
  requestFingerprint: string;
  output: JsonValue;
  usage?: Usage;
  costUsd?: number;
}
export interface HttpEvalRowEvent {
  schemaVersion: "http-eval-row-event-v1";
  id: string;
  workspaceId: string;
  publicRunId: string;
  rowId: string;
  claim: HttpEvalClaim | null;
  status: "succeeded" | "failed" | "outcome_unknown" | "not_sent";
  completedAt: string;
  response: HttpEvalTargetResponse | null;
  rawResponseHash: string | null;
  errorCode: string | null;
  fingerprint: string;
}
export interface HttpEvalResult extends EvalResult { sourceOutputFingerprint: string; fingerprint: string }
export interface HttpEvalExecution {
  schemaVersion: "http-eval-execution-v1";
  results: HttpEvalResult[];
  gates: GateResult[];
  fingerprint: string;
}
export interface HttpEvalRunRecord {
  schemaVersion: "http-eval-run-record-v1";
  workspaceId: string;
  plan: HttpEvalPlanVersionRecord;
  ledger: HttpEvalRunLedger;
  events: HttpEvalRowEvent[];
  execution: HttpEvalExecution;
  fingerprint: string;
}
export interface HttpEvalRunStorageIds { runId: string; workflowId: string; auditId: string; reservationEventId: string }
export interface CreateHttpEvalLedgerInput {
  workspaceId: string;
  request: unknown;
  plan: unknown;
  startedAt: string;
  leaseToken: string;
}
export interface ClaimHttpEvalRowInput {
  plan: unknown;
  ledger: unknown;
  rowId: string;
  leaseToken: string;
  claimToken: string;
  now: string;
}
export interface FinalizeHttpEvalRowInput {
  plan: unknown;
  ledger: unknown;
  rowId: string;
  claimToken: string;
  completedAt: string;
  responseText?: string;
  errorCode?: string;
  errorOutcome?: "not_sent" | "unknown";
}
export interface HttpEvalFinalizedRow { ledger: HttpEvalRunLedger; event: HttpEvalRowEvent; results: HttpEvalResult[] }
export interface RecoverHttpEvalRunInput { plan: unknown; ledger: unknown; now: string }
export interface StopHttpEvalRunInput { plan: unknown; ledger: unknown; leaseToken: string; now: string; reasonCode: string }

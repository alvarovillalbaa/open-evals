import type { CustomEvalSetContract } from "./custom-evals";
import type { EvalResult, GateResult, JsonValue, RunSample } from "./types";

export interface ProvidedOutputRunDraft {
  schemaVersion: "provided-output-run-draft-v1";
  runId: string;
  datasetVersionId: string;
  evalSetVersionId: string;
  outputs: Array<{ rowId: string; output: string }>;
}

export interface ProvidedOutputRunRequest {
  schemaVersion: "provided-output-run-request-v1";
  draft: ProvidedOutputRunDraft;
  expectedPlanFingerprint: string;
}

export interface ProvidedOutputJsonField {
  present: boolean;
  value: JsonValue;
}

export interface ProvidedOutputDatasetRow {
  id: string;
  rowKey: string;
  input: JsonValue;
  expectedOutput: ProvidedOutputJsonField;
  context: ProvidedOutputJsonField;
  history: ProvidedOutputJsonField;
  traceFixture: ProvidedOutputJsonField;
  metadata: Record<string, JsonValue>;
  reviewStatus: "synthetic" | "reviewed" | "golden";
}

export interface ProvidedOutputDatasetSnapshot {
  dataset: { id: string; name: string; kind: string };
  version: { id: string; datasetId: string; version: number; fingerprint: string; createdAt: string };
  rows: ProvidedOutputDatasetRow[];
}

export interface ProvidedOutputMemberProof {
  evalSetVersionId: string;
  evalItemVersionId: string;
  position: number;
  weight: number;
  criticality: "critical";
  itemFingerprint: string;
}

export interface ProvidedOutputEvalSetSource {
  contract: unknown;
  members: ProvidedOutputMemberProof[];
}

export interface ProvidedOutputSavedEvalSet {
  contract: CustomEvalSetContract;
  members: ProvidedOutputMemberProof[];
}

export interface ProvidedOutputSample extends RunSample {
  datasetRowId: string;
  datasetRowFingerprint: string;
  output: string;
}

export interface ProvidedOutputRunPlan {
  schemaVersion: "provided-output-run-v1";
  id: string;
  runId: string;
  publicRunId: string;
  workspaceId: string;
  draft: ProvidedOutputRunDraft;
  dataset: ProvidedOutputDatasetSnapshot;
  datasetFingerprint: string;
  rowFingerprints: Array<{ rowId: string; fingerprint: string }>;
  evalSet: ProvidedOutputSavedEvalSet;
  target: { kind: "provided_output"; version: "provided-output-target-v1"; fingerprint: string };
  sampleManifest: {
    schemaVersion: "provided-output-sample-manifest-v1";
    rows: ProvidedOutputSample[];
    ordering: "utf8_row_key_then_id";
    inclusionPolicy: "all_rows";
    duplicatePolicy: "reject";
    fingerprint: string;
  };
  policy: {
    schemaVersion: "provided-output-policy-v1";
    evaluator: "case_insensitive_contains_v1";
    expectedOutputVisibility: "visible";
    maxTargetCalls: 0;
    maxJudgeCalls: 0;
  };
  fingerprint: string;
}

export interface ProvidedOutputExecution {
  schemaVersion: "provided-output-execution-v1";
  planFingerprint: string;
  results: EvalResult[];
  gates: GateResult[];
  fingerprint: string;
}

export interface ProvidedOutputRunRecord {
  schemaVersion: "provided-output-run-record-v1";
  workspaceId: string;
  requestFingerprint: string;
  plan: ProvidedOutputRunPlan;
  execution: ProvidedOutputExecution;
  fingerprint: string;
}

export interface ResolveProvidedOutputRunInput {
  workspaceId: string;
  draft: unknown;
  dataset: unknown;
  evalSet: ProvidedOutputEvalSetSource;
}

export interface PrepareProvidedOutputRunRecordInput {
  workspaceId: string;
  request: unknown;
  dataset: unknown;
  evalSet: ProvidedOutputEvalSetSource;
}

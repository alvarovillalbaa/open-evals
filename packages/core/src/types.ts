import { z } from "zod";

export const spanKindSchema = z.enum([
  "LLM",
  "AGENT",
  "CHAIN",
  "WORKFLOW",
  "TOOL",
  "RETRIEVER",
  "EMBEDDING",
  "EVALUATOR",
  "GUARDRAIL",
  "OTHER"
]);
export type SpanKind = z.infer<typeof spanKindSchema>;

export const targetKindSchema = z.enum([
  "historical_output",
  "invoke_live_target",
  "invoke_http_target",
  "invoke_mcp_target",
  "invoke_local_target",
  "provided_output"
]);
export type TargetKind = z.infer<typeof targetKindSchema>;

export const criticalitySchema = z.enum(["critical", "standard", "diagnostic"]);
export type Criticality = z.infer<typeof criticalitySchema>;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface CanonicalTrace {
  id: string;
  source: string;
  externalTraceId: string;
  workspaceId: string;
  projectId?: string;
  environment: string;
  targetId?: string;
  targetVersion?: string;
  targetFingerprint?: string;
  promptDefinitionId?: string;
  promptVersionId?: string;
  promptHash?: string;
  sessionId?: string;
  scopeKeys: Record<string, string>;
  startedAt: string;
  endedAt?: string;
  status: "ok" | "error" | "unknown";
  input?: JsonValue;
  output?: JsonValue;
  metadata: Record<string, JsonValue>;
  tags: string[];
  usage?: Usage;
  costUsd?: number;
  latencyMs?: number;
  rawArtifactRef?: string;
  canonicalSchemaVersion: "canonical-trace-v1";
  contentHash: string;
  redactionState: "raw" | "redacted" | "blocked";
  ingestedAt: string;
  spans: CanonicalSpan[];
}

export interface CanonicalSpan {
  id: string;
  traceId: string;
  externalSpanId: string;
  parentSpanId?: string;
  kind: SpanKind;
  name: string;
  startedAt: string;
  endedAt?: string;
  status: "ok" | "error" | "unknown";
  error?: string;
  input?: JsonValue;
  output?: JsonValue;
  provider?: string;
  model?: string;
  modelParameters: Record<string, JsonValue>;
  messages?: Array<{ role: string; content: JsonValue }>;
  usage?: Usage;
  costUsd?: number;
  toolName?: string;
  toolCallId?: string;
  toolArguments?: JsonValue;
  toolResult?: JsonValue;
  retrievalEvidence?: JsonValue;
  handoff?: { source?: string; target?: string };
  attributes: Record<string, JsonValue>;
  events: Array<{ name: string; time?: string; attributes?: Record<string, JsonValue> }>;
  links: Array<{ traceId?: string; spanId?: string; attributes?: Record<string, JsonValue> }>;
  promptVersionId?: string;
  promptHash?: string;
  rawSourceRef?: string;
}

export interface EvaluationFieldSchema {
  key: string;
  displayName: string;
  type: "score" | "label" | "boolean" | "text" | "integer" | "number" | "json";
  minimum?: number;
  maximum?: number;
  threshold?: number;
  weight?: number;
  criticality?: Criticality;
  aggregation?: "mean" | "min" | "max" | "pass_rate";
  allowedValues?: string[];
  hardFailValues?: string[];
  gating?: boolean;
}

export interface EvalItemVersion {
  id: string;
  itemId: string;
  name: string;
  type:
    | "llm_judge"
    | "string_check"
    | "text_similarity"
    | "trace_check"
    | "json_schema"
    | "code_evaluator"
    | "composite";
  evaluationUnits: string[];
  outputSchema: { fields: EvaluationFieldSchema[] };
  criticality: Criticality;
  config: Record<string, JsonValue>;
  version: number;
  fingerprint: string;
}

export interface EvalSetVersion {
  id: string;
  setId: string;
  name: string;
  itemVersions: Array<{ item: EvalItemVersion; weight: number; criticality: Criticality }>;
  gates: {
    rowThreshold: number;
    datasetPassRateThreshold: number;
    evalSetThreshold: number;
    runThreshold: number;
  };
  fingerprint: string;
}

export interface DatasetRow {
  id: string;
  input: JsonValue;
  output?: JsonValue;
  expectedOutput?: JsonValue;
  context?: JsonValue;
  history?: JsonValue;
  trace?: CanonicalTrace;
  metadata: Record<string, JsonValue>;
  reviewStatus: "synthetic" | "reviewed" | "golden";
}

export interface RunPlan {
  id: string;
  targetId: string;
  targetKind: TargetKind;
  sourceKind: string;
  sourceSnapshot: Record<string, JsonValue>;
  datasetVersionIds: string[];
  scenarioVersionIds: string[];
  sampleManifest: SampleManifest;
  sampleSelectionPolicy: Record<string, JsonValue>;
  randomSeed: string;
  evalSetVersionIds: string[];
  evalItemVersionIds: string[];
  expectedOutputVisibility: "hidden" | "visible" | "field_scoped";
  thresholdHierarchy: Record<string, JsonValue>;
  concurrency: number;
  retryPolicy: Record<string, JsonValue>;
  stopPolicy: StopPolicy;
  budget: Record<string, JsonValue>;
  promptVersionId?: string;
  candidateId?: string;
  dataPolicyFingerprint: string;
  codeVersion: string;
  planFingerprint: string;
}

export interface SampleManifest {
  schemaVersion: "sample-manifest-v1";
  rows: RunSample[];
  population?: Record<string, JsonValue>;
  filters?: Record<string, JsonValue>;
  strata?: Record<string, JsonValue>;
  seed: string;
  inclusionPolicy: string;
  duplicatePolicy: string;
  fingerprint: string;
}

export interface RunSample {
  rowId: string;
  rowIndex: number;
  sourceId: string;
  sourceKind: string;
  snapshotHash: string;
  input: JsonValue;
  output?: JsonValue;
  expectedOutput?: JsonValue;
  context?: JsonValue;
  traceId?: string;
}

export interface StopPolicy {
  warmupRows: number;
  batchSize: number;
  zeroPassStop: boolean;
  maxObservedFailureRate?: number;
  criticalEvaluatorFailure: boolean;
  maxProviderErrorRate?: number;
  maxCostUsd?: number;
  maxTokens?: number;
  maxDurationSeconds?: number;
  maxTargetCalls?: number;
  maxJudgeCalls?: number;
  passFeasibilityStop: boolean;
}

export interface EvalFieldResult {
  key: string;
  value: JsonValue;
  normalizedScore?: number;
  passed?: boolean;
  decision?: "pass" | "soft_fail" | "hard_fail";
  rationale?: string;
  confidence?: number;
}

export interface EvalResult {
  id: string;
  rowId: string;
  evalItemVersionId: string;
  originalOutput: Record<string, JsonValue>;
  fields: EvalFieldResult[];
  conciseRationale?: string;
  evidenceRefs: string[];
  evaluatorVersion: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
  usage?: Usage;
  costUsd?: number;
  error?: string;
}

export interface GateResult {
  id: string;
  runId: string;
  level: "field" | "item_row" | "row" | "dataset" | "eval_set" | "target" | "criticality" | "run";
  scopeId: string;
  score?: number;
  passed: boolean;
  decision: "pass" | "soft_fail" | "hard_fail";
  thresholdVersion: string;
  formula: string;
  reasons: string[];
  failedCriticalComponents: string[];
  sourceResultIds: string[];
  fingerprint: string;
}

export interface PromptComponent {
  id: string;
  kind: string;
  locked: boolean;
  content: string;
}

export interface PromptVersion {
  id: string;
  definitionId: string;
  components: PromptComponent[];
  compiledText: string;
  parentVersionIds: string[];
  contentHash: string;
  status: "draft" | "searching" | "offline_validated" | "shadow" | "canary" | "active" | "retired" | "rolled_back";
}

export interface PromptRelease {
  id: string;
  definitionId: string;
  versionId: string;
  scopeType: "platform" | "workspace" | "project" | "company" | "user" | "session";
  scopeId: string;
  stage: "shadow" | "canary" | "active";
  active: boolean;
  previousReleaseId?: string;
}

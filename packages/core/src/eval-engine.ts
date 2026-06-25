import type {
  DatasetRow,
  EvalFieldResult,
  EvalItemVersion,
  EvalResult,
  EvalSetVersion,
  GateResult,
  JsonValue,
  RunPlan,
  RunSample,
  SampleManifest,
  StopPolicy
} from "./types";
import { stableHash, stableRowId } from "./hash";

export const defaultStopPolicy: StopPolicy = {
  warmupRows: 30,
  batchSize: 30,
  zeroPassStop: true,
  criticalEvaluatorFailure: true,
  passFeasibilityStop: true
};

export function buildSampleManifest(rows: DatasetRow[], seed = "demo-seed"): SampleManifest {
  const samples: RunSample[] = rows.map((row, index) => {
    const sourceKind = row.reviewStatus === "golden" ? "golden_dataset" : "dataset";
    const rowId = stableRowId(sourceKind, row.id, row.input);
    return {
      rowId,
      rowIndex: index,
      sourceId: row.id,
      sourceKind,
      snapshotHash: stableHash(row),
      input: row.input,
      output: row.output,
      expectedOutput: row.expectedOutput,
      context: row.context,
      traceId: row.trace?.id
    };
  });
  return {
    schemaVersion: "sample-manifest-v1",
    rows: samples,
    seed,
    inclusionPolicy: "frozen_order",
    duplicatePolicy: "reject",
    fingerprint: stableHash({ samples, seed }, 64)
  };
}

export function resolveRunPlan(args: {
  id: string;
  targetId: string;
  targetKind: RunPlan["targetKind"];
  rows: DatasetRow[];
  evalSet: EvalSetVersion;
  promptVersionId?: string;
  candidateId?: string;
  historicalDataAllowed?: boolean;
}): RunPlan {
  if (args.targetKind === "historical_output" && !args.historicalDataAllowed) {
    throw new Error("historical_data_policy_denied");
  }
  if (args.targetKind === "provided_output") {
    const blank = args.rows.find((row) => row.output === undefined || row.output === null || row.output === "");
    if (blank) throw new Error(`provided_output_requires_non_empty_output:${blank.id}`);
  }
  const sampleManifest = buildSampleManifest(args.rows);
  const planBase = {
    targetId: args.targetId,
    targetKind: args.targetKind,
    sourceKind: "demo",
    sourceSnapshot: { rowCount: args.rows.length },
    sampleManifest,
    evalSetVersionIds: [args.evalSet.id],
    evalItemVersionIds: args.evalSet.itemVersions.map((item) => item.item.id),
    promptVersionId: args.promptVersionId,
    candidateId: args.candidateId
  };
  return {
    id: args.id,
    targetId: args.targetId,
    targetKind: args.targetKind,
    sourceKind: "demo",
    sourceSnapshot: { rowCount: args.rows.length },
    datasetVersionIds: ["demo-dataset-v1"],
    scenarioVersionIds: ["demo-scenario-v1"],
    sampleManifest,
    sampleSelectionPolicy: { strategy: "frozen_order", seed: sampleManifest.seed },
    randomSeed: sampleManifest.seed,
    evalSetVersionIds: [args.evalSet.id],
    evalItemVersionIds: args.evalSet.itemVersions.map((item) => item.item.id),
    expectedOutputVisibility: "hidden",
    thresholdHierarchy: args.evalSet.gates as unknown as Record<string, JsonValue>,
    concurrency: 30,
    retryPolicy: { maxAttempts: 2, idempotency: "row_id" },
    stopPolicy: defaultStopPolicy,
    budget: { maxCostUsd: 5, maxTokens: 100000, maxDurationSeconds: 600 },
    promptVersionId: args.promptVersionId,
    candidateId: args.candidateId,
    dataPolicyFingerprint: stableHash({ historicalDataAllowed: Boolean(args.historicalDataAllowed) }, 64),
    codeVersion: "local-dev",
    planFingerprint: stableHash(planBase, 64)
  };
}

function text(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function runDeterministicEval(item: EvalItemVersion, sample: RunSample): EvalResult {
  const expected = text(sample.expectedOutput);
  const actual = text(sample.output);
  let fields: EvalFieldResult[];
  if (item.type === "string_check") {
    const needle = String(item.config["contains"] ?? expected);
    const passed = actual.toLowerCase().includes(needle.toLowerCase());
    fields = [{ key: "contains_expected", value: passed, passed, decision: passed ? "pass" : "hard_fail" }];
  } else if (item.type === "text_similarity") {
    const score = similarity(actual, expected);
    const threshold = Number(item.outputSchema.fields[0]?.threshold ?? 80);
    fields = [{ key: "similarity", value: score, normalizedScore: score, passed: score >= threshold, decision: score >= threshold ? "pass" : "soft_fail" }];
  } else if (item.type === "trace_check") {
    const hasTool = Boolean(sample.traceId);
    fields = [{ key: "trace_present", value: hasTool, passed: hasTool, decision: hasTool ? "pass" : "soft_fail" }];
  } else {
    const groundedness = actual.includes("pre-populated") ? 92 : 62;
    const instruction = actual.includes("completed") ? 55 : 88;
    const safety = actual.includes("completed") ? 60 : 91;
    const completeness = actual.length > 40 ? 87 : 72;
    const risk = safety < 50 ? "critical" : safety < 70 ? "high" : "low";
    const failure = groundedness < 80 ? "grounding" : instruction < 80 ? "policy" : "none";
    fields = [
      scoreField("groundedness", groundedness, 85, "critical"),
      scoreField("instruction_following", instruction, 80, "standard"),
      scoreField("safety", safety, 90, "critical"),
      scoreField("completeness", completeness, 80, "standard"),
      { key: "risk_label", value: risk, passed: risk !== "critical", decision: risk === "critical" ? "hard_fail" : "pass" },
      { key: "failure_type", value: failure, passed: failure === "none", decision: failure === "none" ? "pass" : "soft_fail" }
    ];
  }
  return {
    id: `res_${stableHash({ item: item.id, rowId: sample.rowId }, 18)}`,
    rowId: sample.rowId,
    evalItemVersionId: item.id,
    originalOutput: Object.fromEntries(fields.map((field) => [field.key, field.value])) as Record<string, JsonValue>,
    fields,
    conciseRationale: "Deterministic fixture evaluator; no hidden chain-of-thought captured.",
    evidenceRefs: sample.traceId ? [sample.traceId] : [],
    evaluatorVersion: item.fingerprint,
    provider: "local",
    model: "deterministic"
  };
}

function scoreField(key: string, value: number, threshold: number, criticality: string): EvalFieldResult {
  const passed = value >= threshold;
  return {
    key,
    value,
    normalizedScore: value,
    passed,
    decision: passed ? "pass" : criticality === "critical" ? "hard_fail" : "soft_fail"
  };
}

export function similarity(left: string, right: string): number {
  if (!left && !right) return 100;
  const a = new Set(left.toLowerCase().split(/\W+/).filter(Boolean));
  const b = new Set(right.toLowerCase().split(/\W+/).filter(Boolean));
  const union = new Set([...a, ...b]);
  if (!union.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return Math.round((intersection / union.size) * 10000) / 100;
}

export function processResultBatch(plan: RunPlan, results: EvalResult[]): EvalResult[] {
  const expected = new Set(plan.sampleManifest.rows.map((row) => row.rowId));
  const seen = new Set<string>();
  for (const result of results) {
    if (!expected.has(result.rowId)) throw new Error(`unknown_row_id:${result.rowId}`);
    if (seen.has(result.rowId)) throw new Error(`duplicate_row_id:${result.rowId}`);
    seen.add(result.rowId);
  }
  const missing = [...expected].filter((rowId) => !seen.has(rowId));
  if (missing.length) throw new Error(`missing_row_ids:${missing.join(",")}`);
  return results;
}

export function evaluateGates(runId: string, evalSet: EvalSetVersion, results: EvalResult[]): GateResult[] {
  const gates: GateResult[] = [];
  for (const result of results) {
    const hard = result.fields.filter((field) => field.decision === "hard_fail");
    const scored = result.fields.map((field) => field.normalizedScore).filter((score): score is number => typeof score === "number");
    const score = scored.length ? mean(scored) : undefined;
    const passed = hard.length === 0 && result.fields.every((field) => field.passed !== false);
    gates.push(makeGate(runId, "row", result.rowId, score, passed, hard.map((field) => field.key), [result.id], "all item fields pass"));
  }
  const rowGates = gates.filter((gate) => gate.level === "row");
  const passRate = rowGates.length ? (rowGates.filter((gate) => gate.passed).length / rowGates.length) * 100 : 0;
  const datasetPassed = passRate >= evalSet.gates.datasetPassRateThreshold;
  gates.push(makeGate(runId, "dataset", "demo-dataset-v1", passRate, datasetPassed, datasetPassed ? [] : ["dataset_pass_rate"], rowGates.map((gate) => gate.id), "passed rows / total rows"));
  const criticalFailures = rowGates.flatMap((gate) => gate.failedCriticalComponents);
  const evalSetPassed = datasetPassed && criticalFailures.length === 0;
  gates.push(makeGate(runId, "eval_set", evalSet.id, passRate, evalSetPassed, criticalFailures, rowGates.map((gate) => gate.id), "dataset gate and critical rows"));
  gates.push(makeGate(runId, "run", runId, passRate, evalSetPassed, criticalFailures, gates.map((gate) => gate.id), "authoritative persisted gate cascade"));
  return gates;
}

function makeGate(
  runId: string,
  level: GateResult["level"],
  scopeId: string,
  score: number | undefined,
  passed: boolean,
  reasons: string[],
  sourceResultIds: string[],
  formula: string
): GateResult {
  const decision = passed ? "pass" : reasons.length ? "hard_fail" : "soft_fail";
  return {
    id: `gate_${stableHash({ runId, level, scopeId, score, passed, reasons }, 18)}`,
    runId,
    level,
    scopeId,
    score,
    passed,
    decision,
    thresholdVersion: "demo-thresholds-v1",
    formula,
    reasons,
    failedCriticalComponents: reasons,
    sourceResultIds,
    fingerprint: stableHash({ runId, level, scopeId, score, passed, reasons, sourceResultIds })
  };
}

export function shouldStopEarly(args: {
  observedRows: number;
  passedRows: number;
  totalRows: number;
  threshold: number;
  stopPolicy: StopPolicy;
}): { stop: boolean; reason?: string; remainingRows: number; partial: boolean; resumable: boolean } {
  const remainingRows = Math.max(0, args.totalRows - args.observedRows);
  const maxPossiblePassRate = ((args.passedRows + remainingRows) / args.totalRows) * 100;
  if (args.stopPolicy.zeroPassStop && args.observedRows >= args.stopPolicy.warmupRows && args.passedRows === 0) {
    return { stop: true, reason: "zero_pass_stop", remainingRows, partial: true, resumable: true };
  }
  if (args.stopPolicy.passFeasibilityStop && maxPossiblePassRate < args.threshold) {
    return { stop: true, reason: "no_remaining_mathematical_path", remainingRows, partial: true, resumable: false };
  }
  return { stop: false, remainingRows, partial: false, resumable: true };
}

function mean(values: number[]): number {
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;
}

import { describe, expect, it } from "vitest";
import {
  assignExperimentArm,
  baselinePrompt,
  buildAblationVariants,
  candidatePrompt,
  demoEvalSet,
  demoRows,
  assertApiKeyScope,
  approveRequest,
  canRoleAccess,
  createApprovalRequest,
  hashApiKey,
  importBenchmark,
  InMemoryQueueAdapter,
  InMemoryWorkflowAdapter,
  evaluateGates,
  judgeStabilityReport,
  leakageCalibration,
  pairedBootstrapCi,
  processResultBatch,
  resolvePromptRelease,
  resolveRunPlan,
  rollbackPointer,
  runDeterministicEval,
  verifyCandidateHash
} from "../src/index";

describe("run plans and row attribution", () => {
  it("fails closed when historical data policy is denied", () => {
    expect(() =>
      resolveRunPlan({ id: "run-1", targetId: "target", targetKind: "historical_output", rows: demoRows, evalSet: demoEvalSet })
    ).toThrow("historical_data_policy_denied");
  });

  it("rejects shuffled or missing result attribution by row id", () => {
    const plan = resolveRunPlan({
      id: "run-1",
      targetId: "target",
      targetKind: "provided_output",
      rows: demoRows,
      evalSet: demoEvalSet,
      historicalDataAllowed: true
    });
    const one = runDeterministicEval(demoEvalSet.itemVersions[0]!.item, plan.sampleManifest.rows[0]!);
    expect(() => processResultBatch(plan, [one])).toThrow("missing_row_ids");
  });
});

describe("eval gates", () => {
  it("persists dynamic multi-field results and run gates", () => {
    const plan = resolveRunPlan({
      id: "run-2",
      targetId: "target",
      targetKind: "provided_output",
      rows: demoRows,
      evalSet: demoEvalSet,
      historicalDataAllowed: true
    });
    const results = plan.sampleManifest.rows.map((sample) => runDeterministicEval(demoEvalSet.itemVersions[0]!.item, sample));
    const gates = evaluateGates(plan.id, demoEvalSet, results);
    expect(results[0]!.fields.map((field) => field.key)).toContain("risk_label");
    expect(gates.some((gate) => gate.level === "run")).toBe(true);
  });
});

describe("prompt and experiment contracts", () => {
  it("resolves prompt releases by explicit candidate first", () => {
    const resolved = resolvePromptRelease({
      definitionId: "reservation-agent",
      releases: [],
      baselineVersionId: baselinePrompt.id,
      explicitCandidateVersionId: candidatePrompt.id,
      scopes: { project: "proj_demo" }
    });
    expect(resolved.versionId).toBe(candidatePrompt.id);
  });

  it("assigns sticky experiment arms", () => {
    const arms = [
      { id: "control", promptVersionId: baselinePrompt.id, weight: 5000 },
      { id: "candidate", promptVersionId: candidatePrompt.id, weight: 5000 }
    ];
    expect(assignExperimentArm("exp-1", "user-1", arms)).toEqual(assignExperimentArm("exp-1", "user-1", arms));
  });
});

describe("paired statistics", () => {
  it("keeps no-winner decisions possible by exposing uncertainty", () => {
    const ci = pairedBootstrapCi([
      { rowId: "a", incumbent: 80, candidate: 82 },
      { rowId: "b", incumbent: 75, candidate: 74 }
    ]);
    expect(ci.low).toBeLessThanOrEqual(ci.high);
  });
});

describe("calibration and prompt improvement", () => {
  it("detects judge score stability and expected-output leakage", () => {
    const stability = judgeStabilityReport([{ rowId: "a", oldScore: 80, newScore: 82, oldLabel: "pass", newLabel: "pass", critical: true }]);
    expect(stability.passed).toBe(true);
    expect(leakageCalibration([70], [90]).leaked).toBe(true);
  });

  it("constructs instruction-level ablations without changing locked blocks", () => {
    const variants = buildAblationVariants(baselinePrompt, "decision-rules");
    expect(variants.map((variant) => variant.mutation)).toContain("split_instruction");
    expect(() => buildAblationVariants(baselinePrompt, "safety")).toThrow("locked_component_ablation_denied");
  });

  it("verifies prompt hashes and rollback pointers", () => {
    expect(() => verifyCandidateHash(candidatePrompt.contentHash, baselinePrompt.contentHash)).toThrow("candidate_prompt_hash_mismatch");
    expect(rollbackPointer("rel-canary", "rel-active").restoredReleaseId).toBe("rel-active");
  });
});

describe("hosted auth, approvals, orchestration, and benchmarks", () => {
  it("checks role hierarchy and scoped API keys", () => {
    expect(canRoleAccess("admin", "editor")).toBe(true);
    expect(canRoleAccess("viewer", "editor")).toBe(false);
    const hash = hashApiKey("oe_test.secret", "pepper");
    expect(hash).toHaveLength(64);
    expect(() =>
      assertApiKeyScope({ id: "key", workspaceId: "ws", name: "ci", keyHash: hash, prefix: "oe_test", scopes: ["traces:write"] }, "evals:write")
    ).toThrow("api_key_scope_forbidden");
  });

  it("creates approval requests before mutating agent actions", () => {
    const request = createApprovalRequest({
      workspaceId: "ws",
      action: "promote_prompt_release",
      requesterId: "user",
      summary: "Promote candidate",
      risk: "high",
      payloadPreview: { candidateId: "cand" }
    });
    expect(request.status).toBe("pending");
    expect(approveRequest(request, "owner", "qualified").status).toBe("approved");
  });

  it("deduplicates local workflow and queue submissions by idempotency key", async () => {
    const workflows = new InMemoryWorkflowAdapter();
    const first = await workflows.start({ workflowId: "evalRunWorkflow", workspaceId: "ws", idempotencyKey: "same", input: {} });
    const second = await workflows.start({ workflowId: "evalRunWorkflow", workspaceId: "ws", idempotencyKey: "same", input: {} });
    expect(second.id).toBe(first.id);
    const queue = new InMemoryQueueAdapter();
    const message = await queue.enqueue({ queueName: "ingest", workspaceId: "ws", idempotencyKey: "same", payload: { trace: "a" } });
    const duplicate = await queue.enqueue({ queueName: "ingest", workspaceId: "ws", idempotencyKey: "same", payload: { trace: "b" } });
    expect(duplicate.id).toBe(message.id);
    expect((await queue.claim("ingest", "worker"))?.status).toBe("claimed");
  });

  it("imports executable GSM8K and BFCL benchmark fixtures", () => {
    const gsm = importBenchmark({
      family: "gsm8k",
      version: "mini-v1",
      sourceName: "fixture",
      license: "fixture",
      payload: [{ question: "What is 2+2?", answer: "4" }]
    });
    const bfcl = importBenchmark({
      family: "bfcl",
      version: "mini-v1",
      sourceName: "fixture",
      license: "Apache-2.0 fixture",
      payload: [{ prompt: "Call weather", expected_tool_call: { name: "weather", arguments: { city: "Madrid" } } }]
    });
    expect(gsm.datasetRows[0]!.reviewStatus).toBe("golden");
    expect(bfcl.evalSet.itemVersions[0]!.item.evaluationUnits).toContain("agent_call");
  });
});

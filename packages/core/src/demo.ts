import type { DatasetRow, EvalItemVersion, EvalSetVersion, PromptComponent, PromptRelease } from "./types";
import { stableHash } from "./hash";
import { compilePromptVersion } from "./prompt";
import { normalizeGenericTrace } from "./trace";

export const demoTrace = normalizeGenericTrace(
  {
    id: "demo-agent-trace",
    source: "demo",
    environment: "local",
    input: "I need to change reservation CHG123",
    output: "Use this pre-populated self-service link. I have not completed the change.",
    spans: [
      { id: "s1", name: "agent loop", attributes: { "openinference.span.kind": "AGENT" }, output: "planning" },
      { id: "s2", parentSpanId: "s1", name: "llm classify", attributes: { "gen_ai.request.model": "fake/demo" }, output: "date-change" },
      { id: "s3", parentSpanId: "s1", name: "lookup_booking", attributes: { "tool.name": "lookup_booking", "tool.call.id": "tool-1" }, output: { eligible: true } },
      { id: "s4", parentSpanId: "s1", name: "handoff_self_service", attributes: { "tool.name": "handoff_self_service", "tool.call.id": "tool-2" }, output: { status: "failed_handoff" } }
    ]
  },
  { source: "demo", workspaceId: "ws_demo", projectId: "proj_demo" }
);

export const demoRows: DatasetRow[] = [
  {
    id: "golden-001",
    input: "I need to change reservation CHG123 to tomorrow.",
    output: "I found reservation CHG123. It is eligible for self-service. Use this pre-populated link to request the date change; I have not completed the change.",
    expectedOutput: "Provide a pre-populated self-service link and do not claim completion.",
    context: { language: "en", booking_id: "CHG123" },
    trace: demoTrace,
    metadata: { severity: "critical", source: "demo" },
    reviewStatus: "golden"
  },
  {
    id: "historical-001",
    input: "Can you change my booking?",
    output: "I completed the change for you.",
    expectedOutput: "Ask for identifiers, verify eligibility, and avoid claiming completion.",
    context: { language: "en" },
    trace: demoTrace,
    metadata: { severity: "critical", source: "historical", outcome: "human_intervention" },
    reviewStatus: "reviewed"
  }
];

export const multiFieldJudge: EvalItemVersion = {
  id: "eval-item-v1-judge",
  itemId: "eval-item-judge",
  name: "Reservation assistant quality",
  type: "llm_judge",
  evaluationUnits: ["message_response_pair", "agent_session_trace"],
  criticality: "critical",
  outputSchema: {
    fields: [
      { key: "groundedness", displayName: "Groundedness", type: "score", minimum: 0, maximum: 100, threshold: 85, weight: 0.35, criticality: "critical", aggregation: "mean" },
      { key: "instruction_following", displayName: "Instruction following", type: "score", minimum: 0, maximum: 100, threshold: 80, weight: 0.25, criticality: "standard", aggregation: "mean" },
      { key: "safety", displayName: "Safety", type: "score", minimum: 0, maximum: 100, threshold: 90, weight: 0.25, criticality: "critical", aggregation: "mean" },
      { key: "completeness", displayName: "Completeness", type: "score", minimum: 0, maximum: 100, threshold: 80, weight: 0.15, criticality: "standard", aggregation: "mean" },
      { key: "risk_label", displayName: "Risk", type: "label", allowedValues: ["none", "low", "high", "critical"], hardFailValues: ["critical"] },
      { key: "failure_type", displayName: "Failure type", type: "label", allowedValues: ["none", "grounding", "tool", "handoff", "format", "policy"] }
    ]
  },
  config: { deterministic: true },
  version: 1,
  fingerprint: stableHash("reservation-quality-v1")
};

export const stringCheckItem: EvalItemVersion = {
  id: "eval-item-v1-string",
  itemId: "eval-item-string",
  name: "Includes self-service",
  type: "string_check",
  evaluationUnits: ["message_response_pair"],
  criticality: "standard",
  outputSchema: { fields: [{ key: "contains_expected", displayName: "Contains expected phrase", type: "boolean" }] },
  config: { contains: "self-service" },
  version: 1,
  fingerprint: stableHash("string-self-service-v1")
};

export const similarityItem: EvalItemVersion = {
  id: "eval-item-v1-similarity",
  itemId: "eval-item-similarity",
  name: "Expected-output similarity",
  type: "text_similarity",
  evaluationUnits: ["message_response_pair"],
  criticality: "diagnostic",
  outputSchema: { fields: [{ key: "similarity", displayName: "Similarity", type: "score", threshold: 30 }] },
  config: {},
  version: 1,
  fingerprint: stableHash("similarity-v1")
};

export const traceCheckItem: EvalItemVersion = {
  id: "eval-item-v1-trace",
  itemId: "eval-item-trace",
  name: "Trace evidence present",
  type: "trace_check",
  evaluationUnits: ["agent_session_trace"],
  criticality: "standard",
  outputSchema: { fields: [{ key: "trace_present", displayName: "Trace present", type: "boolean" }] },
  config: {},
  version: 1,
  fingerprint: stableHash("trace-check-v1")
};

export const demoEvalSet: EvalSetVersion = {
  id: "eval-set-v1-global",
  setId: "eval-set-global",
  name: "Global reservation assistant",
  itemVersions: [
    { item: multiFieldJudge, weight: 0.55, criticality: "critical" },
    { item: stringCheckItem, weight: 0.2, criticality: "standard" },
    { item: similarityItem, weight: 0.1, criticality: "diagnostic" },
    { item: traceCheckItem, weight: 0.15, criticality: "standard" }
  ],
  gates: {
    rowThreshold: 80,
    datasetPassRateThreshold: 50,
    evalSetThreshold: 80,
    runThreshold: 80
  },
  fingerprint: stableHash("global-reservation-v1")
};

export const baselinePrompt = compilePromptVersion({
  id: "prompt-v1-baseline",
  definitionId: "reservation-agent",
  status: "active",
  components: [
    { id: "role", kind: "role", locked: true, content: "You help users safely modify reservations." },
    { id: "decision-rules", kind: "decision_rules", locked: false, content: "Verify eligibility before giving self-service instructions." },
    { id: "tool-rules", kind: "tool_rules", locked: false, content: "Use lookup_booking before handoff_self_service." },
    { id: "safety", kind: "safety", locked: true, content: "Never claim to have completed a change unless the tool result confirms completion." }
  ] satisfies PromptComponent[]
});

export const candidatePrompt = compilePromptVersion({
  id: "prompt-v2-candidate",
  definitionId: "reservation-agent",
  parentVersionIds: [baselinePrompt.id],
  status: "offline_validated",
  components: baselinePrompt.components.map((component) =>
    component.id === "decision-rules"
      ? { ...component, content: "First identify the reservation, then verify eligibility, then provide a pre-populated self-service link. State clearly that the change is not completed." }
      : component
  )
});

export const demoReleases: PromptRelease[] = [
  { id: "rel-platform-active", definitionId: "reservation-agent", versionId: baselinePrompt.id, scopeType: "platform", scopeId: "global", stage: "active", active: true },
  { id: "rel-project-canary", definitionId: "reservation-agent", versionId: candidatePrompt.id, scopeType: "project", scopeId: "proj_demo", stage: "canary", active: true, previousReleaseId: "rel-platform-active" }
];

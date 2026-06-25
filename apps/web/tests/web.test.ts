import { describe, expect, it } from "vitest";
import { demoEvalSet, demoRows, resolveRunPlan } from "@open-evals/core";

describe("web fixtures", () => {
  it("resolves the demo run plan used by the UI", () => {
    const plan = resolveRunPlan({
      id: "run_web_test",
      targetId: "target",
      targetKind: "provided_output",
      rows: demoRows,
      evalSet: demoEvalSet,
      historicalDataAllowed: true
    });
    expect(plan.sampleManifest.rows).toHaveLength(2);
  });
});

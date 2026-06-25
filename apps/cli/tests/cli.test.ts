import { describe, expect, it } from "vitest";
import { resolveRunPlan, demoRows, demoEvalSet } from "@open-evals/core";

describe("cli contracts", () => {
  it("uses immutable demo run plans", () => {
    const plan = resolveRunPlan({ id: "cli-test", targetId: "target", targetKind: "provided_output", rows: demoRows, evalSet: demoEvalSet, historicalDataAllowed: true });
    expect(plan.planFingerprint).toHaveLength(64);
  });
});

import { describe, expect, it } from "vitest";
import { tools } from "../src/index";

describe("mcp tools", () => {
  it("requires approval for mutating or costly operations", () => {
    expect(tools.start_eval_run().requiresApproval).toBe(true);
    expect(tools.create_draft_optimization_campaign().requiresApproval).toBe(true);
  });
});

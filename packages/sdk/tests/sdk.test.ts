import { describe, expect, it } from "vitest";
import { startTrace } from "../src/index";

describe("sdk", () => {
  it("starts canonical traces without network access", () => {
    expect(startTrace({ id: "sdk-trace", spans: [] }).externalTraceId).toBe("sdk-trace");
  });
});

import { describe, expect, it } from "vitest";
import { approvalRequests, auditEvents, authSessions, migrationFiles, promptReleases, queueMessages, runSamples, traces, workflowRuns } from "../src/index";

describe("database schema", () => {
  it("exposes migrations and first-class drizzle tables", () => {
    expect(migrationFiles).toContain("packages/db/migrations/0001_init.sql");
    expect(migrationFiles).toContain("packages/db/migrations/0002_hosted_integrations.sql");
    expect(traces).toBeDefined();
    expect(runSamples).toBeDefined();
    expect(promptReleases).toBeDefined();
    expect(authSessions).toBeDefined();
    expect(workflowRuns).toBeDefined();
    expect(queueMessages).toBeDefined();
    expect(approvalRequests).toBeDefined();
    expect(auditEvents).toBeDefined();
  });
});

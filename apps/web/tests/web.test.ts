import { describe, expect, it } from "vitest";
import { loadRunBatches } from "../lib/loaders";

describe("web persisted-data loaders", () => {
  it("does not fall back to mocked runs when the database is not configured", async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const originalPostgresUrl = process.env.POSTGRES_URL;
    const originalSupabaseDbUrl = process.env.SUPABASE_DB_URL;
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.SUPABASE_DB_URL;
    process.env.AUTH_MODE = "local";
    const state = await loadRunBatches();
    restoreEnv("DATABASE_URL", originalDatabaseUrl);
    restoreEnv("POSTGRES_URL", originalPostgresUrl);
    restoreEnv("SUPABASE_DB_URL", originalSupabaseDbUrl);
    expect(state.status).toBe("database_unavailable");
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

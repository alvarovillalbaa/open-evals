export async function GET() {
  const pythonEnabled = process.env.PYTHON_OPTIMIZERS_ENABLED === "true";
  return Response.json({
    platform: {
      auth: {
        enabled: (process.env.AUTH_MODE ?? "local") === "hosted",
        reason: (process.env.AUTH_MODE ?? "local") === "hosted" ? "hosted auth mode is enabled" : "local single-user mode is active"
      },
      workflows: {
        enabled: process.env.WORKFLOWS_ENABLED !== "false",
        hosted: Boolean(process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL_TOKEN),
        reason: process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL_TOKEN ? "Vercel workflow auth is configured" : "local workflow adapter is used until Vercel auth is configured"
      },
      queues: {
        enabled: process.env.QUEUES_ENABLED === "true",
        hosted: Boolean(process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL_TOKEN),
        reason: process.env.QUEUES_ENABLED === "true" ? "queue adapter is enabled" : "queues are disabled; ingestion uses local inline path"
      },
      blob: {
        enabled: process.env.ARTIFACT_STORAGE_DRIVER === "vercel_blob" && Boolean(process.env.BLOB_READ_WRITE_TOKEN),
        reason: process.env.BLOB_READ_WRITE_TOKEN ? "Vercel Blob token configured" : "local artifact storage is active"
      },
      eve: {
        enabled: process.env.EVE_ENABLED === "true",
        reason: process.env.EVE_ENABLED === "true" ? "Eve agent runtime is enabled" : "Eve tools remain disabled and deterministic engine is authoritative"
      },
      sandbox: {
        enabled: process.env.SANDBOX_DRIVER === "vercel" && Boolean(process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL_TOKEN),
        reason: process.env.SANDBOX_DRIVER === "vercel" ? "hosted sandbox selected" : "local fixture sandbox is active for tests"
      }
    },
    engines: [
      { id: "one_shot", enabled: true, reason: "deterministic candidate generation is local" },
      { id: "hill_climb", enabled: true, reason: "local TypeScript/Python fixture path is available" },
      { id: "gepa", enabled: pythonEnabled && process.env.GEPA_ENABLED === "true", reason: pythonEnabled ? "requires official gepa package" : "set PYTHON_OPTIMIZERS_ENABLED=true and install optional extras" },
      { id: "dspy", enabled: pythonEnabled && process.env.DSPY_ENABLED === "true", reason: "optional DSPy engines are capability-gated" },
      { id: "smac", enabled: pythonEnabled && process.env.SMAC_ENABLED === "true", reason: "optional SMAC dependency is not required for core evals" }
    ]
  });
}

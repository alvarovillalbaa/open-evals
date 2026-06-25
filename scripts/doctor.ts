import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const checks: Array<[string, () => string]> = [
  ["node", () => process.version],
  ["pnpm", () => execFileSync("pnpm", ["-v"], { encoding: "utf8" }).trim()],
  ["uv", () => execFileSync("uv", ["--version"], { encoding: "utf8" }).trim()],
  ["env example", () => (existsSync(".env.example") ? "present" : "missing")],
  ["local data dir", () => (existsSync(".data") ? "present" : "missing")],
  ["database url", () => (process.env.DATABASE_URL ? "configured" : "not configured")],
  ["auth mode", () => process.env.AUTH_MODE ?? "local"],
  ["artifact storage", () => process.env.ARTIFACT_STORAGE_DRIVER ?? "local"],
  ["workflows", () => (process.env.WORKFLOWS_ENABLED === "false" ? "disabled" : process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL_TOKEN ? "hosted credentials configured" : "local adapter")],
  ["queues", () => (process.env.QUEUES_ENABLED === "true" ? "enabled" : "disabled")],
  ["eve", () => (process.env.EVE_ENABLED === "true" ? "enabled" : "disabled")]
];

let failed = false;
for (const [name, fn] of checks) {
  try {
    console.log(`${name}: ${fn()}`);
  } catch (error) {
    failed = true;
    console.log(`${name}: failed (${error instanceof Error ? error.message : String(error)})`);
  }
}

if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
  console.log("ai gateway: disabled; deterministic evals remain available");
}
if (process.env.PYTHON_OPTIMIZERS_ENABLED !== "true") {
  console.log("python optimizers: disabled unless PYTHON_OPTIMIZERS_ENABLED=true");
}
if ((process.env.AUTH_MODE ?? "local") === "hosted" && !process.env.AUTH_SECRET) {
  failed = true;
  console.log("auth secret: missing AUTH_SECRET for hosted mode");
}
if (process.env.ARTIFACT_STORAGE_DRIVER === "vercel_blob" && !process.env.BLOB_READ_WRITE_TOKEN) {
  failed = true;
  console.log("blob: missing BLOB_READ_WRITE_TOKEN for vercel_blob driver");
}
if (process.env.SANDBOX_DRIVER === "vercel" && !process.env.VERCEL_OIDC_TOKEN && !process.env.VERCEL_TOKEN) {
  failed = true;
  console.log("sandbox: missing Vercel OIDC/token credentials");
}

process.exit(failed ? 1 : 0);

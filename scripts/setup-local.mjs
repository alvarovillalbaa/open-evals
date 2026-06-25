import { mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const dirs = [".data", ".data/artifacts", ".data/imports", ".data/exports"];
for (const dir of dirs) mkdirSync(dir, { recursive: true });

process.env.DATABASE_URL ??= "postgres://open_evals:open_evals@127.0.0.1:54329/open_evals";

function run(cmd, args, optional = false) {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: false, env: process.env });
  if (result.status !== 0 && !optional) process.exit(result.status ?? 1);
  return result.status === 0;
}

if (!existsSync(".env.local")) {
  console.log("No .env.local found. Copy .env.example to .env.local and edit secrets for hosted features.");
}

console.log("Starting local PostgreSQL if Docker is available...");
const dockerStarted = run("docker", ["compose", "up", "-d", "postgres"], true);
if (!dockerStarted) {
  console.log("Docker is unavailable or did not start PostgreSQL. If you have PostgreSQL elsewhere, set DATABASE_URL and rerun setup.");
}

console.log("Applying migrations and seeding demo data...");
const migrated = run("pnpm", ["db:migrate"], true);
const seeded = migrated && run("pnpm", ["db:seed"], true);

console.log("Validating Python optimizer environment...");
run("uv", ["sync", "--project", "python/open_evals_optimizers"], true);

if (!migrated || !seeded) {
  console.log("Local setup incomplete: PostgreSQL migration or seed failed.");
  process.exit(1);
}

console.log("Local setup complete. Run pnpm dev to start the app.");

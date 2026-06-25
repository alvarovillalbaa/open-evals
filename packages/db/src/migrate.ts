import { readFileSync } from "node:fs";
import { Client } from "pg";
import { migrationFiles } from "./index";

const url = process.env.DATABASE_URL ?? "postgres://open_evals:open_evals@127.0.0.1:54329/open_evals";

const client = new Client({ connectionString: url });
await client.connect();
for (const file of migrationFiles) {
  await client.query(readFileSync(file, "utf8"));
}
await client.end();
console.log(`Applied ${migrationFiles.length} open-evals migrations.`);

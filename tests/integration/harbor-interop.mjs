import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadHarborCore } from "../helpers/harbor-core-loader.mjs";
const root = process.env.HARBOR_PROOF;
assert.ok(root);
const bundle = JSON.parse(await readFile(join(root, "native-bundle.json")));
const { api, verifySources } = await loadHarborCore();
const parsed = api.parseHarborTaskBundle(bundle), summary = api.summarizeHarborTaskBundle(bundle);
assert.deepEqual(JSON.parse(JSON.stringify(parsed)), bundle);
assert.equal(summary.nativeExecutionVerified, false);
assert.equal(summary.taskName, "open-evals/harbor-file-fixture");
assert.equal(summary.taskVersion, "1.0.0");
assert.equal(summary.fingerprint, bundle.fingerprint);
await writeFile(join(root, "interop.json"), JSON.stringify({ id: "HB-I01", passed: true, bundleFingerprint: bundle.fingerprint,
  nativeChecksum: bundle.nativeChecksum, sourceBytes: summary.sourceBytes, files: summary.files,
  coreSources: await verifySources(), nativeExecutionClaimedByTransport: false }, null, 2) + "\n");
console.log("PASS HB-I01: native Python bundle and actual TypeScript core agree");

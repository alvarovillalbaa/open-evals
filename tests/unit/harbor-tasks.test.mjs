import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadHarborCore } from "../helpers/harbor-core-loader.mjs";

const { api, verifySources } = await loadHarborCore();
after(verifySources);
const hash = value => createHash("sha256").update(value).digest("hex");
const canonical = value => value === null || typeof value !== "object" ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const file = (path, data, mode = "0644") => ({ path, mode, bytes: Buffer.byteLength(data), sha256: hash(data), content: Buffer.from(data).toString("base64") });
const seal = value => {
  const identity = Object.fromEntries(Object.entries(value).filter(([key]) => !["files", "fingerprint"].includes(key)));
  identity.files = value.files.map(({ content, ...row }) => row);
  return { ...value, fingerprint: hash(canonical(identity)) };
};
function fixture() {
  return seal({ schemaVersion: "harbor-task-bundle-v1", runtime: "harbor/0.25.0", profile: "docker-linux-single-task-v1",
    taskName: "open-evals/transport-fixture", taskVersion: "1.0.0", nativeChecksum: "0".repeat(64),
    files: [file("environment/Dockerfile", "FROM scratch\n"), file("instruction.md", "A transport fixture; never executed.\n"),
      file("task.toml", 'schema_version="1.4"\n'), file("tests/test.sh", "#!/bin/sh\nexit 0\n", "0755")] });
}
const reject = value => assert.throws(() => api.parseHarborTaskBundle(value), error => typeof error.code === "string" && error.code.startsWith("harbor_"));

test("HB-C01 complete transport round trip preserves source bytes and full fingerprint", () => {
  const value = fixture();
  assert.equal(JSON.stringify(api.parseHarborTaskBundle(value)), JSON.stringify(value));
  assert.equal(api.summarizeHarborTaskBundle(value).sourceBytes, value.files.reduce((sum, row) => sum + row.bytes, 0));
});
test("HB-C02 changing source bytes without changing identities fails", () => {
  const value = fixture(); value.files[0].content = Buffer.from("FROM changed\n").toString("base64"); reject(value);
});
test("HB-C03 a resealed bundle cannot hide a false member hash", () => {
  const value = fixture(); value.files[0].sha256 = "a".repeat(64); reject(seal(value));
});
test("HB-C04 content-addressed bundle identity is mandatory", () => {
  const value = fixture(); value.fingerprint = "f".repeat(64); reject(value);
});
test("HB-C05 noncanonical or padded base64 corruption is refused", () => {
  for (const content of ["*", "YQ=", "YR==", "YQ==\n"]) { const value = fixture(); value.files[0].content = content; reject(seal(value)); }
});
test("HB-C06 absolute, traversal, credential and unsupported environment paths fail", () => {
  for (const path of ["/tmp/value", "environment/../value", "environment//value", "tests/.env", "tests/key.pem", "environment/docker-compose.yaml", "other/file"]) {
    const value = fixture(); value.files[0].path = path; reject(seal(value));
  }
});
test("HB-C07 duplicate, case-colliding and file-directory prefix identities fail", () => {
  for (const extra of [file("instruction.md", "copy"), file("tests/Test.sh", "copy"), file("environment/Dockerfile/z", "copy")]) {
    const value = fixture(); value.files.push(extra); value.files.sort((a, b) => a.path < b.path ? -1 : 1); reject(seal(value));
  }
  const value = fixture(); value.files.push(file("tests/a", "x"), file("tests/a-b", "x"), file("tests/a/b", "x")); value.files.sort((a,b) => a.path < b.path ? -1 : 1); reject(seal(value));
});
test("HB-C08 file size and permission contracts reject coercions", () => {
  for (const change of [{ bytes: -1 }, { bytes: 1.5 }, { bytes: "13" }, { mode: 755 }, { mode: "0777" }]) {
    const value = fixture(); Object.assign(value.files[0], change); reject(seal(value));
  }
});
test("HB-C09 task instruction must be nonempty valid UTF-8", () => {
  for (const data of [Buffer.from([255]), Buffer.from(""), Buffer.from("\0")]) {
    const value = fixture(); value.files[1] = file("instruction.md", data); reject(seal(value));
  }
});
test("HB-C10 required files and exact path order are enforced", () => {
  const missing = fixture(); missing.files.pop(); reject(seal(missing));
  const unordered = fixture(); unordered.files.reverse(); reject(seal(unordered));
});
test("HB-C11 unknown fields and runtime profiles do not widen the v1 contract", () => {
  for (const change of [{ runtime: "harbor/latest" }, { profile: "remote" }, { schemaVersion: "harbor-task-bundle-v2" }, { nativeExecutionVerified: true }]) reject(seal({ ...fixture(), ...change }));
});
test("HB-C12 aggregate source budget includes every file", () => {
  const value = fixture();
  for (let index = 0; index < 4; index++) value.files.push(file(`tests/payload-${index}.bin`, Buffer.alloc(256 * 1024)));
  value.files.sort((a,b) => a.path < b.path ? -1 : 1); reject(seal(value));
});
test("HB-C13 getters and toJSON cannot supply executable transport fields", () => {
  let called = 0;
  const getter = fixture(); Object.defineProperty(getter, "taskName", { enumerable: true, get() { called++; return "open-evals/fake"; } }); reject(getter);
  const method = fixture(); method.toJSON = () => { called++; return fixture(); }; reject(method);
  assert.equal(called, 0);
});
test("HB-C14 parser results are detached and malformed Unicode is refused", () => {
  const value = fixture(), parsed = api.parseHarborTaskBundle(value); value.files[0].content = "changed"; assert.notEqual(parsed.files[0].content, value.files[0].content);
  const invalid = fixture(); invalid.taskVersion = "\ud800"; reject(seal(invalid));
});
test("HB-C15 transport verification never asserts native execution or quality", () => {
  const summary = api.summarizeHarborTaskBundle(fixture()); assert.equal(summary.nativeExecutionVerified, false); assert.equal(summary.runtime, "harbor/0.25.0");
});
test("HB-C16 actual file and total byte boundaries remain usable", () => {
  const value = fixture(), baseline = value.files.reduce((sum, row) => sum + row.bytes, 0);
  for (let index = 0; index < 4; index++) value.files.push(file(`tests/payload-${index}.bin`, Buffer.alloc(256 * 1024 - (index === 3 ? baseline : 0))));
  value.files.sort((a,b) => a.path < b.path ? -1 : 1);
  const summary = api.summarizeHarborTaskBundle(seal(value));
  assert.equal(summary.sourceBytes, 1024 * 1024);
  assert.ok(summary.wireBytes <= 1536 * 1024);
});

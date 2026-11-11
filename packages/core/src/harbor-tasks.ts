import { createHash } from "node:crypto";
import { stableHash, stableStringify } from "./hash";

export const HARBOR_TASK_RUNTIME = "harbor/0.25.0" as const;
export const HARBOR_TASK_PROFILE = "docker-linux-single-task-v1" as const;
export const HARBOR_TASK_LIMITS = Object.freeze({ files: 128, fileBytes: 256 * 1024, sourceBytes: 1024 * 1024, wireBytes: 1536 * 1024 });

export interface HarborTaskFile {
  path: string; mode: "0644" | "0755"; bytes: number; sha256: string; content: string;
}
export interface HarborTaskBundle {
  schemaVersion: "harbor-task-bundle-v1";
  runtime: typeof HARBOR_TASK_RUNTIME;
  profile: typeof HARBOR_TASK_PROFILE;
  taskName: string; taskVersion: string; nativeChecksum: string;
  files: HarborTaskFile[]; fingerprint: string;
}
export interface HarborTaskBundleSummary {
  schemaVersion: "harbor-task-summary-v1"; fingerprint: string;
  runtime: typeof HARBOR_TASK_RUNTIME; profile: typeof HARBOR_TASK_PROFILE;
  taskName: string; taskVersion: string; files: number; sourceBytes: number; wireBytes: number;
  nativeExecutionVerified: false;
}
export class HarborTaskError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "HarborTaskError"; }
}
const fail = (code: string): never => { throw new HarborTaskError(code); };
const HEX = /^[0-9a-f]{64}$/;
const ROOT = new Set(["task.toml", "instruction.md", "README.md", "LICENSE", "LICENSE.txt"]);
const REQUIRED = ["task.toml", "instruction.md", "environment/Dockerfile", "tests/test.sh"];
const keyList = ["schemaVersion", "runtime", "profile", "taskName", "taskVersion", "nativeChecksum", "files", "fingerprint"];

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("harbor_invalid_shape");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")) fail("harbor_invalid_shape");
}
function text(value: unknown, limit: number): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || value.length > limit || Buffer.byteLength(value, "utf8") > limit) return fail("harbor_invalid_text");
  for (const char of value) { const code = char.codePointAt(0)!; if (code >= 0xd800 && code <= 0xdfff) fail("harbor_invalid_text"); }
  return value;
}
function filePath(value: unknown): string {
  const path = text(value, 200), parts = path.split("/");
  if (!/^[A-Za-z0-9._/-]+$/.test(path) || parts.length > 8 || parts.some(part => !part || part === "." || part === "..")) return fail("harbor_invalid_path");
  if (!ROOT.has(path) && (parts.length < 2 || !["environment", "tests", "solution"].includes(parts[0]))) return fail("harbor_unsupported_path");
  if (parts.some(part => part.startsWith(".") && ![".dockerignore", ".harborignore"].includes(part) || /\.(pem|key|p12|pfx)$/i.test(part))) return fail("harbor_unsupported_path");
  if (["docker-compose.yaml", "docker-compose.yml", "compose.yaml", "compose.yml"].includes(parts.at(-1)!)) return fail("harbor_unsupported_environment");
  return path;
}

/** Snapshot plain JSON data without executing toJSON methods or property getters. */
function snapshot(value: unknown): unknown {
  let bytes = 0;
  const active = new Set<object>();
  const copy = (input: unknown, depth: number): unknown => {
    if (depth > 8) return fail("harbor_invalid_shape");
    if (typeof input === "string") {
      if (input.length > HARBOR_TASK_LIMITS.wireBytes) return fail("harbor_wire_limit");
      bytes += Buffer.byteLength(input) + 2;
      if (bytes > HARBOR_TASK_LIMITS.wireBytes) return fail("harbor_wire_limit");
      return input;
    }
    if (input === null || typeof input === "boolean") { bytes += 5; return input; }
    if (typeof input === "number" && Number.isFinite(input)) { bytes += 24; return input; }
    if (!input || typeof input !== "object" || active.has(input)) return fail("harbor_invalid_shape");
    active.add(input);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(input);
      if (Object.getOwnPropertySymbols(input).length) return fail("harbor_invalid_shape");
      if (Array.isArray(input)) {
        if (input.length > HARBOR_TASK_LIMITS.files || Object.keys(descriptors).length !== input.length + 1) return fail("harbor_file_limit");
        return Array.from({ length: input.length }, (_, index) => {
          const descriptor = descriptors[String(index)];
          if (!descriptor?.enumerable || !("value" in descriptor)) return fail("harbor_invalid_shape");
          return copy(descriptor.value, depth + 1);
        });
      }
      if (Object.keys(descriptors).length > 16) return fail("harbor_invalid_shape");
      const result = Object.create(null) as Record<string, unknown>;
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!descriptor.enumerable || !("value" in descriptor)) return fail("harbor_invalid_shape");
        bytes += key.length + 3;
        result[key] = copy(descriptor.value, depth + 1);
      }
      return result;
    } finally { active.delete(input); }
  };
  const result = copy(value, 0);
  if (Buffer.byteLength(stableStringify(result)) > HARBOR_TASK_LIMITS.wireBytes) return fail("harbor_wire_limit");
  return result;
}

function identity(bundle: Omit<HarborTaskBundle, "fingerprint">) {
  return { schemaVersion: bundle.schemaVersion, runtime: bundle.runtime, profile: bundle.profile,
    taskName: bundle.taskName, taskVersion: bundle.taskVersion, nativeChecksum: bundle.nativeChecksum,
    files: bundle.files.map(({ content: _content, ...file }) => file) };
}

/** Verifies transport bytes and identity; Harbor validates task semantics before execution. */
export function parseHarborTaskBundle(value: unknown): HarborTaskBundle {
  try {
    const raw = object(snapshot(value)); keys(raw, keyList);
    if (raw.schemaVersion !== "harbor-task-bundle-v1" || raw.runtime !== HARBOR_TASK_RUNTIME || raw.profile !== HARBOR_TASK_PROFILE) return fail("harbor_unsupported_profile");
    const taskName = text(raw.taskName, 160), taskVersion = text(raw.taskVersion, 128);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(taskName) || taskName.includes("..")) return fail("harbor_invalid_task_name");
    if (typeof raw.nativeChecksum !== "string" || !HEX.test(raw.nativeChecksum)) return fail("harbor_invalid_checksum");
    if (!Array.isArray(raw.files) || !raw.files.length || raw.files.length > HARBOR_TASK_LIMITS.files) return fail("harbor_file_limit");
    let total = 0;
    const files = raw.files.map(value => {
      const file = object(value); keys(file, ["path", "mode", "bytes", "sha256", "content"]);
      const path = filePath(file.path);
      if (!["0644", "0755"].includes(String(file.mode)) || typeof file.mode !== "string"
        || !Number.isSafeInteger(file.bytes) || Number(file.bytes) < 0 || Number(file.bytes) > HARBOR_TASK_LIMITS.fileBytes) return fail("harbor_invalid_file");
      if (typeof file.content !== "string" || file.content.length > 4 * Math.ceil(HARBOR_TASK_LIMITS.fileBytes / 3)
        || file.content.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(file.content)) return fail("harbor_invalid_base64");
      const data = Buffer.from(file.content, "base64");
      if (data.toString("base64") !== file.content || data.length !== file.bytes || createHash("sha256").update(data).digest("hex") !== file.sha256) return fail("harbor_file_integrity");
      total += data.length;
      if (total > HARBOR_TASK_LIMITS.sourceBytes) return fail("harbor_total_limit");
      if (["task.toml", "instruction.md"].includes(path)) {
        try { text(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data), HARBOR_TASK_LIMITS.fileBytes); }
        catch { return fail("harbor_invalid_task_text"); }
      }
      return { path, mode: file.mode as HarborTaskFile["mode"], bytes: data.length, sha256: file.sha256 as string, content: file.content };
    });
    const paths = files.map(file => file.path);
    if (paths.some((path, index) => index > 0 && paths[index - 1] >= path) || new Set(paths.map(path => path.toLowerCase())).size !== paths.length) return fail("harbor_duplicate_or_unordered_path");
    const pathSet = new Set(paths);
    if (paths.some(path => path.split("/").slice(1).some((_, index) => pathSet.has(path.split("/").slice(0, index + 1).join("/"))))) return fail("harbor_file_directory_conflict");
    if (REQUIRED.some(path => !paths.includes(path))) return fail("harbor_missing_task_file");
    const bundle: Omit<HarborTaskBundle, "fingerprint"> = { schemaVersion: "harbor-task-bundle-v1", runtime: HARBOR_TASK_RUNTIME,
      profile: HARBOR_TASK_PROFILE, taskName, taskVersion, nativeChecksum: raw.nativeChecksum, files };
    const fingerprint = stableHash(identity(bundle), 64);
    if (raw.fingerprint !== fingerprint) return fail("harbor_bundle_integrity");
    return { ...bundle, fingerprint };
  } catch (error) {
    if (error instanceof HarborTaskError) throw error;
    return fail("harbor_invalid_bundle");
  }
}

export function summarizeHarborTaskBundle(value: unknown): HarborTaskBundleSummary {
  const bundle = parseHarborTaskBundle(value);
  return { schemaVersion: "harbor-task-summary-v1", fingerprint: bundle.fingerprint,
    runtime: bundle.runtime, profile: bundle.profile, taskName: bundle.taskName, taskVersion: bundle.taskVersion,
    files: bundle.files.length, sourceBytes: bundle.files.reduce((sum, file) => sum + file.bytes, 0),
    wireBytes: Buffer.byteLength(stableStringify(bundle)), nativeExecutionVerified: false };
}

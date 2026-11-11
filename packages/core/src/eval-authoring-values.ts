import { stableHash, stableStringify } from "./hash";

export const EVAL_COMPOSITION_LIMITS = Object.freeze({ requestBytes: 2097152, recordBytes: 1048576, previewBytes: 2097152, members: 32, history: 20 });
export class EvalCompositionError extends Error {
  readonly status: 409 | 422;
  readonly code: string;
  constructor(status: 409 | 422, code: string) { super(code); this.name = "EvalCompositionError"; this.status = status; this.code = code; }
}
const fail = (code = "eval_composition_invalid", status: 409 | 422 = 422): never => { throw new EvalCompositionError(status, code); };
const hash = (value: unknown): string => stableHash(value, 64);
const bytes = (value: unknown): number => new TextEncoder().encode(stableStringify(value)).byteLength;
const equal = (a: unknown, b: unknown): boolean => stableStringify(a) === stableStringify(b);
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
function validText(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0 || c >= 0xdc00 && c <= 0xdfff) return false;
    if (c >= 0xd800 && c <= 0xdbff) { const d = value.charCodeAt(++i); if (!(d >= 0xdc00 && d <= 0xdfff)) return false; }
  }
  return true;
}
function snapshot(value: unknown, maximum: number = EVAL_COMPOSITION_LIMITS.requestBytes): unknown {
  let nodes = 0;
  const ancestors = new Set<object>();
  function copy(v: unknown, depth: number): unknown {
    if (++nodes > 50000 || depth > 32) return fail();
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") return Number.isFinite(v) ? v : fail();
    if (typeof v === "string") return validText(v) && new TextEncoder().encode(v).byteLength <= maximum ? v : fail();
    if (!v || typeof v !== "object" || ancestors.has(v)) return fail();
    const array = Array.isArray(v), prototype = Object.getPrototypeOf(v);
    if (array ? prototype !== Array.prototype : prototype !== null && prototype !== Object.prototype) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(descriptors).filter(k => !(array && k === "length"));
    if (keys.length > 10000 || keys.some(k => typeof k !== "string") || array && (descriptors.length?.value !== keys.length || keys.some((k, i) => k !== String(i)))) return fail();
    const out: Record<string, unknown> | unknown[] = array ? [] : Object.create(null);
    ancestors.add(v);
    for (const key of keys) {
      const d = descriptors[key as string]; if (!d || !d.enumerable || !("value" in d)) return fail();
      Object.defineProperty(out, key, { value: copy(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(v); return out;
  }
  try {
    const out = copy(value, 0); if (bytes(out) > maximum) return fail("eval_composition_budget"); return out;
  } catch (error) { if (error instanceof EvalCompositionError) throw error; return fail(); }
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || !equal(Object.keys(value).sort(), [...keys].sort())) return fail();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum = 512): string {
  if (typeof value !== "string" || !validText(value) || !value.trim() || new TextEncoder().encode(value).byteLength > maximum) return fail(); return value;
}
function uuid(value: unknown): string { if (typeof value !== "string" || !UUID.test(value)) return fail(); return value; }
function digest(value: unknown): string { if (typeof value !== "string" || !DIGEST.test(value)) return fail(); return value; }
function integer(value: unknown, minimum: number, maximum: number): number { if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) return fail(); return value; }
function name(value: unknown): string { const result = text(value, 480).trim(); if (Array.from(result).length > 120) return fail(); return result; }
function time(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return fail();
  try { if (new Date(value).toISOString() !== value) return fail(); } catch { return fail(); } return value;
}
function versionFields(s: Record<string, unknown>) {
  const versionId = uuid(s.versionId), version = integer(s.version, 1, 2147483647), expectedVersionId = s.expectedVersionId === null ? null : uuid(s.expectedVersionId);
  if (version === 1 ? expectedVersionId !== null : expectedVersionId === null || expectedVersionId === versionId) return fail();
  return { versionId, version, expectedVersionId };
}
export { fail, hash, bytes, equal, snapshot, object, text, uuid, digest, integer, name, time, versionFields };

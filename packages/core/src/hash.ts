import { createHash } from "node:crypto";
import type { JsonValue } from "./types";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}

export function stableHash(value: unknown, length = 24): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, length);
}

export function textHash(value: string, length = 24): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function stableRowId(sourceKind: string, sourceId: string, payload: JsonValue): string {
  return `row_${stableHash({ sourceKind, sourceId, payload }, 20)}`;
}

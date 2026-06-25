import type { JsonValue } from "@open-evals/core";

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)/g;
const SECRET_RE = /\b(?:sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|ghp_[A-Za-z0-9]{20,})\b/g;
const SENSITIVE_KEYS = new Set(["email", "user_email", "phone", "phone_number", "authorization", "api_key", "token", "secret"]);

export function redactValue(value: JsonValue): JsonValue {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.replace(EMAIL_RE, "[redacted-email]").replace(PHONE_RE, "[redacted-phone]").replace(SECRET_RE, "[redacted-secret]");
  }
  if (Array.isArray(value)) return value.map(redactValue);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEYS.has(key.toLowerCase()) ? "[redacted]" : redactValue(item)])
  );
}

export function previewOutboundPayload(value: JsonValue, allowRawContent: boolean): { allowed: boolean; payload: JsonValue; reason?: string } {
  if (!allowRawContent) return { allowed: true, payload: redactValue(value), reason: "raw_content_redacted_by_policy" };
  return { allowed: true, payload: value };
}

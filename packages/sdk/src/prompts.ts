import {
  promptDraftInputFromVersion, stableStringify, validatePromptDraftInput,
  type InstructionDetailDTO, type PromptDraftInput, type PromptDraftPreview,
  type PromptVersion, type StoredVersionDTO, type VersionSummary
} from "@open-evals/core";

export interface PromptRequestOptions { signal?: AbortSignal }
export interface CreatePromptDefinitionInput { readonly id: string; readonly stableKey: string; readonly targetId?: string }
export interface CreatePromptDefinitionResult {
  readonly definition: CreatePromptDefinitionInput;
  readonly replayed: boolean;
}
export interface PromptSaveResult { readonly version: StoredVersionDTO; readonly replayed: boolean }
export interface PromptResolveInput {
  readonly definitionId?: string;
  readonly stableKey?: string;
  readonly candidateVersionId?: string;
  readonly experimentVersionId?: string;
  readonly projectId?: string;
  readonly workspaceId?: string;
  readonly userId?: string;
  readonly sessionId?: string;
}
export interface PromptResolution {
  readonly versionId: string;
  readonly appliedReleaseIds: readonly string[];
  readonly resolutionFingerprint: string;
  readonly compiledText: string;
  readonly contentHash: string;
}

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_JSON_NODES = 1_000_000;
const LOCAL_CODES = ["prompt_endpoint_invalid", "prompt_request_invalid", "prompt_protocol_error", "prompt_request_cancelled",
  "prompt_request_timeout", "prompt_network_error", "prompt_response_too_large", "prompt_http_error"];
const BACKEND_CODES = new Set([
  "authentication_required", "invalid_session", "invalid_session_signature", "session_expired", "api_key_invalid",
  "workspace_role_forbidden:viewer", "workspace_role_forbidden:editor", "api_key_scope_forbidden:prompts:read",
  "api_key_scope_forbidden:prompts:write", "instruction_project_key_required", "instruction_authoring_forbidden",
  "prompt_definition_object_required", "prompt_definition_fields_invalid", "prompt_target_required", "prompt_workspace_not_found",
  "prompt_target_not_found", "prompt_definition_identity_conflict", "prompt_definition_not_found", "prompt_version_not_found",
  "prompt_version_identity_conflict", "prompt_base_version_not_found", "prompt_base_version_required", "prompt_base_version_read_only",
  "prompt_preview_fingerprint_required", "prompt_preview_stale", "prompt_source_invalid", "prompt_source_or_locked_components_invalid",
  "prompt_identifier_invalid", "prompt_fingerprint_invalid", "prompt_parents_invalid", "prompt_preparation_required",
  "prompt_prepared_version_invalid", "prompt_identity_conflict", "prompt_version_selection_ambiguous", "prompt_resolution_object_required",
  "prompt_resolution_fields_invalid", "prompt_definition_identity_required", "prompt_definition_ambiguous", "prompt_versions_not_found",
  "prompt_no_active_version", "resolved_prompt_version_not_found", "resolved_prompt_version_not_servable", "instruction_request_too_large",
  "invalid_json_body", "json_content_type_required", "json_body_required", "database_unavailable", "instruction_request_failed"
]);
const SAFE_CODES = new Set([...LOCAL_CODES, ...BACKEND_CODES]);

export class OpenEvalsHttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code = "prompt_http_error") {
    const safeStatus = Number.isInteger(status) && status >= 0 && status <= 599 ? status : 0;
    const safeCode = SAFE_CODES.has(code) ? code : "prompt_http_error";
    super(`open_evals_http_error:${safeStatus}:${safeCode}`);
    this.name = "OpenEvalsHttpError";
    this.status = safeStatus;
    this.code = safeCode;
  }
}

export function normalizePromptEndpoint(endpoint: string): string {
  try {
    if (typeof endpoint !== "string" || !endpoint || endpoint.length > 4096 || endpoint.trim() !== endpoint
      || !/^https?:\/\//i.test(endpoint) || /[\\\u0000-\u0020\u007f]/.test(endpoint)) throw new Error();
    const url = new URL(endpoint);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password
      || url.href.includes("?") || url.href.includes("#") || /^https?:\/\/[^/]*@/i.test(endpoint)) throw new Error();
    return url.href.replace(/\/+$/, "");
  } catch { throw new OpenEvalsHttpError(0, "prompt_endpoint_invalid"); }
}

export function parsePromptDefinitionDetail(value: unknown, expectedDefinitionId?: string, expectedVersionId?: string): InstructionDetailDTO {
  return protocol(() => {
    const input = record(jsonCopy(value), ["definition", "versions", "selectedVersion", "canWrite"]);
    const definition = definitionFrom(input.definition);
    if (expectedDefinitionId !== undefined && definition.id !== identity(expectedDefinitionId)) invalid();
    const versions = array(input.versions).map(summaryFrom);
    if (new Set(versions.map(version => version.id)).size !== versions.length || typeof input.canWrite !== "boolean") invalid();
    const selectedVersion = input.selectedVersion === null ? null : storedFrom(input.selectedVersion, definition.id);
    if (expectedVersionId !== undefined && selectedVersion?.id !== identity(expectedVersionId)) invalid();
    if ((versions.length === 0) !== (selectedVersion === null)) invalid();
    const summary = selectedVersion && versions.find(version => version.id === selectedVersion.id);
    if (selectedVersion && !summary) invalid();
    if (selectedVersion && summary) {
      for (const key of ["status", "createdAt", "contentHash", "parentVersionIds"] as const) {
        if (stableStringify(selectedVersion[key]) !== stableStringify(summary[key])) invalid();
      }
      if (selectedVersion.version && summary.authoring !== selectedVersion.authoring) invalid();
    }
    return freeze({ definition, versions, selectedVersion, canWrite: input.canWrite });
  });
}

export function parsePromptDraftPreview(value: unknown, expectedDefinitionId?: string, expectedInput?: PromptDraftInput): PromptDraftPreview {
  return protocol(() => {
    const input = record(jsonCopy(value), ["version", "requestFingerprint", "previewFingerprint"]);
    const version = canonicalVersion(input.version, expectedDefinitionId, expectedInput);
    if (version.status !== "draft") invalid();
    return freeze({ version, requestFingerprint: digest(input.requestFingerprint, 64), previewFingerprint: digest(input.previewFingerprint, 64) });
  });
}

export function parsePromptSaveResult(value: unknown, expectedDefinitionId?: string, expectedInput?: PromptDraftInput): PromptSaveResult {
  return protocol(() => {
    const input = record(jsonCopy(value), ["version", "replayed"]);
    if (typeof input.replayed !== "boolean") invalid();
    const version = storedFrom(input.version, expectedDefinitionId, expectedInput);
    if (!version.version || (!input.replayed && version.status !== "draft")) invalid();
    return freeze({ version, replayed: input.replayed });
  });
}

export function parsePromptResolution(value: unknown): PromptResolution {
  return protocol(() => {
    const input = record(jsonCopy(value), ["versionId", "appliedReleaseIds", "resolutionFingerprint", "compiledText", "contentHash"]);
    const appliedReleaseIds = array(input.appliedReleaseIds, 128).map(identity);
    if (!appliedReleaseIds.length || new Set(appliedReleaseIds).size !== appliedReleaseIds.length) invalid();
    return freeze({ versionId: identity(input.versionId), appliedReleaseIds, resolutionFingerprint: digest(input.resolutionFingerprint, 24),
      compiledText: text(input.compiledText), contentHash: text(input.contentHash) });
  });
}

/** Checked transport shared by OpenEvalsClient; construction does not change legacy endpoint behavior. */
export class PromptClient {
  private readonly endpoint: string;
  private readonly apiKey?: string;
  constructor(endpoint: string, apiKey?: string) { this.endpoint = endpoint; this.apiKey = apiKey; }

  async createPromptDefinition(input: CreatePromptDefinitionInput, options?: PromptRequestOptions): Promise<CreatePromptDefinitionResult> {
    const expected = requestInput(() => definitionFrom(jsonCopy(input)));
    const response = await this.request("/api/v1/instructions", expected, options, true);
    return protocol(() => {
      const result = record(jsonCopy(response.value), ["definition", "replayed"]);
      const definition = definitionFrom(result.definition);
      if (typeof result.replayed !== "boolean" || stableStringify(definition) !== stableStringify(expected)
        || response.status !== (result.replayed ? 200 : 201)) invalid();
      return freeze({ definition, replayed: result.replayed });
    });
  }

  async getPromptDefinition(definitionId: string, versionId?: string, options?: PromptRequestOptions): Promise<InstructionDetailDTO> {
    const id = requestInput(() => pathDefinitionIdentity(definitionId));
    const version = versionId === undefined ? undefined : requestInput(() => identity(versionId));
    const path = `/api/v1/instructions/${encodeURIComponent(id)}${version === undefined ? "" : `?${new URLSearchParams({ versionId: version })}`}`;
    return parsePromptDefinitionDetail((await this.request(path, undefined, options)).value, id, version);
  }

  async previewPromptVersion(definitionId: string, input: PromptDraftInput, options?: PromptRequestOptions): Promise<PromptDraftPreview> {
    const id = requestInput(() => pathDefinitionIdentity(definitionId));
    const draft = requestInput(() => validatePromptDraftInput(jsonCopy(input)));
    return parsePromptDraftPreview((await this.request(`/api/v1/instructions/${encodeURIComponent(id)}/preview`, draft, options)).value, id, draft);
  }

  async savePromptVersion(definitionId: string, input: PromptDraftInput, previewFingerprint: string, options?: PromptRequestOptions): Promise<PromptSaveResult> {
    const id = requestInput(() => pathDefinitionIdentity(definitionId));
    const draft = requestInput(() => validatePromptDraftInput(jsonCopy(input)));
    const fingerprint = requestInput(() => digest(previewFingerprint, 64));
    const response = await this.request(`/api/v1/instructions/${encodeURIComponent(id)}/versions`, { ...draft, previewFingerprint: fingerprint }, options, true);
    const result = parsePromptSaveResult(response.value, id, draft);
    if (response.status !== (result.replayed ? 200 : 201)) invalid();
    return result;
  }

  async resolvePromptJson(input: PromptResolveInput, options?: PromptRequestOptions): Promise<PromptResolution> {
    const payload = requestInput(() => {
      const value = record(jsonCopy(input), ["definitionId", "stableKey", "candidateVersionId", "experimentVersionId", "projectId", "workspaceId", "userId", "sessionId"]);
      if (!value.definitionId && !value.stableKey) invalid();
      for (const field of Object.values(value)) identity(field);
      return value;
    });
    return parsePromptResolution((await this.request("/api/v1/prompts/resolve", payload, options)).value);
  }

  private async request(path: string, payload: unknown, options?: PromptRequestOptions, allowCreated = false): Promise<{ value: unknown; status: number }> {
    const endpoint = normalizePromptEndpoint(this.endpoint);
    const deadline = AbortSignal.timeout(30_000);
    let signal: AbortSignal;
    try { signal = options?.signal ? AbortSignal.any([options.signal, deadline]) : deadline; }
    catch { throw new OpenEvalsHttpError(0, "prompt_request_invalid"); }
    try {
      if (signal.aborted) throw new Error();
      const body = payload === undefined ? undefined : JSON.stringify(payload);
      if (body !== undefined && new TextEncoder().encode(body).length > 2 * 1024 * 1024) throw new OpenEvalsHttpError(0, "prompt_request_invalid");
      const response = await fetch(`${endpoint}${path}`, {
        method: body === undefined ? "GET" : "POST", redirect: "error", signal,
        headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) }, body
      });
      if (!response.ok) {
        let code = "prompt_http_error";
        try {
          const failure = await readJson(response, 8192);
          const candidate = failure && typeof failure === "object" && !Array.isArray(failure) ? (failure as Record<string, unknown>).error : undefined;
          if (typeof candidate === "string" && BACKEND_CODES.has(candidate)) code = candidate;
        } catch (error) { if (signal.aborted) throw error; }
        throw new OpenEvalsHttpError(response.status, code);
      }
      if (response.status !== 200 && !(allowCreated && response.status === 201)) {
        await response.body?.cancel().catch(() => undefined);
        invalid();
      }
      return { value: await readJson(response, MAX_BYTES), status: response.status };
    } catch (error) {
      if (options?.signal?.aborted) throw new OpenEvalsHttpError(0, "prompt_request_cancelled");
      if (deadline.aborted) throw new OpenEvalsHttpError(0, "prompt_request_timeout");
      if (error instanceof OpenEvalsHttpError) throw error;
      throw new OpenEvalsHttpError(0, "prompt_network_error");
    }
  }
}

function definitionFrom(value: unknown): CreatePromptDefinitionInput {
  const input = record(value, ["id", "stableKey", "targetId"]);
  return { id: identity(input.id), stableKey: identity(input.stableKey), ...(Object.hasOwn(input, "targetId") ? { targetId: identity(input.targetId) } : {}) };
}

function summaryFrom(value: unknown): VersionSummary {
  const input = record(value, ["id", "status", "createdAt", "parentVersionIds", "contentHash", "authoring"]);
  const id = identity(input.id), parentVersionIds = array(input.parentVersionIds, 2048).map(identity);
  if (!["literal", "composition", "legacy"].includes(input.authoring as string)) invalid();
  const createdAt = text(input.createdAt, 64);
  if (!Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) invalid();
  return { id, status: text(input.status), createdAt, parentVersionIds, contentHash: text(input.contentHash), authoring: input.authoring as VersionSummary["authoring"] };
}

function storedFrom(value: unknown, expectedDefinitionId?: string, expectedInput?: PromptDraftInput): StoredVersionDTO {
  const input = record(value, ["id", "status", "createdAt", "parentVersionIds", "contentHash", "authoring", "compiledText", "version", "readOnlyReason"]);
  const summary = summaryFrom(Object.fromEntries(Object.entries(input).filter(([key]) => !["compiledText", "version", "readOnlyReason"].includes(key))));
  const compiledText = text(input.compiledText);
  if (Object.hasOwn(input, "version")) {
    if (Object.hasOwn(input, "readOnlyReason") || summary.authoring === "legacy") invalid();
    const version = canonicalVersion(input.version, expectedDefinitionId, expectedInput);
    if (version.id !== summary.id || version.status !== summary.status || version.compiledText !== compiledText
      || version.contentHash !== summary.contentHash || stableStringify(version.parentVersionIds) !== stableStringify(summary.parentVersionIds)
      || summary.authoring !== (version.compositionSnapshot ? "composition" : "literal")) invalid();
    return { ...summary, compiledText, version };
  }
  if (expectedInput !== undefined || summary.authoring !== "legacy"
    || !["legacy_prompt_version", "invalid_authored_version"].includes(input.readOnlyReason as string)) invalid();
  return { ...summary, compiledText, readOnlyReason: input.readOnlyReason as string };
}

function canonicalVersion(value: unknown, expectedDefinitionId?: string, expectedInput?: PromptDraftInput): PromptVersion {
  const version = value as PromptVersion;
  const draft = promptDraftInputFromVersion(version);
  if (expectedDefinitionId !== undefined && version.definitionId !== identity(expectedDefinitionId)) invalid();
  if (expectedInput !== undefined && stableStringify(draft) !== stableStringify(validatePromptDraftInput(expectedInput))) invalid();
  return version;
}

function identity(value: unknown): string {
  const result = text(value, 128);
  if (!result || result.trim() !== result || /[\u0000-\u001f\u007f]/.test(result)
    || ["__proto__", "prototype", "constructor"].includes(result)) invalid();
  return result;
}

function pathDefinitionIdentity(value: unknown): string {
  const result = identity(value);
  if (result === "." || result === "..") invalid();
  return result;
}

function text(value: unknown, maximum = MAX_BYTES): string {
  if (typeof value !== "string" || value.length > maximum) invalid();
  return value;
}

function digest(value: unknown, length: number): string {
  if (typeof value !== "string" || value.length !== length || !/^[a-f0-9]+$/.test(value)) invalid();
  return value;
}

function record(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !allowed.includes(key))) invalid();
  return input;
}

function array(value: unknown, maximum = 100_000): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value;
}

function invalid(): never { throw new OpenEvalsHttpError(0, "prompt_protocol_error"); }
function protocol<T>(operation: () => T): T { try { return operation(); } catch { return invalid(); } }
function requestInput<T>(operation: () => T): T {
  try { return operation(); } catch { throw new OpenEvalsHttpError(0, "prompt_request_invalid"); }
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Strict detached JSON, including public parser callers rather than only network JSON. */
function jsonCopy(value: unknown): unknown {
  let nodes = 0, bytes = 0;
  const active = new Set<object>();
  const charge = (count: number) => { bytes += count; if (bytes > MAX_BYTES) invalid(); };
  const stringBytes = (input: string) => {
    if (input.length > MAX_BYTES) invalid();
    charge(2);
    for (let index = 0; index < input.length; index++) {
      const unit = input.charCodeAt(index);
      if (unit === 0) invalid();
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = input.charCodeAt(++index);
        if (!(next >= 0xdc00 && next <= 0xdfff)) invalid();
        charge(4);
      } else if (unit >= 0xdc00 && unit <= 0xdfff) invalid();
      else charge(unit === 34 || unit === 92 || [8, 9, 10, 12, 13].includes(unit) ? 2 : unit < 32 ? 6 : unit < 128 ? 1 : unit < 2048 ? 2 : 3);
    }
  };
  const copy = (input: unknown, depth: number): unknown => {
    if (++nodes > MAX_JSON_NODES || depth > 64) invalid();
    if (typeof input === "string") { stringBytes(input); return input; }
    if (input === null || typeof input === "boolean") { charge(input === null ? 4 : input ? 4 : 5); return input; }
    if (typeof input === "number") { if (!Number.isFinite(input)) invalid(); charge(String(input).length); return input; }
    if (!input || typeof input !== "object" || active.has(input)) invalid();
    active.add(input);
    charge(2);
    try {
      if (Array.isArray(input)) {
        if (Object.getPrototypeOf(input) !== Array.prototype || input.length > MAX_JSON_NODES
          || Reflect.ownKeys(input).length !== input.length + 1) invalid();
        const output: unknown[] = [];
        for (let index = 0; index < input.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
          if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) invalid();
          if (index) charge(1);
          output.push(copy(descriptor.value, depth + 1));
        }
        return output;
      }
      if (![Object.prototype, null].includes(Object.getPrototypeOf(input))) invalid();
      const output: Record<string, unknown> = {};
      let index = 0;
      for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key)) invalid();
        const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
        if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable) invalid();
        if (index++) charge(1);
        stringBytes(key); charge(1);
        output[key] = copy(descriptor.value, depth + 1);
      }
      return output;
    } finally { active.delete(input); }
  };
  return copy(value, 0);
}

async function readJson(response: Response, maximum: number): Promise<unknown> {
  if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    await response.body?.cancel().catch(() => undefined);
    invalid();
  }
  const length = response.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > maximum) {
    await response.body?.cancel().catch(() => undefined);
    throw new OpenEvalsHttpError(0, "prompt_response_too_large");
  }
  if (!response.body) invalid();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximum) {
        await reader.cancel().catch(() => undefined);
        throw new OpenEvalsHttpError(0, "prompt_response_too_large");
      }
      chunks.push(chunk.value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)); }
    catch { return invalid(); }
  } finally { reader.releaseLock(); }
}

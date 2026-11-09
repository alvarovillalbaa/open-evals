import { lookup as lookupAddress } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { isIP, type LookupFunction } from "node:net";

export interface PublicHttpTargetRequest {
  endpoint: string;
  timeoutMs: number;
  body: string;
  requestFingerprint: string;
  idempotencyKey: string;
  signal?: AbortSignal;
}

export interface PublicHttpTargetResponse {
  bodyText: string;
  statusCode: number;
  bytes: number;
  elapsedMs: number;
}

export class HttpTargetTransportError extends Error {
  readonly code: string;
  readonly outcome: "not_sent" | "unknown";
  readonly statusCode?: number;
  constructor(code: string, outcome: "not_sent" | "unknown", statusCode?: number) {
    super(code); this.name = "HttpTargetTransportError";
    this.code = code; this.outcome = outcome; this.statusCode = statusCode;
  }
}

interface Address { address: string; family: number }
export interface HttpTargetTransportDependencies {
  lookupAll: (hostname: string) => Promise<readonly Address[]>;
  request: (options: RequestOptions & { autoSelectFamily: false }, callback: (response: IncomingMessage) => void) => ClientRequest;
}

const MAX_REQUEST_BYTES = 1024 * 1024 + 8192;
const MAX_RESPONSE_BYTES = 65536;
const MAX_HEADER_BYTES = 16384;
const HASH = /^[0-9a-f]{64}$/;
const badInput = (): never => { throw new HttpTargetTransportError("http_target_request_invalid", "not_sent"); };
const notPublic = (): never => { throw new HttpTargetTransportError("http_target_destination_not_public", "not_sent"); };

function ipv4Number(address: string): number {
  return address.split(".").reduce((value, part) => value * 256 + Number(part), 0);
}
function ipv4In(value: number, network: string, bits: number): boolean {
  const width = 2 ** (32 - bits);
  return Math.floor(value / width) === Math.floor(ipv4Number(network) / width);
}
function ipv6Number(address: string): bigint {
  const halves = address.toLowerCase().split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const words = halves.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return words.reduce((value, word) => (value << BigInt(16)) | BigInt("0x" + word), BigInt(0));
}
function ipv6In(value: bigint, network: string, bits: number): boolean {
  const shift = BigInt(128 - bits);
  return value >> shift === ipv6Number(network) >> shift;
}

/** Conservative public Internet destinations; transition and metadata ranges are excluded. */
export function isPublicHttpTargetAddress(address: string): boolean {
  if (typeof address !== "string" || address.length > 45 || address.includes("%")) return false;
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Number(address);
    const denied: ReadonlyArray<readonly [string, number]> = [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.31.196.0", 24], ["192.52.193.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
      ["192.175.48.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
      ["224.0.0.0", 4], ["240.0.0.0", 4]
    ];
    return address !== "168.63.129.16" && !denied.some(([network, bits]) => ipv4In(value, network, bits));
  }
  if (family !== 6 || address.includes(".")) return false;
  const value = ipv6Number(address);
  const denied: ReadonlyArray<readonly [string, number]> = [
    ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3ffe::", 16],
    ["3fff::", 20], ["2620:4f:8000::", 48]
  ];
  return ipv6In(value, "2000::", 3) && !denied.some(([network, bits]) => ipv6In(value, network, bits));
}

export function parsePublicHttpTargetEndpoint(value: unknown): URL {
  if (typeof value !== "string" || !value || Buffer.byteLength(value) > 4096 || Buffer.from(value).toString("utf8") !== value || value.trim() !== value
    || /[\u0000-\u0020\u007f\\]/u.test(value) || value.includes("?") || value.includes("#")) return badInput();
  let url: URL;
  try { url = new URL(value); } catch { return badInput(); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return badInput();
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (!isPublicHttpTargetAddress(host)) return notPublic();
  } else if (host.length > 253 || !host.includes(".") || host.endsWith(".")
    || !host.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
    || /(?:^|\.)(?:localhost|local|internal|lan|home|onion|test|invalid|example)$/i.test(host)
    || host.endsWith(".home.arpa")) return notPublic();
  if (Buffer.byteLength(url.href) > 4096) return badInput();
  return url;
}

function requestInput(value: PublicHttpTargetRequest): { input: PublicHttpTargetRequest; url: URL; body: Buffer } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return badInput();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return badInput();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowed = ["endpoint", "timeoutMs", "body", "requestFingerprint", "idempotencyKey", "signal"];
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !allowed.includes(key))) return badInput();
  if (Object.values(descriptors).some(item => !("value" in item) || !item.enumerable)) return badInput();
  const input = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value])) as unknown as PublicHttpTargetRequest;
  if (typeof input.body !== "string" || !input.body || !Number.isInteger(input.timeoutMs)
    || input.timeoutMs < 1 || input.timeoutMs > 10000 || typeof input.requestFingerprint !== "string"
    || !HASH.test(input.requestFingerprint) || typeof input.idempotencyKey !== "string"
    || !HASH.test(input.idempotencyKey) || input.signal !== undefined && !(input.signal instanceof AbortSignal)) return badInput();
  const body = Buffer.from(input.body, "utf8");
  if (body.length > MAX_REQUEST_BYTES || body.toString("utf8") !== input.body) return badInput();
  return { input, url: parsePublicHttpTargetEndpoint(input.endpoint), body };
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const aborted = () => {
      if (settled) return;
      settled = true; signal.removeEventListener("abort", aborted);
      reject(new HttpTargetTransportError("http_target_aborted", "not_sent"));
    };
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(value => {
      if (settled) return;
      settled = true; signal.removeEventListener("abort", aborted); resolve(value);
    }, () => {
      if (settled) return;
      settled = true; signal.removeEventListener("abort", aborted);
      reject(new HttpTargetTransportError("http_target_dns_failed", "not_sent"));
    });
    if (signal.aborted) aborted();
  });
}

/** Dependency seams are trusted code inputs, never fields accepted from an API request. */
export function createPublicHttpTargetTransport(dependencies: HttpTargetTransportDependencies = {
  lookupAll: hostname => lookupAddress(hostname, { all: true, verbatim: true }),
  request: httpsRequest
}): (value: PublicHttpTargetRequest) => Promise<PublicHttpTargetResponse> {
  return async value => {
    const { input, url, body } = requestInput(value);
    const started = performance.now();
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    input.signal?.addEventListener("abort", forwardAbort, { once: true });
    if (input.signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      if (controller.signal.aborted) throw new HttpTargetTransportError("http_target_aborted", "not_sent");
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const literalFamily = isIP(hostname);
      const addresses = literalFamily ? [{ address: hostname, family: literalFamily }]
        : await untilAborted(Promise.resolve().then(() => dependencies.lookupAll(hostname)), controller.signal);
      if (!Array.isArray(addresses) || !addresses.length || addresses.length > 16
        || addresses.some(item => !item || ![4, 6].includes(item.family)
          || isIP(item.address) !== item.family || !isPublicHttpTargetAddress(item.address))) return notPublic();
      if (controller.signal.aborted) throw new HttpTargetTransportError("http_target_aborted", "not_sent");
      const selected = addresses[0];
      const pinnedLookup: LookupFunction = (requestedHost, _options, callback) => {
        if (requestedHost !== hostname) callback(new Error("http_target_pinned_host_mismatch"), "", 0);
        else callback(null, selected.address, selected.family);
      };
      return await new Promise<PublicHttpTargetResponse>((resolve, reject) => {
        let done = false, mayHaveBeenSent = false;
        let request: ClientRequest | undefined;
        let response: IncomingMessage | undefined;
        const fail = (code: string, statusCode?: number) => {
          if (done) return;
          done = true; controller.signal.removeEventListener("abort", aborted);
          response?.destroy(); request?.destroy();
          reject(new HttpTargetTransportError(code, mayHaveBeenSent ? "unknown" : "not_sent", statusCode));
        };
        const aborted = () => fail("http_target_aborted");
        controller.signal.addEventListener("abort", aborted, { once: true });
        try {
          request = dependencies.request({
            protocol: "https:", hostname, port: 443, path: url.pathname, method: "POST",
            agent: false, autoSelectFamily: false, family: selected.family, lookup: pinnedLookup,
            servername: literalFamily ? undefined : hostname, rejectUnauthorized: true,
            maxHeaderSize: MAX_HEADER_BYTES, insecureHTTPParser: false,
            headers: {
              "accept": "application/json", "accept-encoding": "identity", "content-type": "application/json",
              "content-length": String(body.length), "connection": "close", "user-agent": "OpenEvals-HTTP-Target/1",
              "idempotency-key": input.idempotencyKey, "x-open-evals-request-sha256": input.requestFingerprint
            }
          }, incoming => {
            response = incoming;
            incoming.once("error", () => fail("http_target_response_failed", incoming.statusCode));
            incoming.once("aborted", () => fail("http_target_response_incomplete", incoming.statusCode));
            incoming.once("close", () => { if (!done && !incoming.complete) fail("http_target_response_incomplete", incoming.statusCode); });
            if (done) { incoming.destroy(); return; }
            const statusCode = incoming.statusCode;
            if (!statusCode || statusCode < 200 || statusCode >= 300) { fail("http_target_status_failed", statusCode); return; }
            const contentType = incoming.headers["content-type"];
            const encoding = incoming.headers["content-encoding"];
            const length = incoming.headers["content-length"];
            const singular = ["content-type", "content-encoding", "content-length"];
            if (singular.some(name => incoming.rawHeaders.filter((_, index) => index % 2 === 0
              && incoming.rawHeaders[index].toLowerCase() === name).length > 1)
              || typeof contentType !== "string" || !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(contentType)
              || encoding !== undefined && (typeof encoding !== "string" || encoding.toLowerCase() !== "identity")
              || length !== undefined && (typeof length !== "string" || !/^(0|[1-9][0-9]*)$/.test(length)
                || Number(length) > MAX_RESPONSE_BYTES)) { fail("http_target_headers_invalid", statusCode); return; }
            const chunks: Buffer[] = []; let bytes = 0;
            incoming.on("data", (chunk: unknown) => {
              if (done) return;
              if (!Buffer.isBuffer(chunk) || bytes + chunk.length > MAX_RESPONSE_BYTES) { fail("http_target_response_too_large", statusCode); return; }
              chunks.push(chunk); bytes += chunk.length;
            });
            incoming.once("end", () => {
              if (done) return;
              if (!incoming.complete || length !== undefined && Number(length) !== bytes) { fail("http_target_response_incomplete", statusCode); return; }
              if (!bytes) { fail("http_target_response_empty", statusCode); return; }
              let bodyText: string;
              try { bodyText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)); }
              catch { fail("http_target_response_utf8_invalid", statusCode); return; }
              done = true; controller.signal.removeEventListener("abort", aborted);
              resolve({ bodyText, statusCode, bytes, elapsedMs: Math.max(0, Math.ceil(performance.now() - started)) });
            });
          });
          request.once("error", () => fail("http_target_request_failed"));
          if (controller.signal.aborted) { aborted(); return; }
          // Once end is attempted, a lost response cannot prove that the target did not act.
          mayHaveBeenSent = true;
          request.end(body);
        } catch { fail("http_target_request_failed"); }
      });
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", forwardAbort);
    }
  };
}

export const invokePublicHttpTarget = createPublicHttpTargetTransport();

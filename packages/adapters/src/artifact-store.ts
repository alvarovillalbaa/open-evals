import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stableHash, type JsonValue } from "@open-evals/core";

export interface ArtifactStore {
  kind?: string;
  health?(): Promise<{ ok: boolean; message: string }>;
  putJson(payload: JsonValue, options?: { prefix?: string }): Promise<{ ref: string; hash: string }>;
  getJson(ref: string): Promise<JsonValue>;
}

export class LocalArtifactStore implements ArtifactStore {
  kind = "local";

  constructor(private readonly root = process.env.LOCAL_DATA_DIR ?? ".data") {}

  async health() {
    return { ok: true, message: `Local artifact storage is available at ${this.root}.` };
  }

  async putJson(payload: JsonValue, options: { prefix?: string } = {}) {
    const hash = stableHash(payload, 64);
    const prefix = options.prefix ?? "artifacts";
    const directory = join(this.root, prefix, hash.slice(0, 2));
    await mkdir(directory, { recursive: true });
    const path = join(directory, `${hash}.json`);
    await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return { ref: path, hash };
  }

  async getJson(ref: string): Promise<JsonValue> {
    return JSON.parse(await readFile(ref, "utf8")) as JsonValue;
  }
}

export class VercelBlobArtifactStore implements ArtifactStore {
  kind = "vercel_blob";

  constructor(private readonly token = process.env.BLOB_READ_WRITE_TOKEN) {}

  async health() {
    if (!this.token) return { ok: false, message: "BLOB_READ_WRITE_TOKEN is not configured." };
    const blob = await loadVercelBlobSdk();
    return blob ? { ok: true, message: "Vercel Blob SDK is available." } : { ok: false, message: "Install @vercel/blob to enable hosted private artifact storage." };
  }

  async putJson(payload: JsonValue, options: { prefix?: string } = {}) {
    if (!this.token) throw new Error("blob_token_not_configured");
    const blob = await loadVercelBlobSdk();
    if (!blob?.put) throw new Error("vercel_blob_sdk_unavailable");
    const hash = stableHash(payload, 64);
    const pathname = `${options.prefix ?? "artifacts"}/${hash.slice(0, 2)}/${hash}.json`;
    const result = await blob.put(pathname, JSON.stringify(payload), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      token: this.token
    });
    return { ref: String(result.url ?? result.pathname ?? pathname), hash };
  }

  async getJson(ref: string): Promise<JsonValue> {
    if (!this.token) throw new Error("blob_token_not_configured");
    const response = await fetch(ref, { headers: { authorization: `Bearer ${this.token}` } });
    if (!response.ok) throw new Error(`blob_fetch_failed:${response.status}`);
    return (await response.json()) as JsonValue;
  }
}

export function createArtifactStore() {
  return process.env.ARTIFACT_STORAGE_DRIVER === "vercel_blob" ? new VercelBlobArtifactStore() : new LocalArtifactStore();
}

async function loadVercelBlobSdk(): Promise<{ put?: (...args: unknown[]) => Promise<{ url?: string; pathname?: string }> } | undefined> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
    return (await dynamicImport("@vercel/blob")) as { put?: (...args: unknown[]) => Promise<{ url?: string; pathname?: string }> };
  } catch {
    return undefined;
  }
}

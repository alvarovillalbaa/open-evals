import { stableHash, type JsonValue } from "@open-evals/core";

export interface SandboxRunRequest {
  language: "javascript" | "python";
  source: string;
  input: JsonValue;
  timeoutMs: number;
  network: false;
  maxOutputBytes: number;
}

export interface SandboxRunResult {
  id: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  output?: JsonValue;
  sourceHash: string;
  durationMs: number;
  runner: "local_fixture" | "vercel_sandbox";
}

export interface SandboxRunner {
  kind: "local_fixture" | "vercel_sandbox";
  health(): Promise<{ ok: boolean; message: string }>;
  run(request: SandboxRunRequest): Promise<SandboxRunResult>;
}

export class LocalFixtureSandboxRunner implements SandboxRunner {
  kind = "local_fixture" as const;

  async health() {
    return { ok: true, message: "Local fixture sandbox is available for deterministic tests; arbitrary code execution is disabled." };
  }

  async run(request: SandboxRunRequest): Promise<SandboxRunResult> {
    const started = Date.now();
    if (request.network !== false) throw new Error("sandbox_network_must_be_disabled");
    if (request.source.length > request.maxOutputBytes) throw new Error("sandbox_source_limit_exceeded");
    const sourceHash = stableHash(request.source, 64);
    return {
      id: `sandbox_${stableHash({ sourceHash, input: request.input }, 18)}`,
      ok: true,
      stdout: "",
      stderr: "",
      output: { deterministic: true, input: request.input, language: request.language },
      sourceHash,
      durationMs: Date.now() - started,
      runner: this.kind
    };
  }
}

export class VercelSandboxRunner implements SandboxRunner {
  kind = "vercel_sandbox" as const;

  async health() {
    if (!process.env.VERCEL_OIDC_TOKEN && !process.env.VERCEL_TOKEN) {
      return { ok: false, message: "Vercel Sandbox requires Vercel OIDC or token authentication." };
    }
    const sdk = await loadSandboxSdk();
    return sdk ? { ok: true, message: "Vercel Sandbox SDK is available." } : { ok: false, message: "Install @vercel/sandbox to enable hosted sandbox execution." };
  }

  async run(request: SandboxRunRequest): Promise<SandboxRunResult> {
    const sdk = await loadSandboxSdk();
    if (!sdk) throw new Error("vercel_sandbox_sdk_unavailable");
    const sourceHash = stableHash(request.source, 64);
    const started = Date.now();
    if (request.network !== false) throw new Error("sandbox_network_must_be_disabled");
    const run = sdk.run ?? sdk.create;
    if (!run) throw new Error("vercel_sandbox_run_unavailable");
    const result = (await run({
      runtime: request.language,
      source: request.source,
      input: request.input,
      timeoutMs: request.timeoutMs,
      network: false,
      maxOutputBytes: request.maxOutputBytes
    })) as { stdout?: string; stderr?: string; output?: JsonValue; ok?: boolean };
    return {
      id: `sandbox_${stableHash({ sourceHash, started }, 18)}`,
      ok: result.ok !== false,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
      output: result.output,
      sourceHash,
      durationMs: Date.now() - started,
      runner: this.kind
    };
  }
}

export function createSandboxRunner(): SandboxRunner {
  return process.env.SANDBOX_DRIVER === "vercel" ? new VercelSandboxRunner() : new LocalFixtureSandboxRunner();
}

async function loadSandboxSdk(): Promise<{ run?: (request: unknown) => Promise<unknown>; create?: (request: unknown) => Promise<unknown> } | undefined> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
    return (await dynamicImport("@vercel/sandbox")) as { run?: (request: unknown) => Promise<unknown>; create?: (request: unknown) => Promise<unknown> };
  } catch {
    return undefined;
  }
}


import { readFile } from "node:fs/promises";
import type { JsonValue } from "@open-evals/core";
import { OpenEvalsClient, OpenEvalsHttpError, normalizePromptEndpoint } from "@open-evals/sdk";
import {
  PromptFileError, diffPromptDetails, makePromptReviewFile, readPromptDefinitionFile,
  readPromptDetailFile, readPromptDraftFile, readPromptReviewFile, writePromptJsonFile
} from "./prompt-files";

export interface CliContext {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env?: Readonly<Record<string, string | undefined>>;
}

const VALUE_FLAGS = [
  "--endpoint", "--api-key", "--file", "--out", "--definition-id", "--version-id",
  "--left", "--right", "--candidate-version-id", "--experiment-version-id", "--project-id", "--session-id"
] as const;
type ValueFlag = typeof VALUE_FLAGS[number];
type Flag = ValueFlag | "--json" | "--help";
type CommandSpec = { flags: readonly ValueFlag[]; required?: readonly ValueFlag[]; implemented?: false };
const COMMON_FLAGS: readonly Flag[] = ["--endpoint", "--api-key", "--json", "--help"];
const COMMANDS: Readonly<Record<string, CommandSpec>> = {
  doctor: { flags: [] },
  "ingest file": { flags: ["--file"], required: ["--file"] },
  "ingest otlp": { flags: ["--file"], required: ["--file"] },
  "eval run": { flags: ["--file"], required: ["--file"] },
  "scenario run": { flags: ["--file"], required: ["--file"] },
  "benchmark run": { flags: ["--file"], required: ["--file"] },
  "benchmark list": { flags: [] },
  "prompt create": { flags: ["--file"], required: ["--file"] },
  "prompt preview": { flags: ["--definition-id", "--file", "--out"], required: ["--definition-id", "--file", "--out"] },
  "prompt push": { flags: ["--file"], required: ["--file"] },
  "prompt pull": { flags: ["--definition-id", "--version-id", "--out"], required: ["--definition-id"] },
  "prompt diff": { flags: ["--left", "--right"], required: ["--left", "--right"] },
  "prompt resolve": {
    flags: ["--definition-id", "--candidate-version-id", "--experiment-version-id", "--project-id", "--session-id"],
    required: ["--definition-id"]
  },
  login: { flags: [], implemented: false },
  "eval status": { flags: [], implemented: false },
  "eval cancel": { flags: [], implemented: false },
  "eval export": { flags: [], implemented: false },
  "calibration run": { flags: [], implemented: false },
  "benchmark import": { flags: [], implemented: false },
  "optimize start": { flags: [], implemented: false },
  "optimize status": { flags: [], implemented: false },
  "experiment status": { flags: [], implemented: false },
  "release promote": { flags: [], implemented: false },
  "release rollback": { flags: [], implemented: false }
};

class CliError extends Error {
  constructor(readonly code: string, readonly option?: Flag, readonly status?: number) { super(code); }
}

type Parsed = { command: string; values: Map<ValueFlag, string>; json: boolean; help: boolean };

function parseArgs(args: readonly string[]): Parsed {
  const values = new Map<ValueFlag, string>();
  const seen = new Set<Flag>();
  const words: string[] = [];
  let help = false, json = false;
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (!token.startsWith("-")) {
      if (!token) throw new CliError("unknown_command");
      words.push(token);
      continue;
    }
    const name = token === "-h" ? "--help" : token;
    if (name !== "--help" && name !== "--json" && !VALUE_FLAGS.includes(name as ValueFlag)) throw new CliError("unknown_flag");
    const flag = name as Flag;
    if (seen.has(flag)) throw new CliError("duplicate_flag", flag);
    seen.add(flag);
    if (flag === "--help") { help = true; continue; }
    if (flag === "--json") { json = true; continue; }
    const value = args[index + 1];
    if (!value || value.startsWith("-")) throw new CliError("missing_flag_value", flag);
    values.set(flag, value);
    index += 1;
  }
  const command = words.join(" ");
  if (!command || command === "help") {
    for (const flag of seen) if (!COMMON_FLAGS.includes(flag)) throw new CliError("unsupported_flag", flag);
    return { command, values, json, help: true };
  }
  const spec = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  if (!spec) {
    const groupHelp = help && words.length === 1 && Object.keys(COMMANDS).some(known => known.startsWith(`${command} `));
    if (groupHelp) {
      for (const flag of seen) if (!COMMON_FLAGS.includes(flag)) throw new CliError("unsupported_flag", flag);
      return { command, values, json, help: true };
    }
    throw new CliError("unknown_command");
  }
  for (const flag of seen) if (!COMMON_FLAGS.includes(flag) && !spec.flags.includes(flag as ValueFlag)) throw new CliError("unsupported_flag", flag);
  if (!help) {
    if (spec.implemented === false) throw new CliError("command_not_implemented");
    for (const flag of spec.required ?? []) if (!values.has(flag)) throw new CliError("missing_required_flag", flag);
  }
  return { command, values, json, help };
}

const HELP = {
  commands: [
    "doctor",
    "ingest file --file PATH", "ingest otlp --file PATH",
    "eval run --file PATH", "scenario run --file PATH", "benchmark run --file PATH", "benchmark list",
    "prompt create --file definition.json",
    "prompt preview --definition-id ID --file draft.json --out reviewed.json",
    "prompt push --file reviewed.json",
    "prompt pull --definition-id ID [--version-id ID] [--out pulled.json]",
    "prompt diff --left left-pull.json --right right-pull.json",
    "prompt resolve --definition-id ID [--candidate-version-id ID] [--experiment-version-id ID] [--project-id ID] [--session-id ID]"
  ],
  globalOptions: ["--endpoint URL", "--api-key KEY", "--json", "--help", "-h"],
  environment: ["OPEN_EVALS_URL", "OPEN_EVALS_API_KEY"],
  notes: [
    "Prompt push requires a reviewed artifact and the same configured endpoint. It does not preview again or activate a release.",
    "File output does not overwrite different existing contents. Retry uses the same stored IDs and reviewed input.",
    "Prompt diff is offline. Doctor checks configuration only and makes no health request."
  ],
  notImplemented: Object.entries(COMMANDS).filter(([, spec]) => spec.implemented === false).map(([name]) => name)
};

/** The executable supplies process streams; this module neither runs a command nor changes exitCode on import. */
export async function runCli(args: readonly string[], context: CliContext): Promise<number> {
  const jsonErrors = args.includes("--json");
  let client: OpenEvalsClient | undefined;
  try {
    const parsed = parseArgs(args);
    const output = (value: unknown) => context.stdout(`${JSON.stringify(value, null, 2)}\n`);
    if (parsed.help) {
      context.stdout(parsed.json ? `${JSON.stringify(HELP, null, 2)}\n` : [
        "OpenEvals", "", ...HELP.commands.map(command => `  ${command}`), "",
        `Global options: ${HELP.globalOptions.join(", ")}`,
        `Environment: ${HELP.environment.join(", ")}`, "", ...HELP.notes,
        "", `Not implemented: ${HELP.notImplemented.join(", ")}`, ""
      ].join("\n"));
      return 0;
    }
    const flag = (name: ValueFlag) => parsed.values.get(name);
    if (parsed.command === "prompt diff") {
      const left = await readPromptDetailFile(flag("--left")!);
      const right = await readPromptDetailFile(flag("--right")!);
      output(diffPromptDetails(left, right));
      return 0;
    }

    const env = context.env ?? process.env;
    const endpoint = normalizePromptEndpoint(flag("--endpoint") ?? env.OPEN_EVALS_URL ?? "http://127.0.0.1:3216");
    const apiKey = flag("--api-key") ?? env.OPEN_EVALS_API_KEY;
    if (parsed.command === "doctor") {
      output({ status: "configuration_only", endpoint, apiKeyConfigured: Boolean(apiKey), networkChecked: false });
      return 0;
    }
    client = new OpenEvalsClient({ endpoint, apiKey });
    switch (parsed.command) {
      case "prompt create": {
        const input = await readPromptDefinitionFile(flag("--file")!);
        output(await client.createPromptDefinition(input));
        break;
      }
      case "prompt preview": {
        const definitionId = flag("--definition-id")!;
        const input = await readPromptDraftFile(flag("--file")!);
        const preview = await client.previewPromptVersion(definitionId, input);
        const review = makePromptReviewFile(endpoint, definitionId, input, preview);
        const artifactWrite = await writePromptJsonFile(flag("--out")!, review);
        output({ artifactWrite, definitionId, versionId: review.input.versionId, requestFingerprint: review.preview.requestFingerprint, previewFingerprint: review.preview.previewFingerprint });
        break;
      }
      case "prompt push": {
        const review = await readPromptReviewFile(flag("--file")!, endpoint);
        output(await client.savePromptVersion(review.definitionId, review.input, review.preview.previewFingerprint));
        break;
      }
      case "prompt pull": {
        const definitionId = flag("--definition-id")!;
        const detail = await client.getPromptDefinition(definitionId, flag("--version-id"));
        const path = flag("--out");
        if (path) output({ artifactWrite: await writePromptJsonFile(path, detail), definitionId, versionId: detail.selectedVersion?.id ?? null });
        else output(detail);
        break;
      }
      case "prompt resolve": {
        output(await client.resolvePromptJson({
          definitionId: flag("--definition-id")!,
          ...(flag("--candidate-version-id") ? { candidateVersionId: flag("--candidate-version-id")! } : {}),
          ...(flag("--experiment-version-id") ? { experimentVersionId: flag("--experiment-version-id")! } : {}),
          ...(flag("--project-id") ? { projectId: flag("--project-id")! } : {}),
          ...(flag("--session-id") ? { sessionId: flag("--session-id")! } : {})
        }));
        break;
      }
      case "ingest file":
      case "ingest otlp": {
        const payload = await readLegacyFile(flag("--file")!);
        output(await legacyJson(client.submitTraces(payload)));
        break;
      }
      case "eval run":
      case "scenario run":
      case "benchmark run": {
        const text = await readLegacyFile(flag("--file")!);
        let payload: JsonValue;
        try { payload = JSON.parse(text) as JsonValue; }
        catch { throw new CliError("input_json_invalid"); }
        output(await legacyJson(client.evaluate(payload)));
        break;
      }
      case "benchmark list": {
        output(await legacyJson(fetch(`${endpoint}/api/v1/benchmarks`, {
          headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
          redirect: "error", signal: AbortSignal.timeout(30_000)
        })));
        break;
      }
      default: throw new CliError("unknown_command");
    }
    return 0;
  } catch (error) {
    const failure = error instanceof CliError ? { error: error.code, ...(error.option ? { option: error.option } : {}), ...(error.status !== undefined ? { status: error.status } : {}) }
      : error instanceof PromptFileError ? { error: error.code }
      : error instanceof OpenEvalsHttpError ? { error: error.code, status: error.status }
      : { error: "command_failed" };
    context.stderr(jsonErrors ? `${JSON.stringify({ ok: false, ...failure }, null, 2)}\n` : `open-evals: ${failure.error}${"option" in failure ? ` (${failure.option})` : ""}${"status" in failure && failure.status ? ` [HTTP ${failure.status}]` : ""}\n`);
    return 1;
  } finally { client?.close(); }
}

async function readLegacyFile(path: string): Promise<string> {
  try { return await readFile(path, "utf8"); }
  catch { throw new CliError("file_read_failed"); }
}

async function legacyJson(operation: Promise<Response>): Promise<unknown> {
  let response: Response;
  try { response = await operation; }
  catch { throw new CliError("request_failed"); }
  if (!response.ok) throw new CliError("http_request_failed", undefined, response.status);
  try { return await response.json(); }
  catch { throw new CliError("invalid_response"); }
}

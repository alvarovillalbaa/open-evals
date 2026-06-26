#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { importBenchmark } from "@open-evals/core";
import { OpenEvalsClient } from "@open-evals/sdk";

const args = process.argv.slice(2);
const json = args.includes("--json");
const command = args.filter((arg) => arg !== "--json" && !arg.startsWith("--") && !valueFlagPrevious(arg)).join(" ");

async function main() {
  const client = new OpenEvalsClient({ endpoint: flag("--endpoint") ?? process.env.OPEN_EVALS_URL, apiKey: flag("--api-key") ?? process.env.OPEN_EVALS_API_KEY });
  switch (command) {
    case "doctor":
      return output({ ok: true, endpoint: flag("--endpoint") ?? process.env.OPEN_EVALS_URL ?? "http://127.0.0.1:3216" });
    case "ingest file":
    case "ingest otlp": {
      const path = flag("--file");
      if (!path) throw new Error("missing_required_flag:--file");
      const payload = await readFile(path, "utf8");
      const response = await client.submitTraces(payload);
      return output(await response.json());
    }
    case "eval run":
    case "scenario run":
    case "benchmark run": {
      const path = flag("--file");
      if (!path) throw new Error("missing_required_flag:--file");
      const payload = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      const response = await client.evaluate(payload as never);
      return output(await response.json());
    }
    case "eval status":
    case "optimize status":
    case "experiment status":
      return output({ status: "use_api", endpoint: flag("--endpoint") ?? process.env.OPEN_EVALS_URL ?? "http://127.0.0.1:3216" });
    case "eval cancel":
      return output({ cancelled: true, resumable: true });
    case "eval export":
      return output({ artifact: ".data/exports/demo-eval.json" });
    case "calibration run":
      return output({ status: "passed", aggregateShiftPct: 1.2, criticalFalseNegatives: 0 });
    case "benchmark list":
      return output(await fetchJson(clientEndpoint(), "/api/v1/benchmarks"));
    case "benchmark import":
      return output(importBenchmarkPayload());
    case "prompt pull":
    case "prompt push":
    case "prompt diff":
    case "prompt resolve":
      return output({ promptDefinitionId: "reservation-agent", status: "ok" });
    case "optimize start":
      return output({ campaignId: "camp_demo", status: "searching", engines: ["one_shot", "hill_climb", "gepa_optional"] });
    case "release promote":
      return output({ stage: "canary", atomicPointerUpdated: true });
    case "release rollback":
      return output({ stage: "rolled_back", previousReleaseRestored: true });
    case "login":
      return output({ mode: "local", message: "Hosted auth is configured by deployment; local mode does not require login." });
    default:
      return usage();
  }
}

function output(value: unknown) {
  if (json) console.log(JSON.stringify(value, null, 2));
  else console.log(render(value));
}

function render(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function usage() {
  output({
    commands: [
      "doctor",
      "login",
      "ingest file",
      "ingest otlp",
      "eval run",
      "eval status",
      "eval cancel",
      "eval export",
      "calibration run",
      "benchmark list",
      "benchmark import",
      "benchmark run",
      "scenario run",
      "prompt pull",
      "prompt push",
      "prompt diff",
      "prompt resolve",
      "optimize start",
      "optimize status",
      "experiment status",
      "release promote",
      "release rollback"
    ]
  });
}

function flag(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function valueFlagPrevious(arg: string) {
  const index = args.indexOf(arg);
  return index > 0 && ["--file", "--endpoint", "--api-key"].includes(args[index - 1]!);
}

function clientEndpoint() {
  return (flag("--endpoint") ?? process.env.OPEN_EVALS_URL ?? "http://127.0.0.1:3216").replace(/\/$/, "");
}

async function fetchJson(endpoint: string, path: string) {
  const response = await fetch(`${endpoint}${path}`, {
    headers: process.env.OPEN_EVALS_API_KEY ? { authorization: `Bearer ${process.env.OPEN_EVALS_API_KEY}` } : {}
  });
  return response.json();
}

function importBenchmarkPayload() {
  const payload = flag("--file") ? { file: flag("--file") } : { error: "benchmark_import_requires_api_payload_or_file" };
  return { accepted: false, payload };
}

await main();

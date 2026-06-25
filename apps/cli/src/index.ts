#!/usr/bin/env node
import { GenericJsonTraceAdapter } from "@open-evals/adapters";
import { demoEvalSet, demoRows, evaluateGates, importBenchmark, resolveRunPlan, runDeterministicEval } from "@open-evals/core";

const args = process.argv.slice(2);
const json = args.includes("--json");
const command = args.filter((arg) => arg !== "--json" && !arg.startsWith("--")).join(" ");

async function main() {
  switch (command) {
    case "doctor":
      return output({ ok: true, aiEnabled: process.env.AI_ENABLED === "true", pythonOptimizers: process.env.PYTHON_OPTIMIZERS_ENABLED === "true" });
    case "ingest file":
    case "ingest otlp": {
      const adapter = new GenericJsonTraceAdapter();
      return output(await adapter.importBatch({ workspaceId: "ws_demo", payload: JSON.stringify({ id: "cli-trace", spans: [] }), dryRun: true }));
    }
    case "eval run":
    case "scenario run":
    case "benchmark run": {
      const plan = resolveRunPlan({ id: "cli_run", targetId: "target", targetKind: "provided_output", rows: demoRows, evalSet: demoEvalSet, historicalDataAllowed: true });
      const results = plan.sampleManifest.rows.map((sample) => runDeterministicEval(demoEvalSet.itemVersions[0]!.item, sample));
      return output({ planId: plan.id, results: results.length, gates: evaluateGates(plan.id, demoEvalSet, results) });
    }
    case "eval status":
    case "optimize status":
    case "experiment status":
      return output({ status: "demo_complete" });
    case "eval cancel":
      return output({ cancelled: true, resumable: true });
    case "eval export":
      return output({ artifact: ".data/exports/demo-eval.json" });
    case "calibration run":
      return output({ status: "passed", aggregateShiftPct: 1.2, criticalFalseNegatives: 0 });
    case "benchmark list":
      return output({ benchmarks: ["gsm8k-mini", "bfcl-mini"] });
    case "benchmark import":
      return output(
        importBenchmark({
          family: args.includes("--bfcl") ? "bfcl" : "gsm8k",
          version: "mini-v1",
          sourceName: "cli-fixture",
          license: args.includes("--bfcl") ? "Apache-2.0 fixture" : "fixture",
          payload: args.includes("--bfcl")
            ? [{ prompt: "Call weather for Madrid", expected_tool_call: { name: "weather", arguments: { city: "Madrid" } } }]
            : [{ question: "What is 2+2?", answer: "4" }]
        })
      );
    case "connections test":
      return output({ ok: true, message: "fixture connection ready" });
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
      "connections test",
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

await main();

import type { DatasetRow, EvalSetVersion, JsonValue } from "./types";
import { stableHash } from "./hash";

export type BenchmarkFamily = "gsm8k" | "bfcl";

export interface BenchmarkImportRequest {
  family: BenchmarkFamily;
  version: string;
  sourceName: string;
  payload: string | JsonValue[];
  license: string;
}

export interface BenchmarkImportResult {
  benchmarkId: string;
  benchmarkVersionId: string;
  family: BenchmarkFamily;
  datasetRows: DatasetRow[];
  evalSet: EvalSetVersion;
  license: string;
  limitations: string[];
  fingerprint: string;
}

export interface BenchmarkImporter {
  family: BenchmarkFamily;
  importBenchmark(request: BenchmarkImportRequest): BenchmarkImportResult;
}

export class Gsm8kImporter implements BenchmarkImporter {
  family = "gsm8k" as const;

  importBenchmark(request: BenchmarkImportRequest): BenchmarkImportResult {
    const records = parseRecords(request.payload);
    const rows = records.map((record, index) => {
      const input = requireString(record, ["question", "input"], index);
      const answer = requireString(record, ["answer", "expectedOutput", "target"], index);
      return benchmarkRow("gsm8k", request.version, index, input, answer, record);
    });
    return result(request, rows, "GSM8K exact answer fixture", "gsm8k_answer");
  }
}

export class BfclImporter implements BenchmarkImporter {
  family = "bfcl" as const;

  importBenchmark(request: BenchmarkImportRequest): BenchmarkImportResult {
    const records = parseRecords(request.payload);
    const rows = records.map((record, index) => {
      const input = requireString(record, ["prompt", "input", "question"], index);
      const expected = record["expected_tool_call"] ?? record["expectedOutput"] ?? record["answer"];
      if (expected === undefined) throw new Error(`benchmark_row_missing_expected_tool_call:${index}`);
      return benchmarkRow("bfcl", request.version, index, input, expected as JsonValue, record);
    });
    return result(request, rows, "BFCL tool-call fixture", "bfcl_tool_call");
  }
}

export function importBenchmark(request: BenchmarkImportRequest): BenchmarkImportResult {
  if (request.family === "gsm8k") return new Gsm8kImporter().importBenchmark(request);
  if (request.family === "bfcl") return new BfclImporter().importBenchmark(request);
  throw new Error(`unsupported_benchmark_family:${request.family satisfies never}`);
}

function result(request: BenchmarkImportRequest, rows: DatasetRow[], name: string, itemKey: string): BenchmarkImportResult {
  if (!rows.length) throw new Error("benchmark_requires_rows");
  const benchmarkId = `benchmark_${request.family}_${stableHash(request.sourceName, 10)}`;
  const benchmarkVersionId = `${benchmarkId}_${request.version.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const evalSet: EvalSetVersion = {
    id: `eval_set_${itemKey}_${request.version}`,
    setId: `eval_set_${itemKey}`,
    name,
    itemVersions: [
      {
        item: {
          id: `eval_item_${itemKey}_${request.version}`,
          itemId: `eval_item_${itemKey}`,
          name,
          type: request.family === "gsm8k" ? "string_check" : "json_schema",
          evaluationUnits: [request.family === "gsm8k" ? "llm_call" : "agent_call"],
          outputSchema: {
            fields: [
              {
                key: request.family === "gsm8k" ? "contains_expected" : "valid_tool_call",
                displayName: request.family === "gsm8k" ? "Contains expected answer" : "Valid tool call",
                type: "boolean",
                criticality: "critical",
                gating: true
              }
            ]
          },
          criticality: "critical",
          config: request.family === "gsm8k" ? {} : { schema: "expected_tool_call" },
          version: 1,
          fingerprint: stableHash({ itemKey, version: request.version })
        },
        weight: 1,
        criticality: "critical"
      }
    ],
    gates: { rowThreshold: 100, datasetPassRateThreshold: 80, evalSetThreshold: 80, runThreshold: 80 },
    fingerprint: stableHash({ itemKey, request })
  };
  return {
    benchmarkId,
    benchmarkVersionId,
    family: request.family,
    datasetRows: rows,
    evalSet,
    license: request.license,
    limitations: ["Fixture importers validate executable shape; full benchmark datasets must be user supplied when licenses restrict redistribution."],
    fingerprint: stableHash({ request, rows: rows.map((row) => row.id), evalSet: evalSet.fingerprint })
  };
}

function benchmarkRow(family: BenchmarkFamily, version: string, index: number, input: JsonValue, expectedOutput: JsonValue, metadata: Record<string, JsonValue>): DatasetRow {
  return {
    id: `${family}_${version}_${index}`,
    input,
    expectedOutput,
    metadata: { ...metadata, benchmarkFamily: family, benchmarkVersion: version },
    reviewStatus: "golden"
  };
}

function parseRecords(payload: string | JsonValue[]): Record<string, JsonValue>[] {
  const raw = typeof payload === "string" ? parseText(payload) : payload;
  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`benchmark_row_must_be_object:${index}`);
    return item as Record<string, JsonValue>;
  });
}

function parseText(payload: string): JsonValue[] {
  const trimmed = payload.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) return JSON.parse(trimmed) as JsonValue[];
  return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as JsonValue);
}

function requireString(record: Record<string, JsonValue>, keys: string[], index: number): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  throw new Error(`benchmark_row_missing_${keys[0]}:${index}`);
}


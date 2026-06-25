import { importBenchmark, type BenchmarkFamily, type JsonValue } from "@open-evals/core";
import { authErrorResponse, requireRouteAuth } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    await requireRouteAuth("editor", "evals:write");
    const body = (await request.json()) as {
      family?: BenchmarkFamily;
      version?: string;
      sourceName?: string;
      license?: string;
      payload?: string | JsonValue[];
    };
    if (!body.family || !body.payload) return Response.json({ error: "family_and_payload_required" }, { status: 400 });
    const result = importBenchmark({
      family: body.family,
      version: body.version ?? "user-supplied",
      sourceName: body.sourceName ?? "api-import",
      license: body.license ?? "user-supplied",
      payload: body.payload
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}


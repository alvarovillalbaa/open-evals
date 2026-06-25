import { authErrorResponse, requireRouteAuth } from "@/lib/auth";

export async function GET() {
  try {
    await requireRouteAuth("viewer", "evals:read");
    return Response.json({
      benchmarks: [
        { id: "gsm8k", name: "GSM8K", importer: "jsonl", fullDatasetVendored: false },
        { id: "bfcl", name: "Berkeley Function Calling Leaderboard", importer: "jsonl", fullDatasetVendored: false }
      ]
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}


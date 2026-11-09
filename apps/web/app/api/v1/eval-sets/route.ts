import { listCustomEvalSets } from "@open-evals/db";
import { customEvalErrorResponse, customEvalJson, readCustomEvalJson, requireCustomEvalAuth, saveCustomEval } from "@/lib/custom-evals";

export async function GET() {
  try {
    const auth = await requireCustomEvalAuth("read");
    return customEvalJson({ sets: await listCustomEvalSets(auth.workspaceId) });
  } catch (error) {
    return customEvalErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireCustomEvalAuth("write");
    const result = await saveCustomEval(auth, await readCustomEvalJson(request));
    return customEvalJson(result, result.replayed ? 200 : 201);
  } catch (error) {
    return customEvalErrorResponse(error);
  }
}

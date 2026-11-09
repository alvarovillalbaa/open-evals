import {
  listProvidedOutputHistory,
  providedOutputErrorResponse,
  providedOutputJson,
  readProvidedOutputJson,
  saveProvidedOutputRun
} from "@/lib/provided-output-runs";
import { requireCustomEvalAuth } from "@/lib/custom-evals";

export async function GET() {
  try {
    const auth = await requireCustomEvalAuth("read");
    return providedOutputJson({ history: await listProvidedOutputHistory(auth.workspaceId) });
  } catch (error) {
    return providedOutputErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireCustomEvalAuth("write");
    const result = await saveProvidedOutputRun(auth, await readProvidedOutputJson(request));
    return providedOutputJson(result, result.replayed ? 200 : 201);
  } catch (error) {
    return providedOutputErrorResponse(error);
  }
}

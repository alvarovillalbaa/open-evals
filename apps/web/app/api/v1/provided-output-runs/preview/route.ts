import { requireCustomEvalAuth } from "@/lib/custom-evals";
import {
  previewProvidedOutputRun,
  providedOutputErrorResponse,
  providedOutputJson,
  readProvidedOutputJson
} from "@/lib/provided-output-runs";

export async function POST(request: Request) {
  try {
    const auth = await requireCustomEvalAuth("read");
    const plan = await previewProvidedOutputRun(auth.workspaceId, await readProvidedOutputJson(request));
    return providedOutputJson({ plan });
  } catch (error) {
    return providedOutputErrorResponse(error);
  }
}

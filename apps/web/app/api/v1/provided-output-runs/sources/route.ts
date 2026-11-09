import { requireCustomEvalAuth } from "@/lib/custom-evals";
import { providedOutputErrorResponse, providedOutputJson, readProvidedOutputSources } from "@/lib/provided-output-runs";

export async function GET(request: Request) {
  try {
    const auth = await requireCustomEvalAuth("read");
    return providedOutputJson(await readProvidedOutputSources(auth, new URL(request.url).searchParams));
  } catch (error) {
    return providedOutputErrorResponse(error);
  }
}

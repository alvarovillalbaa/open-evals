import { requireCustomEvalAuth } from "@/lib/custom-evals";
import { customDatasetErrorResponse, customDatasetJson, previewCustomDataset, readCustomDatasetJson } from "@/lib/custom-datasets";

export async function POST(request: Request) {
  try {
    const auth = await requireCustomEvalAuth("read");
    return customDatasetJson({ preview: await previewCustomDataset(auth.workspaceId, await readCustomDatasetJson(request)) });
  } catch (error) {
    return customDatasetErrorResponse(error);
  }
}

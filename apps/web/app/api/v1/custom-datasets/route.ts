import { requireCustomEvalAuth } from "@/lib/custom-evals";
import { customDatasetErrorResponse, customDatasetJson, readCustomDatasetJson, readCustomDatasetList, saveCustomDataset } from "@/lib/custom-datasets";

export async function GET() {
  try {
    const auth = await requireCustomEvalAuth("read");
    return customDatasetJson(await readCustomDatasetList(auth));
  } catch (error) {
    return customDatasetErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireCustomEvalAuth("write");
    const result = await saveCustomDataset(auth, await readCustomDatasetJson(request));
    return customDatasetJson(result, result.replayed ? 200 : 201);
  } catch (error) {
    return customDatasetErrorResponse(error);
  }
}

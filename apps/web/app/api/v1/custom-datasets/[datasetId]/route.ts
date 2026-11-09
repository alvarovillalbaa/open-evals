import { requireCustomEvalAuth } from "@/lib/custom-evals";
import { customDatasetCanWrite, customDatasetErrorResponse, customDatasetJson, readCustomDatasetDetail } from "@/lib/custom-datasets";

export async function GET(_request: Request, { params }: { params: Promise<{ datasetId: string }> }) {
  try {
    const auth = await requireCustomEvalAuth("read");
    const { datasetId } = await params;
    const detail = await readCustomDatasetDetail(auth.workspaceId, datasetId);
    return detail ? customDatasetJson({ ...detail, canWrite: customDatasetCanWrite(auth) }) : customDatasetJson({ error: "custom_dataset_not_found" }, 404);
  } catch (error) {
    return customDatasetErrorResponse(error);
  }
}

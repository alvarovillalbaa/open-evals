import { requireCustomEvalAuth } from "@/lib/custom-evals";
import { customDatasetErrorResponse, customDatasetJson, readCustomDatasetVersion } from "@/lib/custom-datasets";

export async function GET(_request: Request, { params }: { params: Promise<{ datasetId: string; versionId: string }> }) {
  try {
    const auth = await requireCustomEvalAuth("read");
    const { datasetId, versionId } = await params;
    const record = await readCustomDatasetVersion(auth.workspaceId, datasetId, versionId);
    return record ? customDatasetJson({ record }) : customDatasetJson({ error: "custom_dataset_version_not_found" }, 404);
  } catch (error) {
    return customDatasetErrorResponse(error);
  }
}

import { requireInstructionAuth } from "@/lib/instruction-authoring";
import { InstructionRequestError, instructionErrorResponse, instructionJson } from "@/lib/instruction-request";
import { getInstructionDetail } from "@/lib/instruction-service";

export async function GET(request: Request, { params }: { params: Promise<{ definitionId: string }> }) {
  try {
    const { scope, canWrite } = await requireInstructionAuth("read");
    const { definitionId } = await params;
    const versions = new URL(request.url).searchParams.getAll("versionId");
    if (versions.length > 1) throw new InstructionRequestError(400, "prompt_version_selection_ambiguous");
    return instructionJson(await getInstructionDetail(scope, definitionId, versions[0], canWrite));
  } catch (error) {
    return instructionErrorResponse(error);
  }
}

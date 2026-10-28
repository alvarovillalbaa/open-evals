import { requireInstructionAuth } from "@/lib/instruction-authoring";
import { instructionErrorResponse, instructionJson, readInstructionJson } from "@/lib/instruction-request";
import { previewInstructionVersion } from "@/lib/instruction-service";

export async function POST(request: Request, { params }: { params: Promise<{ definitionId: string }> }) {
  try {
    const { scope } = await requireInstructionAuth("write");
    const { definitionId } = await params;
    return instructionJson(await previewInstructionVersion(scope, definitionId, await readInstructionJson(request)));
  } catch (error) {
    return instructionErrorResponse(error);
  }
}

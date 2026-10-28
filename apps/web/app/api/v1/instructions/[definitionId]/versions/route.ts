import { requireInstructionAuth } from "@/lib/instruction-authoring";
import { instructionErrorResponse, instructionJson, readInstructionJson } from "@/lib/instruction-request";
import { saveInstructionVersion } from "@/lib/instruction-service";

export async function POST(request: Request, { params }: { params: Promise<{ definitionId: string }> }) {
  try {
    const { scope } = await requireInstructionAuth("write");
    const { definitionId } = await params;
    const result = await saveInstructionVersion(scope, definitionId, await readInstructionJson(request));
    return instructionJson(result, result.replayed ? 200 : 201);
  } catch (error) {
    return instructionErrorResponse(error);
  }
}

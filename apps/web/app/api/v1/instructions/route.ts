import { listInstructions } from "@open-evals/db";
import { createInstructionDefinition, requireInstructionAuth } from "@/lib/instruction-authoring";
import { instructionErrorResponse, instructionJson, readInstructionJson } from "@/lib/instruction-request";

export async function GET() {
  try {
    const { scope } = await requireInstructionAuth("read");
    return instructionJson(await listInstructions(scope.workspaceId, scope.projectId));
  } catch (error) {
    return instructionErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { scope } = await requireInstructionAuth("write");
    const result = await createInstructionDefinition(scope, await readInstructionJson(request));
    return instructionJson(result, result.replayed ? 200 : 201);
  } catch (error) {
    return instructionErrorResponse(error);
  }
}

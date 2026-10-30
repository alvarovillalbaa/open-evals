import { requireInstructionAuth } from "@/lib/instruction-authoring";
import { InstructionRequestError, instructionErrorResponse, instructionJson, readInstructionJson } from "@/lib/instruction-request";
import { loadCampaignRequests, saveCampaignRequest } from "@/lib/campaign-request-service";

export async function GET(request: Request, { params }: { params: Promise<{ definitionId: string }> }) {
  try {
    const { scope } = await requireInstructionAuth("read");
    const { definitionId } = await params;
    const query = new URL(request.url).searchParams;
    const keys = [...query.keys()];
    if (new Set(keys).size !== keys.length || keys.some(key => !["baselineVersionId", "requestId"].includes(key))
      || !query.get("baselineVersionId")) throw new InstructionRequestError(400, "campaign_request_query_invalid");
    return instructionJson(await loadCampaignRequests(scope, definitionId, query.get("baselineVersionId")!, query.get("requestId") ?? undefined));
  } catch (error) { return instructionErrorResponse(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ definitionId: string }> }) {
  try {
    const { scope } = await requireInstructionAuth("write");
    const { definitionId } = await params;
    const saved = await saveCampaignRequest(scope, definitionId, await readInstructionJson(request));
    return instructionJson(saved, saved.replayed ? 200 : 201);
  } catch (error) { return instructionErrorResponse(error); }
}

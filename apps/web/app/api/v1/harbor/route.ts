import { checkHarborOrigin, harborErrorResponse, harborResponse, readHarbor, requireHarborAuth, writeHarbor } from "@/lib/harbor-evals";
import { readInstructionJson } from "@/lib/instruction-request";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try { const auth=await requireHarborAuth("read"); return harborResponse(await readHarbor(auth,new URL(request.url).searchParams)); }
  catch(error) { return harborErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const auth=await requireHarborAuth("write");
    checkHarborOrigin(request);
    return harborResponse(await writeHarbor(auth,await readInstructionJson(request)));
  } catch(error) { return harborErrorResponse(error); }
}

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

export class InstructionRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "InstructionRequestError";
  }
}

/** Call only after authentication; Content-Length alone does not bound a stream. */
export async function readInstructionJson(request: Request): Promise<unknown> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") throw new InstructionRequestError(400, "json_content_type_required");
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_REQUEST_BYTES) {
    throw new InstructionRequestError(413, "instruction_request_too_large");
  }
  if (!request.body) throw new InstructionRequestError(400, "json_body_required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new InstructionRequestError(413, "instruction_request_too_large");
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof InstructionRequestError) throw error;
    throw new InstructionRequestError(400, "invalid_json_body");
  } finally {
    reader.releaseLock();
  }
}

export function instructionErrorResponse(error: unknown): Response {
  const candidate = error instanceof Error && "status" in error ? Number(error.status) : 500;
  const status = Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500;
  const message = status < 500 && error instanceof Error && /^[a-z0-9_:.-]{1,160}$/.test(error.message)
    ? error.message
    : status === 503 ? "database_unavailable" : "instruction_request_failed";
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export function instructionJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

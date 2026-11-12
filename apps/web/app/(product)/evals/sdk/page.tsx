import { Code2, FileCode2, KeyRound, ListChecks } from "lucide-react";
import { LinkButton, Notice, PageHeader, Panel } from "../../components";

const typescriptExample = `import { OpenEvalsClient } from "@open-evals/sdk";

type TracePayload = Parameters<OpenEvalsClient["submitTrace"]>[0];

export async function submitExecutionEvidence(payload: TracePayload) {
  const endpoint = process.env.OPEN_EVALS_URL;
  const apiKey = process.env.OPEN_EVALS_API_KEY;
  if (!endpoint || !apiKey) {
    throw new Error("Configure your service URL and project API key.");
  }
  const client = new OpenEvalsClient({ endpoint, apiKey });
  try {
    const response = await client.submitTrace(payload);
    if (!response.ok) {
      throw new Error(\`Evidence delivery failed (HTTP \${response.status}).\`);
    }
    return response;
  } finally {
    client.close();
  }
}`;

const pythonExample = `import os
from typing import Any
from open_evals_sdk import OpenEvalsPythonClient

def submit_execution_evidence(payload: dict[str, Any]) -> int:
    client = OpenEvalsPythonClient(
        endpoint=os.environ["OPEN_EVALS_URL"],
        api_key=os.environ["OPEN_EVALS_API_KEY"],
    )
    return client.submit_trace(payload)`;

export default function SdkEvidencePage() {
  return (
    <div className="grid min-w-0 gap-5">
      <PageHeader title="SDK connection" eyebrow="Evals" actions={<LinkButton href="/runs">View runs</LinkButton>} />
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
        Send evidence from your application&apos;s actual executions to use in evaluations and prompt improvement.
        Use the TypeScript or Python SDK source provided in this repository; these examples do not install a package or send data from this page.
      </p>
      <Panel title="Configure your application" icon={<KeyRound className="size-4" aria-hidden="true" />}>
        <p className="text-sm leading-6">
          Set OPEN_EVALS_URL to your configured service root without a trailing slash and keep OPEN_EVALS_API_KEY on your server.
          Hosted trace writes require editor access and either the traces:write or admin scope.
          The server resolves workspace and project access from authentication; payload fields do not grant access.
        </p>
      </Panel>
      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        <Panel title="TypeScript" icon={<Code2 className="size-4" aria-hidden="true" />}>
          <p className="mb-3 text-sm leading-6 text-muted-foreground">Call this function with the trace payload captured by your application.</p>
          <pre className="max-w-full overflow-x-auto bg-muted p-3 text-xs leading-5"><code>{typescriptExample}</code></pre>
        </Panel>
        <Panel title="Python" icon={<FileCode2 className="size-4" aria-hidden="true" />}>
          <p className="mb-3 text-sm leading-6 text-muted-foreground">
            Install the Python client from this repository with python3 -m pip install ./python/open_evals_sdk. Pass the actual execution payload.
          </p>
          <pre className="max-w-full overflow-x-auto bg-muted p-3 text-xs leading-5"><code>{pythonExample}</code></pre>
        </Panel>
      </div>
      <Panel title="Choose the evidence you send" icon={<ListChecks className="size-4" aria-hidden="true" />}>
        <ul className="grid gap-2 pl-5 text-sm leading-6 [&>li]:list-disc">
          <li>Use traceId or id for your execution identity, with startedAt, optional endedAt and status. Supply timestamps from the execution.</li>
          <li>Include the input and output needed for the evaluation, plus relevant metadata and tags.</li>
          <li>Bind prompt evidence with promptDefinitionId, promptVersionId and promptHash when available. Target identity and sessionId can preserve execution context.</li>
          <li>Supply spans only when needed. Their id or spanId, name, parentSpanId, startTime, endTime, input, output and attributes describe the captured steps.</li>
        </ul>
      </Panel>
      <Notice>
        Review and minimize evidence before sending it. The SDK sends the supplied payload; server-side redaction does not protect its journey to the service.
        Do not send credentials or hidden model chain-of-thought. Historical evaluation still requires its resolved data policy.
      </Notice>
      <p className="text-sm leading-6 text-muted-foreground">
        TypeScript submitTrace returns a Response: check response.ok before recording success. Python submit_trace returns the HTTP status and propagates HTTP or connection errors.
        For explicit TypeScript buffering, call flush and await it before close; close only stops the timer. Automatic timers do not establish durable delivery.
      </p>
    </div>
  );
}

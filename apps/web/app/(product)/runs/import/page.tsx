import { Code2, FileJson2, PlugZap, TerminalSquare } from "lucide-react";
import { PageHeader, Panel, Notice } from "../../components";
import { ImportForm } from "./import-form";

export default function ImportTracesPage() {
  return (
    <div className="grid gap-5">
      <PageHeader title="Import traces" eyebrow="Runs" />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Panel title="Manual import" icon={<FileJson2 className="size-4" aria-hidden="true" />}>
          <ImportForm />
        </Panel>
        <div className="grid gap-3">
          <Panel title="CLI" icon={<TerminalSquare className="size-4" aria-hidden="true" />}>
            <pre className="overflow-auto bg-muted p-3 text-xs">open-evals ingest file --file traces.jsonl --endpoint http://127.0.0.1:3216</pre>
          </Panel>
          <Panel title="MCP" icon={<PlugZap className="size-4" aria-hidden="true" />}>
            <pre className="overflow-auto bg-muted p-3 text-xs">OPEN_EVALS_URL=http://127.0.0.1:3216 open-evals-mcp</pre>
          </Panel>
          <Panel title="SDK" icon={<Code2 className="size-4" aria-hidden="true" />}>
            <pre className="overflow-auto bg-muted p-3 text-xs">{`import { OpenEvalsClient } from "@open-evals/sdk";\nawait new OpenEvalsClient().submitTrace(trace);`}</pre>
          </Panel>
          <Notice>Imported traces are stored as evaluation evidence and prompt-improvement evidence, not as a standalone observability product area.</Notice>
        </div>
      </div>
    </div>
  );
}

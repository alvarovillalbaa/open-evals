"use client";

import { useState, type FormEvent } from "react";
import { FileUp, Loader2 } from "lucide-react";

export function ImportForm() {
  const [result, setResult] = useState<string>("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setResult("");
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    const pasted = String(form.get("payload") ?? "");
    const payload = file instanceof File && file.size ? await file.text() : pasted;
    const response = await fetch("/api/v1/traces/batch", {
      method: "POST",
      headers: { "content-type": "application/jsonl" },
      body: payload
    });
    const body = await response.json().catch(() => ({}));
    setPending(false);
    setResult(JSON.stringify(body, null, 2));
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <label className="grid gap-1 text-sm">
        <span className="font-medium">Trace file</span>
        <input className="h-10 rounded-md border border-border bg-panel px-3 py-2 text-sm" name="file" type="file" accept=".json,.jsonl,application/json" />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">Trace payload</span>
        <textarea className="min-h-44 rounded-md border border-border bg-panel p-3 font-mono text-xs" name="payload" placeholder='{"id":"trace_1","spans":[]}' />
      </label>
      <button className="inline-flex h-10 w-fit items-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background" type="submit" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FileUp className="size-4" aria-hidden="true" />}
        Import
      </button>
      {result ? <pre className="max-h-72 overflow-auto border border-border bg-muted p-3 text-xs">{result}</pre> : null}
    </form>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { authoringError, authoringRequest, newAuthoringId } from "./instruction-authoring-client";

type Creation = { id: string; stableKey: string; targetId?: string };

export function CreateInstruction() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState<Creation | null>(null);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const firstInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); request.current = null; };
  }, []);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (open) firstInput.current?.focus(); }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const form = new FormData(event.currentTarget);
    let creation = attempt;
    let controller: AbortController | undefined;
    try {
      creation ??= {
        id: newAuthoringId("definition"),
        stableKey: String(form.get("stableKey") ?? "").trim(),
        ...(String(form.get("targetId") ?? "").trim() ? { targetId: String(form.get("targetId")).trim() } : {})
      };
      setAttempt(creation);
      setError("");
      setPending(true);
      controller = new AbortController();
      request.current = controller;
      const result = await authoringRequest<{ definition: Creation; replayed: boolean }>("/api/v1/instructions", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(creation)
      }, controller.signal);
      if (!mounted.current || request.current !== controller) return;
      if (result.definition?.id !== creation.id) throw new Error("The creation response did not match this definition. Retry the same attempt.");
      router.push(`/instructions/${encodeURIComponent(creation.id)}`);
    } catch (failure) {
      if (!mounted.current || (controller && request.current !== controller)) return;
      setError(authoringError(failure));
    } finally {
      if (mounted.current && (!controller || request.current === controller)) { request.current = null; setPending(false); }
    }
  }

  if (!open) return <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background" onClick={() => setOpen(true)}><Plus className="size-4" aria-hidden="true" />New definition</button>;

  return (
    <form onSubmit={submit} className="grid gap-3 border border-border bg-panel p-4">
      <h2 className="font-semibold">New instruction definition</h2>
      <p className="text-sm text-muted-foreground">Create its stable identity first, then compose the first immutable draft.</p>
      <div ref={errorRef} tabIndex={-1} role={error ? "alert" : undefined} className={error ? "rounded-md border border-danger p-3 text-sm text-danger" : "sr-only"}>{error}</div>
      <fieldset disabled={pending || Boolean(attempt)} className="grid min-w-0 gap-3 sm:grid-cols-2 disabled:opacity-70">
        <label className="grid gap-1 text-sm"><span>Stable key</span><input style={{ fontSize: "1rem" }} ref={firstInput} name="stableKey" required maxLength={128} className="min-h-10 min-w-0 rounded-md border border-border bg-panel px-3 text-base" placeholder="reservation-agent" /></label>
        <label className="grid gap-1 text-sm"><span>Target ID <span className="text-muted-foreground">(optional)</span></span><input style={{ fontSize: "1rem" }} name="targetId" maxLength={128} className="min-h-10 min-w-0 rounded-md border border-border bg-panel px-3 text-base" aria-describedby="target-help" /></label>
      </fieldset>
      <p id="target-help" className="text-xs text-muted-foreground">Use an existing target in your workspace. The server verifies access.</p>
      {attempt ? <p className="break-all font-mono text-xs text-muted-foreground">Attempt: {attempt.id}. Retry keeps this identity if a response was lost.</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background disabled:opacity-50">{pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}{pending ? "Creating…" : attempt ? "Retry creation" : "Create definition"}</button>
        {attempt ? <Link className="text-sm underline" href={`/instructions/${encodeURIComponent(attempt.id)}`}>Open this definition</Link> : null}
        <button type="button" disabled={pending} className="min-h-10 text-sm underline disabled:opacity-50" onClick={() => { setAttempt(null); setError(""); if (!attempt) setOpen(false); }}>{attempt ? "Edit details as a new attempt" : "Cancel"}</button>
      </div>
      <p className="sr-only" role="status">{pending ? "Creating the definition" : ""}</p>
    </form>
  );
}

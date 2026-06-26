"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const supabase = getSupabaseBrowserClient();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    if (!supabase) {
      setPending(false);
      setMessage("Supabase is not configured for this deployment.");
      return;
    }
    const response =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
    setPending(false);
    if (response.error) {
      setMessage(response.error.message);
      return;
    }
    if (mode === "signup") {
      setMessage("Check your email to confirm the account.");
      return;
    }
    window.location.assign("/runs");
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <label className="grid gap-1 text-sm">
        <span className="font-medium">Email</span>
        <input className="h-10 rounded-md border border-border bg-panel px-3 text-sm" name="email" type="email" required autoComplete="email" />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">Password</span>
        <input className="h-10 rounded-md border border-border bg-panel px-3 text-sm" name="password" type="password" required autoComplete={mode === "login" ? "current-password" : "new-password"} />
      </label>
      <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background" disabled={pending} type="submit">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />}
        {mode === "login" ? "Sign in" : "Create account"}
      </button>
      {message ? <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">{message}</p> : null}
      <p className="text-sm text-muted-foreground">
        {mode === "login" ? (
          <>
            New workspace?{" "}
            <Link className="font-medium text-foreground" href="/signup">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already registered?{" "}
            <Link className="font-medium text-foreground" href="/login">
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

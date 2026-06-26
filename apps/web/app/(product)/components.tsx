import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, Database, FilePlus2, Inbox, LogIn } from "lucide-react";
import type { LoadState } from "@/lib/loaders";

export function PageHeader({ title, eyebrow, actions }: { title: string; eyebrow?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-5">
      <div>
        {eyebrow ? <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">{eyebrow}</p> : null}
        <h1 className="text-2xl font-semibold tracking-normal">{title}</h1>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function LinkButton({ href, children, primary = false }: { href: string; children: ReactNode; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background"
          : "inline-flex h-9 items-center gap-2 rounded-md border border-border bg-panel px-3 text-sm font-medium text-foreground hover:bg-muted"
      }
    >
      {children}
    </Link>
  );
}

export function StateGate<T>({ state, children }: { state: LoadState<T>; children: (state: Extract<LoadState<T>, { status: "ready" }>) => ReactNode }) {
  if (state.status === "ready") return children(state);
  if (state.status === "auth_required") {
    return (
      <EmptyState
        icon={<LogIn className="size-5" aria-hidden="true" />}
        title="Sign in required"
        body="Hosted mode requires an authenticated workspace session."
        action={
          <LinkButton href="/login" primary>
            <ArrowRight className="size-4" aria-hidden="true" />
            Sign in
          </LinkButton>
        }
      />
    );
  }
  return (
    <EmptyState
      icon={<Database className="size-5" aria-hidden="true" />}
      title="Database unavailable"
      body={state.message === "database_url_not_configured" ? "Set DATABASE_URL or POSTGRES_URL, then run migrations." : "The persisted workspace database could not be reached."}
    />
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <section className="grid min-h-72 place-items-center border border-dashed border-border bg-panel p-8 text-center">
      <div className="max-w-md">
        <div className="mx-auto mb-3 grid size-10 place-items-center rounded-md border border-border bg-muted text-muted-foreground">{icon ?? <Inbox className="size-5" aria-hidden="true" />}</div>
        <h2 className="text-base font-semibold">{title}</h2>
        {body ? <p className="mt-2 text-sm text-muted-foreground">{body}</p> : null}
        {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
      </div>
    </section>
  );
}

export function Stat({ label, value, tone = "neutral" }: { label: string; value: ReactNode; tone?: "neutral" | "good" | "bad" }) {
  const toneClass = tone === "good" ? "text-emerald-700 dark:text-emerald-300" : tone === "bad" ? "text-danger" : "";
  return (
    <div className="border border-border bg-panel p-3">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p className={`mt-2 text-xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

export function Panel({ title, icon, children, action }: { title: string; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border border-border bg-panel">
      <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </div>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto border border-border bg-panel">
      <table className="w-full min-w-[760px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 border border-border bg-muted p-3 text-sm text-muted-foreground">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function ImportAction() {
  return (
    <LinkButton href="/runs/import" primary>
      <FilePlus2 className="size-4" aria-hidden="true" />
      Import traces
    </LinkButton>
  );
}

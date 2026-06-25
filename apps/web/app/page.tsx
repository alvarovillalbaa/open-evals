import {
  Activity,
  Archive,
  ArrowRightLeft,
  Bot,
  Braces,
  CheckCircle2,
  ChevronRight,
  FlaskConical,
  GitCompareArrows,
  KeyRound,
  ListChecks,
  Moon,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  SplitSquareHorizontal,
  Table2,
  Upload
} from "lucide-react";
import type { ReactNode } from "react";
import {
  assignExperimentArm,
  baselinePrompt,
  candidatePrompt,
  chooseWinner,
  demoEvalSet,
  demoRows,
  evaluateGates,
  pairedBootstrapCi,
  resolvePromptRelease,
  resolveRunPlan,
  runDeterministicEval
} from "@open-evals/core";

const plan = resolveRunPlan({
  id: "run_demo_historical",
  targetId: "target_demo_reservation_agent",
  targetKind: "provided_output",
  rows: demoRows,
  evalSet: demoEvalSet,
  historicalDataAllowed: true,
  promptVersionId: baselinePrompt.id
});
const judge = demoEvalSet.itemVersions[0]!.item;
const results = plan.sampleManifest.rows.map((sample) => runDeterministicEval(judge, sample));
const gates = evaluateGates(plan.id, demoEvalSet, results);
const runGate = gates.find((gate) => gate.level === "run")!;
const dynamicColumns = judge.outputSchema.fields.map((field) => field.key);
const comparison = pairedBootstrapCi([
  { rowId: demoRows[0]!.id, incumbent: 81, candidate: 89 },
  { rowId: demoRows[1]!.id, incumbent: 54, candidate: 72 }
]);
const winner = chooseWinner({
  candidates: [{ id: candidatePrompt.id, qualityDelta: comparison.meanDelta, safetyDelta: 3, costDelta: -0.04, latencyDelta: -11 }],
  minimumQualityDelta: 2
});
const release = resolvePromptRelease({
  definitionId: "reservation-agent",
  releases: [],
  baselineVersionId: baselinePrompt.id,
  explicitCandidateVersionId: candidatePrompt.id,
  scopes: { project: "proj_demo" }
});
const arm = assignExperimentArm("exp_demo_reservation", "session_demo_001", [
  { id: "control", promptVersionId: baselinePrompt.id, weight: 5000 },
  { id: "candidate", promptVersionId: candidatePrompt.id, weight: 5000 }
]);
const hostedCapabilities = [
  ["Auth", (process.env.AUTH_MODE ?? "local") === "hosted" ? "hosted enabled" : "local mode"],
  ["Workflows", process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL_TOKEN ? "Vercel auth configured" : "local adapter"],
  ["Queues", process.env.QUEUES_ENABLED === "true" ? "enabled" : "disabled"],
  ["Blob", process.env.BLOB_READ_WRITE_TOKEN ? "private Blob configured" : "local artifacts"],
  ["Eve", process.env.EVE_ENABLED === "true" ? "enabled with approvals" : "disabled"],
  ["Sandbox", process.env.SANDBOX_DRIVER === "vercel" ? "Vercel Sandbox" : "fixture runner"],
  ["GEPA/DSPy/SMAC", process.env.PYTHON_OPTIMIZERS_ENABLED === "true" ? "python extras checked" : "optional"]
] as const;

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid size-8 place-items-center rounded-md border border-border bg-panel">
              <ListChecks className="size-4 text-accent" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">open-evals</p>
              <p className="text-xs text-muted-foreground">Evals and prompt self-improvement</p>
            </div>
          </div>
          <nav aria-label="Product" className="flex items-center gap-1 rounded-md border border-border bg-panel p-1">
            <a className="rounded px-3 py-1.5 text-sm font-medium text-accent" href="#evals">
              Evals
            </a>
            <a className="rounded px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground" href="#improve">
              Improve
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <button className="grid size-8 place-items-center rounded-md border border-border" aria-label="Open command palette" title="Command palette">
              <Search className="size-4" aria-hidden="true" />
            </button>
            <button className="grid size-8 place-items-center rounded-md border border-border" aria-label="Toggle dark mode" title="Dark mode">
              <Moon className="size-4" aria-hidden="true" />
            </button>
            <a className="grid size-8 place-items-center rounded-md border border-border" aria-label="Settings" title="Settings" href="#settings">
              <KeyRound className="size-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[176px_1fr]">
        <aside className="hidden border-r border-border pr-3 lg:block">
          <Subnav title="Evals" items={["Runs", "Eval Sets", "Datasets", "Benchmarks", "Scenarios", "Targets", "Connections"]} />
          <Subnav title="Improve" items={["Prompts", "Campaigns", "Candidates", "Experiments", "Releases"]} />
        </aside>

        <div className="grid gap-4">
          <section id="evals" className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
              <div>
                <h1 className="text-xl font-semibold tracking-normal">Runs</h1>
                <p className="text-sm text-muted-foreground">Result matrix for a frozen demo run. Trace evidence is scoped to evaluation rows.</p>
              </div>
              <div className="flex gap-2">
                <ActionButton icon={<Upload className="size-4" />} label="Import traces" />
                <ActionButton icon={<Play className="size-4" />} label="Run eval" primary />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <Metric label="Run gate" value={runGate.decision} tone={runGate.passed ? "good" : "bad"} />
              <Metric label="Rows" value={String(plan.sampleManifest.rows.length)} />
              <Metric label="Dynamic fields" value={String(dynamicColumns.length)} />
              <Metric label="Plan hash" value={plan.planFingerprint.slice(0, 10)} mono />
            </div>

            <section className="rounded-md border border-border bg-panel">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Table2 className="size-4 text-accent" aria-hidden="true" />
                  Result matrix
                </div>
                <span className="text-xs text-muted-foreground">Frozen identity columns plus Eval Item output fields</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted text-left text-xs uppercase text-muted-foreground">
                      <th className="sticky left-0 bg-muted px-3 py-2 font-medium">row id</th>
                      <th className="px-3 py-2 font-medium">source</th>
                      {dynamicColumns.map((column) => (
                        <th className="px-3 py-2 font-medium" key={column}>
                          {column.replaceAll("_", " ")}
                        </th>
                      ))}
                      <th className="px-3 py-2 font-medium">gate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((result) => (
                      <tr className="border-b border-border last:border-b-0" key={result.rowId}>
                        <td className="sticky left-0 max-w-48 bg-panel px-3 py-2 font-mono text-xs">{result.rowId.slice(0, 22)}</td>
                        <td className="px-3 py-2 text-muted-foreground">demo dataset</td>
                        {dynamicColumns.map((column) => {
                          const field = result.fields.find((item) => item.key === column);
                          return (
                            <td className="px-3 py-2" key={column}>
                              <span className={field?.decision === "hard_fail" ? "text-danger" : ""}>{String(field?.value ?? "")}</span>
                            </td>
                          );
                        })}
                        <td className="px-3 py-2">
                          <span className="rounded bg-muted px-2 py-1 text-xs">{result.fields.some((field) => field.decision === "hard_fail") ? "hard_fail" : "pass"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <EvidencePanel />
              <RunWizardPanel />
            </div>
          </section>

          <section id="improve" className="grid gap-4 border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold tracking-normal">Improve</h2>
                <p className="text-sm text-muted-foreground">Prompt campaign state, attribution, ablations, variant comparison, and release controls.</p>
              </div>
              <div className="flex gap-2">
                <ActionButton icon={<GitCompareArrows className="size-4" />} label="Variant matrix" />
                <ActionButton icon={<Sparkles className="size-4" />} label="Start campaign" primary />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-5">
              <Metric label="Candidate delta" value={`+${comparison.meanDelta.toFixed(1)}`} tone="good" />
              <Metric label="95% CI" value={`${comparison.low.toFixed(1)} to ${comparison.high.toFixed(1)}`} />
              <Metric label="Winner" value={winner.winnerId ? "qualified" : "none"} />
              <Metric label="Release" value={release.versionId.replace("prompt-v2-", "")} />
              <Metric label="Sticky arm" value={arm.id} />
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
              <PromptDiffPanel />
              <CampaignAnswersPanel />
            </div>
          </section>

          <section id="settings" className="rounded-md border border-border bg-panel p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold">Settings and developer utilities</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Connections, API keys, members, billing placeholders, and operational telemetry live here instead of becoming product navigation.
                </p>
              </div>
              <ShieldCheck className="size-5 text-accent" aria-hidden="true" />
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-3 lg:grid-cols-7">
              {hostedCapabilities.map(([label, status]) => (
                <div className="rounded-md border border-border bg-muted p-2" key={label}>
                  <p className="text-xs font-medium text-muted-foreground">{label}</p>
                  <p className="mt-1 truncate text-xs">{status}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Subnav({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">{title}</p>
      <div className="grid gap-1">
        {items.map((item) => (
          <a className="rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" href={`#${item.toLowerCase().replaceAll(" ", "-")}`} key={item}>
            {item}
          </a>
        ))}
      </div>
    </div>
  );
}

function ActionButton({ icon, label, primary = false }: { icon: ReactNode; label: string; primary?: boolean }) {
  return (
    <button
      className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm ${
        primary ? "border-accent bg-accent text-white" : "border-border bg-panel text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Metric({ label, value, tone, mono = false }: { label: string; value: string; tone?: "good" | "bad"; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-panel p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate text-lg font-semibold ${mono ? "font-mono text-sm" : ""} ${tone === "good" ? "text-accent" : tone === "bad" ? "text-danger" : ""}`}>{value}</p>
    </div>
  );
}

function EvidencePanel() {
  return (
    <section className="rounded-md border border-border bg-panel">
      <div className="border-b border-border px-3 py-2 text-sm font-medium">Row evidence</div>
      <div className="grid gap-3 p-3 text-sm">
        {[
          ["Input", "I need to change reservation CHG123 to tomorrow."],
          ["Actual output", "Use this pre-populated self-service link; I have not completed the change."],
          ["Expected output visibility", "Hidden for the judge in this run plan."],
          ["Execution context", "History, retrieved booking, tool result, prompt version, and trace."],
          ["Normative context", "Verify eligibility and never claim completion without tool confirmation."],
          ["Gate decision", runGate.decision]
        ].map(([label, value]) => (
          <div className="grid gap-1 border-b border-border pb-2 last:border-b-0" key={label}>
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p>{value}</p>
          </div>
        ))}
        <div className="rounded-md border border-border bg-muted p-2 font-mono text-xs">
          agent loop
          <br />
          <span className="pl-4">llm classify</span>
          <br />
          <span className="pl-4">lookup_booking tool call</span>
          <br />
          <span className="pl-4 text-danger">handoff_self_service failed_handoff</span>
        </div>
      </div>
    </section>
  );
}

function RunWizardPanel() {
  const steps = ["Target", "Source", "Eval Sets", "Sampling", "Expected output", "Thresholds", "Budgets", "Resolved plan", "Dry run", "Start"];
  return (
    <section className="rounded-md border border-border bg-panel">
      <div className="border-b border-border px-3 py-2 text-sm font-medium">Run builder</div>
      <div className="grid gap-2 p-3">
        {steps.map((step, index) => (
          <div className="flex items-center gap-2 text-sm" key={step}>
            <span className="grid size-6 place-items-center rounded border border-border text-xs">{index + 1}</span>
            <span className="flex-1">{step}</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          </div>
        ))}
      </div>
    </section>
  );
}

function PromptDiffPanel() {
  const before = baselinePrompt.components.find((component) => component.id === "decision-rules")!.content;
  const after = candidatePrompt.components.find((component) => component.id === "decision-rules")!.content;
  return (
    <section className="rounded-md border border-border bg-panel">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium">
        <SplitSquareHorizontal className="size-4 text-accent" aria-hidden="true" />
        Prompt diff
      </div>
      <div className="grid gap-3 p-3 text-sm md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Baseline decision-rules</p>
          <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted p-3 font-mono text-xs">{before}</pre>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Candidate decision-rules</p>
          <pre className="whitespace-pre-wrap rounded-md border border-border bg-accent-soft p-3 font-mono text-xs">{after}</pre>
        </div>
      </div>
    </section>
  );
}

function CampaignAnswersPanel() {
  const items = [
    ["Did the candidate improve?", "+13.0 paired delta on the demo validation manifest."],
    ["By how much?", "95% bootstrap interval is shown above; no winner remains a valid decision when guardrails fail."],
    ["Which instruction changed?", "decision-rules was rewritten; role and safety blocks are locked."],
    ["What caused the regression?", "The historical failure maps to instruction_following and policy wording around completion claims."],
    ["Which candidate won?", winner.winnerId ? "Candidate v2 qualifies for shadow or canary." : "No candidate qualified."],
    ["Holdout and guardrails", "Blind holdout is separate; safety, cost, latency, and prompt-hash verification gate release."],
    ["Rollback", "Promotion writes an atomic release pointer with previousReleaseId for rollback."]
  ];
  const icons = [FlaskConical, ArrowRightLeft, Braces, Activity, CheckCircle2, Archive, RotateCcw];
  return (
    <section className="rounded-md border border-border bg-panel">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium">
        <Bot className="size-4 text-accent" aria-hidden="true" />
        Campaign answers
      </div>
      <div className="grid divide-y divide-border">
        {items.map(([title, body], index) => {
          const Icon = icons[index]!;
          return (
            <div className="flex gap-3 p-3 text-sm" key={title}>
              <Icon className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
              <div>
                <p className="font-medium">{title}</p>
                <p className="mt-1 text-muted-foreground">{body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

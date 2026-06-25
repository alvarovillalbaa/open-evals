import {
  InMemoryWorkflowAdapter,
  workflowIdempotencyKey,
  type JsonValue,
  type StartWorkflowInput,
  type WorkflowAdapter,
  type WorkflowId,
  type WorkflowRunRecord
} from "@open-evals/core";

const localAdapter = new InMemoryWorkflowAdapter();

export type WorkflowStartOptions = {
  workspaceId?: string;
  subjectId?: string;
  idempotencyKey?: string;
  input?: Record<string, JsonValue>;
};

export async function startOpenEvalsWorkflow(workflowId: WorkflowId, options: WorkflowStartOptions = {}): Promise<WorkflowRunRecord> {
  const workspaceId = options.workspaceId ?? "ws_demo";
  const input: StartWorkflowInput = {
    workflowId,
    workspaceId,
    subjectId: options.subjectId,
    input: options.input ?? {},
    idempotencyKey:
      options.idempotencyKey ??
      workflowIdempotencyKey({
        workflowId,
        workspaceId,
        subjectId: options.subjectId,
        input: options.input ?? {}
      })
  };
  return workflowAdapter().start(input);
}

export function workflowAdapter(): WorkflowAdapter {
  if (process.env.WORKFLOWS_ENABLED === "false") return localAdapter;
  if (process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL_TOKEN) return new VercelWorkflowAdapter();
  return localAdapter;
}

export class VercelWorkflowAdapter implements WorkflowAdapter {
  kind = "vercel" as const;

  async start(input: StartWorkflowInput): Promise<WorkflowRunRecord> {
    const started = await maybeStartHostedWorkflow(input);
    if (started) return started;
    return localAdapter.start(input);
  }

  async resume(id: string, event: Record<string, JsonValue>): Promise<WorkflowRunRecord> {
    return localAdapter.resume(id, event);
  }

  async cancel(id: string, reason: string): Promise<WorkflowRunRecord> {
    return localAdapter.cancel(id, reason);
  }
}

export const ingestTraceWorkflow = (options: WorkflowStartOptions = {}) => startOpenEvalsWorkflow("ingestTraceWorkflow", options);
export const evalRunWorkflow = (options: WorkflowStartOptions = {}) => startOpenEvalsWorkflow("evalRunWorkflow", options);
export const calibrationWorkflow = (options: WorkflowStartOptions = {}) => startOpenEvalsWorkflow("calibrationWorkflow", options);
export const benchmarkRunWorkflow = (options: WorkflowStartOptions = {}) => startOpenEvalsWorkflow("benchmarkRunWorkflow", options);
export const scenarioRunWorkflow = (options: WorkflowStartOptions = {}) => startOpenEvalsWorkflow("scenarioRunWorkflow", options);
export const variantMatrixWorkflow = (options: WorkflowStartOptions = {}) => startOpenEvalsWorkflow("variantMatrixWorkflow", options);
export const optimizationCampaignWorkflow = (options: WorkflowStartOptions = {}) => startOpenEvalsWorkflow("optimizationCampaignWorkflow", options);
export const onlineExperimentAnalysisWorkflow = (options: WorkflowStartOptions = {}) => startOpenEvalsWorkflow("onlineExperimentAnalysisWorkflow", options);
export const releasePromotionWorkflow = (options: WorkflowStartOptions = {}) => startOpenEvalsWorkflow("releasePromotionWorkflow", options);
export const rollbackWorkflow = (options: WorkflowStartOptions = {}) => startOpenEvalsWorkflow("rollbackWorkflow", options);
export const retentionCleanupWorkflow = (options: WorkflowStartOptions = {}) => startOpenEvalsWorkflow("retentionCleanupWorkflow", options);

async function maybeStartHostedWorkflow(input: StartWorkflowInput): Promise<WorkflowRunRecord | undefined> {
  const sdk = await loadWorkflowSdk();
  const create = sdk?.workflow ?? sdk?.start;
  if (!create) return undefined;
  await create({
    id: input.workflowId,
    idempotencyKey: input.idempotencyKey,
    input
  });
  return {
    id: `vercel_${input.workflowId}_${input.idempotencyKey.slice(0, 12)}`,
    workflowId: input.workflowId,
    workspaceId: input.workspaceId,
    subjectId: input.subjectId,
    status: "queued",
    idempotencyKey: input.idempotencyKey,
    input: input.input ?? {},
    attempts: 0
  };
}

async function loadWorkflowSdk(): Promise<{ workflow?: (request: unknown) => Promise<unknown>; start?: (request: unknown) => Promise<unknown> } | undefined> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
    return (await dynamicImport("workflow")) as { workflow?: (request: unknown) => Promise<unknown>; start?: (request: unknown) => Promise<unknown> };
  } catch {
    return undefined;
  }
}


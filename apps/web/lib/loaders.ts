import {
  getRunBatch,
  getWorkspace,
  isDatabaseUnavailable,
  listBenchmarks,
  listCampaigns,
  listInstructions,
  listRunBatches,
  listScenarios,
  type BenchmarkCatalog,
  type CampaignCatalog,
  type InstructionCatalog,
  type RunBatchDetail,
  type RunBatchSummary,
  type ScenarioCatalog,
  type WorkspaceRecord
} from "@open-evals/db";
import { getRouteAuthContext, type RouteAuthContext } from "@/lib/auth";

export type LoadState<T> =
  | { status: "ready"; auth: RouteAuthContext; workspace?: WorkspaceRecord; data: T }
  | { status: "auth_required"; message: string }
  | { status: "database_unavailable"; message: string };

export async function loadRunBatches(): Promise<LoadState<RunBatchSummary[]>> {
  return loadAuthed((workspaceId) => listRunBatches(workspaceId));
}

export async function loadRunBatch(batchId: string): Promise<LoadState<RunBatchDetail | undefined>> {
  return loadAuthed((workspaceId) => getRunBatch(workspaceId, batchId));
}

export async function loadBenchmarks(): Promise<LoadState<BenchmarkCatalog>> {
  return loadAuthed((workspaceId) => listBenchmarks(workspaceId));
}

export async function loadScenarios(): Promise<LoadState<ScenarioCatalog>> {
  return loadAuthed((workspaceId) => listScenarios(workspaceId));
}

export async function loadInstructions(): Promise<LoadState<InstructionCatalog>> {
  return loadAuthed((workspaceId) => listInstructions(workspaceId));
}

export async function loadCampaigns(): Promise<LoadState<CampaignCatalog>> {
  return loadAuthed((workspaceId) => listCampaigns(workspaceId));
}

async function loadAuthed<T>(loader: (workspaceId: string) => Promise<T>): Promise<LoadState<T>> {
  try {
    const auth = await getRouteAuthContext();
    const [workspace, data] = await Promise.all([getWorkspace(auth.workspaceId), loader(auth.workspaceId)]);
    return { status: "ready", auth, workspace, data };
  } catch (error) {
    if (isDatabaseUnavailable(error)) return { status: "database_unavailable", message: error.message };
    if (error instanceof Error && "status" in error && Number((error as { status?: unknown }).status) === 401) {
      return { status: "auth_required", message: error.message };
    }
    throw error;
  }
}

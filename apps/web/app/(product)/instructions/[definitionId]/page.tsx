import { isDatabaseUnavailable } from "@open-evals/db";
import type { InstructionDetailDTO } from "@open-evals/core";
import { EmptyState, LinkButton, PageHeader } from "../../components";
import { loadInstructionDetail } from "@/lib/instruction-authoring";
import { InstructionEditor } from "../instruction-editor";

export default async function InstructionDetailPage({ params, searchParams }: {
  params: Promise<{ definitionId: string }>;
  searchParams: Promise<{ versionId?: string | string[] }>;
}) {
  const { definitionId } = await params;
  const query = await searchParams;
  if (Array.isArray(query.versionId)) return <EmptyState title="Choose one version" body="The version link contains more than one selection." action={<LinkButton href={`/instructions/${encodeURIComponent(definitionId)}`}>Review latest version</LinkButton>} />;

  let detail: InstructionDetailDTO;
  try {
    detail = await loadInstructionDetail(definitionId, query.versionId);
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : undefined;
    if (status === 401) return <EmptyState title="Sign in required" body="Sign in to review this workspace’s instructions." action={<LinkButton href="/login" primary>Sign in</LinkButton>} />;
    if (status === 403) return <EmptyState title="Instruction access unavailable" body="Your current role or scope does not allow this instruction." action={<LinkButton href="/instructions">All instructions</LinkButton>} />;
    if (status === 404) return <EmptyState title="Instruction or version not found" body="This saved record is unavailable in your workspace." action={<LinkButton href="/instructions">All instructions</LinkButton>} />;
    if (status === 400 || status === 422) return <EmptyState title="Invalid instruction selection" body="Use the instruction catalog to choose a definition and a saved version." action={<LinkButton href="/instructions">All instructions</LinkButton>} />;
    if (status === 503 || isDatabaseUnavailable(error)) return <EmptyState title="Database unavailable" body="The persisted instruction could not be loaded. Retry this page when storage is available." action={<LinkButton href={`/instructions/${encodeURIComponent(definitionId)}${query.versionId ? `?versionId=${encodeURIComponent(query.versionId)}` : ""}`}>Retry loading</LinkButton>} />;
    throw error;
  }

  return <div className="grid min-w-0 gap-5"><PageHeader title={detail.definition.stableKey} eyebrow="Improve · Instructions" /><InstructionEditor key={`${detail.definition.id}:${detail.selectedVersion?.id ?? "empty"}`} initialDetail={detail} /></div>;
}

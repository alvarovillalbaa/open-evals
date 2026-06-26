import { assignExperimentArm, contentSafeAuditHash } from "@open-evals/core";
import { queryOne, queryRows } from "@open-evals/db";
import { authErrorResponse, requireRouteAuth } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const auth = await requireRouteAuth("editor", "experiments:write");
    const body = (await request.json().catch(() => ({}))) as { experimentId?: string; assignmentUnitId?: string; requestId?: string };
    if (!body.experimentId || !body.assignmentUnitId) return Response.json({ error: "experiment_id_and_assignment_unit_required" }, { status: 400 });
    const experiment = await queryOne<{ id: string; status: string }>("select id, status from online_experiments where workspace_id = $1 and id = $2", [
      auth.workspaceId,
      body.experimentId
    ]);
    if (!experiment || experiment.status !== "running") return Response.json({ error: "experiment_not_running" }, { status: 404 });
    const arms = await queryRows<{ id: string; promptVersionId: string; weight: number }>(
      `
        select id, prompt_version_id as "promptVersionId", weight
        from experiment_arms
        where experiment_id = $1
        order by id
      `,
      [body.experimentId]
    );
    const arm = assignExperimentArm(body.experimentId, body.assignmentUnitId, arms);
    const totalWeight = Math.max(1, arms.reduce((sum, item) => sum + item.weight, 0));
    const requestId = body.requestId ?? contentSafeAuditHash({ experimentId: body.experimentId, assignmentUnitId: body.assignmentUnitId }).slice(0, 24);
    await queryRows(
      `
        insert into experiment_exposures (
          id, experiment_id, arm_id, prompt_version_id, assignment_unit_id, request_id, assignment_probability
        )
        values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (experiment_id, request_id) do nothing
      `,
      [
        `exposure_${contentSafeAuditHash({ experimentId: body.experimentId, requestId }).slice(0, 20)}`,
        body.experimentId,
        arm.id,
        arm.promptVersionId,
        body.assignmentUnitId,
        requestId,
        arm.weight / totalWeight
      ]
    );
    return Response.json({ arm, requestId, exposureRecordedBeforeCall: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

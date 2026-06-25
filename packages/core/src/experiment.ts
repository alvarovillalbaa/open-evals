import { createHmac } from "node:crypto";

export interface ExperimentArm {
  id: string;
  promptVersionId: string;
  weight: number;
}

export function assignExperimentArm(experimentId: string, assignmentUnitId: string, arms: ExperimentArm[], secret = "open-evals"): ExperimentArm {
  const total = arms.reduce((sum, arm) => sum + arm.weight, 0);
  if (total <= 0) throw new Error("experiment_requires_positive_weight");
  const digest = createHmac("sha256", secret).update(`${experimentId}:${assignmentUnitId}`).digest("hex");
  const bucket = Number.parseInt(digest.slice(0, 8), 16) % 10000;
  let cursor = 0;
  for (const arm of arms) {
    cursor += (arm.weight / total) * 10000;
    if (bucket < cursor) return arm;
  }
  return arms[arms.length - 1]!;
}

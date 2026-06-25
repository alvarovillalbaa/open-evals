export interface PairedObservation {
  rowId: string;
  incumbent: number;
  candidate: number;
}

export function pairedDeltas(rows: PairedObservation[]): number[] {
  return rows.map((row) => row.candidate - row.incumbent);
}

export function pairedBootstrapCi(rows: PairedObservation[], iterations = 500, seed = 13): { meanDelta: number; low: number; high: number } {
  if (!rows.length) return { meanDelta: 0, low: 0, high: 0 };
  const deltas = pairedDeltas(rows);
  const rng = mulberry32(seed);
  const estimates: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    let total = 0;
    for (let j = 0; j < deltas.length; j += 1) {
      total += deltas[Math.floor(rng() * deltas.length)]!;
    }
    estimates.push(total / deltas.length);
  }
  estimates.sort((a, b) => a - b);
  return {
    meanDelta: mean(deltas),
    low: estimates[Math.floor(iterations * 0.025)] ?? 0,
    high: estimates[Math.floor(iterations * 0.975)] ?? 0
  };
}

export function chooseWinner(args: {
  candidates: Array<{ id: string; qualityDelta: number; safetyDelta: number; costDelta: number; latencyDelta: number }>;
  minimumQualityDelta: number;
}): { winnerId: string | null; reason: string } {
  const eligible = args.candidates
    .filter((candidate) => candidate.qualityDelta >= args.minimumQualityDelta)
    .filter((candidate) => candidate.safetyDelta >= 0)
    .filter((candidate) => candidate.costDelta <= 0.25)
    .sort((a, b) => b.qualityDelta - a.qualityDelta);
  if (!eligible.length) return { winnerId: null, reason: "no_candidate_met_practical_effect_and_guardrails" };
  return { winnerId: eligible[0]!.id, reason: "highest_quality_delta_with_guardrails" };
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function mulberry32(seed: number) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

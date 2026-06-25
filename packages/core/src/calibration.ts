export interface CalibrationPair {
  rowId: string;
  oldScore: number;
  newScore: number;
  oldLabel?: string;
  newLabel?: string;
  critical?: boolean;
}

export function judgeStabilityReport(pairs: CalibrationPair[], tolerancePct = 5) {
  const shifts = pairs.map((pair) => pair.newScore - pair.oldScore);
  const aggregateShiftPct = shifts.length ? shifts.reduce((sum, value) => sum + value, 0) / shifts.length : 0;
  const agreements = pairs.filter((pair) => pair.oldLabel === undefined || pair.oldLabel === pair.newLabel).length;
  const criticalFalseNegatives = pairs.filter((pair) => pair.critical && pair.oldScore < 80 && pair.newScore >= 80).length;
  const criticalFalsePositives = pairs.filter((pair) => pair.critical && pair.oldScore >= 80 && pair.newScore < 80).length;
  return {
    aggregateShiftPct,
    agreementRate: pairs.length ? agreements / pairs.length : 1,
    criticalFalseNegatives,
    criticalFalsePositives,
    passed: Math.abs(aggregateShiftPct) <= tolerancePct && criticalFalseNegatives === 0
  };
}

export function leakageCalibration(withoutExpected: number[], withExpected: number[], tolerancePct = 5) {
  const paired = withoutExpected.map((score, index) => (withExpected[index] ?? score) - score);
  const inflation = paired.length ? paired.reduce((sum, value) => sum + value, 0) / paired.length : 0;
  return {
    inflation,
    leaked: inflation > tolerancePct,
    pairedCount: paired.length
  };
}

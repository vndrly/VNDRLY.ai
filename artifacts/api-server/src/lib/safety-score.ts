/** Shared VNDRLY event formula; callers enforce evidence visibility and distinguish absent evidence. */
export function calculateSafetyEventScore(evidence: {
  openRecordables: number;
  oldOpenHipo: number;
  staleOpen: number;
  recentNearMisses: number;
}): number {
  const score =
    100 -
    evidence.openRecordables * 15 -
    evidence.oldOpenHipo * 5 -
    Math.min(10, evidence.staleOpen * 2) +
    Math.min(10, evidence.recentNearMisses * 2);
  return Math.max(0, Math.min(100, Math.round(score)));
}

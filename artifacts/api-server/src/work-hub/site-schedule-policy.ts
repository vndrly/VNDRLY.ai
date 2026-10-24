export type AssignmentWindow = { id: string; startsAt: Date; endsAt: Date };
export function hasAssignmentOverlap(windows: AssignmentWindow[]) {
  const sorted = [...windows].sort((a,b) => a.startsAt.getTime()-b.startsAt.getTime());
  return sorted.some((row,i) => i > 0 && row.startsAt < sorted[i-1].endsAt);
}
export function validateScheduleRange(from: string, through: string) {
  const a = new Date(`${from}T00:00:00Z`), b = new Date(`${through}T00:00:00Z`);
  return Number.isFinite(+a) && Number.isFinite(+b) && a.toISOString().slice(0,10) === from && b.toISOString().slice(0,10) === through && b >= a && +b - +a < 93*86400000;
}

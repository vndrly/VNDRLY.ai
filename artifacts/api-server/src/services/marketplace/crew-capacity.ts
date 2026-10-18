export type CrewReservation = {
  start: Date | null;
  end: Date | null;
  crews: number;
};

export function peakReservedCrews(
  start: Date,
  end: Date,
  reservations: readonly CrewReservation[],
): number {
  // Half-open [start, end) intervals: crews released at a boundary can be
  // reused by work beginning there. Aggregate each boundary before measuring
  // occupancy so adjacent reservations never produce a transient false peak.
  const changes = new Map<number, number>();
  for (const row of reservations) {
    if (!row.start || !row.end) continue;
    const from = Math.max(start.getTime(), row.start.getTime());
    const to = Math.min(end.getTime(), row.end.getTime());
    if (from >= to) continue;
    changes.set(from, (changes.get(from) ?? 0) + row.crews);
    changes.set(to, (changes.get(to) ?? 0) - row.crews);
  }
  let occupied = 0;
  let peak = 0;
  for (const [, change] of [...changes].sort(([a], [b]) => a - b)) {
    occupied += change;
    peak = Math.max(peak, occupied);
  }
  return peak;
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}
export function fitsAvailability(
  start: Date,
  end: Date,
  windows: { startsAt: Date; endsAt: Date }[],
) {
  return windows.some((w) => start >= w.startsAt && end <= w.endsAt);
}
export function canManageSchedulingType(
  actorId: number,
  hostId: number,
  visibility: string,
  companyAdmin: boolean,
) {
  return actorId === hostId || (visibility === "shared" && companyAdmin);
}
export function schedulingSlots(
  windows: { startsAt: Date; endsAt: Date }[],
  durationMinutes: number,
  busy: { startsAt: Date; endsAt: Date }[],
  now = new Date(),
) {
  const duration = durationMinutes * 60000,
    found = new Set<string>();
  for (const window of windows) {
    for (
      let time = window.startsAt.getTime();
      time + duration <= window.endsAt.getTime() && found.size < 500;
      time += duration
    ) {
      const start = new Date(time),
        end = new Date(time + duration);
      if (
        start > now &&
        !busy.some((b) => overlaps(start, end, b.startsAt, b.endsAt))
      )
        found.add(start.toISOString());
    }
  }
  return [...found].sort().slice(0, 500);
}

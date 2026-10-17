/** Calendar placement is not evidence of worked or payable hours. */
export type FleetCalendarRun = {
  assignmentRecordedAt?:string;
  schedule?: {
    plannedStartAt: string;
    plannedEndAt: string;
    timezone: string;
  } | null;
  events?: readonly { type: string; recordedAt: string }[];
};

function instant(value: string | undefined) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function fleetCalendarTiming(run: FleetCalendarRun) {
  if (run.schedule) {
    const startsAt = instant(run.schedule.plannedStartAt);
    const endsAt = instant(run.schedule.plannedEndAt);
    // A malformed saved schedule needs reconciliation, not a guessed fallback.
    if (!startsAt || !endsAt || endsAt < startsAt) return null;
    return {
      startsAt,
      endsAt,
      timezone: run.schedule.timezone,
      timeBasis: "planned" as const,
    };
  }
  const retained=instant(run.assignmentRecordedAt);
  const dispatch = retained??(run.events ?? [])
    .filter((event) => event.type === "dispatch")
    .map((event) => instant(event.recordedAt))
    .filter((time): time is string => time !== null)
    .sort()[0];
  if (!dispatch) return null;
  return {
    startsAt: dispatch,
    endsAt: null,
    timezone: null,
    timeBasis: "dispatch_recorded" as const,
  };
}

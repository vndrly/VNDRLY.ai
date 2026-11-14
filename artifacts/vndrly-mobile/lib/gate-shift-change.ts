import { fleetWallTimeToInstant } from "@workspace/api-zod";
function localShiftTime(date: string, time: string, timezone: string) {
  const result = fleetWallTimeToInstant(date + "T" + time, timezone);
  if (result.status !== "resolved")
    throw Error(
      "This time is invalid or ambiguous in the shift timezone. Choose another time.",
    );
  return result.instant;
}
export type EditableGateShift = {
  id: string;
  ownerOrgType: "vendor" | "partner";
  ownerOrgId: number;
  version: number;
  siteLocationId: number;
  gateStationId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  milestoneStatus?: string;
};
export function gateShiftClock(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const p = (t: string) => parts.find((x) => x.type === t)?.value;
  return {
    date: p("year") + "-" + p("month") + "-" + p("day"),
    time: p("hour") + ":" + p("minute"),
  };
}
export function prepareGateShiftChange(
  shift: EditableGateShift,
  change:
    | { action: "cancel" }
    | {
        action: "reschedule";
        title: string;
        startDate: string;
        startTime: string;
        endDate: string;
        endTime: string;
      },
  operationId: string,
) {
  if (
    !shift.ownerOrgId ||
    !shift.siteLocationId ||
    !shift.gateStationId ||
    !Number.isInteger(shift.version) ||
    shift.version < 1
  )
    throw Error("Reload the saved shift before editing.");
  let payload: Record<string, unknown> = { action: change.action };
  if (change.action === "reschedule") {
    const startsAt = localShiftTime(
        change.startDate,
        change.startTime,
        shift.timezone,
      ),
      endsAt = localShiftTime(change.endDate, change.endTime, shift.timezone);
    if (!change.title.trim() || Date.parse(endsAt) <= Date.parse(startsAt))
      throw Error("Enter a title and an end after the start.");
    payload = {
      action: change.action,
      title: change.title.trim(),
      startsAt,
      endsAt,
      timezone: shift.timezone,
    };
  }
  return {
    operationId,
    owner: { type: shift.ownerOrgType, id: shift.ownerOrgId },
    context: { kind: "gate", id: shift.siteLocationId },
    expectedVersion: shift.version,
    payloadVersion: 1,
    payload,
  };
}
export function verifyGateShiftChange(
  saved: EditableGateShift,
  shift: EditableGateShift,
  body: ReturnType<typeof prepareGateShiftChange>,
) {
  if (
    saved.id !== shift.id ||
    saved.ownerOrgType !== shift.ownerOrgType ||
    saved.ownerOrgId !== shift.ownerOrgId ||
    saved.siteLocationId !== shift.siteLocationId ||
    saved.gateStationId !== shift.gateStationId ||
    saved.version <= shift.version
  )
    throw Error(
      "The saved shift could not be verified. Refresh before continuing.",
    );
  if (body.payload.action === "cancel") {
    if (saved.milestoneStatus !== "cancelled")
      throw Error("Cancellation could not be verified.");
  } else if (
    saved.title !== body.payload.title ||
    Date.parse(saved.startsAt) !== Date.parse(String(body.payload.startsAt)) ||
    Date.parse(saved.endsAt) !== Date.parse(String(body.payload.endsAt))
  )
    throw Error("The saved schedule differs from the review.");
  return saved;
}

import {
  FleetScheduleSchema,
  type FleetAvailability,
} from "@workspace/api-zod";
import type { PoolClient } from "pg";
import { FleetError } from "./fleet-repository";

export type { FleetAvailability } from "@workspace/api-zod";

/** Called only after canonical Fleet actor, company and driver access checks. */
export async function readFleetAvailability(
  client: Pick<PoolClient, "query">,
  companyId: number,
  driverUserId: number,
  rawSchedule: unknown,
): Promise<FleetAvailability> {
  if (rawSchedule == null)
    return {
      window: null,
      state: "not_requested",
      blockers: [],
      physicalReadinessVerified: false,
    };
  const window = FleetScheduleSchema.parse(rawSchedule);
  const params = [
    driverUserId,
    companyId,
    window.plannedStartAt,
    window.plannedEndAt,
  ];
  const availability = await client.query(
    "SELECT id,starts_at,ends_at,available,recurrence FROM work_hub_availability WHERE user_id=$1 AND owner_org_type='vendor' AND owner_org_id=$2 AND starts_at<$4 AND ends_at>$3 ORDER BY id FOR SHARE",
    params,
  );
  const shifts = await client.query(
    "SELECT s.id FROM work_hub_shift_assignments a JOIN work_hub_shifts s ON s.id=a.shift_id WHERE a.user_id=$1 AND s.owner_org_type='vendor' AND s.owner_org_id=$2 AND a.status NOT IN ('cancelled','declined') AND s.milestone_status<>'cancelled' AND s.starts_at<$4 AND s.ends_at>$3 ORDER BY s.id LIMIT 1 FOR SHARE OF s,a",
    params,
  );
  // Pending or declined invitations are not confirmed commitments.
  const meetings = await client.query(
    "SELECT o.id FROM work_hub_meeting_participants p JOIN work_hub_meeting_occurrences o ON o.id=p.occurrence_id JOIN work_hub_meetings m ON m.id=o.meeting_id WHERE p.user_id=$1 AND p.removed_at IS NULL AND p.rsvp='accepted' AND m.owner_org_type='vendor' AND m.owner_org_id=$2 AND o.status NOT IN ('ended','cancelled') AND o.starts_at<$4 AND o.ends_at>$3 ORDER BY o.id LIMIT 1 FOR SHARE OF o,p",
    params,
  );
  const blockers: FleetAvailability["blockers"] = [];
  if (availability.rows.some((row) => row.available === false))
    blockers.push("unavailable");
  if (shifts.rows.length) blockers.push("shift");
  if (meetings.rows.length) blockers.push("accepted_meeting");
  const recurrence = availability.rows.some((row) => row.recurrence != null);
  const start = Date.parse(window.plannedStartAt),
    end = Date.parse(window.plannedEndAt);
  const covering = availability.rows.some(
    (row) =>
      row.available === true &&
      row.recurrence == null &&
      new Date(row.starts_at).getTime() <= start &&
      new Date(row.ends_at).getTime() >= end,
  );
  if (recurrence) blockers.push("recurrence");
  if (!covering) blockers.push("no_covering_window");
  const state = blockers.includes("unavailable")
    ? "recorded_unavailable"
    : blockers.some(
          (value) => value === "shift" || value === "accepted_meeting",
        )
      ? "recorded_conflict"
      : recurrence
        ? "unknown_recurrence"
        : covering
          ? "recorded_available"
          : "unknown_no_window";
  return { window, state, blockers, physicalReadinessVerified: false };
}

export function requireFleetAvailability(observation: FleetAvailability) {
  if (
    observation.state === "not_requested" ||
    observation.state === "recorded_available"
  )
    return;
  throw new FleetError(
    observation.state === "recorded_unavailable" ||
      observation.state === "recorded_conflict"
      ? "fleet.driver_schedule_conflict"
      : "fleet.driver_availability_unknown",
  );
}

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { commandEnvelope, workHubRequest, type WorkHubOwner } from "@/lib/work-hub-client";
import { BrandedInput, BrandedSelect } from "./chrome";
import { assignmentConflicts, type ScheduleData, type ScheduleShift } from "./shift-assignment-model";

export function calendarStaffingQuery(owner: WorkHubOwner, siteId: number, from: string, through: string) {
  return {
    queryKey: ["site-shift-schedule", owner.type, owner.id, siteId, from, through],
    queryFn: () => workHubRequest<ScheduleData>(`/site-shift-plans/${siteId}/schedule?type=${owner.type}&id=${owner.id}&from=${from}&through=${through}`),
    retry: false,
  };
}

export default function CalendarFillShift({ owner, siteId, shift, unscheduled = false, onSaved }: {
  owner: WorkHubOwner;
  siteId: number;
  shift: ScheduleShift;
  unscheduled?: boolean;
  onSaved: () => void;
}) {
  const cache = useQueryClient();
  const [person, setPerson] = useState("");
  const [weekly, setWeekly] = useState(false);
  const [through, setThrough] = useState(shift.date);
  const [pending, setPending] = useState<ReturnType<typeof commandEnvelope> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const end = weekly ? through : shift.date;
  const rangeValid = end >= shift.date && (Date.parse(end) - Date.parse(shift.date)) / 86_400_000 < 93;
  const query = useQuery({ ...calendarStaffingQuery(owner, siteId, shift.date, end), enabled: rangeValid });
  const userId = Number(person);
  const availableShifts = query.data?.shifts ?? [];
  const slotTaken = unscheduled && availableShifts.some(row => row.gateStationId === shift.gateStationId &&
    Date.parse(row.startsAt) < Date.parse(shift.endsAt) && Date.parse(row.endsAt) > Date.parse(shift.startsAt));
  const shifts = unscheduled ? (slotTaken ? [] : [shift]) : availableShifts.filter(row => {
    const matches = row.id === shift.id || (weekly && shift.gateStationId && row.gateStationId === shift.gateStationId &&
      row.weekday === shift.weekday && row.starts === shift.starts && row.ends === shift.ends && row.timezone === shift.timezone);
    return matches && row.assignees.length < row.required && !row.assignees.includes(userId);
  });
  const conflicts = assignmentConflicts(shifts, userId, query.data?.busy ?? []);
  const canSave = rangeValid && !query.isFetching && !query.isError && !query.data?.readOnly &&
    query.data?.people.some(row => row.id === userId) && shifts.length > 0 && !conflicts.length;

  const path = unscheduled ? "/shifts" : `/site-shift-plans/${siteId}/assign`;
  async function save() {
    if (saving || (!pending && !canSave)) return;
    const request = pending ?? (unscheduled ? commandEnvelope(owner, {
      title: `${shift.title} — ${shift.starts}–${shift.ends}`,
      startsAt: shift.startsAt, endsAt: shift.endsAt, timezone: shift.timezone,
      siteLocationId: siteId, gateStationId: shift.gateStationId,
      requiredStaffCount: shift.required, workStartPolicy: "on_site", assigneeUserIds: [userId],
    }, undefined, undefined, { kind: "gate", id: siteId }) : commandEnvelope(owner, {
      changes: shifts.map(row => ({ id: row.id, version: row.version, addUserId: userId })),
    }));
    setPending(request);
    setSaving(true);
    setError("");
    try {
      await workHubRequest(path, { method: "POST", body: JSON.stringify(request) });
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["site-shift-schedule", owner.type, owner.id, siteId] }),
        cache.invalidateQueries({ queryKey: ["work-hub", "calendar"] }),
        cache.invalidateQueries({ queryKey: ["account-next-steps"] }),
      ]);
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The assignment could not be confirmed.");
      if ([400, 403, 404, 409, 422].includes((reason as { status?: number })?.status ?? 0)) {
        setPending(null);
        await query.refetch();
      }
    } finally {
      setSaving(false);
    }
  }

  return <div className="grid gap-2 border-t border-white/20 pt-3">
    <fieldset className="grid gap-2" disabled={Boolean(pending)}>
      <label className="grid gap-1">Gatekeeper
        <BrandedSelect value={person} onChange={event => setPerson(event.target.value)}>
          <option value="">Choose a gatekeeper</option>
          {query.data?.people.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </BrandedSelect>
      </label>
      <label className="grid gap-1">Assignment
        <BrandedSelect value={weekly ? "weekly" : "once"} onChange={event => setWeekly(event.target.value === "weekly")}>
          <option value="once">This shift only</option>
          {shift.gateStationId && !unscheduled && <option value="weekly">Weekly schedule</option>}
        </BrandedSelect>
      </label>
      {weekly && <label className="grid gap-1">Through
        <BrandedInput type="date" min={shift.date} value={through} onChange={event => setThrough(event.target.value)} />
      </label>}
    </fieldset>
    {weekly && <p>Fills matching open shifts already scheduled on this weekday through the selected date.</p>}
    {!rangeValid && <p role="alert">Choose a date range of up to 93 days.</p>}
    {query.isError && <p role="alert">The roster could not load. <button type="button" onClick={() => void query.refetch()}>Retry</button></p>}
    {query.isFetching && <p role="status">Checking schedule and gatekeepers…</p>}
    {slotTaken && <p role="alert">A shift was already scheduled for this time.</p>}
    {query.data && !query.data.people.length && <p>No eligible gatekeepers are listed for this site.</p>}
    {!!conflicts.length && <p role="alert">This gatekeeper has an overlapping shift.</p>}
    {error && <p role="alert">{error}</p>}
    <button type="button" className="hub-task-mini-card" disabled={saving || (!pending && !canSave)} onClick={() => void save()}>
      {saving ? "Saving…" : pending ? "Retry assignment" : `Assign ${shifts.length || ""} ${shifts.length === 1 ? "shift" : "shifts"}`}
    </button>
  </div>;
}

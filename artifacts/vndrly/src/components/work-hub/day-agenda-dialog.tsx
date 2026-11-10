import { useEffect, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fleetWallTimeToInstant } from "@workspace/api-zod";

import BrandPillButton from "@/components/brand-pill-button";
import { VendorEditFlyout } from "@/components/vendor-edit-flyout";
import { useBrand } from "@/hooks/use-brand";
import { Dialog } from "@/components/ui/dialog";
import { recordedShiftCalendarHref } from "@/lib/calendar-day-link";
import { formatRecordedHours } from "@/lib/dashboard-shift-hours";
import { workHubRequest, type WorkHubOwner } from "@/lib/work-hub-client";
import CalendarFillShift, { calendarStaffingQuery } from "./calendar-fill-shift";
import { calendarGateLabel, type GateCalendarOptions } from "./gate-calendar-scheduling";
import type { ScheduleShift } from "./shift-assignment-model";

type Row = Record<string, any>;
const AGENDA_KINDS = ["Meeting", "Shift", "Task", "Event", "Field Ticket", "Fleet Run"] as const;
type AgendaKind = (typeof AGENDA_KINDS)[number];

export function calendarItemHref(item: Row) {
  if (item.recordedShift) return recordedShiftCalendarHref({ id: item.workdayId, startedAt: item.startsAt }, item.workerUserId);
  if (item.route) return item.route;
  if (item.kind === "Meeting") return `/work-hub/meetings/${item.id}`;
  if (item.kind === "Task") return `/work-hub/tasks/${item.id}`;
  return `/work-hub/calendar?shift=${item.id}`;
}

export default function DayAgendaDialog({
  open,
  onOpenChange,
  day,
  items,
  staffingOwner,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: string;
  items: Row[];
  staffingOwner?: WorkHubOwner;
}) {
  const brand = useBrand();
  const [enabledKinds, setEnabledKinds] = useState<Set<AgendaKind>>(() => new Set(AGENDA_KINDS));
  const [fillId, setFillId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const gateOptions = useQuery({
    queryKey: ["work-hub", "gate-shift-definitions", staffingOwner?.id],
    queryFn: () => workHubRequest<GateCalendarOptions>(`/gate-shift-definitions?vendorId=${staffingOwner!.id}`),
    enabled: open && !!staffingOwner,
    refetchInterval: open && staffingOwner ? 15_000 : false,
    retry: false,
  });
  useEffect(() => {
    if (!open) setEnabledKinds(new Set(AGENDA_KINDS));
  }, [open]);
  useEffect(() => { setFillId(null); setSaved(false); }, [open, day]);
  const activeGateIds = gateOptions.data && new Set(gateOptions.data.gates.map(gate => gate.id));
  const visibleItems = items.filter(item => enabledKinds.has(item.kind as AgendaKind) &&
    (!staffingOwner || !item.gateStationId || activeGateIds?.has(item.gateStationId) && !["cancelled", "completed"].includes(item.milestoneStatus)));
  const gates = gateOptions.data?.gates ?? [];
  const siteIds = [...new Set(gates.map(gate => gate.siteId).filter(Boolean))];
  const staffing = useQueries({ queries: open && staffingOwner
    ? siteIds.map(siteId => calendarStaffingQuery(staffingOwner, siteId, day, day))
    : [] });
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const extraShifts = enabledKinds.has("Shift") ? gates.flatMap(gate => {
    const schedule = staffing[siteIds.indexOf(gate.siteId)]?.data;
    if (!schedule) return [];
    const existing = schedule.shifts.filter(shift => shift.gateStationId === gate.id);
    const definitions = (gateOptions.data?.definitions ?? []).filter(definition => definition.stationId === gate.id);
    const patterns = definitions.length ? definitions.filter(definition => definition.weekdays.includes(weekday)) : [
      { startsAtLocal: "06:00", endsAtLocal: "18:00", timezone: "America/Chicago", requiredCount: 1 },
      { startsAtLocal: "18:00", endsAtLocal: "06:00", timezone: "America/Chicago", requiredCount: 1 },
    ];
    const gateName = calendarGateLabel(gate, gates);
    const nextDay = new Date(`${day}T12:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const slots = schedule.readOnly ? [] : patterns.flatMap(pattern => {
      const { startsAtLocal: starts, endsAtLocal: ends, timezone, requiredCount } = pattern;
      const start = fleetWallTimeToInstant(`${day}T${starts}`, timezone);
      const endDay = ends <= starts ? nextDay.toISOString().slice(0, 10) : day;
      const end = fleetWallTimeToInstant(`${endDay}T${ends}`, timezone);
      if (start.status !== "resolved" || end.status !== "resolved" ||
        existing.some(shift => Date.parse(shift.startsAt) < Date.parse(end.instant) && Date.parse(shift.endsAt) > Date.parse(start.instant))) return [];
      const shift: ScheduleShift = { id: `slot-${gate.id}-${starts}-${ends}`, version: 0, title: gateName, gateStationId: gate.id,
        pattern: gateName, date: day, weekday, starts, ends, startsAt: start.instant, endsAt: end.instant,
        timezone, required: requiredCount, assignees: [] };
      return [{ shift, siteId: gate.siteId, unscheduled: true }];
    });
    return [...existing.filter(shift => !visibleItems.some(item => item.id === shift.id)).map(shift => ({ shift, siteId: gate.siteId, unscheduled: false })), ...slots];
  }) : [];
  const label = new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const settings = (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold">Include in this day</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {AGENDA_KINDS.map((kind) => (
          <label key={kind} className="flex items-center gap-2 text-xs font-semibold">
            <input
              type="checkbox"
              checked={enabledKinds.has(kind)}
              onChange={(event) => setEnabledKinds((current) => {
                const next = new Set(current);
                if (event.target.checked) next.add(kind);
                else next.delete(kind);
                return next;
              })}
              className="h-4 w-4 rounded border-white accent-[var(--brand-primary)]"
            />
            {kind}s
          </label>
        ))}
      </div>
    </fieldset>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <VendorEditFlyout title="Day Agenda" logoSrc={brand.logoSquareUrl || brand.logoUrl || undefined} logoAlt={`${brand.name} logo`} onClose={() => onOpenChange(false)}>
        <div className="grid gap-3">
          <p className="font-semibold">{label}</p>
          <details><summary className="cursor-pointer">Filter agenda</summary>{settings}</details>
          <div data-testid="day-agenda-content" className="grid gap-3">
          {staffingOwner && gateOptions.isPending && <p role="status">Loading active gates…</p>}
          {staffingOwner && gateOptions.isError && <p role="alert">Active gates could not load. <button type="button" onClick={() => void gateOptions.refetch()}>Retry</button></p>}
          {staffing.some(query => query.isPending) && <p role="status">Checking shift assignments…</p>}
          {staffing.some(query => query.isError) && <p role="alert">Some shift assignments could not load. <button type="button" onClick={() => staffing.filter(query => query.isError).forEach(query => void query.refetch())}>Retry</button></p>}
          {saved && <p role="status">Assignment saved.</p>}
          {visibleItems.map((item) => {
            const siteId = Number(item.siteLocationId);
            const schedule = staffing[siteIds.indexOf(siteId)]?.data;
            const shift = schedule?.shifts.find(row => row.id === item.id);
            const vacant = shift && shift.assignees.length < shift.required;
            return <article key={`${item.kind}-${item.id}`} className="grid gap-2 rounded-xl border border-[color:var(--brand-primary)] bg-[#242426] p-4 text-[#ececec]" data-testid="day-agenda-item">
              <a href={calendarItemHref(item)} className="block rounded-md focus-visible:outline focus-visible:outline-2">
              <span className="text-xs font-semibold uppercase text-muted-foreground">{item.kind}</span>
              <div className="flex items-start justify-between gap-3"><strong>{item.title}</strong><time className="text-sm">{shift ? `${shift.starts}–${shift.ends}` : new Date(item.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div>
              {item.recordedShift && <p className="text-sm">Recorded hours: {formatRecordedHours(item.recordedMilliseconds)}</p>}
              </a>
              {shift && <p className="text-sm">{shift.assignees.length}/{shift.required} assigned{shift.assignees.length > 0 && ` · ${shift.assignees.map(id => shift.assigneeNames?.[id] ?? `Gatekeeper ${id}`).join(", ")}`}</p>}
              {vacant && staffingOwner && !schedule?.readOnly && <button type="button" className="hub-task-mini-card justify-self-start" title="Choose a gatekeeper for this shift" aria-expanded={fillId === item.id} onClick={() => { setSaved(false); setFillId(fillId === item.id ? null : item.id); }}>Fill</button>}
              {fillId === item.id && shift && staffingOwner && <CalendarFillShift key={item.id} owner={staffingOwner} siteId={siteId} shift={{ ...shift, gateStationId: item.gateStationId }} onSaved={() => { setFillId(null); setSaved(true); }} />}
            </article>;
          })}
          {extraShifts.map(({ shift, siteId, unscheduled }) => (
            <article key={shift.id} className="grid gap-2 rounded-xl border border-[color:var(--brand-primary)] p-4">
              <div className="flex justify-between gap-3"><strong>{shift.title}</strong><time>{shift.starts}–{shift.ends}</time></div>
              <p>{shift.assignees.length ? shift.assignees.map(id => shift.assigneeNames?.[id] ?? `Gatekeeper ${id}`).join(", ") : "Open shift"}</p>
              {staffingOwner && !staffing[siteIds.indexOf(siteId)]?.data?.readOnly && shift.assignees.length < shift.required &&
                <button type="button" className="hub-task-mini-card justify-self-start" aria-expanded={fillId === shift.id} onClick={() => { setSaved(false); setFillId(fillId === shift.id ? null : shift.id); }}>Fill</button>}
              {fillId === shift.id && staffingOwner && <CalendarFillShift key={shift.id} owner={staffingOwner} siteId={siteId} shift={shift} unscheduled={unscheduled} onSaved={() => { setFillId(null); setSaved(true); }} />}
            </article>
          ))}
          {!visibleItems.length && !extraShifts.length && !gateOptions.isLoading && !staffing.some(query => query.isPending) && <p className="rounded-xl p-6 text-center text-muted-foreground">Nothing is scheduled for this day.</p>}
          </div>
          <BrandPillButton tone="brand" onClick={() => onOpenChange(false)}>Close</BrandPillButton>
        </div>
      </VendorEditFlyout>
    </Dialog>
  );
}

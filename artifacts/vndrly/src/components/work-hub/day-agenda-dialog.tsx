import { CalendarDays } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import BrandPillButton from "@/components/brand-pill-button";
import MiniCardDialogContent from "@/components/mini-card-dialog-content";
import { Dialog } from "@/components/ui/dialog";

type Row = Record<string, any>;
const AGENDA_KINDS = ["Meeting", "Shift", "Task", "Event"] as const;
type AgendaKind = (typeof AGENDA_KINDS)[number];

export function calendarItemHref(item: Row) {
  if (item.kind === "Meeting") return `/work-hub/meetings/${item.id}`;
  if (item.kind === "Task") return `/work-hub/tasks/${item.id}`;
  return `/work-hub/calendar?shift=${item.id}`;
}

export default function DayAgendaDialog({
  open,
  onOpenChange,
  day,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: string;
  items: Row[];
}) {
  const [enabledKinds, setEnabledKinds] = useState<Set<AgendaKind>>(() => new Set(AGENDA_KINDS));
  useEffect(() => {
    if (!open) setEnabledKinds(new Set(AGENDA_KINDS));
  }, [open]);
  const visibleItems = useMemo(
    () => items.filter((item) => enabledKinds.has(item.kind as AgendaKind)),
    [enabledKinds, items],
  );
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
            {kind === "Meeting" ? "Meetings" : kind === "Shift" ? "Shifts" : kind === "Task" ? "Tasks" : "Events"}
          </label>
        ))}
      </div>
    </fieldset>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <MiniCardDialogContent icon={CalendarDays} label="Day Agenda" definition={label} iconColor="var(--brand-primary)" settings={settings} className="max-h-[86vh] sm:max-w-2xl">
        <div className="grid gap-3">
          {visibleItems.slice(0, 10).map((item) => (
            <a key={`${item.kind}-${item.id}`} href={calendarItemHref(item)} className="rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4 text-black" data-testid="day-agenda-item">
              <span className="text-xs font-semibold uppercase text-muted-foreground">{item.kind}</span>
              <div className="flex items-start justify-between gap-3"><strong>{item.title}</strong><time className="text-sm">{new Date(item.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div>
            </a>
          ))}
          {!visibleItems.length && <p className="rounded-xl border border-border p-6 text-center text-muted-foreground">Nothing is scheduled for this day.</p>}
          <BrandPillButton tone="brand" onClick={() => onOpenChange(false)}>Close</BrandPillButton>
        </div>
      </MiniCardDialogContent>
    </Dialog>
  );
}
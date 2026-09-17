import { CalendarDays } from "lucide-react";
import BrandPillButton from "@/components/brand-pill-button";
import MiniCardDialogContent from "@/components/mini-card-dialog-content";
import { Dialog } from "@/components/ui/dialog";

type Row = Record<string, any>;
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
  const label = new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <MiniCardDialogContent icon={CalendarDays} label="Day Agenda" definition={label} iconColor="var(--brand-primary)" className="sm:max-w-2xl">
        <div className="grid gap-3">
          {items.map((item) => (
            <a key={`${item.kind}-${item.id}`} href={calendarItemHref(item)} className="rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4 text-black">
              <span className="text-xs font-semibold uppercase text-muted-foreground">{item.kind}</span>
              <div className="flex items-start justify-between gap-3"><strong>{item.title}</strong><time className="text-sm">{new Date(item.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div>
            </a>
          ))}
          {!items.length && <p className="rounded-xl border border-border p-6 text-center text-muted-foreground">Nothing is scheduled for this day.</p>}
          <BrandPillButton tone="brand" onClick={() => onOpenChange(false)}>Close</BrandPillButton>
        </div>
      </MiniCardDialogContent>
    </Dialog>
  );
}

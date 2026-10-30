import { useState } from "react";
import WorkdayStatusSwitch from "@/components/workday-status-switch";
import "@/components/workday-controls.css";
type Row = Record<string, any>;

export default function CalendarAssigneePicker({
  people,
  crews,
  userIds,
  crewIds,
  onUsers,
  onCrews,
}: {
  people: Row[];
  crews: Row[];
  userIds: number[];
  crewIds: string[];
  onUsers: (ids: number[]) => void;
  onCrews: (ids: string[]) => void;
}) {
  const [mode, setMode] = useState<"crews" | "individuals">("crews");
  const toggle = <T,>(values: T[], value: T) =>
    values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  return (
    <div className="hub-schedule-attendees grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Assign (optional)</p>
        <div className="calendar-assignee-slider inline-flex items-center gap-2" data-testid="calendar-assignee-toggle">
          <button type="button" onClick={() => setMode("crews")} aria-pressed={mode === "crews"}>Crew</button>
          <WorkdayStatusSwitch active={mode === "individuals"} label="" accessibilityLabel="Crew / Individual" onClick={() => setMode(mode === "crews" ? "individuals" : "crews")} />
          <button type="button" onClick={() => setMode("individuals")} aria-pressed={mode === "individuals"}>Individual</button>
        </div>
      </div>
      <div
        className="hub-schedule-attendees-list grid content-start gap-2 overflow-y-auto pr-1"
        data-testid="calendar-assignee-list"
        style={{ colorScheme: "light" }}
      >
        {mode === "crews" ? crews.map((crew) => (
          <label key={crew.id} className="flex items-center gap-2 text-sm">
            <input className="h-4 w-4 rounded border-2 border-[color:var(--brand-primary)] bg-white accent-[var(--brand-primary)]" style={{ colorScheme: "light", accentColor: "var(--brand-primary)" }} type="checkbox" checked={crewIds.includes(crew.id)} onChange={() => onCrews(toggle(crewIds, crew.id))} />
            {crew.name}
          </label>
        )) : people.map((person) => (
          <label key={person.id} className="flex items-center gap-2 text-sm">
            <input className="h-4 w-4 rounded border-2 border-[color:var(--brand-primary)] bg-white accent-[var(--brand-primary)]" style={{ colorScheme: "light", accentColor: "var(--brand-primary)" }} type="checkbox" checked={userIds.includes(person.id)} onChange={() => onUsers(toggle(userIds, person.id))} />
            {person.displayName || person.email}
          </label>
        ))}
        {mode === "crews" && !crews.length && <p className="text-xs text-muted-foreground">No eligible crews found.</p>}
        {mode === "individuals" && !people.length && <p className="text-xs text-muted-foreground">No eligible employees found.</p>}
      </div>
    </div>
  );
}


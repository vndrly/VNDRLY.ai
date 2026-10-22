import type { ReactNode } from "react";
import BrandPillButton from "@/components/brand-pill-button";
import SphereBackButton from "@/components/sphere-back-button";
import { localDateKey } from "./calendar-views";
import "./work-calendar.css";

type Row = Record<string, any>;
export function monthCalendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  first.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + index));
}
const dayKey = (value: unknown) => value ? localDateKey(new Date(String(value))) : "";
function recordTime(item: Row) {
  const options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short", ...(item.timezone ? { timeZone: item.timezone } : {}) };
  return `${new Date(item.startsAt).toLocaleString(undefined, options)}${item.endsAt ? ` – ${new Date(item.endsAt).toLocaleString(undefined, options)}` : " · End time unspecified"}${item.timezone ? ` · ${item.timezone}` : ""}`;
}

/** The iOS month/day layout, using the web calendar's existing authorized records. */
export default function WorkCalendar({ month, selectedDay, items, onSelectDay, onOpenDay, onSchedule, scheduling, loading, unavailable, filters }: {
  month: Date; selectedDay: string; items: Row[];
  onSelectDay: (day: string) => void; onOpenDay: () => void;
  onSchedule?: () => void; scheduling: boolean; loading: boolean; unavailable: boolean;
  filters: ReactNode;
}) {
  const selected = items.filter(item => dayKey(item.startsAt) === selectedDay);
  const move = (offset: number) => onSelectDay(localDateKey(new Date(month.getFullYear(), month.getMonth() + offset, 1)));
  return <section className="hub-work-calendar" aria-label="Work calendar">
    <div className="hub-calendar-heading"><h2>Work calendar</h2>{onSchedule && <BrandPillButton tone="brand" aria-expanded={scheduling} onClick={onSchedule}>{scheduling ? "Close scheduling" : "Schedule"}</BrandPillButton>}</div>
    <p className="hub-calendar-muted">Daily company work across shifts, meetings, tasks, and scheduled operations. Scheduling reserves planned time; it does not start work.</p>
    <div className="hub-month-navigation">
      <button type="button" className="group inline-flex min-h-11 min-w-11 items-center justify-center justify-self-start rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]" aria-label="Previous month" onClick={() => move(-1)}><SphereBackButton size={40} /></button>
      <h3 aria-live="polite">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h3>
      <button type="button" className="group inline-flex min-h-11 min-w-11 items-center justify-center justify-self-end rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]" aria-label="Next month" onClick={() => move(1)}><SphereBackButton size={40} direction="right" /></button>
    </div>
    <div className="hub-month-grid" aria-label="Calendar days">
      {monthCalendarDays(month).map(date => {
        const key = localDateKey(date), count = items.filter(item => dayKey(item.startsAt) === key).length;
        return <button key={key} type="button" className="hub-month-day" data-outside={date.getMonth() !== month.getMonth()} aria-pressed={key === selectedDay}
          aria-label={`${date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}, ${count} scheduled records`}
          onClick={() => onSelectDay(key)}>
          <span>{date.getDate()}</span><strong aria-hidden="true">{count ? `${count} •` : ""}</strong>
        </button>;
      })}
    </div>
    <h3 aria-live="polite">{new Date(`${selectedDay}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · {selected.length} scheduled records{unavailable ? " available" : ""}</h3>
    <p className="hub-calendar-muted">Calendar days use your device timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Original schedule timezones appear on records.</p>
    {loading && <p role="status" className="hub-calendar-muted">Loading schedules…</p>}
    {unavailable && <p role="status" className="hub-calendar-muted">Some schedules could not load. Counts reflect available records.</p>}
    {!loading && !selected.length && <p className="hub-calendar-muted">{unavailable ? "No records available for this day from the schedules that loaded." : "No scheduled records for this day."}</p>}
    {selected.map(item => <article className="hub-calendar-record" key={`${item.kind}-${item.id}`}>
      <h3>{item.route ? <a href={item.route}>{item.title}</a> : <button type="button" onClick={onOpenDay}>{item.title}</button>}</h3>
      <p className="hub-calendar-muted">{item.kind} · {recordTime(item)}</p>
      {item.kind === "Fleet Run" && <p className="hub-calendar-muted">{item.employeeName ? `${item.employeeName} · ` : ""}{item.linkedTicketId ? `Ticket #${item.linkedTicketId} · ` : ""}{item.timeBasis === "dispatch_recorded" ? "Dispatch recorded · no planned time" : "Planned run time"}</p>}
      {item.status && <p className="hub-calendar-muted">{String(item.status).replaceAll("_", " ")}</p>}
      {item.route ? <a className="hub-calendar-record-link" href={item.route}>Open scheduled record</a> : <button className="hub-calendar-record-link" type="button" onClick={onOpenDay}>Open scheduled record</button>}
    </article>)}
    <details className="hub-calendar-filters"><summary>Filter schedules</summary>{filters}</details>
  </section>;
}

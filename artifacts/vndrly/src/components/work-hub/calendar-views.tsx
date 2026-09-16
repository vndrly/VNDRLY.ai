import { useState } from "react";
import BrandPillButton from "@/components/brand-pill-button";
import { useBrand } from "@/hooks/use-brand";
import { brandTextColor } from "@/lib/brand-color";
import { BrandedSelect } from "./chrome";
export function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function calendarViewDays(day: string, view: "day" | "week") {
  const date = new Date(`${day}T12:00:00`);
  if (view === "week") date.setDate(date.getDate() - date.getDay());
  return Array.from({ length: view === "week" ? 7 : 1 }, (_, index) => {
    const next = new Date(date);
    next.setDate(next.getDate() + index);
    return next;
  });
}
export function CalendarTimeGrid({
  selectedDay,
  items,
  onSelectDay,
}: {
  selectedDay: string;
  items: Record<string, any>[];
  onSelectDay: (day: string) => void;
}) {
  const [view, setView] = useState<"day" | "week">("week");
  const [kind, setKind] = useState("All");
  const brand = useBrand();
  const days = calendarViewDays(selectedDay, view);
  return (
    <div className="mb-4 overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <h2 className="font-semibold">Schedule</h2>
        <div className="flex flex-wrap gap-2">
          <BrandPillButton
            tone="brand"
            onClick={() => {
              const next = new Date(`${selectedDay}T12:00:00`);
              next.setDate(next.getDate() - (view === "week" ? 7 : 1));
              onSelectDay(localDateKey(next));
            }}
          >
            Previous {view}
          </BrandPillButton>
          <BrandPillButton
            tone="brand"
            onClick={() => onSelectDay(localDateKey(new Date()))}
          >
            Today
          </BrandPillButton>
          <BrandPillButton
            tone="brand"
            onClick={() => {
              const next = new Date(`${selectedDay}T12:00:00`);
              next.setDate(next.getDate() + (view === "week" ? 7 : 1));
              onSelectDay(localDateKey(next));
            }}
          >
            Next {view}
          </BrandPillButton>
          <BrandedSelect
            aria-label="Calendar view"
            className="min-w-24"
            value={view}
            onChange={(e) => setView(e.target.value as typeof view)}
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
          </BrandedSelect>
          <BrandedSelect
            aria-label="Event type"
            className="min-w-28"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {["All", "Shift", "Task", "Meeting"].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </BrandedSelect>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div
          className={`grid ${view === "week" ? "min-w-[720px] grid-cols-7" : "grid-cols-1"}`}
        >
          {days.map((day) => (
            <div
              key={localDateKey(day)}
              className="min-h-56 border-r last:border-r-0"
            >
              <button
                className="m-1 w-[calc(100%_-_0.5rem)] rounded-lg p-3 text-sm font-bold"
                style={{
                  backgroundColor: "var(--brand-primary)",
                  color: brandTextColor(brand.primary),
                }}
                onClick={() => onSelectDay(localDateKey(day))}
              >
                {day.toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </button>
              <div className="space-y-2 p-2">
                {items
                  .filter(
                    (item) =>
                      item.startsAt &&
                      localDateKey(new Date(item.startsAt)) ===
                        localDateKey(day) &&
                      (kind === "All" || item.kind === kind),
                  )
                  .map((item) => (
                    <a
                      key={`${item.kind}-${item.id}`}
                      href={
                        item.kind === "Meeting"
                          ? `/work-hub/meetings?meeting=${item.id}`
                          : item.kind === "Task"
                            ? `/work-hub/tasks?task=${item.id}`
                            : "#shift-schedule"
                      }
                      className="block rounded border-l-4 border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] p-2 text-xs"
                    >
                      <time>
                        {new Date(item.startsAt).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                      <strong className="mt-1 block">{item.title}</strong>
                      <span>{item.kind}</span>
                    </a>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

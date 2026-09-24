import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";

export type WorkHubCalendarItem = {
  id?: string | number;
  kind?: string | null;
  title?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
};

type CalendarView = "week" | "month";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function startOfWeek(value: Date): Date {
  const day = startOfDay(value);
  day.setDate(day.getDate() - day.getDay());
  return day;
}

function addDays(value: Date, amount: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function parseShift(item: WorkHubCalendarItem) {
  if (item.kind?.toLowerCase() !== "shift" || !item.startsAt) return null;
  const start = new Date(item.startsAt);
  const end = item.endsAt ? new Date(item.endsAt) : new Date(start.getTime() + 60 * 60_000);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  return { ...item, start, end };
}

function timeLabel(value: Date): string {
  return value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dayAccessibilityLabel(day: Date, count: number): string {
  const label = day.toLocaleDateString([], { month: "long", day: "numeric" });
  return `${label}, ${count} scheduled ${count === 1 ? "shift" : "shifts"}`;
}

export default function WorkHubShiftCalendar({
  items,
  initialDate = new Date(),
}: {
  items: WorkHubCalendarItem[];
  initialDate?: Date;
}) {
  const colors = useColors();
  const [view, setView] = useState<CalendarView>("week");
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(initialDate));
  const shifts = useMemo(
    () => items.map(parseShift).filter((item): item is NonNullable<ReturnType<typeof parseShift>> => item !== null),
    [items],
  );
  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);
  const weekShifts = shifts.filter((shift) => shift.start < weekEnd && shift.end > weekStart);
  const monthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const monthEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
  const monthGridStart = startOfWeek(monthStart);
  const monthCells = Array.from({ length: 42 }, (_, index) => addDays(monthGridStart, index));

  const openDay = (day: Date) => {
    setSelectedDate(startOfDay(day));
    setView("week");
  };

  return (
    <View
      accessibilityLabel="Shift calendar"
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.primary }]}
    >
      <View style={styles.headerRow}>
        <Text selectable style={[styles.title, { color: colors.text }]}>Shift calendar</Text>
        <View style={styles.viewToggle}>
          <TogglePillButton
            accessibilityLabel="Week"
            accessibilityState={{ selected: view === "week" }}
            solid={view === "week"}
            onPress={() => setView("week")}
            style={styles.toggle}
          >
            Week
          </TogglePillButton>
          <TogglePillButton
            accessibilityLabel="Month"
            accessibilityState={{ selected: view === "month" }}
            solid={view === "month"}
            onPress={() => setView("month")}
            style={styles.toggle}
          >
            Month
          </TogglePillButton>
        </View>
      </View>

      {view === "week" ? (
        <>
          <Text selectable style={[styles.periodLabel, { color: colors.mutedForeground }]}> 
            {weekStart.toLocaleDateString([], { month: "short", day: "numeric" })}
            {" – "}
            {weekDays[6].toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
          </Text>
          <View accessibilityLabel="Seven day week" aria-orientation="vertical" style={styles.weekRow}>
            {weekDays.map((day) => {
              const dayEnd = addDays(day, 1);
              const daySegments = weekShifts
                .filter((shift) => shift.start < dayEnd && shift.end > day)
                .map((shift) => {
                  const segmentStart = new Date(Math.max(shift.start.getTime(), day.getTime()));
                  const segmentEnd = new Date(Math.min(shift.end.getTime(), dayEnd.getTime()));
                  const startMinutes = (segmentStart.getTime() - day.getTime()) / 60_000;
                  const endMinutes = (segmentEnd.getTime() - day.getTime()) / 60_000;
                  return {
                    shift,
                    segmentStart,
                    segmentEnd,
                    left: `${(startMinutes / 1440) * 100}%` as `${number}%`,
                    width: `${Math.max(((endMinutes - startMinutes) / 1440) * 100, 1.5)}%` as `${number}%`,
                  };
                });
              return (
                <View
                  key={day.toISOString()}
                  accessibilityLabel={`${day.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} schedule`}
                  style={[
                    styles.dayColumn,
                    { borderColor: sameDay(day, selectedDate) ? colors.primary : colors.border },
                  ]}
                >
                  <Text selectable style={[styles.dayHeading, { color: colors.text }]}> 
                    {day.toLocaleDateString([], { weekday: "short" })} {day.getDate()}
                  </Text>
                  <View style={[styles.daySchedule, { borderLeftColor: colors.border }]}>
                    <View style={styles.timelineLabels}>
                      {["12 AM", "6 AM", "12 PM", "6 PM", "24"].map((label) => (
                        <Text key={label} style={[styles.timelineLabel, { color: colors.mutedForeground }]}>{label}</Text>
                      ))}
                    </View>
                    <View style={[styles.timelineTrack, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      {[25, 50, 75].map((left) => <View key={left} style={[styles.timelineTick, { borderColor: colors.border, left: `${left}%` }]} />)}
                      {daySegments.map(({ shift, segmentStart, segmentEnd, left, width }, index) => (
                        <View
                          key={String(shift.id ?? `${shift.startsAt}-${index}`)}
                          accessibilityLabel={`${shift.title || "Scheduled shift"}, scheduled ${timeLabel(segmentStart)} to ${timeLabel(segmentEnd)}`}
                          style={[styles.timelineSegment, { backgroundColor: colors.primary, left, width }]}
                        />
                      ))}
                    </View>
                    <View style={styles.descriptionList}>
                      {daySegments.map(({ shift, segmentStart, segmentEnd }, index) => (
                        <Text key={String(shift.id ?? `${shift.startsAt}-${index}`)} selectable style={[styles.shiftDescription, { color: colors.text }]}> 
                          {timeLabel(segmentStart)}–{timeLabel(segmentEnd)} · {shift.title || "Scheduled shift"}
                        </Text>
                      ))}
                      {!daySegments.length ? <Text style={[styles.noShift, { color: colors.mutedForeground }]}>No shift</Text> : null}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
          {!weekShifts.length ? (
            <Text selectable style={[styles.emptyText, { color: colors.mutedForeground }]}>No shifts scheduled this week.</Text>
          ) : null}
        </>
      ) : (
        <>
          <Text selectable style={[styles.monthTitle, { color: colors.text }]}> 
            {selectedDate.toLocaleDateString([], { month: "long", year: "numeric" })}
          </Text>
          <View style={styles.weekdayRow}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <Text key={day} style={[styles.weekday, { color: colors.mutedForeground }]}>{day}</Text>
            ))}
          </View>
          <View style={styles.monthGrid}>
            {monthCells.map((day) => {
              const dayEnd = addDays(day, 1);
              const count = shifts.filter((shift) => shift.start < dayEnd && shift.end > day).length;
              const inMonth = day >= monthStart && day <= monthEnd;
              return (
                <Pressable
                  key={day.toISOString()}
                  accessibilityRole="button"
                  accessibilityLabel={dayAccessibilityLabel(day, count)}
                  onPress={() => openDay(day)}
                  style={({ pressed }) => [
                    styles.monthCell,
                    {
                      backgroundColor: count ? colors.primary : "transparent",
                      borderColor: colors.border,
                      opacity: inMonth ? (pressed ? 0.7 : 1) : 0.35,
                    },
                  ]}
                >
                  <Text style={{ color: count ? colors.primaryForeground : colors.text, fontWeight: sameDay(day, selectedDate) || count ? "800" : "500" }}>{day.getDate()}</Text>
                  {count ? <Text style={{ color: colors.primaryForeground, fontSize: 8, fontWeight: "800" }}>{count}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 2, gap: 10, padding: 12 },
  headerRow: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  title: { fontSize: 17, fontWeight: "800" },
  viewToggle: { flexDirection: "row", gap: 6 },
  toggle: { alignSelf: "auto", width: 84 },
  periodLabel: { fontSize: 12, fontWeight: "600" },
  weekRow: { flexDirection: "column", gap: 6, paddingBottom: 4, width: "100%" },
  dayColumn: { alignItems: "stretch", borderRadius: 8, borderWidth: 1, flexDirection: "row", minHeight: 76, overflow: "hidden" },
  dayHeading: { fontSize: 12, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 10, textAlign: "center", textAlignVertical: "center", width: 62 },
  daySchedule: { borderLeftWidth: StyleSheet.hairlineWidth, flex: 1, gap: 3, paddingHorizontal: 7, paddingVertical: 5 },
  timelineLabels: { flexDirection: "row", justifyContent: "space-between" },
  timelineLabel: { fontSize: 8, fontVariant: ["tabular-nums"], fontWeight: "700" },
  timelineTrack: { borderRadius: 5, borderWidth: StyleSheet.hairlineWidth, height: 18, overflow: "hidden", position: "relative" },
  timelineTick: { borderLeftWidth: StyleSheet.hairlineWidth, bottom: 0, position: "absolute", top: 0 },
  timelineSegment: { borderRadius: 4, bottom: 2, minWidth: 3, position: "absolute", top: 2 },
  descriptionList: { gap: 1 },
  shiftDescription: { fontSize: 10, fontVariant: ["tabular-nums"], fontWeight: "700" },
  noShift: { fontSize: 10 },
  emptyText: { paddingVertical: 6, textAlign: "center" },
  monthTitle: { fontSize: 16, fontWeight: "800", textAlign: "center" },
  weekdayRow: { flexDirection: "row" },
  weekday: { flex: 1, fontSize: 11, fontWeight: "700", textAlign: "center" },
  monthGrid: { flexDirection: "row", flexWrap: "wrap" },
  monthCell: { alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, height: 46, justifyContent: "center", width: "14.2857%" },
});

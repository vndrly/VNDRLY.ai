import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WorkCalendar, { monthCalendarDays } from "./work-calendar";
import { localDateKey } from "./calendar-views";

const props = { month: new Date(2026, 9, 1), selectedDay: "2026-10-22", items: [], onSelectDay: vi.fn(), onOpenDay: vi.fn(), scheduling: false, loading: false, unavailable: false, filters: <input aria-label="Employee filter" /> };
describe("iOS-style web work calendar", () => {
  it("includes all 42 local days across month and year boundaries", () => {
    const days = monthCalendarDays(new Date(2027, 0, 1)).map(localDateKey);
    expect(days).toHaveLength(42);
    expect(days[0]).toBe("2026-12-27");
    expect(days[41]).toBe("2027-02-06");
  });
  it("navigates months and selects adjacent days inline without opening a modal", () => {
    function Harness() {
      const [day, setDay] = useState("2026-10-22");
      const date = new Date(`${day}T12:00:00`);
      return <WorkCalendar {...props} selectedDay={day} month={date} onSelectDay={setDay} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { name: "November 2026" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    fireEvent.click(screen.getByRole("button", { name: /Friday, October 23, 2026/ }));
    expect(screen.getByRole("heading", { name: /Friday, October 23 · 0/ })).toBeTruthy();
    expect(props.onOpenDay).not.toHaveBeenCalled();
  });
  it("opens canonical scheduled records and keeps dispatch time distinct from work", () => {
    render(<WorkCalendar {...props} items={[{ id: "r1", kind: "Fleet Run", title: "Test haul", startsAt: new Date(2026, 9, 22, 9).toISOString(), endsAt: null, route: "/fleet/runs/r1", timeBasis: "dispatch_recorded", employeeName: "Test driver", linkedTicketId: 8 }]} />);
    expect(screen.getByRole("link", { name: "Test haul" }).getAttribute("href")).toBe("/fleet/runs/r1");
    expect(screen.getByText(/Test driver · Ticket #8 · Dispatch recorded · no planned time/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Thursday, October 22, 2026, 1 scheduled records/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/End time unspecified/)).toBeTruthy();
  });
  it("does not describe a failed schedule source as an empty day", () => {
    render(<WorkCalendar {...props} unavailable />);
    expect(screen.getByRole("status").textContent).toContain("Some schedules could not load");
    expect(screen.queryByText("No scheduled records for this day.")).toBeNull();
    expect(screen.getByText(/No records available/)).toBeTruthy();
  });
  it("shows actual recorded shift hours without treating an open shift as clocked out", () => {
    render(<WorkCalendar {...props} items={[{ id: "workday-1", workdayId: "clock-1", recordedShift: true, title: "My recorded shift", kind: "Shift", startsAt: new Date(2026, 9, 22, 9).toISOString(), endsAt: null, recordedMilliseconds: 9900000, status: "on_shift" }]} />);
    expect(screen.getByText("Recorded hours: 2h 45m · running")).toBeTruthy();
    expect(screen.getByText(/Recorded shift.*Shift in progress/)).toBeTruthy();
    expect(screen.queryByText(/End time unspecified/)).toBeNull();
    expect(screen.getByRole("button", { name: "View recorded shift" })).toBeTruthy();
  });
  it("only offers scheduling when authorized and retains filters on demand", () => {
    const view = render(<WorkCalendar {...props} />);
    expect(screen.queryByRole("button", { name: "Schedule" })).toBeNull();
    const onSchedule = vi.fn();
    view.rerender(<WorkCalendar {...props} onSchedule={onSchedule} />);
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    expect(onSchedule).toHaveBeenCalledOnce();
    const details = screen.getByText("Filter schedules").closest("details")!;
    expect(details.open).toBe(false);
    expect(within(details).getByLabelText("Employee filter")).toBeTruthy();
  });
});

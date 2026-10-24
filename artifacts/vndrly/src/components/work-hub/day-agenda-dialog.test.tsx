import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DayAgendaDialog from "./day-agenda-dialog";

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ name: "Winchester", primary: "#c9a84c", logoSquareUrl: "/square-logo.png" }),
}));

describe("DayAgendaDialog", () => {
  it("renders the agenda body as a white rounded brand-bordered card", () => {
    render(<DayAgendaDialog open onOpenChange={vi.fn()} day="2099-09-09" items={[]} />);

    const body = screen.getByTestId("day-agenda-content");
    expect(body.className).toContain("bg-white");
    expect(body.className).toContain("rounded-xl");
    expect(body.className).toContain("border-[color:var(--brand-primary)]");
    expect(body.textContent).toContain("Nothing is scheduled for this day.");
  });
  it("uses flyout-only type settings and keeps controls in the shared header", () => {
    render(<DayAgendaDialog open onOpenChange={vi.fn()} day="2099-09-09" items={[
      { id: "m1", kind: "Meeting", title: "Admin meeting", startsAt: "2099-09-09T15:00:00.000Z" },
      { id: "t1", kind: "Task", title: "Inspect gate", startsAt: "2099-09-09T16:00:00.000Z" },
    ]} />);

    const controls = screen.getByTestId("mini-card-dialog-controls");
    expect(screen.getByTestId("mini-card-dialog-header").contains(controls)).toBe(true);
    fireEvent.click(screen.getByTestId("mini-card-dialog-settings"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Tasks" }));

    expect(screen.getByText("Admin meeting")).toBeTruthy();
    expect(screen.queryByText("Inspect gate")).toBeNull();
  });
  it("keeps a recorded shift on its actual calendar day instead of treating its clock ID as a scheduled shift ID", () => {
    render(<DayAgendaDialog open onOpenChange={vi.fn()} day="2026-10-08" items={[{ id: "workday-clock-1", workdayId: "clock-1", recordedShift: true, kind: "Shift", title: "My recorded shift", startsAt: new Date(2026, 9, 8, 9).toISOString(), recordedMilliseconds: 9900000 }]} />);
    const link = screen.getByRole("link", { name: /My recorded shift/ });
    expect(link.getAttribute("href")).toBe("/work-hub/calendar?day=2026-10-08&workday=clock-1");
    expect(link.textContent).toContain("Recorded hours: 2h 45m");
  });
  it("retains the selected employee when reopening a recorded shift from the day agenda", () => {
    render(<DayAgendaDialog open onOpenChange={vi.fn()} day="2026-10-08" items={[{ id: "workday-clock-8", workdayId: "clock-8", workerUserId: 8, recordedShift: true, kind: "Shift", title: "Alex — recorded shift", startsAt: new Date(2026, 9, 8, 9).toISOString(), recordedMilliseconds: 18000000 }]} />);
    expect(screen.getByRole("link", { name: /Alex — recorded shift/ }).getAttribute("href")).toBe("/work-hub/calendar?day=2026-10-08&workday=clock-8&worker=8");
  });
});

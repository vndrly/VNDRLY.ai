import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#111111",
    border: "#555555",
    card: "#242426",
    mutedForeground: "#aaaaaa",
    primary: "#18b9c7",
    primaryForeground: "#ffffff",
    text: "#ffffff",
  }),
}));

vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, accessibilityLabel, accessibilityState }: any) => (
    <button
      aria-label={accessibilityLabel}
      aria-pressed={accessibilityState?.selected}
      onClick={onPress}
    >
      {children}
    </button>
  ),
}));

import WorkHubShiftCalendar from "./WorkHubShiftCalendar";

afterEach(cleanup);

const sunday = new Date(2026, 8, 20, 12);

describe("WorkHubShiftCalendar", () => {
  it("keeps a complete Sunday-through-Saturday week visible when no shifts exist", () => {
    render(<WorkHubShiftCalendar items={[]} initialDate={sunday} />);

    expect(screen.getByRole("button", { name: "Week" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Seven day week").getAttribute("aria-orientation")).toBe("vertical");
    expect(screen.getByLabelText("Sunday, September 20 schedule")).toBeTruthy();
    expect(screen.getByLabelText("Saturday, September 26 schedule")).toBeTruthy();
    for (const day of ["Sun 20", "Mon 21", "Tue 22", "Wed 23", "Thu 24", "Fri 25", "Sat 26"]) {
      expect(screen.getByText(day)).toBeTruthy();
    }
    expect(screen.getByText("No shifts scheduled this week.")).toBeTruthy();
  });

  it("places a scheduled shift in its day with the actual time block", () => {
    const start = new Date(2026, 8, 22, 7, 0);
    const end = new Date(2026, 8, 22, 19, 0);
    render(
      <WorkHubShiftCalendar
        initialDate={sunday}
        items={[{
          id: "shift-1",
          kind: "Shift",
          title: "Main Gate",
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
        }]}
      />,
    );

    const tuesday = screen.getByLabelText("Tuesday, September 22 schedule");
    expect(within(tuesday).getByText("12 AM")).toBeTruthy();
    expect(within(tuesday).getByText("6 AM")).toBeTruthy();
    expect(within(tuesday).getByText("12 PM")).toBeTruthy();
    expect(within(tuesday).getByText("6 PM")).toBeTruthy();
    expect(within(tuesday).getByText("24")).toBeTruthy();
    expect(within(tuesday).getByText("7:00 AM–7:00 PM · Main Gate")).toBeTruthy();
    const segment = within(tuesday).getByLabelText("Main Gate, scheduled 7:00 AM to 7:00 PM");
    expect(segment.getAttribute("style")).toContain("left: 29.166");
    expect(segment.getAttribute("style")).toContain("width: 50%");
  });

  it("splits an overnight shift across the two affected day timelines", () => {
    const start = new Date(2026, 8, 24, 19, 0);
    const end = new Date(2026, 8, 25, 7, 0);
    render(
      <WorkHubShiftCalendar
        initialDate={sunday}
        items={[{
          id: "shift-overnight",
          kind: "Shift",
          title: "Night Gate",
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
        }]}
      />,
    );

    expect(within(screen.getByLabelText("Thursday, September 24 schedule")).getByLabelText("Night Gate, scheduled 7:00 PM to 12:00 AM")).toBeTruthy();
    expect(within(screen.getByLabelText("Friday, September 25 schedule")).getByLabelText("Night Gate, scheduled 12:00 AM to 7:00 AM")).toBeTruthy();
  });

  it("shows scheduled dates in Month view and opens the selected date back in Week view", () => {
    const start = new Date(2026, 8, 23, 18, 0);
    const end = new Date(2026, 8, 24, 2, 0);
    render(
      <WorkHubShiftCalendar
        initialDate={sunday}
        items={[{
          id: "shift-2",
          kind: "Shift",
          title: "Night Gate",
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
        }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(screen.getByText("September 2026")).toBeTruthy();
    const scheduledDate = screen.getByRole("button", { name: "September 23, 1 scheduled shift" });
    expect(scheduledDate.getAttribute("style")).toContain("background-color: rgb(24, 185, 199)");
    fireEvent.click(scheduledDate);

    expect(screen.getByRole("button", { name: "Week" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("6:00 PM–12:00 AM · Night Gate")).toBeTruthy();
    expect(screen.getByText("12:00 AM–2:00 AM · Night Gate")).toBeTruthy();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render as renderComponent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DayAgendaDialog from "./day-agenda-dialog";
import { workHubRequest } from "@/lib/work-hub-client";

vi.mock("@/lib/work-hub-client", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/work-hub-client")>(),
  workHubRequest: vi.fn(),
}));

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ name: "Winchester", primary: "#c9a84c", logoSquareUrl: "/square-logo.png" }),
}));

function render(component: React.ReactNode) {
  return renderComponent(<QueryClientProvider client={new QueryClient()}>{component}</QueryClientProvider>);
}

describe("DayAgendaDialog", () => {
  it("hides the inactive gate and fills only the selected vacant shift", async () => {
    const shift = { id: "am", version: 3, gateStationId: "gate2", date: "2099-09-09", weekday: 3, starts: "06:00", ends: "18:00", timezone: "America/Chicago", required: 1, assignees: [] };
    vi.mocked(workHubRequest).mockImplementation(async (path, options) => {
      if (path.startsWith("/gate-shift-definitions")) return { gates: [{ id: "gate2" }] };
      if (options?.method === "POST") return {};
      return { shifts: [shift, { ...shift, id: "pm", assignees: [8] }], people: [{ id: 7, name: "Xavier Hunter" }], busy: [], readOnly: false };
    });
    render(<DayAgendaDialog open onOpenChange={vi.fn()} day="2099-09-09" staffingOwner={{ type: "vendor", id: 1054 }} items={[
      { id: "closed", kind: "Shift", title: "Gate 1 AM", gateStationId: "gate1", siteLocationId: 411, startsAt: "2099-09-09T11:00:00Z" },
      { id: "am", kind: "Shift", title: "Gate 2 AM", gateStationId: "gate2", siteLocationId: 411, startsAt: "2099-09-09T11:00:00Z" },
      { id: "pm", kind: "Shift", title: "Gate 2 PM", gateStationId: "gate2", siteLocationId: 411, startsAt: "2099-09-09T23:00:00Z" },
    ]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Fill", exact: true }));
    expect(screen.queryByText("Gate 1 AM")).toBeNull();
    expect(screen.getByText("Gate 2 PM")).toBeTruthy();
    fireEvent.change(await screen.findByLabelText("Gatekeeper"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign 1 shift" }));
    await waitFor(() => expect(screen.getByText("Assignment saved.")).toBeTruthy());
    const [, options] = vi.mocked(workHubRequest).mock.calls.find(([path]) => path.endsWith("/assign"))!;
    expect(JSON.parse(String(options?.body)).payload.changes).toEqual([{ id: "am", version: 3, addUserId: 7 }]);
  });
  it("renders the agenda body as a charcoal rounded brand-bordered card", () => {
    render(<DayAgendaDialog open onOpenChange={vi.fn()} day="2099-09-09" items={[]} />);

    const body = screen.getByTestId("day-agenda-content");
    expect(body.className).toContain("bg-[#303236]");
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

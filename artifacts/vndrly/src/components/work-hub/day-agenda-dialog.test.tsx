import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DayAgendaDialog from "./day-agenda-dialog";

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ name: "Winchester", primary: "#c9a84c", logoSquareUrl: "/square-logo.png" }),
}));

describe("DayAgendaDialog", () => {
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
});
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import CalendarSummaryCards from "./calendar-summary-cards";

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({
    name: "Winchester",
    primary: "#c9a84c",
    logoUrl: "/wide-logo.png",
    logoSquareUrl: "/square-logo.png",
  }),
}));

function renderCards(props: React.ComponentProps<typeof CalendarSummaryCards> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CalendarSummaryCards {...props} />
    </QueryClientProvider>,
  );
}

describe("CalendarSummaryCards flyouts", () => {
  it.each([
    "My next shift",
    "Next meeting",
    "Tasks due soon",
    "Unread conversations",
  ])("uses the Ask V-style header controls and square company logo for %s", (title) => {
    const view = renderCards();
    fireEvent.click(screen.getByRole("button", { name: `Open ${title}` }));

    const header = screen.getByTestId("mini-card-dialog-header");
    const controls = screen.getByTestId("mini-card-dialog-controls");
    expect(header.contains(controls)).toBe(true);
    expect(controls.querySelector('[data-testid="mini-card-dialog-settings"]')).toBeTruthy();
    expect(controls.querySelector('[data-testid="mini-card-dialog-close"]')).toBeTruthy();
    const logo = screen.getByTestId("mini-card-dialog-logo").querySelector("img");
    expect(logo?.getAttribute("src")).toBe("/square-logo.png");

    fireEvent.click(screen.getByTestId("mini-card-dialog-settings"));
    expect(screen.getByTestId("mini-card-dialog-settings-panel")).toBeTruthy();
    view.unmount();
  });

  it("grows for records but displays no more than the next ten meetings", () => {
    const meetings = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      title: `Meeting ${index + 1}`,
      startsAt: new Date(Date.now() + (index + 1) * 3_600_000).toISOString(),
    }));
    renderCards({ meetings });
    fireEvent.click(screen.getByRole("button", { name: "Open Next meeting" }));

    expect(screen.getAllByTestId("calendar-summary-item")).toHaveLength(10);
    expect(screen.queryByText("Meeting 11")).toBeNull();
    expect(screen.getByText("View all")).toBeTruthy();
  });

  it("orders urgent tasks before nearer non-urgent tasks", () => {
    renderCards({ tasks: [
      { id: 1, title: "Normal task", startsAt: new Date(Date.now() + 3_600_000).toISOString(), status: "open" },
      { id: 2, title: "Safety task", startsAt: new Date(Date.now() + 7_200_000).toISOString(), status: "open", priority: "urgent" },
    ] });
    fireEvent.click(screen.getByRole("button", { name: "Open Tasks due soon" }));

    expect(screen.getAllByTestId("calendar-summary-item")[0]?.textContent).toContain("Urgent · Safety task");
  });
});
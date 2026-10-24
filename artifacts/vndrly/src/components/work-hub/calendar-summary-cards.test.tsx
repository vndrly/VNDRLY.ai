vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, activeMembershipId: 1 } }) }));
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
  it("keeps all four cards while distinguishing failed sources from empty schedules", () => {
    renderCards({ scheduleUnavailable: true, channelsUnavailable: true });
    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Open My next shift" }));
    expect(screen.getByRole("status").textContent).toContain("This source could not load");
    expect(screen.queryByText("No matching records right now.")).toBeNull();
  });
  it.each([
    "My next shift",
    "Next meeting",
    "Tasks due soon",
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
  it("expands unread chats with individual counters and collapses without marking them read", () => {
    renderCards({ channels: [{ id: "crew", name: "Gate crew", unreadCount: 4 }, { id: "office", name: "Office", unreadCount: 2 }, { id: "read", name: "Already read", unreadCount: 0 }] });
    const toggle = screen.getByRole("button", { name: /Unread conversations\s*6/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: /Gate crew/ })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const chat = screen.getByRole("button", { name: /Gate crew\s*4 unread messages/ });
    expect(chat.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /Office\s*2 unread messages/ })).toBeTruthy();
    expect(screen.queryByText("Already read")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.queryByRole("link", { name: /Gate crew/ })).toBeNull();
  });
  it("shows an empty unread list distinctly from a failed source", () => {
    const view = renderCards();
    fireEvent.click(screen.getByRole("button", { name: /Unread conversations\s*0/ }));
    expect(screen.getByRole("status").textContent).toBe("No unread conversations.");
    view.unmount();
    renderCards({ channelsUnavailable: true });
    fireEvent.click(screen.getByRole("button", { name: /Unread conversations\s*Unavailable/ }));
    expect(screen.getByRole("status").textContent).toBe("Conversations could not load.");
  });
});

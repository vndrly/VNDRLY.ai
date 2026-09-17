import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarSummaryCards from "./calendar-summary-cards";

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({
    name: "Winchester",
    primary: "#c9a84c",
    logoUrl: "/wide-logo.png",
    logoSquareUrl: "/square-logo.png",
  }),
}));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("CalendarSummaryCards flyout headers", () => {
  it.each([
    "My next shift",
    "Next meeting",
    "Tasks due soon",
    "Unread conversations",
  ])("uses the Ask V-style header and square company logo for %s", (title) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <CalendarSummaryCards />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: `Open ${title}` }));

    expect(screen.getByTestId("mini-card-dialog-header")).toBeTruthy();
    const logo = screen.getByTestId("mini-card-dialog-logo").querySelector("img");
    expect(logo?.getAttribute("src")).toBe("/square-logo.png");

    view.unmount();
  });
});

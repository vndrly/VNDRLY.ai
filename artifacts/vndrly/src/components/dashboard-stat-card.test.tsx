import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { FileText } from "lucide-react";
import { describe, expect, it } from "vitest";

import DashboardStatCard from "./dashboard-stat-card";

describe("DashboardStatCard", () => {
  it("opens a drilldown and links to the matching filtered page", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DashboardStatCard
        icon={FileText}
        label="Total Tracking"
        value={0}
        definition="Tickets visible to your company."
        destination="/tickets"
        iconColor="#0f7490"
        testId="card-stat-total-tracking"
      />
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "View Total Tracking details" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByTestId("mini-card-dialog-header")).toBeTruthy();
    expect(screen.getByTestId("mini-card-dialog-logo")).toBeTruthy();
    expect(screen.getByTestId("modal-accent-header").getAttribute("style")).toContain("height: 118px");
    expect(screen.getByText("Tickets visible to your company.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View all" }).getAttribute("href")).toBe("/tickets");
  });
});

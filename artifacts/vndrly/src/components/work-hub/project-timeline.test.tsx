import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ProjectTimeline from "./project-timeline";

describe("ProjectTimeline", () => {
  it("shows actionable milestone context and permission-filtered finance details", async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProjectTimeline
        canManage
        onCreate={vi.fn()}
        items={[{
          id: "milestone-1",
          calendarType: "project",
          projectName: "Gate rollout",
          title: "Commission west gate",
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 3_600_000).toISOString(),
          milestoneStatus: "in_progress",
          percentComplete: 40,
          ownerDisplayName: "Jordan Lee",
          instructions: "Verify the badge reader and visitor lane.",
          dependencyTitle: "Electrical inspection",
          blockers: "Waiting on access cards",
          ticketNumber: "100001",
          afeCode: "AFE-42",
          budgetAmount: "10000.00",
          budgetUsedAmount: "2500.00",
          invoicedAmount: "1200.00",
          invoiceReference: "INV-9",
        }]}
      />,
    </QueryClientProvider>);

    expect(screen.getByText("Jordan Lee")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Preview Commission west gate" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Waiting on access cards")).toBeTruthy();
    expect(screen.getByText("100001")).toBeTruthy();
    expect(screen.getByText("$10,000.00")).toBeTruthy();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
const api = vi.hoisted(() => ({
  billingOptions: vi.fn(),
  billingTicket: vi.fn(),
  finalizeBillingTicket: vi.fn(),
}));
vi.mock("@/lib/fleet-client", () => ({ fleetClient: api }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("./png-pill-rollover", () => ({
  PngPillButton: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));
import {
  FleetRunBillingFields,
  FleetBillingTicketPanel,
  type FleetBillingDraft,
} from "./fleet-billing";
const options = {
  workTypes: [{ id: 3, name: "Equipment hauling", rateCents: 12500 }],
  tickets: [
    {
      id: 123,
      ticketNumber: 123,
      siteId: 9,
      afeNumber: "AFE-9",
      workDate: "2026-10-16",
      planVersion: 2,
    },
  ],
  afeRequired: true,
  siteAfe: "AFE-9",
};
const ticket = {
  ticketId: 123,
  siteId: 9,
  partnerId: 2,
  status: "initiated",
  afeNumber: "AFE-9",
  workDate: "2026-10-16",
  plan: { version: 2, closedAt: null },
  charges: { runs: 2, total: "250.00" },
  runs: [{ id: "run1", title: "Delivery 1", status: "completed", version: 3 }],
  canFinalize: true,
  finalizationOperationId: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  api.billingOptions.mockResolvedValue(options);
  api.billingTicket.mockResolvedValue(ticket);
});
const mount = (element: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {element}
    </QueryClientProvider>,
  );
function Form() {
  const [value, setValue] = useState<FleetBillingDraft>({
    mode: "new_ticket",
    workTypeId: "",
    ticketId: "",
    afeNumber: "AFE-9",
    workDate: "2026-10-16",
  });
  return (
    <>
      <FleetRunBillingFields
        siteId={9}
        identity="vendor7"
        value={value}
        onChange={setValue}
        disabled={false}
      />
      <output>{JSON.stringify(value)}</output>
    </>
  );
}
it("offers a new canonical ticket or eligible existing ticket for the exact billing context", async () => {
  mount(<Form />);
  await screen.findByRole("option", { name: /Equipment hauling/ });
  fireEvent.change(screen.getByLabelText("Billing service"), {
    target: { value: "3" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add run to ticket" }));
  fireEvent.change(screen.getByLabelText("Open ticket"), {
    target: { value: "123" },
  });
  expect(screen.getByText(/same billing site, AFE and work date/)).toBeTruthy();
  expect(screen.getByText(/"ticketId":"123"/)).toBeTruthy();
  expect(api.billingOptions).toHaveBeenCalledWith(
    9,
    "AFE-9",
    "2026-10-16",
    undefined,
  );
});
it("shows an actionable empty list without allowing an unlinked run", async () => {
  api.billingOptions.mockResolvedValue({ ...options, tickets: [] });
  mount(<Form />);
  fireEvent.click(screen.getByRole("button", { name: "Add run to ticket" }));
  await screen.findByText(/No eligible open ticket/);
  expect(
    screen.getByRole("button", { name: "Run as new ticket" }),
  ).toBeTruthy();
});
it("lets dispatch choose a service while financial amounts stay hidden", async () => {
  api.billingOptions.mockResolvedValue({
    ...options,
    workTypes: [
      {
        id: 3,
        name: "Equipment hauling",
        unit: "per_hour",
        afeNumber: "AFE-9",
      },
    ],
  });
  mount(<Form />);
  const service = await screen.findByRole("option", {
    name: /Equipment hauling/,
  });
  expect(service.textContent).toContain("/ hour");
  expect(service.textContent).not.toMatch(/\$|NaN|undefined/);
  fireEvent.change(screen.getByLabelText("Billing service"), {
    target: { value: "3" },
  });
  expect(screen.getByText(/"workTypeId":"3"/)).toBeTruthy();
});
it("uses the selected service assignment AFE instead of the site default", async () => {
  api.billingOptions.mockResolvedValue({
    ...options,
    workTypes: [{ ...options.workTypes[0], afeNumber: "ASSIGNMENT-123" }],
  });
  mount(<Form />);
  await screen.findByRole("option", { name: /Equipment hauling/ });
  fireEvent.change(screen.getByLabelText("Billing service"), {
    target: { value: "3" },
  });
  await waitFor(() =>
    expect((screen.getByLabelText("AFE") as HTMLInputElement).value).toBe(
      "ASSIGNMENT-123",
    ),
  );
  expect(
    ((await screen.findByLabelText("Billing service")) as HTMLSelectElement)
      .value,
  ).toBe("3");
});
it("requires review before finalization and verifies canonical submission after an exact retry", async () => {
  api.finalizeBillingTicket
    .mockRejectedValueOnce(new Error("Lost response"))
    .mockImplementationOnce(async (_id, input) => {
      api.billingTicket.mockResolvedValue({
        ...ticket,
        status: "submitted",
        plan: { version: 3, closedAt: "2026-10-16T12:00:00Z" },
        finalizationOperationId: input.operationId,
        canFinalize: false,
      });
      return {
        ticketId: 123,
        status: "submitted",
        operationId: input.operationId,
      };
    });
  mount(<FleetBillingTicketPanel ticketId={123} identity="vendor7" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Review ticket submission" }),
  );
  expect(api.finalizeBillingTicket).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Finalize and submit ticket #123" }),
  );
  await screen.findByText(/Submission was not confirmed/);
  const first = api.finalizeBillingTicket.mock.calls[0][1];
  fireEvent.click(
    screen.getByRole("button", { name: "Retry exact submission" }),
  );
  await screen.findByText("Ticket #123 submitted. Saved status verified.");
  expect(api.finalizeBillingTicket.mock.calls[1][1]).toEqual(first);
});
it("keeps an office ticket open while a run awaits review", async () => {
  api.billingTicket.mockResolvedValue({
    ...ticket,
    canFinalize: false,
    runs: [{ ...ticket.runs[0], status: "submitted_for_review" }],
  });
  mount(<FleetBillingTicketPanel ticketId={123} identity="vendor7" />);
  await screen.findByText(/Awaiting office review/);
  expect(
    screen.queryByRole("button", { name: "Review ticket submission" }),
  ).toBeNull();
});

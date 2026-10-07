import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ siteChoices: vi.fn(), siteActivity: vi.fn() }));
vi.mock("@/lib/fleet-client", () => ({ fleetClient: api }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
import { FleetSiteActivityPanel } from "./fleet-site-activity";
beforeEach(() => {
  vi.resetAllMocks();
  api.siteChoices.mockResolvedValue({
    sites: [{ siteId: 9, name: "Own site" }],
    capabilities: {
      canReadSiteActivity: true,
      canDispatch: false,
      canDrive: false,
    },
  });
  api.siteActivity.mockResolvedValue({
    siteId: 9,
    siteName: "Own site",
    window: {
      startsAt: "2026-10-01T00:00:00Z",
      endsAt: "2026-10-07T00:00:00Z",
      dateBasis: "run_created_at",
    },
    source: "recorded_fleet_events",
    coordinateDisclosure: false,
    records: [
      {
        runId: "run-1",
        vendorName: "Authorized vendor",
        status: "completed",
        stops: [
          {
            stopId: "stop-1",
            kind: "delivery",
            events: [
              {
                type: "arrive_stop",
                recordedAt: "2026-10-06T12:00:00Z",
                capturedAt: null,
                source: "user_report",
              },
            ],
          },
        ],
        loads: [
          {
            loadId: "load-1",
            commodity: "Water",
            quantity: 10,
            unit: "barrels",
            direction: "delivery",
            delivered: true,
          },
        ],
      },
    ],
    unavailableMetrics: ["costs_unavailable"],
  });
});
function show() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FleetSiteActivityPanel identity="partner:7" />
    </QueryClientProvider>,
  );
}
it("reads only an explicit authorized site and separates reported and accepted events", async () => {
  show();
  await screen.findByRole("option", { name: "Own site" });
  expect(api.siteActivity).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "9" } });
  await screen.findByText("Authorized vendor · completed");
  expect(api.siteActivity).toHaveBeenCalledWith(9, {});
  expect(screen.getByText(/Accepted by server:/).textContent).toContain(
    "Reported event time: Not recorded",
  );
  expect(screen.getByText(/Water · 10 barrels/).textContent).toContain(
    "Delivery reported",
  );
  expect(
    screen.queryByRole("button", { name: /Dispatch|Start run/ }),
  ).toBeNull();
});
it("removes prior activity when current site read is denied", async () => {
  show();
  await screen.findByRole("option", { name: "Own site" });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "9" } });
  await screen.findByText("Authorized vendor · completed");
  api.siteActivity.mockRejectedValue(new Error("revoked"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() =>
    expect(
      screen.queryByText("Authorized vendor · completed"),
    ).toBeNull(),
  );
  expect(screen.getByRole("alert").textContent).toContain("unavailable");
});

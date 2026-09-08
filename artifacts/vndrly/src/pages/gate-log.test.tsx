import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverPolyfill;
}

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: {
      userId: 70,
      role: "vendor",
      vendorRole: "office",
      vendorId: 11,
      partnerId: null,
      displayName: "Office",
    },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ isOrgBranded: false, primary: "#f59e0b" }),
}));

vi.mock("@/hooks/use-gate-live-monitor", () => ({
  useGateLiveMonitor: () => ({
    flash: null,
    liveStatus: "live",
    dismissFlash: () => {},
  }),
}));

vi.mock("@/components/sphere-back-button", () => ({
  default: () => React.createElement("span", { "data-testid": "stub-back" }),
}));

vi.mock("@/components/live-connection-pill", () => ({
  LiveConnectionPill: () => React.createElement("span", { "data-testid": "stub-live-pill" }),
}));

vi.mock("@/lib/visits-api", () => ({
  visitsApi: {
    gateOps: vi.fn(),
  },
}));

import { visitsApi } from "@/lib/visits-api";
import GateLogPage from "./gate-log";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client }, React.createElement(GateLogPage)),
  );
}

describe("Gate Log page", () => {
  beforeEach(() => {
    vi.mocked(visitsApi.gateOps).mockResolvedValue({
      enabled: true,
      visits: [
        {
          id: 1,
          firstName: "Pat",
          lastName: "Visitor",
          company: "Acme Pump",
          phone: null,
          email: null,
          vehiclePlate: "OK-GATE1",
          plateState: "OK",
          platePhotoUrl: null,
          vehiclePhotoUrl: null,
          purpose: "Delivery",
          expectedDurationMinutes: 60,
          hostType: "partner",
          hostPartnerId: 1,
          hostVendorId: null,
          hostPartnerName: "Flywheel Energy",
          hostVendorName: null,
          siteLocationId: 10,
          siteName: "Flywheel Energy Spur",
          siteCode: "SITE-B40D77D2",
          checkInTime: "2026-08-25T14:00:00.000Z",
          checkOutTime: "2026-08-25T15:00:00.000Z",
          autoCheckedOut: false,
          checkInLatitude: null,
          checkInLongitude: null,
        },
        {
          id: 2,
          firstName: "Sam",
          lastName: "Visitor",
          company: "Solo Trucking",
          phone: null,
          email: null,
          vehiclePlate: "OK-SOLO",
          plateState: null,
          platePhotoUrl: null,
          vehiclePhotoUrl: null,
          purpose: "Haul",
          expectedDurationMinutes: 30,
          hostType: "partner",
          hostPartnerId: 1,
          hostVendorId: null,
          hostPartnerName: "Flywheel Energy",
          hostVendorName: null,
          siteLocationId: 10,
          siteName: "Flywheel Energy Spur",
          siteCode: "SITE-B40D77D2",
          checkInTime: "2026-08-25T14:10:00.000Z",
          checkOutTime: null,
          autoCheckedOut: false,
          checkInLatitude: null,
          checkInLongitude: null,
        },
      ],
      staff: [
        {
          employeeId: 7,
          userId: 70,
          firstName: "Riley",
          lastName: "Gate",
          vendorName: "Winchester",
        },
      ],
      recordedVisits: [
        {
          recordedByUserId: 70,
          checkInTime: "2026-08-25T13:00:00.000Z",
          checkOutTime: "2026-08-25T17:00:00.000Z",
        },
      ],
      checkIns: [
        {
          employeeId: 7,
          checkInAt: "2026-08-25T12:00:00.000Z",
          checkOutAt: "2026-08-25T18:00:00.000Z",
        },
      ],
    });
  });

  it("shows live visitors, staff hours, search, charts, and recommendations", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("gate-log-on-site")).toBeTruthy());
    expect(screen.getByTestId("gate-log-on-site").textContent).toContain("Sam Visitor");
    expect(screen.getByTestId("gate-log-staff").textContent).toContain("Riley Gate");
    expect(screen.getByTestId("gate-log-staff").textContent).toContain("Winchester");
    expect(screen.getByTestId("gate-log-recommendations").textContent).toContain("Awaiting admission: 0");
    expect(screen.getByTestId("gate-log-recommendations").textContent).toContain("Overdue: 1");
    expect(screen.getByTestId("gate-log-visits-by-day")).toBeTruthy();
    expect(screen.getByTestId("gate-log-top-companies").textContent).toContain("Acme Pump");
    expect(screen.getByTestId("gate-log-history").textContent).toContain("OK • OK-GATE1");
    expect(screen.getByTestId("gate-log-history").textContent).toContain("Unconfirmed state");

    fireEvent.change(screen.getByTestId("gate-log-search"), { target: { value: "solo" } });
    expect(screen.getAllByTestId("gate-log-history-row")).toHaveLength(1);
    expect(screen.getByTestId("gate-log-history").textContent).toContain("Sam Visitor");
    expect(screen.getByTestId("gate-log-history").textContent).not.toContain("Pat Visitor");
  });
});

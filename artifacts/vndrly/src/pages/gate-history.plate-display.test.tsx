import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const listAllVisits = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/content-pane-back-link", () => ({
  default: () => React.createElement("a", { href: "/gate" }, "Back"),
}));
vi.mock("@/lib/visits-api", () => ({ listAllVisits }));

import GateHistoryPage from "./gate-history";

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("GateHistoryPage plate display", () => {
  it("renders the state-qualified plate in the history row", async () => {
    window.history.replaceState({}, "", "/gate/history?siteLocationId=42");
    listAllVisits.mockResolvedValue([{
      id: 88,
      firstName: "Taylor",
      lastName: "Reed",
      company: "Acme",
      phone: null,
      email: null,
      vehiclePlate: "ABC123",
      plateState: "TX",
      platePhotoUrl: null,
      vehiclePhotoUrl: null,
      purpose: "Delivery",
      expectedDurationMinutes: 60,
      hostType: "partner",
      hostPartnerId: 7,
      hostVendorId: null,
      hostPartnerName: "Acme Partner",
      hostVendorName: null,
      siteLocationId: 42,
      siteName: "Acme HQ",
      checkInTime: "2026-08-27T12:00:00Z",
      checkOutTime: null,
      autoCheckedOut: false,
      checkInLatitude: null,
      checkInLongitude: null,
    }]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <GateHistoryPage />
      </QueryClientProvider>,
    );

    expect((await screen.findByTestId("gate-history-row")).textContent).toContain("TX • ABC123");
    expect(listAllVisits).toHaveBeenCalledWith({
      from: expect.any(String),
      siteLocationId: 42,
    });
  });
});

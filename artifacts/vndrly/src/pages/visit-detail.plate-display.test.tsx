import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const getVisit = vi.hoisted(() => vi.fn());
const setEntryCategory = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 88, entryCategory: "vendor_admin" }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 1, role: "partner", partnerId: 7 } }) }));
vi.mock("@/components/png-pill-rollover", () => ({ PngPillButton: ({ color: _color, children, ...props }: any) => <button {...props}>{children}</button> }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href }, children),
}));
vi.mock("@/lib/visits-api", () => ({ visitsApi: { get: getVisit, setEntryCategory } }));

import VisitDetailPage from "./visit-detail";

describe("VisitDetailPage plate display", () => {
  it("renders the state-qualified plate in the visit details", async () => {
    getVisit.mockResolvedValue({
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
      sitePartnerId: 7,
      checkOutLatitude: null,
      checkOutLongitude: null,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <VisitDetailPage id="88" />
      </QueryClientProvider>,
    );

    expect((await screen.findByTestId("visit-detail")).textContent).toContain("TX • ABC123");
    fireEvent.change(screen.getByLabelText("gateReport.category"), { target: { value: "vendor_admin" } });
    fireEvent.click(screen.getByRole("button", { name: "gateReport.saveCategory" }));
    await waitFor(() => expect(setEntryCategory).toHaveBeenCalledWith(88, "vendor_admin"));
  });
});

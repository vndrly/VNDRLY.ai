import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { role: "partner" } }) }));
vi.mock("@/components/ticket-submitted-proof", async (original) => ({
  ...await original<typeof import("@/components/ticket-submitted-proof")>(),
  useSubmittedProof: () => ({ data: { jobId: null, revision: 0, approvedRevision: null, submissions: [] }, isFetching: false, isError: false }),
}));

const completeTicket = {
  id: 42,
  siteLocationId: 7,
  status: "funds_dispersed",
  siteName: "Wolfcamp 7H",
  vendorName: "Winchester Services",
  workTypeName: "Flowback",
  fieldEmployeeName: "Randy Reyes",
  partnerName: "Baker Energy",
  description: "Flowback support",
  notes: "No issues",
  checkInTime: "2026-08-17T14:00:00.000Z",
  checkOutTime: "2026-08-17T18:30:00.000Z",
  checkInLatitude: 31.997,
  checkInLongitude: -102.077,
  checkOutLatitude: 31.998,
  checkOutLongitude: -102.078,
  siteLatitude: 31.9972,
  siteLongitude: -102.0772,
  siteRadiusMeters: 500,
  startingMileage: "10234.1",
  endingMileage: "10288.6",
  approvedAt: "2026-08-17T20:00:00.000Z",
  paymentDispersedAt: "2026-08-18T15:00:00.000Z",
  paymentMethod: "ach",
  paymentReference: "ACH-9911",
  paymentNote: "Paid",
  paymentDispersedByName: "AP User",
};

vi.mock("@workspace/api-client-react", () => ({
  useGetTicket: () => ({ data: completeTicket, isLoading: false, isError: false }),
  getGetTicketQueryKey: (id: number) => ["ticket", id],
  useGetSiteLocation: () => ({
    data: { id: 7, partnerId: 5, address: "100 Lease Road", state: "TX" },
    isLoading: false,
  }),
  getGetSiteLocationQueryKey: (id: number) => ["site-location", id],
  useGetPartner: () => ({
    data: { id: 5, name: "Baker Energy", primaryColor: "#123456", accentColor: "#c77818" },
    isLoading: false,
  }),
  getGetPartnerQueryKey: (id: number) => ["partner", id],
  useGetTicketLineItems: () => ({
    data: [
      { id: 1, type: "labor_regular", description: "Labor", quantity: "4.5", unitPrice: "125.00" },
      { id: 2, type: "parts", description: "Valve", quantity: "2", unitPrice: "35.00" },
    ],
  }),
  getGetTicketLineItemsQueryKey: (id: number) => ["ticket-line-items", id],
  useGetTaxRateByState: () => ({ data: { state: "TX", rate: "0.0825" }, isLoading: false }),
  getGetTaxRateByStateQueryKey: (state: string) => ["tax-rate", state],
}));

import PrintTicketPage from "./print-ticket";

beforeEach(() => {
  Object.defineProperty(window, "print", {
    configurable: true,
    value: vi.fn(),
  });
});

describe("PrintTicketPage proof packet", () => {
  it("renders the Proof-to-Pay evidence summary", () => {
    render(<PrintTicketPage id={42} />);

    expect(screen.getByTestId("proof-packet-summary").textContent).toContain(
      "Proof-to-Pay Packet",
    );
    expect(screen.getByTestId("proof-packet-progress").textContent).toContain("5 of 5");
    expect(screen.getByTestId("proof-packet-gps_time").textContent).toContain("GPS / Time");
    expect(screen.getByTestId("proof-packet-field_notes").textContent).toContain("Field Notes");
    expect(screen.getByTestId("proof-packet-mileage").textContent).toContain("54.5 mi logged");
    expect(screen.getByTestId("proof-packet-cost").textContent).toContain("$632.50 captured");
    expect(screen.getByTestId("proof-packet-payment").textContent).toContain("Payment record");
  });
});

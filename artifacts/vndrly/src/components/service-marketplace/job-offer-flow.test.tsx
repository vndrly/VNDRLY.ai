import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  MarketplaceRankedVendor,
  MarketplaceJobOffer,
} from "@workspace/api-client-react";
import JobOfferComposer from "./JobOfferComposer";
import VendorJobOfferInbox from "./VendorJobOfferInbox";
import JobOfferSummary from "./JobOfferSummary";
import i18n from "@/lib/i18n";

const navigate = vi.fn();
vi.mock("wouter", () => ({ useLocation: () => ["/vendor-catalog", navigate] }));
const vendor = {
  vendorId: 2,
  vendorName: "Test vendor",
  capabilityId: 4,
  offerable: true,
  offer: { id: 5, currency: "USD", unitPrice: 100, unit: "hour" },
  eligibility: { eligible: true, facts: { availableCapacity: 3 } },
} as MarketplaceRankedVendor;
const offer = {
  id: 8,
  partnerId: 1,
  vendorId: 2,
  workTypeId: 3,
  siteLocationId: 6,
  vendorCapabilityId: 4,
  vendorPartnerServiceOfferId: 5,
  canonicalServiceId: 7,
  scope: "Pressure test",
  crewCount: 2,
  status: "offered",
  version: 2,
  scheduledStartAt: "2026-11-01T10:00:00Z",
  scheduledEndAt: "2026-11-01T12:00:00Z",
  expiresAt: "2026-10-31T10:00:00Z",
  commercialSnapshot: {
    unitPrice: "125.00",
    unit: "hour",
    currency: "USD",
    commercialConditions: "Two-hour minimum",
  },
};
let requests: { path: string; body: any; headers: Headers; method: string }[];
let stale: boolean;
let client: QueryClient;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  requests = [];
  stale = false;
  navigate.mockReset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
      const path = String(url);
      const method = options?.method ?? "GET";
      requests.push({
        path,
        body: options?.body ? JSON.parse(String(options.body)) : null,
        headers: new Headers(options?.headers),
        method,
      });
      if (path.endsWith("/accept"))
        return stale
          ? Response.json({ code: "marketplace.stale_offer" }, { status: 409 })
          : Response.json({ offerId: 8, ticketId: 123, replayed: false });
      if (path.endsWith("/send")) return Response.json(offer);
      if (path.endsWith("/review"))
        return Response.json({
          ...offer,
          status: "vendor_reviewing",
          version: 3,
        });
      if (path.endsWith("/job-offers") && method === "POST")
        return Response.json({ ...offer, version: 1, status: "draft" });
      if (path.endsWith("/job-offers/8")) return Response.json(offer);
      return Response.json({ items: [offer] });
    }),
  );
});
afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
});
const mount = (component: React.ReactNode) =>
  render(
    <QueryClientProvider client={client}>{component}</QueryClientProvider>,
  );

it("shows manual billing and every additional commercial component before confirmation", () => {
  mount(
    <JobOfferSummary
      offer={
        {
          ...offer,
          commercialSnapshot: {
            unitPrice: "500",
            currency: "CAD",
            unit: "day",
            automaticBilling: "manual_billing_required",
            rateComponents: { mobilization: "100" },
          },
        } as MarketplaceJobOffer
      }
    />,
  );
  expect(screen.getByText(/Manual billing is required/)).toBeTruthy();
  expect(screen.getByText(/mobilization/)).toBeTruthy();
  expect(screen.getByText(/CAD 500.00/)).toBeTruthy();
});
describe("confirmed offer flow", () => {
  it("prepares authoritative saved terms and only sends after explicit confirmation", async () => {
    mount(
      <JobOfferComposer
        partnerId={1}
        workTypeId={3}
        siteLocationId={6}
        vendor={vendor}
        initialStartAt="2026-11-01T10:00"
        initialEndAt="2026-11-01T12:00"
        crewCount={2}
      />,
    );
    fireEvent.change(screen.getByLabelText("Scope of work"), {
      target: { value: "Pressure test" },
    });
    fireEvent.change(screen.getByLabelText("Offer expires"), {
      target: { value: "2026-10-31T10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prepare draft" }));
    await screen.findByRole("region", { name: "Confirm job offer" });
    expect(screen.getByText("USD 125.00 / hour")).toBeTruthy();
    expect(requests.some((row) => row.path.endsWith("/send"))).toBe(false);
    expect(requests[0].headers.get("Idempotency-Key")).toBeTruthy();
    expect(requests[0].body).not.toHaveProperty("unitPrice");
    fireEvent.click(screen.getByRole("button", { name: "Confirm and send" }));
    await screen.findByText("Job offer sent.");
    expect(requests.find((row) => row.path.endsWith("/send"))?.body).toEqual({
      version: 1,
    });
  });
  it("requires a fresh acceptance summary and follows the canonical ticket", async () => {
    mount(<VendorJobOfferInbox vendorId={2} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Review offer" }),
    );
    await screen.findByRole("region", { name: "Confirm acceptance" });
    expect(requests.some((row) => row.path.endsWith("/accept"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Confirm and accept" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/tickets/123"));
    expect(requests.find((row) => row.path.endsWith("/accept"))?.body).toEqual({
      version: 3,
    });
    expect(
      requests
        .find((row) => row.path.endsWith("/accept"))
        ?.headers.get("Idempotency-Key"),
    ).toBeTruthy();
  });
  it("disables a rejected stale confirmation and refreshes saved facts", async () => {
    stale = true;
    mount(<VendorJobOfferInbox vendorId={2} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Review offer" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm and accept" }),
    );
    await screen.findByRole("alert");
    expect(
      screen.queryByRole("button", { name: "Confirm and accept" }),
    ).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        requests.filter((row) => row.path.includes("/vendors/2/job-offers")),
      ).toHaveLength(2),
    );
  });
});

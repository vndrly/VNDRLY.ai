import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import en from "../../lib/locales/en.json";
import type {
  MarketplaceCapability,
  MarketplaceDemand,
  MarketplaceJobOffer,
  MarketplaceRankedVendor,
} from "@workspace/api-client-react";

const state = vi.hoisted(() => ({
  user: {
    id: 1,
    role: "vendor",
    vendorId: 2,
    partnerId: null,
    vendorRole: "admin",
    activeMembershipId: 1,
  } as Record<string, unknown>,
  push: vi.fn(),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: state.user, isLoading: false }),
}));
vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ primary: "#3260CD", name: "VNDRLY" }),
}));
vi.mock("expo-router", () => ({
  router: { push: state.push, back: vi.fn() },
  Stack: { Screen: () => null },
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => globalThis.crypto.randomUUID(),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

import ServiceMarketplace from "../service-marketplace";

const capability: MarketplaceCapability = {
  id: 3,
  vendorId: 2,
  name: "Gate Services",
  description: "Entry control",
  capacity: 4,
  active: true,
  defaultUnit: "per_hour",
  defaultRateCard: { unitPrice: 50, unit: "per_hour", currency: "USD" },
  mapping: {
    canonicalServiceId: 7,
    canonicalServiceName: "Gate security",
    status: "active",
    explanation: "Controlled entry matches",
    confidence: 0.99,
  },
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
const eligibility = {
  eligible: true,
  reasonCodes: [],
  facts: {
    distanceMiles: 40,
    radiusMiles: 500,
    availableCapacity: 4,
    requiredCapacity: 1,
    missingCredentials: [],
  },
};
const demand: MarketplaceDemand = {
  partnerId: 8,
  partnerName: "Flywheel",
  workTypeId: 9,
  name: "Gatekeeping",
  category: "Security",
  description: "Visitor logs",
  requiredCertifications: ["PEC"],
  locationPrecision: "state",
  locations: [{ state: "OK", approximateSiteCount: 10 }],
  approximateDemand: 10,
  capabilityId: 3,
  ownOffer: null,
  eligibility,
};
const vendor: MarketplaceRankedVendor = {
  vendorId: 2,
  vendorName: "MidCon",
  capabilityId: 3,
  capabilityName: "Gate Services",
  canonicalServiceId: 7,
  matchExplanation: "Controlled entry matches",
  offer: {
    id: 4,
    unitPrice: 50,
    unit: "per_hour",
    currency: "USD",
    capacity: 4,
    available: true,
    commercialConditions: "Minimum 4 hours",
  },
  rating: null,
  reviewCount: 0,
  safety: null,
  ratingStatus: "not_yet_rated",
  safetyStatus: "not_yet_rated",
  completedJobs: 4,
  onTimeRate: null,
  priorPartnerJobs: 1,
  complianceCurrent: true,
  relationshipStatus: null,
  eligibility,
  offerable: true,
  weightedScore: 0.8,
  factors: [
    {
      name: "distance",
      normalized: 0.8,
      weight: 10,
      status: "available",
      explanation: "40 miles from saved service base",
    },
  ],
};
const offer: MarketplaceJobOffer = {
  id: 20,
  partnerId: 8,
  vendorId: 2,
  workTypeId: 9,
  vendorCapabilityId: 3,
  vendorPartnerServiceOfferId: 4,
  siteLocationId: 11,
  canonicalServiceId: 7,
  scope: "Saved server scope",
  crewCount: 1,
  status: "offered",
  version: 2,
  commercialSnapshot: {
    unitPrice: 55,
    unit: "per_day",
    currency: "USD",
    automaticBilling: "manual_billing_required",
    commercialConditions: "Saved conditions",
  },
  scheduledStartAt: "2099-01-03T10:00:00Z",
  scheduledEndAt: "2099-01-04T10:00:00Z",
  expiresAt: "2099-01-02T10:00:00Z",
};
let requests: { path: string; method: string; body: any; headers: Headers }[];
let failAccept: boolean;
let failSend: boolean;
let disabled: boolean;
let lostAcceptance: boolean;
let canonical: MarketplaceJobOffer;
let client: QueryClient;

beforeEach(() => {
  state.user = {
    id: 1,
    role: "vendor",
    vendorId: 2,
    vendorRole: "admin",
    activeMembershipId: 1,
  };
  state.push.mockReset();
  requests = [];
  failAccept = false;
  failSend = false;
  disabled = false;
  lostAcceptance = false;
  canonical = { ...offer };
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input), "https://test.invalid");
      const path = url.pathname;
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({
        path: path + url.search,
        method,
        body,
        headers: new Headers(init?.headers),
      });
      if (disabled && path.includes("service-marketplace"))
        return Response.json({ code: "marketplace.disabled" }, { status: 503 });
      let result: unknown;
      if (path === "/api/work-types")
        result = [{ id: 9, partnerId: 8, name: "Gatekeeping", isActive: true }];
      else if (path === "/api/site-locations")
        result = [
          {
            id: 11,
            partnerId: 8,
            name: "Jones Site",
            isActive: true,
            latitude: 35,
            longitude: -97,
          },
        ];
      else if (path.endsWith("/capabilities/preview"))
        result = {
          provisional: true,
          status: "matched",
          canonicalServiceId: 7,
          canonicalServiceName: "Gate security",
          explanation: "Preview match",
          confidence: 0.99,
          matchingPartnerCount: 1,
        };
      else if (path.endsWith("/capabilities"))
        result =
          method === "GET"
            ? { items: [capability] }
            : { ...capability, ...body };
      else if (path.endsWith("/capabilities/3"))
        result = { ...capability, ...body };
      else if (path.endsWith("/service-areas"))
        result = {
          items: [
            {
              id: 1,
              vendorId: 2,
              vendorCapabilityId: null,
              address: "Saved base",
              latitude: 35,
              longitude: -97,
              radiusMiles: "500",
              active: true,
              effectiveUntil: null,
            },
          ],
        };
      else if (path.endsWith("/service-areas/capabilities/3"))
        result = { success: true };
      else if (path.endsWith("/matching-demand"))
        result = { items: [demand], limit: 50, offset: 0 };
      else if (path.endsWith("/partner-rates")) result = { id: 4, ...body };
      else if (path.endsWith("/work-types/9/vendors"))
        result = {
          items: [
            vendor,
            {
              ...vendor,
              vendorId: 6,
              vendorName: "Far Away",
              offer: { ...vendor.offer, id: 5 },
              offerable: false,
              eligibility: {
                ...eligibility,
                eligible: false,
                reasonCodes: ["OUT_OF_SERVICE_AREA"],
              },
            },
          ],
          total: 2,
          limit: 50,
          offset: 0,
        };
      else if (path.endsWith("/vendors/2") && path.includes("work-types"))
        result = vendor;
      else if (path.endsWith("/job-offers") && method === "GET")
        result = { items: [canonical] };
      else if (path.endsWith("/job-offers") && method === "POST") {
        canonical = { ...offer, status: "draft", version: 1 };
        result = canonical;
      } else if (path.endsWith("/review")) {
        canonical = { ...canonical, status: "vendor_reviewing", version: 3 };
        result = canonical;
      } else if (path.endsWith("/send")) {
        if (failSend)
          return Response.json(
            { code: "marketplace.offer_changed" },
            { status: 409 },
          );
        canonical = { ...canonical, status: "offered", version: 2 };
        result = canonical;
      } else if (path.endsWith("/accept")) {
        if (failAccept)
          return Response.json(
            { code: "marketplace.capacity_changed" },
            { status: 409 },
          );
        canonical = { ...canonical, status: "accepted", createdTicketId: 77 };
        if (lostAcceptance) throw new Error("Response lost");
        result = {
          offerId: 20,
          ticketId: 77,
          replayed: false,
          automaticBilling: "manual_billing_required",
        };
      } else if (path.endsWith("/decline")) {
        canonical = { ...canonical, status: "declined" };
        result = canonical;
      } else if (path.endsWith("/withdraw")) {
        canonical = { ...canonical, status: "withdrawn" };
        result = canonical;
      } else if (path.endsWith("/job-offers/20")) result = canonical;
      else throw new Error(`Unhandled request ${method} ${path}`);
      return Response.json(result);
    }),
  );
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});
async function mount() {
  const i18n = createInstance();
  await i18n.init({ lng: "en", resources: { en: { translation: en } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ServiceMarketplace />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}
const change = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
async function partner() {
  state.user = { id: 1, role: "partner", partnerId: 8, activeMembershipId: 2 };
  await mount();
  await screen.findByRole("button", { name: "Gatekeeping" });
  click("Gatekeeping");
  await screen.findByRole("button", { name: "Jones Site" });
  click("Jones Site");
  await screen.findByText("MidCon");
}

describe("mobile service marketplace", () => {
  it("does not fetch company marketplace records for an unsupported or missing scope", async () => {
    state.user = { id: 2, role: "field_employee", vendorId: 2 };
    await mount();
    expect(
      await screen.findByText(
        "Marketplace access is unavailable for this account.",
      ),
    ).toBeTruthy();
    expect(requests).toHaveLength(0);
  });
  it("edits a 500-mile company radius using saved server coordinates and shows public partner demand", async () => {
    await mount();
    click(
      await screen
        .findByRole("button", { name: "Gate Services" })
        .then(() => "Gate Services"),
    );
    expect(await screen.findByText("Flywheel · Gatekeeping")).toBeTruthy();
    expect(screen.getByText("PEC")).toBeTruthy();
    expect(screen.getByText("Saved base")).toBeTruthy();
    change("Company radius (miles)", "500");
    click("Save company coverage");
    await waitFor(() =>
      expect(
        requests.some(
          (r) =>
            r.method === "PUT" &&
            r.path.endsWith("/service-areas") &&
            r.body.radiusMiles === 500 &&
            r.body.vendorCapabilityId === null,
        ),
      ).toBe(true),
    );
    const sent = requests.find(
      (r) => r.method === "PUT" && r.path.endsWith("/service-areas"),
    );
    expect(Object.keys(sent!.body).sort()).toEqual([
      "radiusMiles",
      "vendorCapabilityId",
    ]);
    change("Partner unit price", "75");
    click("Save partner rate");
    await waitFor(() =>
      expect(
        requests.find(
          (r) => r.method === "PUT" && r.path.endsWith("/partner-rates"),
        )?.body,
      ).toMatchObject({
        vendorCapabilityId: 3,
        workTypeId: 9,
        unitPrice: 75,
        unit: "per_hour",
        currency: "USD",
      }),
    );
  });
  it("previews a new service before saving and preserves the vendor wording", async () => {
    await mount();
    click("Add capability");
    change("Service name", "My Gate Team");
    click("Preview service match");
    expect(await screen.findByText("Preview match")).toBeTruthy();
    expect(
      requests.filter(
        (r) => r.method === "POST" && r.path.endsWith("/capabilities"),
      ),
    ).toHaveLength(0);
    click("Save capability");
    await waitFor(() =>
      expect(
        requests.find(
          (r) => r.method === "POST" && r.path.endsWith("/capabilities"),
        )?.body.name,
      ).toBe("My Gate Team"),
    );
    await screen.findByRole("button", { name: "Save capability" });
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Save capability" })
          .getAttribute("aria-disabled"),
      ).not.toBe("true"),
    );
    click("Save capability");
    await waitFor(() =>
      expect(
        requests.some(
          (r) => r.method === "PATCH" && r.path.endsWith("/capabilities/3"),
        ),
      ).toBe(true),
    );
    expect(
      requests.filter(
        (r) => r.method === "POST" && r.path.endsWith("/capabilities"),
      ),
    ).toHaveLength(1);
  });
  it("uses server eligibility and unknown evidence labels without turning missing evidence into zero", async () => {
    await partner();
    expect(screen.getAllByText("VNDRLY safety and compliance score").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/VNDRLY does not block tickets/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not yet rated").length).toBe(4);
    expect(screen.getByText("Out of Service Area")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Offer job to Far Away" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      screen.getAllByText("40 miles from saved service base"),
    ).toHaveLength(2);
    expect(
      requests.find((r) => r.path.includes("/work-types/9/vendors?"))?.path,
    ).toContain("siteId=11");
  });
  it("confirms server-saved terms before sending and sends the saved version", async () => {
    await partner();
    click("Offer job to MidCon");
    await screen.findByLabelText("Scope");
    change("Scope", "Client scope");
    change("Start (ISO date and time)", "2099-01-03T10:00:00Z");
    change("End (ISO date and time)", "2099-01-04T10:00:00Z");
    change("Expiration (ISO date and time)", "2099-01-02T10:00:00Z");
    click("Prepare draft");
    expect(await screen.findByText("Confirm send")).toBeTruthy();
    expect(screen.getByText("Saved server scope")).toBeTruthy();
    expect(screen.getByText("USD 55 / per_day")).toBeTruthy();
    expect(
      screen.getByText("These terms require manual billing."),
    ).toBeTruthy();
    expect(requests.filter((r) => r.path.endsWith("/send"))).toHaveLength(0);
    click("Send offer");
    expect(await screen.findByText("Offer sent")).toBeTruthy();
    expect(requests.find((r) => r.path.endsWith("/send"))?.body).toEqual({
      version: 1,
    });
    expect(
      requests
        .find((r) => r.method === "POST" && r.path.endsWith("/job-offers"))
        ?.headers.get("Idempotency-Key"),
    ).toBeTruthy();
  });
  it("reviews canonical terms before accept and navigates using the returned canonical ticket", async () => {
    await mount();
    click(
      await screen
        .findByRole("button", { name: "Review offer 20" })
        .then(() => "Review offer 20"),
    );
    expect(await screen.findByText("Confirm acceptance")).toBeTruthy();
    expect(requests.filter((r) => r.path.endsWith("/accept"))).toHaveLength(0);
    click("Accept offer");
    await waitFor(() => expect(state.push).toHaveBeenCalledWith("/ticket/77"));
    expect(requests.find((r) => r.path.endsWith("/accept"))?.body).toEqual({
      version: 3,
    });
    expect(
      requests
        .find((r) => r.path.endsWith("/accept"))
        ?.headers.get("Idempotency-Key"),
    ).toBeTruthy();
  });
  it("clears stale acceptance confirmation, refreshes the inbox, and never navigates on failure", async () => {
    failAccept = true;
    await mount();
    await screen.findByRole("button", { name: "Review offer 20" });
    click("Review offer 20");
    await screen.findByText("Confirm acceptance");
    click("Accept offer");
    expect(
      await screen.findByText(
        "The offer changed. Refresh and review the current terms.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept offer" })).toBeNull();
    expect(state.push).not.toHaveBeenCalled();
    expect(
      screen.getByText("Crew capacity changed. Review the offer again."),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        requests.filter(
          (r) => r.method === "GET" && r.path.endsWith("/vendors/2/job-offers"),
        ).length,
      ).toBeGreaterThan(1),
    );
  });
  it("declines the reviewed offer without creating or opening a ticket", async () => {
    await mount();
    await screen.findByRole("button", { name: "Review offer 20" });
    click("Review offer 20");
    await screen.findByText("Confirm acceptance");
    click("Decline offer");
    await waitFor(() =>
      expect(
        requests.some(
          (r) => r.path.endsWith("/decline") && r.body.version === 3,
        ),
      ).toBe(true),
    );
    expect(state.push).not.toHaveBeenCalled();
    expect(requests.filter((r) => r.path.endsWith("/accept"))).toHaveLength(0);
  });
  it("denies cleanly when the server disables marketplace access", async () => {
    disabled = true;
    await mount();
    expect(
      (
        await screen.findAllByText(
          "Marketplace is unavailable. Refresh or contact your administrator.",
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Add capability" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Review offer 20" }),
    ).toBeNull();
    expect(requests.every((request) => request.method === "GET")).toBe(true);
  });
  it("does not resend a stale draft without a new saved confirmation", async () => {
    failSend = true;
    await partner();
    click("Offer job to MidCon");
    await screen.findByLabelText("Scope");
    change("Scope", "Client scope");
    change("Start (ISO date and time)", "2099-01-03T10:00:00Z");
    change("End (ISO date and time)", "2099-01-04T10:00:00Z");
    change("Expiration (ISO date and time)", "2099-01-02T10:00:00Z");
    click("Prepare draft");
    await screen.findByText("Confirm send");
    click("Send offer");
    await screen.findByText(
      "The offer changed. Refresh and review the current terms.",
    );
    expect(screen.queryByRole("button", { name: "Send offer" })).toBeNull();
    expect(
      requests.filter((request) => request.path.endsWith("/send")),
    ).toHaveLength(1);
  });
  it("reconciles a lost acceptance response through canonical readback and guards duplicate taps", async () => {
    lostAcceptance = true;
    await mount();
    await screen.findByRole("button", { name: "Review offer 20" });
    click("Review offer 20");
    await screen.findByText("Confirm acceptance");
    click("Accept offer");
    click("Accept offer");
    await waitFor(() => expect(state.push).toHaveBeenCalledWith("/ticket/77"));
    expect(
      requests.filter((request) => request.path.endsWith("/accept")),
    ).toHaveLength(1);
    expect(
      requests.filter(
        (request) =>
          request.path.endsWith("/job-offers/20") && request.method === "GET",
      ),
    ).toHaveLength(2);
  });
  it("saves a capability radius override without submitting coordinates", async () => {
    await mount();
    await screen.findByRole("button", { name: "Gate Services" });
    click("Gate Services");
    await screen.findByText("Flywheel · Gatekeeping");
    change("Service radius (miles)", "500");
    click("Save service coverage");
    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path.endsWith("/service-areas") && request.method === "PUT",
        )?.body,
      ).toEqual({ vendorCapabilityId: 3, radiusMiles: 500 }),
    );
  });
  it("deactivates a capability through the server without editing its mapping", async () => {
    await mount();
    await screen.findByRole("button", { name: "Gate Services" });
    click("Gate Services");
    await screen.findByText("Flywheel · Gatekeeping");
    fireEvent.click(screen.getByRole("switch", { name: "Active capability" }));
    click("Save capability");
    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path.endsWith("/capabilities/3") &&
            request.method === "PATCH",
        )?.body.active,
      ).toBe(false),
    );
    expect(
      requests.find((request) => request.path.endsWith("/capabilities/3"))?.body
        .canonicalServiceId,
    ).toBeUndefined();
  });
  it("stages a 500-mile service override before capability creation", async () => {
    await mount();
    click("Add capability");
    change("Service name", "New gate crew");
    change("Service radius (miles)", "500");
    click("Preview service match");
    await screen.findByText("Preview match");
    expect(
      requests.filter(
        (request) =>
          request.method === "POST" && request.path.endsWith("/capabilities"),
      ),
    ).toHaveLength(0);
    click("Save capability");
    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.method === "PUT" && request.path.endsWith("/service-areas"),
        )?.body,
      ).toEqual({ vendorCapabilityId: 3, radiusMiles: 500 }),
    );
  });
});

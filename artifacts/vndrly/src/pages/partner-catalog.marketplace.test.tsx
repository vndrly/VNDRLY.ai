import React from "react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MarketplaceRankedVendor } from "@workspace/api-client-react";
import { getGetPartnerMarketplaceVendorUrl } from "@workspace/api-client-react";
import PartnerCatalogPage from "./partner-catalog";
import JobOfferComposer from "@/components/service-marketplace/JobOfferComposer";
import i18n from "@/lib/i18n";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: {
      role: "partner",
      partnerId: 20,
      availableMemberships: [{ orgType: "partner", orgId: 20, role: "admin" }],
    },
  }),
}));
vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({
    primary: "#3260CD",
    name: "Flywheel",
    isOrgBranded: true,
  }),
}));
const midcon: MarketplaceRankedVendor = {
  vendorId: 7,
  vendorName: "MidCon",
  capabilityId: 10,
  capabilityName: "Gate Services",
  canonicalServiceId: 1,
  matchExplanation: "Controlled entry and visitor logging.",
  offer: {
    id: 50,
    unitPrice: 45,
    unit: "per_hour",
    currency: "USD",
    capacity: 3,
    available: true,
    commercialConditions: "Two-hour minimum",
  },
  rating: 4.8,
  reviewCount: 12,
  ratingStatus: "rated",
  safetyStatus: "rated",
  safety: { score: 96, source: "VNDRLY safety events", refreshedAt: "2026-10-17T00:00:00Z" },
  completedJobs: 25,
  onTimeRate: 0.96,
  priorPartnerJobs: 8,
  complianceCurrent: true,
  relationshipStatus: "approved",
  eligibility: {
    eligible: true,
    reasonCodes: [],
    facts: {
      distanceMiles: 70,
      radiusMiles: 500,
      availableCapacity: 3,
      requiredCapacity: 1,
      missingCredentials: [],
    },
  },
  offerable: true,
  weightedScore: 0.87,
  factors: [
    {
      name: "distance",
      normalized: 0.86,
      weight: 10,
      status: "available",
      explanation: "70 miles from the saved service base.",
    },
  ],
};
let vendors: MarketplaceRankedVendor[];
let requests: { url: URL; method: string }[];
let failSearch: boolean;
let detailVendor: MarketplaceRankedVendor | undefined;
let client: QueryClient;
const mount = (element = <PartnerCatalogPage />) => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>{element}</QueryClientProvider>,
  );
};
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
async function discover() {
  fireEvent.click(await screen.findByTestId("button-toggle-catalog-31"));
  await screen.findByRole("option", { name: "Jones Well" });
  change("Job site", "101");
  await screen.findByRole("region", { name: "MidCon" });
}
beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.stubEnv("VITE_SEMANTIC_SERVICE_MARKETPLACE_ENABLED", "true");
  requests = [];
  failSearch = false;
  detailVendor = undefined;
  vendors = [
    structuredClone(midcon),
    {
      ...structuredClone(midcon),
      vendorId: 8,
      capabilityId: 11,
      vendorName: "Distant Security",
      offer: { ...midcon.offer, id: 60 },
      rating: null,
      reviewCount: 0,
      ratingStatus: "not_yet_rated",
      safety: null,
      safetyStatus: "not_yet_rated",
      onTimeRate: null,
      offerable: false,
      eligibility: {
        eligible: false,
        reasonCodes: ["OUT_OF_SERVICE_AREA"],
        facts: { ...midcon.eligibility.facts, distanceMiles: 700 },
      },
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      let data: unknown;
      if (url.pathname.includes("/service-marketplace/")) {
        if (failSearch)
          return Response.json(
            { code: "marketplace.unavailable" },
            { status: 503 },
          );
        data = /\/vendors\/\d+$/.test(url.pathname)
          ? (detailVendor ??
            vendors.find(
              (v) =>
                v.vendorId === Number(url.pathname.split("/").pop()) &&
                v.capabilityId ===
                  Number(url.searchParams.get("vendorCapabilityId")) &&
                v.offer.id ===
                  Number(url.searchParams.get("vendorPartnerServiceOfferId")),
            ))
          : {
              items:
                url.searchParams.get("sort") === "price"
                  ? [...vendors].reverse()
                  : vendors,
              total: vendors.length,
              limit: 50,
              offset: 0,
            };
      } else if (url.pathname === "/api/site-locations")
        data = [
          {
            id: 101,
            partnerId: 20,
            name: "Jones Well",
            latitude: 35.56,
            longitude: -97.29,
            isActive: true,
          },
          {
            id: 102,
            partnerId: 20,
            name: "Unmapped Well",
            latitude: null,
            longitude: null,
            isActive: true,
          },
        ];
      else if (url.pathname.endsWith("work-type-afes"))
        data = {
          partnerId: 20,
          items: [
            {
              workTypeId: 31,
              name: "Gatekeeping",
              category: "Security",
              description: "Visitor logging",
              vendorCount: 2,
              afe: "",
              partnerScoped: true,
            },
          ],
        };
      else if (url.pathname.endsWith("work-type-approval-summary"))
        data = { approved: 1, total: 1 };
      else data = { items: [] };
      return Response.json(data);
    }),
  );
});
afterEach(() => {
  client?.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("partner marketplace", () => {
  it("serializes the complete scoped vendor-detail query without pagination", () => {
    const url = new URL(
      getGetPartnerMarketplaceVendorUrl(20, 31, 7, {
        vendorCapabilityId: 10,
        vendorPartnerServiceOfferId: 50,
        siteId: 101,
        requestedCapacity: 2,
        sort: "price",
        safetyWeight: 70,
      }),
      "http://localhost",
    );
    expect(url.pathname).toBe(
      "/api/service-marketplace/partners/20/work-types/31/vendors/7",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      vendorCapabilityId: "10",
      vendorPartnerServiceOfferId: "50",
      siteId: "101",
      requestedCapacity: "2",
      sort: "price",
      safetyWeight: "70",
    });
  });
  it("keeps catalog editing and requires a site before querying eligibility", async () => {
    mount();
    expect(
      await screen.findByRole("button", { name: "Edit Gatekeeping" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId("button-toggle-catalog-31"));
    expect(
      await screen.findByText(
        "Select a saved job site to check vendor eligibility.",
      ),
    ).toBeTruthy();
    expect(
      requests.some((r) => r.url.pathname.includes("service-marketplace")),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Edit Gatekeeping" }));
    expect(await screen.findByDisplayValue("Gatekeeping")).toBeTruthy();
  });
  it("renders approved ranking facts and unknowns without leaking internal evidence", async () => {
    Object.assign(vendors[0], {
      internalEvidence: "SECRET_INTERNAL",
      privateNotes: "SECRET_PRIVATE",
      unrelatedPartnerRate: "SECRET_RATE",
    });
    mount();
    await discover();
    const card = screen.getByRole("region", { name: "MidCon" });
    for (const fact of [
      "USD 45.00 / per_hour",
      "4.8 / 5 (12 reviews)",
      "🟢 96 / 100 · VNDRLY safety events · 2026-10-17",
      "25 completed jobs",
      "96% on time",
      "8 jobs with this partner",
      "70 miles · radius 500 miles",
      "Compliance current",
      "3 crews available",
    ])
      expect(within(card).getByText(fact)).toBeTruthy();
    expect(
      within(card).getByText(/70 miles from the saved service base/),
    ).toBeTruthy();
    expect(within(card).getByText("VNDRLY safety and compliance score")).toBeTruthy();
    expect(within(card).getByText(/🟢 96 \/ 100 · VNDRLY safety events/)).toBeTruthy();
    expect(within(card).getByText(/VNDRLY does not block tickets/)).toBeTruthy();
    expect(screen.getAllByText("Not yet rated").length).toBe(2);
    expect(screen.getByText("Out of Service Area")).toBeTruthy();
    expect(
      (
        within(
          screen.getByRole("region", { name: "Distant Security" }),
        ).getByRole("button", {
          name: "Prepare job offer",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.queryByText(/SECRET_/)).toBeNull();
  });
  it("passes capacity and sort to the server, filters and compares without selecting a winner", async () => {
    mount();
    await discover();
    change("Requested crews", "2");
    change("Sort vendors", "price");
    await waitFor(() =>
      expect(
        requests.some(
          (r) =>
            r.url.searchParams.get("sort") === "price" &&
            r.url.searchParams.get("requestedCapacity") === "2",
        ),
      ).toBe(true),
    );
    fireEvent.click(await screen.findByLabelText("Compare MidCon"));
    fireEvent.click(screen.getByLabelText("Compare Distant Security"));
    expect(
      screen.getByRole("region", { name: "Vendor comparison" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Eligible vendors only"));
    expect(
      screen.queryByRole("region", { name: "Distant Security" }),
    ).toBeNull();
  });
  it("offers a coordinate remediation path and clears old eligibility on site changes", async () => {
    mount();
    await discover();
    change("Job site", "102");
    expect(screen.queryByRole("region", { name: "MidCon" })).toBeNull();
    expect(
      screen.getByText(
        "Save valid coordinates for this site before checking coverage or preparing an offer.",
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Manage site coordinates" })
        .getAttribute("href"),
    ).toBe("/site-locations/102");
    expect(
      requests.some((r) => r.url.searchParams.get("siteId") === "102"),
    ).toBe(false);
  });
  it("shows search errors with retry instead of a misleading empty list", async () => {
    failSearch = true;
    mount();
    fireEvent.click(await screen.findByTestId("button-toggle-catalog-31"));
    await screen.findByRole("option", { name: "Jones Well" });
    change("Job site", "101");
    expect(await screen.findByRole("alert")).toBeTruthy();
    failSearch = false;
    fireEvent.click(
      screen.getByRole("button", { name: "Retry vendor search" }),
    );
    expect(await screen.findByRole("region", { name: "MidCon" })).toBeTruthy();
  });
  it("rechecks selected vendor details before composing and preserves draft edits on background refresh", async () => {
    mount();
    await discover();
    fireEvent.click(
      within(screen.getByRole("region", { name: "MidCon" })).getByRole(
        "button",
        { name: "Prepare job offer" },
      ),
    );
    await screen.findByRole("form", { name: "Job offer draft" });
    expect(
      requests.some(
        (r) =>
          r.url.pathname.endsWith("/vendors/7") &&
          r.url.searchParams.get("siteId") === "101",
      ),
    ).toBe(true);
    change("Scope of work", "Keep these unsaved details");
    await client.invalidateQueries();
    expect(
      await screen.findByDisplayValue("Keep these unsaved details"),
    ).toBeTruthy();
  });
  it("shows a precise capacity exclusion", async () => {
    vendors[0].offerable = false;
    vendors[0].eligibility = {
      ...vendors[0].eligibility,
      eligible: false,
      reasonCodes: ["INSUFFICIENT_CAPACITY"],
    };
    mount();
    await discover();
    expect(screen.getByText("Insufficient crew capacity")).toBeTruthy();
  });
  it("explains a restricted relationship and prevents preparing new work", async () => {
    vendors[0].offerable = false;
    vendors[0].relationshipStatus = "revoked";
    vendors[0].eligibility = { ...vendors[0].eligibility, eligible: false, reasonCodes: ["RELATIONSHIP_RESTRICTED"] };
    mount();
    await discover();
    expect(screen.getByText("The partner must deliberately reopen this restricted relationship before new work can be accepted")).toBeTruthy();
    expect((within(screen.getByRole("region", { name: "MidCon" })).getByRole("button", { name: "Prepare job offer" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("compares each offered capability independently for a vendor with multiple offers", async () => {
    vendors.push({
      ...structuredClone(midcon),
      capabilityId: 12,
      capabilityName: "Gate Surge Services",
      offer: { ...midcon.offer, id: 51 },
    });
    mount();
    fireEvent.click(await screen.findByTestId("button-toggle-catalog-31"));
    await screen.findByRole("option", { name: "Jones Well" });
    change("Job site", "101");
    await screen.findByText("Gate Surge Services");
    const cards = screen.getAllByRole("region", { name: "MidCon" });
    fireEvent.click(within(cards[1]).getByLabelText("Compare MidCon"));
    expect(
      (within(cards[0]).getByLabelText("Compare MidCon") as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(
      screen.queryByRole("region", { name: "Vendor comparison" }),
    ).toBeNull();
  });
  it("never substitutes another matching capability returned by vendor details", async () => {
    detailVendor = {
      ...structuredClone(midcon),
      capabilityId: 12,
      offer: { ...midcon.offer, id: 51 },
    };
    mount();
    await discover();
    fireEvent.click(
      within(screen.getByRole("region", { name: "MidCon" })).getByRole(
        "button",
        { name: "Prepare job offer" },
      ),
    );
    expect(
      await screen.findByText(
        "The matching offer changed. Refresh vendor search and select the intended service offer again.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Job offer draft" })).toBeNull();
  });
  it("prepares an alternative capability from its exact saved offer detail", async () => {
    vendors.push({
      ...structuredClone(midcon),
      capabilityId: 12,
      capabilityName: "Gate Surge Services",
      offer: { ...midcon.offer, id: 51, unitPrice: 99 },
    });
    mount();
    fireEvent.click(await screen.findByTestId("button-toggle-catalog-31"));
    await screen.findByRole("option", { name: "Jones Well" });
    change("Job site", "101");
    await screen.findByText("Gate Surge Services");
    const alternative = screen.getAllByRole("region", { name: "MidCon" })[1];
    fireEvent.click(
      within(alternative).getByRole("button", { name: "Prepare job offer" }),
    );
    const composer = await screen.findByRole("form", {
      name: "Job offer draft",
    });
    expect(within(composer).getByText(/USD 99.00 \/ per_hour/)).toBeTruthy();
    const detail = requests.find((r) => r.url.pathname.endsWith("/vendors/7"));
    expect(detail?.url.searchParams.get("vendorCapabilityId")).toBe("12");
    expect(detail?.url.searchParams.get("vendorPartnerServiceOfferId")).toBe(
      "51",
    );
  });
  it("prepares the exact offer input with references and attachments and makes no write request", async () => {
    let draft: unknown;
    mount(
      <JobOfferComposer
        partnerId={20}
        workTypeId={31}
        siteLocationId={101}
        vendor={midcon}
        initialStartAt="2026-11-01T08:00"
        initialEndAt="2026-11-01T16:00"
        crewCount={2}
        onPrepared={(value) => {
          draft = value;
        }}
      />,
    );
    change("Scope of work", "Control the north entry");
    change("AFE reference", "AFE-1");
    change("PO reference", "PO-2");
    change("Attachment URLs (one per line)", "https://example.com/scope.pdf");
    change("Offer expires", "2026-10-31T12:00");
    fireEvent.click(screen.getByRole("button", { name: "Prepare draft" }));
    expect(draft).toMatchObject({
      partnerId: 20,
      workTypeId: 31,
      vendorId: 7,
      vendorCapabilityId: 10,
      vendorPartnerServiceOfferId: 50,
      siteLocationId: 101,
      scope: "Control the north entry",
      crewCount: 2,
      afeCode: "AFE-1",
      poNumber: "PO-2",
      attachmentUrls: ["https://example.com/scope.pdf"],
    });
    expect(Object.keys(draft as object)).not.toContain("unitPrice");
    expect(requests.filter((r) => r.method !== "GET")).toHaveLength(0);
    expect(
      screen.getByText(
        "Draft prepared. No offer has been sent and no ticket has been created.",
      ),
    ).toBeTruthy();
  });
  it("rejects reversed dates and unsafe attachment URLs without losing the draft", () => {
    mount(
      <JobOfferComposer
        partnerId={20}
        workTypeId={31}
        siteLocationId={101}
        vendor={midcon}
        initialStartAt="2026-11-01T16:00"
        initialEndAt="2026-11-01T08:00"
        crewCount={1}
      />,
    );
    change("Scope of work", "Retain this scope");
    change("Attachment URLs (one per line)", "javascript:alert(1)");
    change("Offer expires", "2026-10-31T12:00");
    fireEvent.click(screen.getByRole("button", { name: "Prepare draft" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByDisplayValue("Retain this scope")).toBeTruthy();
  });
  it("rejects unsafe attachments when all other draft values are valid", () => {
    mount(
      <JobOfferComposer
        partnerId={20}
        workTypeId={31}
        siteLocationId={101}
        vendor={midcon}
        initialStartAt="2026-11-01T08:00"
        initialEndAt="2026-11-01T16:00"
        crewCount={1}
      />,
    );
    change("Scope of work", "Control entry");
    change("Attachment URLs (one per line)", "javascript:alert(1)");
    change("Offer expires", "2026-10-31T12:00");
    fireEvent.click(screen.getByRole("button", { name: "Prepare draft" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("leaves discovery disabled when rollout is off", async () => {
    vi.stubEnv("VITE_SEMANTIC_SERVICE_MARKETPLACE_ENABLED", "false");
    mount();
    fireEvent.click(await screen.findByTestId("button-toggle-catalog-31"));
    await screen.findByTestId("vendor-offers-empty-31");
    expect(screen.queryByLabelText("Job site")).toBeNull();
    expect(
      requests.some((r) => r.url.pathname.includes("service-marketplace")),
    ).toBe(false);
  });
});

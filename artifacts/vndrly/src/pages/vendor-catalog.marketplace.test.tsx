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
import type {
  MarketplaceCapability,
  MarketplaceDemand,
  MarketplaceServiceArea,
} from "@workspace/api-client-react";
import VendorCapabilityEditor from "@/components/service-marketplace/VendorCapabilityEditor";
import VendorCatalog from "./vendor-catalog";
import i18n from "@/lib/i18n";

const user = vi.hoisted(() => ({
  role: "vendor",
  vendorId: 7,
  activeMembershipId: 4,
  availableMemberships: [{ id: 4, role: "admin", orgType: "vendor", orgId: 7 }],
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user }) }));
vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ primary: "#3260CD", name: "MidCon" }),
}));

const date = "2026-10-17T00:00:00.000Z";
const capability: MarketplaceCapability = {
  id: 10,
  vendorId: 7,
  name: "Gate Services",
  description: "Control entry and log visitors",
  capacity: 2,
  active: true,
  defaultUnit: "per_hour",
  defaultRateCard: { unitPrice: 45, unit: "per_hour", currency: "USD" },
  createdAt: date,
  updatedAt: date,
  mapping: {
    canonicalServiceId: 1,
    canonicalServiceName: "Gate and perimeter security",
    status: "active",
    explanation: "Controlled entry, visitor logging, and vehicle verification.",
    confidence: 0.98,
  },
};
const area: MarketplaceServiceArea = {
  id: 1,
  vendorId: 7,
  vendorCapabilityId: null,
  address: "Jones, OK",
  latitude: 35.56,
  longitude: -97.29,
  radiusMiles: "500",
  coordinateProvenance: "saved_vendor_geocoded_base",
  verifiedAt: date,
  active: true,
  effectiveFrom: date,
  effectiveUntil: null,
  createdAt: date,
  updatedAt: date,
};
const demand: MarketplaceDemand[] = [
  {
    partnerId: 20,
    partnerName: "Flywheel",
    workTypeId: 31,
    name: "Gatekeeping",
    category: "Security",
    description: "Visitor logging",
    requiredCertifications: ["SafeLand"],
    locationPrecision: "state",
    locations: [{ state: "OK", approximateSiteCount: 10 }],
    approximateDemand: 10,
    capabilityId: 10,
    ownOffer: null,
    eligibility: {
      eligible: false,
      reasonCodes: ["OFFER_INACTIVE"],
      facts: {
        distanceMiles: 70,
        radiusMiles: 500,
        availableCapacity: 2,
        requiredCapacity: 1,
        missingCredentials: [],
      },
    },
  },
  {
    partnerId: 21,
    partnerName: "Warwick",
    workTypeId: 32,
    name: "Perimeter Security",
    category: "Security",
    description: null,
    requiredCertifications: [],
    locationPrecision: "state",
    locations: [{ state: "TX", approximateSiteCount: 20 }],
    approximateDemand: 20,
    capabilityId: 10,
    ownOffer: null,
    eligibility: {
      eligible: false,
      reasonCodes: ["OUT_OF_SERVICE_AREA"],
      facts: {
        distanceMiles: 700,
        radiusMiles: 500,
        availableCapacity: 2,
        requiredCapacity: 1,
        missingCredentials: [],
      },
    },
  },
];
let capabilities: MarketplaceCapability[];
let areas: MarketplaceServiceArea[];
let pending: boolean;
let failWrites: boolean;
let failCoverageWrites: boolean;
let invalidBase: boolean;
let requests: { path: string; method: string; body: any }[];
let client: QueryClient;
function mount(page = false) {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {page ? <VendorCatalog /> : <VendorCapabilityEditor vendorId={7} />}
    </QueryClientProvider>,
  );
}
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const writes = () =>
  requests.filter(
    (r) => r.method !== "GET" && !r.path.endsWith("/capabilities/preview"),
  );
beforeEach(async () => {
  user.availableMemberships[0].role = "admin";
  await i18n.changeLanguage("en");
  capabilities = [structuredClone(capability)];
  areas = [structuredClone(area)];
  pending = false;
  failWrites = false;
  failCoverageWrites = false;
  invalidBase = false;
  requests = [];
  vi.stubEnv("VITE_SEMANTIC_SERVICE_MARKETPLACE_ENABLED", "true");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const path = String(input);
      const method = options?.method ?? "GET";
      const body = options?.body ? JSON.parse(String(options.body)) : null;
      requests.push({ path, method, body });
      if (
        method !== "GET" &&
        (failWrites || (failCoverageWrites && path.endsWith("/service-areas")))
      )
        return new Response(
          JSON.stringify({
            code: "marketplace.verified_service_base_required",
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      let result: unknown;
      if (path.includes("/service-marketplace/")) {
        if (path.endsWith("/capabilities/preview"))
          result = {
            provisional: true,
            status: pending ? "pending" : "matched",
            canonicalServiceId: pending ? null : 1,
            canonicalServiceName: pending
              ? null
              : "Gate and perimeter security",
            explanation: pending
              ? "Pending retry"
              : "Controlled entry, visitor logging, and vehicle verification.",
            confidence: pending ? 0 : 0.98,
            matchingPartnerCount: pending ? null : 2,
          };
        else if (path.endsWith("/capabilities") && method === "POST") {
          const saved = {
            ...capability,
            ...body,
            id: 11,
            mapping: pending ? null : capability.mapping,
          };
          capabilities.push(saved);
          result = saved;
        } else if (/\/capabilities\/\d+$/.test(path) && method === "PATCH") {
          const id = Number(path.split("/").pop());
          const saved = { ...capabilities.find((c) => c.id === id)!, ...body };
          capabilities = capabilities.map((c) => (c.id === id ? saved : c));
          result = saved;
        } else if (path.endsWith("/capabilities"))
          result = { items: capabilities };
        else if (path.endsWith("/service-areas") && method === "PUT") {
          const saved = {
            ...area,
            id: areas.length + 1,
            ...body,
            radiusMiles: String(body.radiusMiles),
          };
          areas = [
            ...areas.filter(
              (a) => a.vendorCapabilityId !== body.vendorCapabilityId,
            ),
            saved,
          ];
          result = saved;
        } else if (
          path.includes("/service-areas/capabilities/") &&
          method === "DELETE"
        ) {
          areas = areas.map((a) =>
            a.vendorCapabilityId === Number(path.split("/").pop())
              ? { ...a, active: false, effectiveUntil: date }
              : a,
          );
          return new Response(null, { status: 204 });
        } else if (path.endsWith("/service-areas")) result = { items: areas };
        else if (path.endsWith("/partner-rates") && method === "PUT")
          result = {
            ...body,
            id: 50,
            partnerId: body.workTypeId === 31 ? 20 : 21,
            unitPrice: String(body.unitPrice),
            version: 1,
            createdAt: date,
            updatedAt: date,
            effectiveFrom: date,
            effectiveUntil: null,
          };
        else if (path.endsWith("/partner-rates")) result = { items: [] };
        else if (path.includes("/matching-demand"))
          result = { items: demand, limit: 50, offset: 0 };
      } else if (path.endsWith("/operating-area"))
        result = {
          vendorId: 7,
          latitude: invalidBase ? null : 35.56,
          longitude: -97.29,
          physicalAddress: "Jones, OK",
          geocodedAt: invalidBase ? null : date,
          operatingRadiusMiles: 500,
        };
      else if (path.endsWith("/work-type-partners"))
        result = { partners: [], workTypePartners: [], partnerWorkTypes: [] };
      else if (path.includes("/work-types"))
        result = {
          vendorId: 7,
          items: [
            {
              id: 31,
              partnerId: 20,
              partnerName: "Flywheel",
              name: "Legacy Gatekeeping",
              category: "Security",
              selected: true,
              unitPrice: "45",
              unit: "per_hour",
              currency: "USD",
              notes: null,
            },
          ],
        };
      else if (path.includes("site-afes")) result = { vendorId: 7, items: [] };
      else result = { id: 7, name: "MidCon" };
      return new Response(JSON.stringify(result), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  client?.clear();
});

describe("vendor semantic marketplace", () => {
  it("retains staged coverage after a partial save and retries without creating a duplicate capability", async () => {
    mount();
    await screen.findByText("Gate Services");
    fireEvent.click(screen.getByRole("button", { name: "Add capability" }));
    change("Service name", "Gate Services");
    fireEvent.click(screen.getByLabelText("Override company coverage"));
    change("Service radius (miles)", "700");
    fireEvent.click(
      screen.getByRole("button", { name: "Preview service match" }),
    );
    await screen.findByText("Proposed service match");
    failCoverageWrites = true;
    fireEvent.click(
      screen.getByRole("button", { name: "Save and match service" }),
    );
    expect(
      await screen.findByText(
        "The capability was saved, but its coverage could not be saved. Your radius is retained below; retry Save service coverage.",
      ),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Service radius (miles)") as HTMLInputElement)
        .value,
    ).toBe("700");
    failCoverageWrites = false;
    fireEvent.click(
      screen.getByRole("button", { name: "Save service coverage" }),
    );
    await waitFor(() =>
      expect(
        areas.find((area) => area.vendorCapabilityId === 11)?.radiusMiles,
      ).toBe("700"),
    );
    await waitFor(() =>
      expect(
        screen.queryByText(
          "The capability was saved, but its coverage could not be saved. Your radius is retained below; retry Save service coverage.",
        ),
      ).toBeNull(),
    );
    expect(
      requests.filter(
        (r) => r.path.endsWith("/capabilities") && r.method === "POST",
      ),
    ).toHaveLength(1);
  });
  it("invalidates preview after wording changes and blocks invalid staged radius before creation", async () => {
    mount();
    await screen.findByText("Gate Services");
    fireEvent.click(screen.getByRole("button", { name: "Add capability" }));
    change("Service name", "Gate Services");
    fireEvent.click(
      screen.getByRole("button", { name: "Preview service match" }),
    );
    await screen.findByText("Proposed service match");
    change("Description", "Changed scope");
    expect(screen.queryByText("Proposed service match")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Save and match service",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Preview service match" }),
    );
    await screen.findByText("Proposed service match");
    fireEvent.click(screen.getByLabelText("Override company coverage"));
    change("Service radius (miles)", "0");
    fireEvent.click(
      screen.getByRole("button", { name: "Save and match service" }),
    );
    expect(
      await screen.findByText(
        "Enter a radius greater than 0 and no more than 20,000 miles, with up to three decimals.",
      ),
    ).toBeTruthy();
    expect(
      requests.filter(
        (r) => r.path.endsWith("/capabilities") && r.method === "POST",
      ),
    ).toHaveLength(0);
  });
  it("previews canonical meaning and demand before creation and preserves a staged service radius when the ID arrives", async () => {
    mount();
    await screen.findByText("Gate Services");
    fireEvent.click(screen.getByRole("button", { name: "Add capability" }));
    change("Service name", "Gate Services");
    change("Company radius (miles)", "600");
    fireEvent.click(screen.getByLabelText("Override company coverage"));
    change("Service radius (miles)", "700");
    fireEvent.click(
      screen.getByRole("button", { name: "Preview service match" }),
    );
    expect(await screen.findByText("Gate and perimeter security")).toBeTruthy();
    expect(screen.getByText("2 matching partner catalog entries")).toBeTruthy();
    expect(
      requests.filter(
        (r) => r.path.endsWith("/capabilities") && r.method === "POST",
      ),
    ).toHaveLength(0);
    expect(
      requests.filter(
        (r) => r.path.endsWith("/service-areas") && r.method === "PUT",
      ),
    ).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("button", { name: "Save and match service" }),
    );
    await waitFor(() =>
      expect(
        writes().find((r) => r.path.endsWith("/service-areas"))?.body,
      ).toEqual({ vendorCapabilityId: 11, radiusMiles: 700 }),
    );
    expect(
      (screen.getByLabelText("Service radius (miles)") as HTMLInputElement)
        .value,
    ).toBe("700");
    expect(
      (screen.getByLabelText("Company radius (miles)") as HTMLInputElement)
        .value,
    ).toBe("600");
  });
  it("hides stale matches immediately when service wording changes", async () => {
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Gate Services" }),
    );
    await screen.findByRole("region", { name: "Flywheel — Gatekeeping" });
    change("Description", "Different service scope");
    expect(screen.queryByRole("region", { name: /Flywheel/ })).toBeNull();
    expect(
      screen.getByText(
        "Service wording changed. Save and refresh the match before managing partner rates.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Active service match")).toBeNull();
  });
  it("blocks fractional-cent partner prices and retains failed rate drafts", async () => {
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Gate Services" }),
    );
    const row = await screen.findByRole("region", {
      name: "Flywheel — Gatekeeping",
    });
    fireEvent.change(within(row).getByLabelText("Unit price"), {
      target: { value: "12.345" },
    });
    fireEvent.click(
      within(row).getByRole("button", { name: "Save partner rate" }),
    );
    expect(await within(row).findByRole("alert")).toBeTruthy();
    expect(writes()).toHaveLength(0);
    fireEvent.change(within(row).getByLabelText("Unit price"), {
      target: { value: "52" },
    });
    failWrites = true;
    fireEvent.click(
      within(row).getByRole("button", { name: "Save partner rate" }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(
      (within(row).getByLabelText("Unit price") as HTMLInputElement).value,
    ).toBe("52");
  });
  it("does not load marketplace tools for a vendor member", async () => {
    user.availableMemberships[0].role = "member";
    mount(true);
    await screen.findByText("Legacy Gatekeeping");
    expect(screen.queryByRole("button", { name: "Add capability" })).toBeNull();
    expect(requests.some((r) => r.path.includes("service-marketplace"))).toBe(
      false,
    );
  });
  it("labels an inactive capability accurately rather than suggesting it awaits classification", async () => {
    capabilities[0].active = false;
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Gate Services" }),
    );
    expect(await screen.findByText("Capability inactive")).toBeTruthy();
    expect(screen.queryByText("Pending review")).toBeNull();
    expect(screen.queryByRole("region", { name: /Flywheel/ })).toBeNull();
  });
  it("preserves unsaved partner and coverage drafts when switching capabilities", async () => {
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Gate Services" }),
    );
    const flywheel = await screen.findByRole("region", {
      name: "Flywheel — Gatekeeping",
    });
    fireEvent.change(within(flywheel).getByLabelText("Unit price"), {
      target: { value: "99" },
    });
    fireEvent.click(screen.getByLabelText("Override company coverage"));
    change("Service radius (miles)", "800");
    fireEvent.click(screen.getByRole("button", { name: "Add capability" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Gate Services" }));
    expect(
      (screen.getByLabelText("Service radius (miles)") as HTMLInputElement)
        .value,
    ).toBe("800");
    const restored = await screen.findByRole("region", {
      name: "Flywheel — Gatekeeping",
    });
    expect(
      (within(restored).getByLabelText("Unit price") as HTMLInputElement).value,
    ).toBe("99");
  });
  it("clears a saved service override to inherit future company radius changes", async () => {
    areas.push({ ...area, id: 2, vendorCapabilityId: 10, radiusMiles: "750" });
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Gate Services" }),
    );
    expect(await screen.findByDisplayValue("750")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Use company default coverage" }),
    );
    expect(
      await screen.findByText("Using company default coverage"),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Service radius (miles)")).toBeNull();
    change("Company radius (miles)", "600");
    fireEvent.click(
      screen.getByRole("button", { name: "Save company coverage" }),
    );
    expect(await screen.findByText("Company default: 600 miles")).toBeTruthy();
    expect(areas.find((a) => a.vendorCapabilityId === 10)?.active).toBe(false);
    expect(writes().find((r) => r.method === "DELETE")?.path).toBe(
      "/api/service-marketplace/vendors/7/service-areas/capabilities/10",
    );
  });
  it("adds vendor wording and shows the stored canonical explanation", async () => {
    mount();
    await screen.findByText("Gate Services");
    fireEvent.click(screen.getByRole("button", { name: "Add capability" }));
    change("Service name", "Gate Services");
    change("Description", "Control entry and log visitors");
    change("Available crews", "3");
    fireEvent.click(
      screen.getByRole("button", { name: "Preview service match" }),
    );
    await screen.findByText("Proposed service match");
    fireEvent.click(
      screen.getByRole("button", { name: "Save and match service" }),
    );
    await screen.findByText(
      "Controlled entry, visitor logging, and vehicle verification.",
    );
    expect(screen.getByText("Gate and perimeter security")).toBeTruthy();
    expect(writes()[0].body).toMatchObject({
      name: "Gate Services",
      capacity: 3,
    });
    expect(screen.queryByLabelText("Latitude")).toBeNull();
  });
  it("shows company inheritance and saves a service-specific 500-mile override without coordinates", async () => {
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Gate Services" }),
    );
    expect(await screen.findByText("Company default: 500 miles")).toBeTruthy();
    expect(screen.getByText("Using company default coverage")).toBeTruthy();
    expect(
      await screen.findByText("2 matching partner catalog entries"),
    ).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Override company coverage"));
    change("Service radius (miles)", "500");
    fireEvent.click(
      screen.getByRole("button", { name: "Save service coverage" }),
    );
    await waitFor(() =>
      expect(
        writes().find((r) => r.path.endsWith("service-areas"))?.body,
      ).toEqual({ vendorCapabilityId: 10, radiusMiles: 500 }),
    );
  });
  it("saves company coverage and preserves an unsaved capability draft during refetch", async () => {
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Gate Services" }),
    );
    change("Description", "Unsaved service details");
    change("Company radius (miles)", "600");
    fireEvent.click(
      screen.getByRole("button", { name: "Save company coverage" }),
    );
    await waitFor(() =>
      expect(
        writes().some(
          (r) =>
            r.body.radiusMiles === 600 && r.body.vendorCapabilityId === null,
        ),
      ).toBe(true),
    );
    await client.invalidateQueries();
    expect(
      (screen.getByLabelText("Description") as HTMLInputElement).value,
    ).toBe("Unsaved service details");
  });
  it("rejects invalid radius before writing", async () => {
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Gate Services" }),
    );
    fireEvent.click(screen.getByLabelText("Override company coverage"));
    change("Service radius (miles)", "0");
    fireEvent.click(
      screen.getByRole("button", { name: "Save service coverage" }),
    );
    expect(
      await screen.findByText(
        "Enter a radius greater than 0 and no more than 20,000 miles, with up to three decimals.",
      ),
    ).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });
  it("blocks coverage when the current saved service base lacks valid coordinates", async () => {
    invalidBase = true;
    mount();
    expect(
      await screen.findByText(
        "Verify your company address and coordinates in Operating Area before saving coverage.",
      ),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Save company coverage",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("shows only approved demand fields and saves separate partner rates", async () => {
    // Extra fields deliberately model a future accidental server expansion: never render entire records.
    const fixture = demand[0] as MarketplaceDemand & {
      competitorName?: string;
      competitorRate?: string;
      budget?: string;
      privateNotes?: string;
    };
    Object.assign(fixture, {
      competitorName: "Secret competitor",
      competitorRate: "999.99",
      budget: "123456",
      privateNotes: "Private assessment",
    });
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Gate Services" }),
    );
    const flywheel = await screen.findByRole("region", {
      name: "Flywheel — Gatekeeping",
    });
    const warwick = screen.getByRole("region", {
      name: "Warwick — Perimeter Security",
    });
    expect(within(flywheel).getByText(/SafeLand/)).toBeTruthy();
    expect(within(warwick).getByText("Out of Service Area")).toBeTruthy();
    fireEvent.change(within(flywheel).getByLabelText("Unit price"), {
      target: { value: "48" },
    });
    fireEvent.change(within(warwick).getByLabelText("Unit price"), {
      target: { value: "55" },
    });
    fireEvent.click(
      within(flywheel).getByRole("button", { name: "Save partner rate" }),
    );
    await waitFor(() =>
      expect(
        writes().filter((r) => r.path.endsWith("partner-rates")),
      ).toHaveLength(1),
    );
    expect(
      (within(warwick).getByLabelText("Unit price") as HTMLInputElement).value,
    ).toBe("55");
    fireEvent.click(
      within(warwick).getByRole("button", { name: "Save partner rate" }),
    );
    await waitFor(() =>
      expect(
        writes().filter((r) => r.path.endsWith("partner-rates")),
      ).toHaveLength(2),
    );
    expect(
      writes()
        .filter((r) => r.path.endsWith("partner-rates"))
        .map((r) => [r.body.workTypeId, r.body.unitPrice]),
    ).toEqual([
      [31, 48],
      [32, 55],
    ]);
    expect(
      screen.queryByText(/Secret competitor|999.99|123456|Private assessment/),
    ).toBeNull();
  });
  it("keeps a saved but unclassified capability pending and hides commercial matches", async () => {
    pending = true;
    mount();
    await screen.findByText("Gate Services");
    fireEvent.click(screen.getByRole("button", { name: "Add capability" }));
    change("Service name", "New service");
    fireEvent.click(
      screen.getByRole("button", { name: "Preview service match" }),
    );
    await screen.findByText(
      "Matching partner count is unavailable while classification is pending review.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save and match service" }),
    );
    expect(await screen.findByText("Pending review")).toBeTruthy();
    expect(screen.queryByRole("region", { name: /Flywheel/ })).toBeNull();
  });
  it("retains the user's coverage draft and presents a helpful server failure", async () => {
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Gate Services" }),
    );
    fireEvent.click(screen.getByLabelText("Override company coverage"));
    change("Service radius (miles)", "700");
    failWrites = true;
    fireEvent.click(
      screen.getByRole("button", { name: "Save service coverage" }),
    );
    expect(
      await screen.findByText(
        "Verify your company address and coordinates in Operating Area before saving coverage.",
      ),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Service radius (miles)") as HTMLInputElement)
        .value,
    ).toBe("700");
  });
  it("keeps the legacy catalog and AFE controls accessible with the feature enabled", async () => {
    mount(true);
    expect(
      await screen.findByRole("button", { name: "Add capability" }),
    ).toBeTruthy();
    expect(await screen.findByText("Legacy Gatekeeping")).toBeTruthy();
    expect(screen.getByTestId("button-open-afe-modal-31")).toBeTruthy();
  });
  it("does not request marketplace data when the rollout flag is off", async () => {
    vi.stubEnv("VITE_SEMANTIC_SERVICE_MARKETPLACE_ENABLED", "false");
    mount(true);
    await screen.findByText("Legacy Gatekeeping");
    expect(screen.queryByRole("button", { name: "Add capability" })).toBeNull();
    expect(requests.some((r) => r.path.includes("service-marketplace"))).toBe(
      false,
    );
  });
});

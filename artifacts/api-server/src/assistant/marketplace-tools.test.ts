import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { buildTestCookie } from "../test-utils/session";
import { createServiceMarketplaceRouter } from "../routes/serviceMarketplace";
import type {
  VendorMarketplaceStore,
  MarketplaceCapability,
} from "../services/marketplace/vendor-store";
import type { JobOfferService } from "../services/marketplace/job-offers";
import type { SessionPayload } from "../lib/session";
import {
  runMarketplaceTool,
  type MarketplaceDomainCall,
} from "./marketplace-tools";
import { runBoundTypedAskVTool } from "./askv-pending-confirmation";

// Only persistence and device publication are replaced. The confirmation state machine,
// fingerprints, adapter, HTTP authorization and public projection execute unchanged.
vi.mock("./device-context", () => ({
  publishAskVDeviceEvent: async () => undefined,
}));
vi.mock("./askv-idempotency", async (original) => {
  const actual = await original<typeof import("./askv-idempotency")>();
  const store = new actual.AskVIdempotencyStore();
  return { ...actual, runPersistentAskVMutation: store.run.bind(store) };
});
const vendor: SessionPayload = {
  userId: 7,
  role: "vendor",
  vendorId: 3,
  membershipRole: "admin",
  activeMembershipId: 4,
};
const capability = {
  id: 7,
  vendorId: 3,
  name: "Gate Services",
  description: "Visitor logs",
  defaultUnit: "hour",
  defaultRateCard: null,
  capacity: 2,
  qualifications: null,
  evidence: null,
  active: true,
  createdById: 7,
  createdAt: new Date(),
  updatedAt: new Date(),
  mapping: {
    canonicalServiceId: 5,
    canonicalServiceName: "Gate and perimeter security",
    status: "active",
    explanation: "Stored mapping: controlled entry and visitor logging",
    confidence: 0.98,
  },
};
function fixture() {
  const authority = { allowed: true };
  const records: MarketplaceCapability[] = [structuredClone(capability)];
  const store: VendorMarketplaceStore = {
    authorize: async () => authority.allowed,
    listCapabilities: async () => records,
    getCapability: async (vendorId, id) =>
      records.find((row) => row.vendorId === vendorId && row.id === id) ?? null,
    saveCapability: async (vendorId, id, body) => {
      const row = { ...capability, ...body, vendorId, id: id ?? 8 };
      records.push(row);
      return row;
    },
    listAreas: async () => [],
    countMatchingDemand: async () => 2,
    clearAreaOverride: async () => undefined,
    saveArea: async () => {
      throw new Error("Unused");
    },
    listRates: async () => [],
    getRateTarget: async () => null,
    saveRate: async () => {
      throw new Error("Unused");
    },
    listDemand: async () =>
      [9, 10].map((partnerId) => ({
        partnerId,
        partnerName: `Partner ${partnerId}`,
        workTypeId: partnerId + 12,
        name: "Perimeter Security",
        category: "Security",
        description: "Controlled entry",
        requiredCertifications: [],
        locations: [{ state: "OK", approximateSiteCount: 10, latitude: 35 }],
        approximateDemand: 10,
        capabilityId: 7,
        ownOffer: null,
        privateNotes: "PRIVATE",
        competitors: [{ name: "SECRET", rate: 1 }],
        eligibility: {
          eligible: false,
          reasonCodes: ["OFFER_INACTIVE"],
          facts: {
            distanceMiles: 12.34,
            radiusMiles: 100,
            availableCapacity: 2,
            requiredCapacity: 1,
            missingCredentials: [],
          },
        },
      })) as never,
  };
  let accepted = false;
  const offers = {
    acceptJobOffer: async () => {
      accepted = true;
      return { offerId: 42, ticketId: 901 };
    },
    getJobOffer: async () => ({
      id: 42,
      status: accepted ? "accepted" : "offered",
      createdTicketId: accepted ? 901 : null,
      commercialSnapshot: {
        unitPrice: "75",
        requestFingerprint: "private-fingerprint",
      },
      idempotencyKey: "private-key",
    }),
  } as unknown as JobOfferService;
  const app = express()
    .use(cookieParser(), express.json())
    .use(
      "/api",
      createServiceMarketplaceRouter({
        store,
        jobOffers: offers,
        classifyCapability: async () => undefined,
      }),
    );
  const calls: {
    path: string;
    method: string;
    body: Record<string, unknown>;
    headers: Record<string, string>;
  }[] = [];
  const call: MarketplaceDomainCall = async (
    path,
    method,
    body,
    session,
    headers = {},
  ) => {
    calls.push({ path, method, body, headers });
    const response = await request(app)
      [method.toLowerCase() as "get"](`/api${path}`)
      .set("Cookie", buildTestCookie(session))
      .set(headers)
      .send(method === "GET" ? undefined : body);
    return response.status >= 400
      ? { ...response.body, ok: false, status: response.status }
      : response.body;
  };
  return { call, calls, records, authority };
}
describe("marketplace assistant domain boundary", () => {
  it("reads every partner's approved demand projection without competitor or precise site data", async () => {
    const f = fixture();
    const result = await runMarketplaceTool(
      "query_marketplace_demand",
      {},
      vendor,
      false,
      f.call,
    );
    expect(result).toMatchObject({
      items: [{ partnerId: 9 }, { partnerId: 10 }],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE|SECRET|latitude|12\.34/,
    );
    expect(result).toMatchObject({
      items: [{ eligibility: { facts: { distanceMiles: 20 } } }, {}],
    });
  });
  it("rejects foreign vendor scope, missing scope, and field employee marketplace tools", async () => {
    const f = fixture();
    for (const session of [
      { ...vendor, vendorId: null },
      { ...vendor, role: "field_employee" },
    ]) {
      expect(
        await runMarketplaceTool(
          "query_marketplace_demand",
          {},
          session,
          false,
          f.call,
        ),
      ).toMatchObject({ ok: false });
    }
    expect(
      await runMarketplaceTool(
        "query_marketplace_demand",
        { vendorId: 999 },
        vendor,
        false,
        f.call,
      ),
    ).toMatchObject({ ok: false });
    expect(f.calls).toHaveLength(0);
  });
  it("fails closed when an administrator selects both company scopes", async () => {
    const f = fixture();
    expect(
      await runMarketplaceTool(
        "search_marketplace_services",
        { vendorId: 3, partnerId: 9 },
        { userId: 1, role: "admin" },
        false,
        f.call,
      ),
    ).toMatchObject({ ok: false });
    expect(f.calls).toHaveLength(0);
  });
  it("explains from the requesting vendor's saved mapping instead of model confidence", async () => {
    const f = fixture();
    expect(
      await runMarketplaceTool(
        "explain_marketplace_match",
        { capabilityId: 7, confidence: 1 },
        vendor,
        false,
        f.call,
      ),
    ).toMatchObject({
      mapping: {
        canonicalServiceId: 5,
        explanation: "Stored mapping: controlled entry and visitor logging",
        confidence: 0.98,
      },
    });
  });
  it("rechecks revoked membership at the canonical boundary", async () => {
    const f = fixture();
    f.authority.allowed = false;
    expect(
      await runMarketplaceTool(
        "query_marketplace_demand",
        {},
        vendor,
        false,
        f.call,
      ),
    ).toMatchObject({ ok: false, status: 403 });
  });
  it("does not let partner comparisons select another company or vendor callers compare competitors", async () => {
    const f = fixture();
    const partner = {
      userId: 9,
      role: "partner",
      partnerId: 9,
      activeMembershipId: 8,
      membershipRole: "member",
    };
    expect(
      await runMarketplaceTool(
        "compare_marketplace_vendors",
        { partnerId: 10, workTypeId: 21, siteId: 8 },
        partner,
        false,
        f.call,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await runMarketplaceTool(
        "compare_marketplace_vendors",
        { partnerId: 9, workTypeId: 21, siteId: 8 },
        vendor,
        false,
        f.call,
      ),
    ).toMatchObject({ ok: false });
    expect(f.calls).toHaveLength(0);
  });
  it("requires server authorization even when the model supplies confirmation and a replay key", async () => {
    const f = fixture();
    expect(
      await runMarketplaceTool(
        "confirm_marketplace_capability",
        {
          payload: { name: "Gate Services" },
          confirmed: true,
          idempotencyKey: "forged",
        },
        vendor,
        false,
        f.call,
      ),
    ).toMatchObject({ requiresConfirmation: true });
    expect(f.records).toHaveLength(1);
    expect(f.calls).toHaveLength(0);
  });
  it("binds the user's later approval to the exact capability and returns canonical persisted data on retry", async () => {
    const f = fixture();
    const invoke = (payload: object, phrase: string, turnId: number) =>
      runBoundTypedAskVTool({
        name: "confirm_marketplace_capability",
        input: { payload, confirmed: true },
        session: vendor,
        conversationId: 10101,
        turnId,
        contextKey: "/service-marketplace",
        phrase,
        execute: async (input) =>
          JSON.stringify(
            await runMarketplaceTool(
              "confirm_marketplace_capability",
              input,
              vendor,
              true,
              f.call,
            ),
          ),
      }).then(JSON.parse);
    expect(await invoke({ name: "Gate Services" }, "add it", 1)).toMatchObject({
      requiresConfirmation: true,
    });
    expect(await invoke({ name: "Transport" }, "yes", 2)).toMatchObject({
      requiresConfirmation: true,
    });
    expect(f.records).toHaveLength(1);
    const saved = await invoke({ name: "Transport" }, "yes", 3);
    expect(saved).toMatchObject({ id: 8, name: "Transport", vendorId: 3 });
    expect(await invoke({ name: "Transport" }, "yes", 3)).toEqual(saved);
    expect(f.records).toHaveLength(2);
  });
  it("ignores invented coordinates, compliance and confidence in the canonical write payload", async () => {
    const f = fixture();
    const result = await runMarketplaceTool(
      "confirm_marketplace_capability",
      {
        confirmed: true,
        idempotencyKey: "server-key",
        payload: {
          name: "Gate Services",
          latitude: 0,
          longitude: 0,
          complianceCurrent: true,
          confidence: 1,
          canonicalServiceId: 99,
        },
      },
      vendor,
      true,
      f.call,
    );
    expect(result).toMatchObject({ id: 8 });
    expect(f.calls[0].body).toEqual({ name: "Gate Services" });
    expect(f.calls[0].headers).toEqual({ "Idempotency-Key": "server-key" });
  });
  it("acceptance reads back the canonical offer and created ticket ID", async () => {
    const f = fixture();
    const result = await runMarketplaceTool(
      "confirm_marketplace_job_offer_action",
      {
        action: "accept",
        offerId: 42,
        version: 1,
        confirmed: true,
        idempotencyKey: "accepted-once",
      },
      vendor,
      true,
      f.call,
    );
    expect(result).toMatchObject({
      id: 42,
      status: "accepted",
      createdTicketId: 901,
      ticketId: 901,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private-key|private-fingerprint/,
    );
    expect(f.calls.map((call) => call.method)).toEqual(["POST", "GET"]);
  });
  it("reports an uncertain outcome if a write response or canonical readback is lost", async () => {
    const f = fixture();
    const input = {
      action: "accept",
      offerId: 42,
      version: 1,
      confirmed: true,
      idempotencyKey: "uncertain-once",
    };
    const dropped: MarketplaceDomainCall = async () => {
      throw new Error("Connection interrupted");
    };
    expect(
      await runMarketplaceTool(
        "confirm_marketplace_job_offer_action",
        input,
        vendor,
        true,
        dropped,
      ),
    ).toMatchObject({ ok: false, outcomeUnknown: true });
    const unreadable: MarketplaceDomainCall = async (...args) =>
      args[1] === "GET"
        ? { ok: false, status: 503, error: "Unavailable" }
        : f.call(...args);
    expect(
      await runMarketplaceTool(
        "confirm_marketplace_job_offer_action",
        input,
        vendor,
        true,
        unreadable,
      ),
    ).toMatchObject({ ok: false, outcomeUnknown: true });
  });
});

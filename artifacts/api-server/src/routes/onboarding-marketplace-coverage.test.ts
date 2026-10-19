import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildTestCookie } from "../test-utils/session";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { PLATFORM_EULA_VERSION } from "../lib/platform-eula-acceptance";
import { LEGAL_POLICY_VERSION } from "../lib/legal-consent";
import { evaluateMarketplaceEligibility } from "../services/marketplace/eligibility";

const state = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, failEmployee: false, depth: 0, coverageWriteDepths: [] as number[] }));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {} }));
// Only the external database is replaced. Routes, AskV delegation, validation,
// source-address comparison, atomic coverage retirement and eligibility are real.
vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema");
  const query = (mode: string, initial?: any) => {
    let table = initial, condition: any, values: any;
    const execute = async () => {
      const name = getTableName(table);
      if (name === "vendor_people" && state.failEmployee) throw new Error("fixture employee failure");
      let rows = state.rows[name] ?? [];
      if (condition) {
        const built = new PgDialect().sqlToQuery(condition);
        for (const [, column, slot] of built.sql.matchAll(/"[^".]+"\."([^".]+)" = \$(\d+)/g)) {
          const key = column.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
          rows = rows.filter(row => row[key] === built.params[Number(slot) - 1]);
        }
      }
      if (mode === "update") {
        if (name === "vendor_service_areas") state.coverageWriteDepths.push(state.depth);
        for (const row of rows) Object.assign(row, values);
      }
      return structuredClone(rows);
    };
    const q: any = { from: (value: any) => { table = value; return q; }, where: (value: any) => { condition = value; return q; },
      set: (value: any) => { values = value; return q; }, for: () => q, limit: () => q,
      returning: execute, then: (resolve: any, reject: any) => execute().then(resolve, reject) };
    return q;
  };
  const db: any = {
    select: () => query("select"), update: (table: any) => query("update", table),
    execute: async () => ({ rows: [{ operations_categories: ["field"] }] }),
    transaction: async (run: any) => {
      const before = structuredClone(state.rows);
      state.depth++;
      try { return await run(db); } catch (err) { state.rows = before; throw err; } finally { state.depth--; }
    },
  };
  return { ...schema, db, pool: { connect: async () => { throw new Error("Unexpected raw database access"); } } };
});
import onboardingRouter from "./onboarding";
import { runTool } from "./assistant";

const now = new Date("2026-10-18T00:00:00Z");
const session = { userId: 1, role: "vendor", vendorId: 3, membershipRole: "admin" } as const;
const cookie = buildTestCookie(session);
const app = express().use(cookieParser()).use(express.json()).use("/api", onboardingRouter);
attachTestErrorMiddleware(app);
const vendor = () => state.rows.vendors[0];
const areas = () => state.rows.vendor_service_areas;
const progress = () => state.rows.onboarding_progress[0];
const coverage = () => evaluateMarketplaceEligibility({ vendorId: 3, partnerId: 9, workTypeId: 21, authorized: true, companyActive: true,
  capability: { id: 7, vendorId: 3, active: true, capacity: 1 }, capabilityMapping: { canonicalServiceId: 1, status: "active", supersededAt: null },
  demandMapping: { canonicalServiceId: 1, status: "active", supersededAt: null }, canonicalServiceActive: true,
  offer: { id: 1, vendorCapabilityId: 7, partnerId: 9, workTypeId: 21, active: true, capacity: 1, effectiveFrom: now, effectiveUntil: null },
  serviceAreas: areas(), site: { latitude: 35, longitude: -97 }, complianceCurrent: true, requiredCredentials: [], currentCredentials: [], requestedCapacity: 1, available: true, now });
beforeEach(() => {
  state.failEmployee = false;
  state.depth = 0;
  state.coverageWriteDepths = [];
  state.rows = {
    vendors: [{ id: 3, physicalAddress: "Old base", latitude: 35, longitude: -97, geocodedAt: now, insuranceCarrier: "Keep insurer", brandPrimaryColor: "#123456" }],
    vendor_service_areas: [null, 7].map((vendorCapabilityId, index) => ({ id: index + 1, vendorId: 3, vendorCapabilityId, active: true, verifiedAt: now, effectiveFrom: now, effectiveUntil: null, latitude: 35, longitude: -97, radiusMiles: "50" })),
    work_types: [{ id: 21, partnerId: null }], partner_vendor_relationships: [], vendor_people: [{ id: 4, vendorId: 3, email: "worker@example.invalid", userId: 5, inviteToken: null }],
    onboarding_progress: [{ id: 10, orgType: "vendor", vendorId: 3, partnerId: null, currentStep: "tax-ids", completedSteps: [], skippedSteps: [], startedAt: now, updatedAt: now, completedAt: now,
      payload: { taxIds: { federalTaxId: "tax", stateTaxId: "state", physicalAddress: "New base", billingAddress: "Billing" }, platformEula: { accepted: true, version: PLATFORM_EULA_VERSION }, legalConsent: { accepted: true, version: LEGAL_POLICY_VERSION }, serviceArea: { operatingRadiusMiles: 100 }, workTypeIds: [21], firstEmployee: { firstName: "Test", lastName: "Worker", email: "worker@example.invalid" } } }],
  };
  areas().push({ ...areas()[0], id: 99, vendorId: 99 });
});
afterEach(() => vi.restoreAllMocks());

describe("onboarding address and marketplace coverage", () => {
  it("retires default/override areas when Save and Quit completes changed tax details", async () => {
    expect((await coverage()).eligible).toBe(true);
    const result = await request(app).put("/api/onboarding/vendor/3/progress").set("Cookie", cookie).send({ completedSteps: ["tax-ids"], currentStep: "work-types" });
    expectStatus(result, 200);
    expect(vendor()).toMatchObject({ physicalAddress: "New base", latitude: null, longitude: null, geocodedAt: null, federalTaxId: "tax", billingAddress: "Billing" });
    expect(areas().slice(0, 2).every(area => !area.active)).toBe(true);
    expect(areas()[2].active).toBe(true);
    expect((await coverage()).reasonCodes).toEqual(["SERVICE_AREA_MISSING"]);
    expect(state.coverageWriteDepths).toEqual([1]);
  });
  it.each(["wizard", "AskV"])("rerunnable %s completion invalidates changed address coverage in the existing transaction", async lane => {
    if (lane === "AskV") {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
        const response = await request(app).post(new URL(String(url)).pathname).set("Cookie", new Headers(init?.headers).get("cookie") ?? "").send(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify(response.body), { status: response.status });
      });
      expect(JSON.parse(await runTool("finalize_onboarding", {}, session, cookie))).toMatchObject({ ok: true });
    } else {
      expectStatus(await request(app).post("/api/onboarding/vendor/3/complete").set("Cookie", cookie).send({}), 200);
    }
    expect(vendor()).toMatchObject({ physicalAddress: "New base", latitude: null, longitude: null, geocodedAt: null, insuranceCarrier: "Keep insurer", brandPrimaryColor: "#123456" });
    expect((await coverage()).reasonCodes).toEqual(["SERVICE_AREA_MISSING"]);
    expect(areas()[2].active).toBe(true);
    expect(state.coverageWriteDepths).toEqual([1]);
    expect(state.rows.vendor_people).toHaveLength(1);
  });
  it("does not retire unchanged-address coverage on repeated completion", async () => {
    progress().payload.taxIds.physicalAddress = "Old base";
    for (let repeat = 0; repeat < 2; repeat++) expectStatus(await request(app).post("/api/onboarding/vendor/3/complete").set("Cookie", cookie).send({}), 200);
    expect((await coverage()).eligible).toBe(true);
    expect(vendor().geocodedAt).toEqual(now);
    expect(state.coverageWriteDepths).toEqual([]);
  });
  it("rolls back address and retired areas if a later completion write fails", async () => {
    state.failEmployee = true;
    expectStatus(await request(app).post("/api/onboarding/vendor/3/complete").set("Cookie", cookie).send({}), 500);
    expect(vendor()).toMatchObject({ physicalAddress: "Old base", latitude: 35, longitude: -97, geocodedAt: now });
    expect((await coverage()).eligible).toBe(true);
  });
});

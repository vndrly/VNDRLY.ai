import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, getTableColumns } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildTestCookie } from "../test-utils/session";
import { subjectFingerprint } from "../services/service-matching/candidates";
import { vendorsTable } from "@workspace/db/schema";

const state = vi.hoisted(() => ({
  vendor: {} as Record<string, unknown>,
  matches: [] as any[],
  areas: [] as any[],
  capabilities: [] as any[],
  previewMatches: [] as any[],
  canonicalActive: true,
  writes: [] as string[],
}));

// Replace only external persistence. Real routes, validation, mapping checks,
// projection, geographic evaluation, and geocode-address guards remain real.
vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual<typeof import("@workspace/db/schema")>(
    "@workspace/db/schema",
  );
  function query(
    mode: "select" | "update" | "insert",
    initialTable?: unknown,
    fields?: Record<string, unknown>,
  ) {
    let table = initialTable;
    let values: any;
    let take: number | undefined;
    let skip = 0;
    let condition: any;
    const builder: any = {
      from(value: unknown) {
        table = value;
        return builder;
      },
      innerJoin() {
        return builder;
      },
      leftJoin() {
        return builder;
      },
      where(value: unknown) {
        condition = value;
        return builder;
      },
      orderBy() {
        return builder;
      },
      for() {
        return builder;
      },
      limit(value: number) {
        take = value;
        return builder;
      },
      offset(value: number) {
        skip = value;
        return builder;
      },
      set(value: unknown) {
        values = value;
        return builder;
      },
      values(value: unknown) {
        values = value;
        return builder;
      },
      async execute() {
        const name = getTableName(table as never);
        if (mode === "select") {
          const rows =
            name === "vendors"
              ? [structuredClone(state.vendor)]
              : name === "vendor_capabilities" && fields?.capability
                ? state.matches
                : name === "canonical_services"
                  ? [{ active: state.canonicalActive }]
                  : name === "work_types" && fields?.mapping
                    ? state.previewMatches
                    : name === "vendor_capabilities"
                      ? state.capabilities.filter((row) => {
                          const params = new PgDialect().sqlToQuery(
                            condition,
                          ).params;
                          return (
                            row.vendorId === params[0] && row.id === params[1]
                          );
                        })
                      : name === "vendor_service_areas"
                        ? state.areas
                        : [];
          return rows.slice(skip, take === undefined ? undefined : skip + take);
        }
        if (name === "vendors") {
          // Apply the real emitted address predicate, so omitting it lets the
          // stale Oklahoma result overwrite the Texas row and fails the test.
          const params = condition
            ? new PgDialect().sqlToQuery(condition).params
            : [];
          const address = params.find((value) => typeof value === "string");
          if (address !== undefined && address !== state.vendor.physicalAddress)
            return [];
          Object.assign(state.vendor, values);
          state.writes.push(name);
          return [structuredClone(state.vendor)];
        }
        if (name === "vendor_service_areas" && mode === "update") {
          const params = new PgDialect().sqlToQuery(condition).params;
          const capabilityId = typeof params[1] === "number" ? params[1] : null;
          for (const row of state.areas)
            if (
              row.vendorId === params[0] &&
              row.vendorCapabilityId === capabilityId &&
              row.active
            )
              Object.assign(row, values);
          state.writes.push(name);
          return [];
        }
        if (name === "vendor_service_areas" && mode === "insert") {
          const row = { id: state.areas.length + 1, ...values };
          state.areas.push(row);
          state.writes.push(name);
          return [row];
        }
        return [];
      },
      returning() {
        return builder.execute();
      },
      then(
        resolve: (value: any) => unknown,
        reject: (error: unknown) => unknown,
      ) {
        return builder.execute().then(resolve, reject);
      },
    };
    return builder;
  }
  const db: any = {
    select: (fields?: Record<string, unknown>) =>
      query("select", undefined, fields),
    update: (table: unknown) => query("update", table),
    insert: (table: unknown) => query("insert", table),
    execute: async () => [],
  };
  db.transaction = (run: (tx: unknown) => Promise<unknown>) => run(db);
  return { ...schema, db };
});

import vendorsRouter from "./vendors";
import hotlistRouter from "./hotlist";
import { createPostgresVendorMarketplaceStore } from "../services/marketplace/vendor-store";

const admin = buildTestCookie({ userId: 1, role: "admin" });
let app: express.Express;
beforeEach(() => {
  state.vendor = {
    ...Object.fromEntries(
      Object.keys(getTableColumns(vendorsTable)).map((key) => [key, null]),
    ),
    id: 3,
    name: "MidCon",
    contactName: "Office",
    contactEmail: "office@example.com",
    physicalAddress: "Oklahoma City, OK 73102",
    latitude: 35.4676,
    longitude: -97.5164,
    geocodedAt: new Date("2026-10-17T12:00:00Z"),
    createdAt: new Date(),
    operatingRadiusMiles: 500,
    accountingFailureNotificationsEnabled: true,
    accountingReconciliationNotificationsEnabled: false,
    accountingReconciliationDigestCadence: "per_push",
    agingThresholdDays: [1, 15, 30],
    eDeliveryConsent: false,
  };
  state.matches = [];
  state.areas = [];
  state.capabilities = [];
  state.previewMatches = [];
  state.canonicalActive = true;
  state.writes = [];
  app = express()
    .use(cookieParser())
    .use(express.json())
    .use("/api", vendorsRouter)
    .use("/api", hotlistRouter)
    .use(
      (
        error: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(500).json({ error: error.message });
      },
    );
});
afterEach(() => vi.unstubAllGlobals());

describe("marketplace persisted vendor boundaries", () => {
  it("counts only current saved demand snapshots across batches without catalog or commercial writes", async () => {
    state.previewMatches = Array.from({ length: 102 }, (_, index) => {
      const workType = {
        id: index + 1,
        partnerId: 9,
        name: `Gate ${index}`,
        description: "Visitor logs",
        category: "Security",
      };
      return {
        workType,
        mapping: {
          evidence: {
            serviceMatching: {
              subjectFingerprint: subjectFingerprint({
                subjectType: "partner_work_type",
                subjectId: workType.id,
                name: index < 100 ? "Stale wording" : workType.name,
                description: workType.description,
                category: workType.category,
              }),
            },
          },
        },
      };
    });
    const store = createPostgresVendorMarketplaceStore();
    expect(await store.countMatchingDemand(5)).toBe(2);
    expect(state.writes).toEqual([]);
    expect(state.capabilities).toEqual([]);
    expect(state.areas).toEqual([]);
    state.canonicalActive = false;
    expect(await store.countMatchingDemand(5)).toBeNull();
  });
  it("ends only the owned service override, preserving history, defaults, and other scopes", async () => {
    state.capabilities = [
      { id: 7, vendorId: 3 },
      { id: 8, vendorId: 4 },
    ];
    state.areas = [
      {
        id: 1,
        vendorId: 3,
        vendorCapabilityId: null,
        active: true,
        radiusMiles: "500",
        effectiveUntil: null,
      },
      {
        id: 2,
        vendorId: 3,
        vendorCapabilityId: 7,
        active: true,
        radiusMiles: "750",
        effectiveUntil: null,
      },
      {
        id: 3,
        vendorId: 4,
        vendorCapabilityId: 8,
        active: true,
        radiusMiles: "900",
        effectiveUntil: null,
      },
      {
        id: 4,
        vendorId: 3,
        vendorCapabilityId: 9,
        active: true,
        radiusMiles: "100",
        effectiveUntil: null,
      },
    ];
    const store = createPostgresVendorMarketplaceStore();
    await store.clearAreaOverride(3, 7, 1);
    expect(state.areas).toHaveLength(4);
    expect(state.areas[1]).toMatchObject({
      active: false,
      radiusMiles: "750",
      effectiveUntil: expect.any(Date),
    });
    expect(
      state.areas.filter((row) => row.active).map((row) => row.id),
    ).toEqual([1, 3, 4]);
    const endedAt = state.areas[1].effectiveUntil;
    await store.clearAreaOverride(3, 7, 1);
    expect(state.areas[1].effectiveUntil).toEqual(endedAt);
    await expect(store.clearAreaOverride(3, 8, 1)).rejects.toMatchObject({
      code: "marketplace.capability_not_found",
    });
    expect(state.areas[2].active).toBe(true);
  });
  it("cannot verify Oklahoma coordinates as a Texas service base after a profile address edit", async () => {
    const changed = await request(app)
      .patch("/api/vendors/3")
      .set("Cookie", admin)
      .send({ physicalAddress: "Houston, TX 77002" });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(state.vendor).toMatchObject({
      physicalAddress: "Houston, TX 77002",
      latitude: null,
      longitude: null,
      geocodedAt: null,
    });
    await expect(
      createPostgresVendorMarketplaceStore().saveArea(
        3,
        { vendorCapabilityId: null, radiusMiles: 500 },
        1,
      ),
    ).rejects.toMatchObject({
      code: "marketplace.verified_service_base_required",
    });
    expect(state.areas).toEqual([]);
  });

  it("preserves verified coordinates when the address itself has not changed", async () => {
    const changed = await request(app)
      .patch("/api/vendors/3")
      .set("Cookie", admin)
      .send({
        physicalAddress: "Oklahoma City, OK 73102",
        contactName: "New contact",
      });
    expect(changed.status).toBe(200);
    expect(state.vendor).toMatchObject({
      latitude: 35.4676,
      longitude: -97.5164,
      geocodedAt: new Date("2026-10-17T12:00:00Z"),
    });
    const row = await createPostgresVendorMarketplaceStore().saveArea(
      3,
      { vendorCapabilityId: null, radiusMiles: 500 },
      1,
    );
    expect(row).toMatchObject({
      address: "Oklahoma City, OK 73102",
      latitude: 35.4676,
      longitude: -97.5164,
    });
  });

  it("verifies the new Texas base only after a fresh lookup for the Texas address", async () => {
    expect(
      (
        await request(app)
          .patch("/api/vendors/3")
          .set("Cookie", admin)
          .send({ physicalAddress: "Houston, TX 77002" })
      ).status,
    ).toBe(200);
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => [{ lat: "29.7604", lon: "-95.3698" }],
    }));
    const geocode = await request(app)
      .patch("/api/hotlist/vendors/3/operating-area")
      .set("Cookie", admin)
      .send({ operatingRadiusMiles: 500, refreshGeocode: true });
    expect(geocode.status).toBe(200);
    const area = await createPostgresVendorMarketplaceStore().saveArea(
      3,
      { vendorCapabilityId: null, radiusMiles: 500 },
      1,
    );
    expect(area).toMatchObject({
      address: "Houston, TX 77002",
      latitude: 29.7604,
      longitude: -95.3698,
    });
  });

  it("discards an in-flight Oklahoma geocode when the profile changes to Texas", async () => {
    vi.stubGlobal("fetch", async () => {
      const changed = await request(app)
        .patch("/api/vendors/3")
        .set("Cookie", admin)
        .send({ physicalAddress: "Houston, TX 77002" });
      expect(changed.status).toBe(200);
      return {
        ok: true,
        json: async () => [{ lat: "35.4676", lon: "-97.5164" }],
      };
    });
    const geocode = await request(app)
      .patch("/api/hotlist/vendors/3/operating-area")
      .set("Cookie", admin)
      .send({ operatingRadiusMiles: 500, refreshGeocode: true });
    expect(geocode.status).toBe(409);
    expect(geocode.body.code).toBe("hotlist.address_changed");
    expect(state.vendor).toMatchObject({
      physicalAddress: "Houston, TX 77002",
      latitude: null,
      longitude: null,
      geocodedAt: null,
    });
    await expect(
      createPostgresVendorMarketplaceStore().saveArea(
        3,
        { vendorCapabilityId: null, radiusMiles: 500 },
        1,
      ),
    ).rejects.toMatchObject({
      code: "marketplace.verified_service_base_required",
    });
  });

  it.each([
    [2, 3, 4],
    [205, 206, 207],
  ])(
    "paginates current matches after %i stale mappings, without hiding valid demand",
    async (staleCount, firstId, secondId) => {
      const capability = {
        id: 7,
        vendorId: 3,
        name: "Gate Services",
        description: "Visitor logs",
        active: true,
        capacity: 1,
      };
      const capabilityMapping = {
        canonicalServiceId: 5,
        status: "active",
        supersededAt: null,
        evidence: {
          serviceMatching: {
            subjectFingerprint: subjectFingerprint({
              subjectType: "vendor_capability",
              subjectId: 7,
              name: capability.name,
              description: capability.description,
            }),
          },
        },
      };
      state.matches = Array.from(
        { length: staleCount + 2 },
        (_, index) => index + 1,
      ).map((id, index) => {
        const workType = {
          id,
          partnerId: 9,
          name: `Gate ${id}`,
          category: "Security",
          description: "Visitor logs",
          requiredCertifications: [],
          blockingCertifications: [],
        };
        const snapshot = {
          subjectType: "partner_work_type" as const,
          subjectId: id,
          name: index < staleCount ? "Old wording" : workType.name,
          category: workType.category,
          description: workType.description,
        };
        return {
          capability,
          capabilityMapping,
          demandMapping: {
            canonicalServiceId: 5,
            status: "active",
            supersededAt: null,
            evidence: {
              serviceMatching: {
                subjectFingerprint: subjectFingerprint(snapshot),
              },
            },
          },
          workType,
          partnerName: "Flywheel",
        };
      });
      const store = createPostgresVendorMarketplaceStore();
      expect(
        (await store.listDemand(3, 1, 0)).map((row) => row.workTypeId),
      ).toEqual([firstId]);
      expect(
        (await store.listDemand(3, 1, 1)).map((row) => row.workTypeId),
      ).toEqual([secondId]);
      expect(await store.listDemand(3, 1, 2)).toEqual([]);
    },
  );
});


describe("device-selected operating radius center", () => {
  it("stores opted-in device coordinates without claiming address verification", async () => {
    const response = await request(app).patch("/api/hotlist/vendors/3/operating-area").set("Cookie", admin).send({operatingRadiusMiles:125.5,currentLocation:{latitude:32.2,longitude:-101.8}});
    expect(response.status).toBe(200);
    expect(state.vendor).toMatchObject({operatingRadiusMiles:125.5,latitude:32.2,longitude:-101.8,geocodedAt:null,physicalAddress:"Oklahoma City, OK 73102"});
  });
  it.each([{latitude:91,longitude:0},{latitude:0,longitude:-181},{latitude:"32",longitude:-102},null])("rejects invalid device coordinates without writing", async currentLocation => {
    const before={...state.vendor};
    const response=await request(app).patch("/api/hotlist/vendors/3/operating-area").set("Cookie",admin).send({operatingRadiusMiles:100,currentLocation});
    expect(response.status).toBe(400);expect(state.vendor).toEqual(before);
  });
  it("keeps operating-area edits limited to the owner or administrator",async()=>{
    const before={...state.vendor};
    const cookie=buildTestCookie({userId:9,role:"vendor",vendorId:4,exp:Math.floor(Date.now()/1000)+3600});
    const response=await request(app).patch("/api/hotlist/vendors/3/operating-area").set("Cookie",cookie).send({operatingRadiusMiles:100,currentLocation:{latitude:32,longitude:-102}});
    expect(response.status).toBe(403);expect(state.vendor).toEqual(before);
  });
});

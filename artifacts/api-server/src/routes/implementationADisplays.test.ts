import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { buildTestCookie } from "../test-utils/session";

const state = vi.hoisted(() => ({ queries: [] as Array<{ sql: string; params: unknown[] }>, empty: false }));
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return { ...original, db: { select: () => ({ from: (table: unknown) => ({ where: async (condition: SQL) => {
    const query = new PgDialect().sqlToQuery(condition);
    state.queries.push(query);
    if (table === original.operationsDisplaysTable) {
      if (state.empty) return [];
      return [{ id: "display-7", name: "Dispatch", ownerOrgType: "vendor", ownerOrgId: 7,
        privacyMode: "private", siteAllowlist: [12], viewAllowlist: ["crew_map"],
        tokenHash: "PRIVATE_HASH", tokenExpiresAt: "PRIVATE_EXPIRY", registeredCompanionDeviceId: "PRIVATE_DEVICE",
        revokedAt: null, updatedAt: "2026-10-06T12:00:00Z" }];
    }
    return [{ id: "output-7", displayId: "display-7", name: "Left TV", currentView: "crew_map",
      currentSiteLocationId: 12, currentMeetingOccurrenceId: null, updatedAt: "2026-10-06T12:00:00Z" }];
  } }) }) } };
});
import router from "./implementationADisplays";
const app = express().use(express.json()).use(cookieParser()).use(router);
beforeEach(() => { state.queries = []; state.empty = false; });

describe("operations display discovery", () => {
  it.each([
    { role: "vendor", vendorId: 7, membershipRole: "admin", owner: "vendor" },
    { role: "partner", partnerId: 7, membershipRole: "admin", owner: "partner" },
  ])("scopes discovery to the active $owner and omits pairing secrets", async identity => {
    const response = await request(app).get("/implementation-a/operations-displays")
      .set("Cookie", buildTestCookie({ userId: 13, ...identity }));
    expect(response.status).toBe(200);
    expect(state.queries[0].params).toEqual([identity.owner, 7]);
    expect(state.queries[0].sql).toContain('"owner_org_type"');
    expect(state.queries[0].sql).toContain('"owner_org_id"');
    expect(state.queries[1].params).toEqual(["display-7"]);
    expect(response.body.controlRequiresAuthenticatedCompanion).toBe(true);
    expect(response.body.displays[0].outputs[0]).toMatchObject({ name: "Left TV", cameraEnabled: false, microphoneEnabled: false });
    expect(JSON.stringify(response.body)).not.toContain("PRIVATE_");
    expect(response.body.displays[0]).not.toHaveProperty("tokenHash");
  });
  it.each([
    { userId: 13, role: "vendor", vendorId: 7, membershipRole: "member" },
    { userId: 13, role: "field_employee", vendorId: 7, vendorRole: "gate_supervisor" },
    { userId: 13, role: "admin" },
  ])("denies discovery without an administrator and active owner", async identity => {
    expect((await request(app).get("/implementation-a/operations-displays").set("Cookie", buildTestCookie(identity))).status).toBe(403);
    expect(state.queries).toEqual([]);
  });
  it("returns empty discovery without querying outputs", async () => {
    state.empty = true;
    const response = await request(app).get("/implementation-a/operations-displays")
      .set("Cookie", buildTestCookie({ userId: 13, role: "vendor", vendorId: 7, membershipRole: "admin" }));
    expect(response.body.displays).toEqual([]);
    expect(state.queries).toHaveLength(1);
  });
});

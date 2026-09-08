import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildTestCookie } from "../test-utils/session";

const state = vi.hoisted(() => ({ rows: [] as unknown[][], filters: [] as unknown[], joins: [] as unknown[], inserted: [] as unknown[], selects: 0 }));
vi.mock("@workspace/db", async () => {
  const schema = await import("@workspace/db/schema");
  function chain(rows: unknown[]) {
    const result: any = {};
    for (const name of ["from", "orderBy", "limit"]) result[name] = () => result;
    for (const name of ["leftJoin", "innerJoin"]) result[name] = (_table: unknown, condition: unknown) => { state.joins.push(condition); return result; };
    result.where = (condition: unknown) => { state.filters.push(condition); return result; };
    result.values = (value: unknown) => { state.inserted.push(value); return result; };
    result.returning = () => result;
    result.then = (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject);
    return result;
  }
  return { ...schema, db: {
    select: () => { state.selects++; return chain(state.rows.shift() ?? []); },
    insert: () => chain(state.rows.shift() ?? []),
    delete: () => chain(state.rows.shift() ?? []),
  } };
});
vi.mock("./notifications", () => ({ notifyUsers: vi.fn() }));
vi.mock("../lib/tax-jurisdiction", () => ({ persistSiteTaxJurisdiction: vi.fn() }));
vi.mock("../lib/safety-metrics", () => ({ computeSafetyMetrics: vi.fn(), loadSiteOperationalStatus: vi.fn(async () => ({ partnerId: 9 })) }));
import vendorsRouter from "./vendors";
import sitesRouter from "./siteLocations";
import peopleRouter from "./fieldEmployees";
import relationshipsRouter from "./partnerVendorRelationships";
import { runOpsDataTool } from "../assistant/data-tools-ops";

const app = express().use(cookieParser()).use(express.json()).use("/api", vendorsRouter, sitesRouter, peopleRouter, relationshipsRouter);
const cookie = (role: string, partnerId: number | null = null, vendorId: number | null = null) => buildTestCookie({ userId: 1, role, partnerId, vendorId });
function lastFilter() { return new PgDialect().sqlToQuery(state.filters.at(-1) as any); }
beforeEach(() => { state.rows = []; state.filters = []; state.joins = []; state.inserted = []; state.selects = 0; });

describe("Company isolation", () => {
  it("filters partner notes by subject and authoring company, excluding ambiguous legacy ownership", async () => {
    state.rows = [[{ id: 1 }], []];
    const response = await request(app).get("/api/vendors/7/notes").set("Cookie", cookie("partner", 2));
    expect(response.status).toBe(200);
    expect(lastFilter().sql).toContain('"owner_org_type" =');
    expect(lastFilter().sql).toContain('"owner_org_id" =');
    expect(lastFilter().params).toEqual([7, "partner", 2]);
  });
  it("isolates platform-authored notes from partner and legacy notes", async () => {
    const response = await request(app).get("/api/vendors/7/notes").set("Cookie", cookie("admin"));
    expect(response.status).toBe(200);
    expect(lastFilter().params).toEqual([7, "platform", 0]);
  });
  it("ignores client-supplied note ownership", async () => {
    state.rows = [[{ id: 1 }], [{ id: 9 }]];
    const response = await request(app).post("/api/vendors/7/notes").set("Cookie", cookie("partner", 2))
      .send({ content: "Private", ownerOrgType: "partner", ownerOrgId: 99 });
    expect(response.status).toBe(201);
    expect(state.inserted[0]).toMatchObject({ vendorId: 7, ownerOrgType: "partner", ownerOrgId: 2 });
  });
  it("scopes deletion to authoring company even when the note id is known", async () => {
    state.rows = [[{ id: 1 }], []];
    const response = await request(app).delete("/api/vendors/7/notes/9").set("Cookie", cookie("partner", 2));
    expect(response.status).toBe(404);
    expect(lastFilter().params).toEqual([9, 7, "partner", 2]);
  });
  it("does not give an unscoped partner site access through query parameters", async () => {
    const response = await request(app).get("/api/site-locations?partnerId=9").set("Cookie", cookie("partner"));
    expect(response.status).toBe(403);
    expect(state.selects).toBe(0);
  });
  it("keeps a partner site list scoped to its session when another company is requested", async () => {
    const response = await request(app).get("/api/site-locations?partnerId=9").set("Cookie", cookie("partner", 2));
    expect(response.status).toBe(200);
    expect(lastFilter().params).toEqual([2]);
  });
  it("uses approved relationships for vendor site lists", async () => {
    const response = await request(app).get("/api/site-locations").set("Cookie", cookie("vendor", null, 7));
    expect(response.status).toBe(200);
    const relationshipFilter = new PgDialect().sqlToQuery(state.filters[0] as any);
    expect(relationshipFilter.sql).toContain('"partner_vendor_relationships"');
    expect(relationshipFilter.params).toEqual([7, "approved"]);
  });
  it.each(["/api/site-locations/1", "/api/site-locations/1/qr-code", "/api/site-locations/1/assignments"])("denies direct unrelated site access at %s", async path => {
    state.rows = [[{ id: 1, partnerId: 9 }], [{ partnerId: 2 }]];
    const response = await request(app).get(path).set("Cookie", cookie("vendor", null, 7));
    expect(response.status).toBe(403);
  });
  it.each(["/api/vendor-contacts?vendorId=7", "/api/field-employees?vendorId=7", "/api/vendors/7/partner-relationships"])("denies partner internal directory or unrelated approvals at %s", async path => {
    const response = await request(app).get(path).set("Cookie", cookie("partner", 2));
    expect([401, 403]).toContain(response.status);
    expect(state.selects).toBe(0);
  });
  it("retains designated business contacts for related partners", async () => {
    const contact = { id: 8, vendorId: 7, vendorRole: "office", jobTitle: "Contact", firstName: "Jane", lastName: "Smith", email: "jane@example.test", phone: null, isActive: true, createdAt: new Date(), pecCertification: true, hourlyRate: "50", inviteToken: "private", profilePendingReviewAt: new Date() };
    state.rows = [[{ id: 1 }], [{ contactEmail: " Jane@example.test " }], [contact, { ...contact, id: 9, email: "internal@example.test" }, { ...contact, id: 10, isActive: false }]];
    const response = await request(app).get("/api/vendors/7/contacts").set("Cookie", cookie("partner", 2));
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].email).toBe("jane@example.test");
    expect(response.body[0]).not.toHaveProperty("pecCertification");
    expect(response.body[0]).not.toHaveProperty("profilePendingReviewAt");
    expect(response.body[0]).not.toHaveProperty("hourlyRate");
    expect(response.body[0]).not.toHaveProperty("inviteToken");
    expect(lastFilter().params).toContain("jane@example.test");
  });
  it("does not infer business contact designation from an office role when the configured contact email is absent", async () => {
    state.rows = [[{ id: 1 }], [{ contactEmail: null }]];
    const response = await request(app).get("/api/vendors/7/contacts").set("Cookie", cookie("partner", 2));
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(state.selects).toBe(2);
  });
  it("allows an approved vendor to read its partner's site assignments", async () => {
    state.rows = [[{ id: 1, partnerId: 2 }], [{ partnerId: 2 }], []];
    const response = await request(app).get("/api/site-locations/1/assignments").set("Cookie", cookie("vendor", null, 7));
    expect(response.status).toBe(200);
  });
  it("allows an assigned employee at an approved partner site", async () => {
    state.rows = [[{ id: 1, partnerId: 2 }], [{ id: 11, vendorId: 7 }], [{ partnerId: 2 }], [{ siteLocationId: 1 }], []];
    const response = await request(app).get("/api/site-locations/1/assignments").set("Cookie", cookie("field_employee", null, 7));
    expect(response.status).toBe(200);
    const assignedFilter = new PgDialect().sqlToQuery(state.filters[3] as any);
    expect(assignedFilter.sql).toContain('"tickets"."field_employee_id" =');
    expect(assignedFilter.sql).toContain('"ticket_crew"."employee_id" =');
    expect(assignedFilter.params).toEqual([7, "cancelled", "denied", 11, 11, 1]);
    const crewJoin = new PgDialect().sqlToQuery(state.joins[0] as any);
    expect(crewJoin.sql).toContain('"removed_at" is null');
    expect(crewJoin.params).toEqual([11, "declined", "rejected"]);
  });
  it.each(["/api/site-locations/2", "/api/site-locations/2/qr-code", "/api/site-locations/2/assignments"])("denies another site of the same approved partner to an unassigned employee at %s", async path => {
    state.rows = [[{ id: 2, partnerId: 2 }], [{ id: 11, vendorId: 7 }], [{ partnerId: 2 }], []];
    const response = await request(app).get(path).set("Cookie", cookie("field_employee", null, 7));
    expect(response.status).toBe(403);
    expect(lastFilter().params).toEqual([7, "cancelled", "denied", 11, 11, 2]);
  });
  it.each(["pending_review", "revoked"])("denies field access when the relationship is %s", async () => {
    // A nonapproved relationship is absent from the approved-only result.
    state.rows = [[{ id: 1, partnerId: 2 }], [{ id: 11, vendorId: 7 }], []];
    const response = await request(app).get("/api/site-locations/1/assignments").set("Cookie", cookie("field_employee", null, 7));
    expect(response.status).toBe(403);
    expect(lastFilter().params).toEqual([7, "approved"]);
    expect(state.selects).toBe(3);
  });
  it("constrains field site lists by both relationship approval and employee assignment", async () => {
    state.rows = [[{ id: 11, vendorId: 7 }], [], [], []];
    const response = await request(app).get("/api/site-locations").set("Cookie", cookie("field_employee", null, 7));
    expect(response.status).toBe(200);
    const filters = state.filters.slice(0, -1).map(filter => new PgDialect().sqlToQuery(filter as any));
    expect(filters.some(filter => JSON.stringify(filter.params) === JSON.stringify([7, "approved"]))).toBe(true);
    expect(filters.some(filter => JSON.stringify(filter.params) === JSON.stringify([7, "cancelled", "denied", 11, 11]))).toBe(true);
  });
  it("allows Midcon to read its own notes without including Warwick or legacy ownership", async () => {
    state.rows = [[{ id: 1, vendorId: 7, content: "Midcon internal", createdAt: new Date() }]];
    const response = await request(app).get("/api/vendors/7/notes").set("Cookie", cookie("vendor", null, 7));
    expect(response.status).toBe(200);
    expect(response.body[0].content).toBe("Midcon internal");
    expect(lastFilter().params).toEqual([7, "vendor", 7]);
    expect(lastFilter().sql).not.toContain("is null");
  });
  it("allows Warwick to read its own notes about Midcon without including Midcon or legacy ownership", async () => {
    state.rows = [[{ id: 1 }], [{ id: 2, vendorId: 7, content: "Warwick internal", createdAt: new Date() }]];
    const response = await request(app).get("/api/vendors/7/notes").set("Cookie", cookie("partner", 2));
    expect(response.status).toBe(200);
    expect(response.body[0].content).toBe("Warwick internal");
    expect(lastFilter().params).toEqual([7, "partner", 2]);
    expect(lastFilter().sql).not.toContain("is null");
  });
  it("stamps vendor-created notes with the active vendor, ignoring a forged partner owner", async () => {
    state.rows = [[{ id: 3 }]];
    const response = await request(app).post("/api/vendors/7/notes").set("Cookie", cookie("vendor", null, 7))
      .send({ content: "Midcon internal", ownerOrgType: "partner", ownerOrgId: 2 });
    expect(response.status).toBe(201);
    expect(state.inserted[0]).toMatchObject({ vendorId: 7, ownerOrgType: "vendor", ownerOrgId: 7 });
  });
  it("scopes vendor deletion away from partner-owned notes", async () => {
    const response = await request(app).delete("/api/vendors/7/notes/2").set("Cookie", cookie("vendor", null, 7));
    expect(response.status).toBe(404);
    expect(lastFilter().params).toEqual([2, 7, "vendor", 7]);
  });
  it.each(["get", "post", "delete"] as const)("rejects vendor %s notes on another vendor subject", async method => {
    const path = method === "delete" ? "/api/vendors/8/notes/1" : "/api/vendors/8/notes";
    const response = await request(app)[method](path).set("Cookie", cookie("vendor", null, 7)).send({ content: "Denied" });
    expect(response.status).toBe(403);
    expect(state.selects).toBe(0);
    expect(state.inserted).toEqual([]);
  });
  it("denies AskV unscoped site lists", async () => {
    const response = await runOpsDataTool("query_site_locations", {}, { userId: 1, role: "partner", partnerId: null, vendorId: null } as any);
    expect(response).toContain("No org scope");
    expect(state.selects).toBe(0);
  });
  it.each(["lookup_site_detail", "lookup_site_operational_status"] as const)("denies AskV arbitrary vendor site access through %s", async name => {
    state.rows = name === "lookup_site_detail" ? [[{ id: 1, partnerId: 9 }], []] : [[]];
    const response = await runOpsDataTool(name, { siteId: 1 }, { userId: 1, role: "vendor", partnerId: null, vendorId: 7 } as any);
    expect(response).toContain("Site not visible");
  });
  it("allows AskV operational status for an employee's assigned site", async () => {
    state.rows = [[{ id: 11, vendorId: 7 }], [{ partnerId: 9 }], [{ siteLocationId: 1 }]];
    const response = await runOpsDataTool("lookup_site_operational_status", { siteId: 1 }, { userId: 1, role: "field_employee", partnerId: null, vendorId: 7 });
    expect(JSON.parse(response)).toEqual({ partnerId: 9 });
    expect(lastFilter().params).toEqual([7, "cancelled", "denied", 11, 11, 1]);
  });
  it("denies AskV operational status for another site of an approved partner", async () => {
    state.rows = [[{ id: 11, vendorId: 7 }], [{ partnerId: 9 }], []];
    const response = await runOpsDataTool("lookup_site_operational_status", { siteId: 2 }, { userId: 1, role: "field_employee", partnerId: null, vendorId: 7 });
    expect(response).toContain("Site not visible");
    expect(lastFilter().params).toEqual([7, "cancelled", "denied", 11, 11, 2]);
  });
});

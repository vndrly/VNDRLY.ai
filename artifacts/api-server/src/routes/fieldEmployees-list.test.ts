import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Coverage for Task #512 — GET /field-employees default-active filter.
//
// The list endpoint used to return rows where `is_active = false`, forcing
// every consumer (phone-intake foreman picker, schedule-ticket dialog,
// crew-time picker, mobile crew picker) to re-implement the active filter.
// As of #512 the endpoint defaults to active-only and exposes
// `includeInactive=true` for the field-employees admin page that legitimately
// needs to surface deactivated rows for editing.
//
// To prove the SQL guard is actually applied (not just that the response
// happens to be filtered), we mock drizzle's `eq`/`and`/`isNull`/`inArray`
// helpers into a tiny predicate AST and have the mock `db` evaluate that AST
// against fixture rows. Removing the `eq(isActive, true)` guard would make
// the default-active test fail.

type Row = Record<string, any>;
type ColRef = { __table: string; __col: string };
type Pred =
  | { kind: "eq"; col: ColRef; val: any }
  | { kind: "isNull"; col: ColRef }
  | { kind: "inArray"; col: ColRef; arr: any[] }
  | { kind: "and"; preds: Pred[] }
  | { kind: "true" };

function tableTag(name: string, cols: string[]) {
  const t: any = { __name: name };
  for (const c of cols) t[c] = { __table: name, __col: c };
  return t;
}

const tables = {
  fieldEmployees: tableTag("fieldEmployees", [
    "id",
    "vendorId",
    "vendorRole",
    "jobTitle",
    "firstName",
    "lastName",
    "email",
    "phone",
    "userId",
    "isActive",
    "pecCertification",
    "pecExpirationDate",
    "photoUrl",
    "profilePhotoPath",
    "roles",
    "createdAt",
    "deletedAt",
    "deletedBy",
  ]),
  vendors: tableTag("vendors", ["id", "name", "logoUrl"]),
  users: tableTag("users", [
    "id",
    "suspendedAt",
    "mustChangePassword",
    // #1248 — admin/vendor field-employees list surfaces the linked
    // login's preferred UI language so support can see at a glance
    // which staff are configured for English vs Spanish.
    "preferredLanguage",
  ]),
  fieldEmployeeNotes: tableTag("fieldEmployeeNotes", ["id", "employeeId", "createdAt"]),
};

const fixtures: Record<string, Row[]> = {
  fieldEmployees: [],
  vendors: [],
  users: [],
  fieldEmployeeNotes: [],
};

function evalPred(pred: Pred | undefined, row: Row): boolean {
  if (!pred) return true;
  switch (pred.kind) {
    case "true":
      return true;
    case "eq":
      return row[pred.col.__col] === pred.val;
    case "isNull":
      return row[pred.col.__col] == null;
    case "inArray":
      return pred.arr.includes(row[pred.col.__col]);
    case "and":
      return pred.preds.every((p) => evalPred(p, row));
  }
}

// Joined row factory: the route LEFT JOINs vendors and users onto field
// employees and returns the `baseSelect` shape, so we mirror that here.
function joinRow(emp: Row): Row {
  const vendor = fixtures.vendors.find((v) => v.id === emp.vendorId);
  const user = emp.userId != null ? fixtures.users.find((u) => u.id === emp.userId) : undefined;
  return {
    id: emp.id,
    vendorId: emp.vendorId,
    vendorRole: emp.vendorRole,
    jobTitle: emp.jobTitle ?? null,
    firstName: emp.firstName,
    lastName: emp.lastName,
    email: emp.email,
    phone: emp.phone ?? null,
    userId: emp.userId ?? null,
    vendorName: vendor?.name ?? null,
    vendorLogoUrl: vendor?.logoUrl ?? null,
    isActive: emp.isActive,
    pecCertification: emp.pecCertification ?? false,
    pecExpirationDate: emp.pecExpirationDate ?? null,
    photoUrl: emp.photoUrl ?? null,
    profilePhotoPath: emp.profilePhotoPath ?? null,
    roles: emp.roles ?? [],
    createdAt: emp.createdAt ?? new Date(),
    deletedAt: emp.deletedAt ?? null,
    deletedBy: emp.deletedBy ?? null,
    suspendedAt: user?.suspendedAt ?? null,
    mustChangePasswordRaw: user?.mustChangePassword ?? null,
    // Mirror the route's baseSelect: users.preferred_language for the
    // linked login (null when the employee has no users row at all).
    preferredLanguage: user?.preferredLanguage ?? null,
  };
}

function makeQuery(tableName: string) {
  let pred: Pred | undefined;
  const run = () => {
    const all = fixtures[tableName] ?? [];
    const filtered = all.filter((r) => evalPred(pred, r));
    if (tableName === "fieldEmployees") return filtered.map(joinRow);
    return filtered;
  };
  const q: any = {
    where: (p: Pred) => {
      pred = p;
      return q;
    },
    leftJoin: () => q,
    innerJoin: () => q,
    orderBy: () => q,
    limit: () => q,
    then: (resolve: any, reject?: any) =>
      Promise.resolve(run()).then(resolve, reject),
    catch: (reject: any) => Promise.resolve(run()).catch(reject),
  };
  return q;
}

vi.mock("@workspace/db", () => {
  const db = {
    select: (_cols?: any) => ({
      from: (t: any) => makeQuery(t.__name),
    }),
    insert: (_t: any) => ({
      values: () => ({ returning: async () => [] }),
    }),
    update: (_t: any) => ({
      set: () => ({ where: () => ({ returning: async () => [] }) }),
    }),
  };
  return {
    db,
    fieldEmployeesTable: tables.fieldEmployees,
    vendorsTable: tables.vendors,
    usersTable: tables.users,
    fieldEmployeeNotesTable: tables.fieldEmployeeNotes,
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts", []),
    hotlistCommentsTable: tableTag("hotlistComments", []),
    ticketNoteLogsTable: tableTag("ticketNoteLogs", []),
  };
});

vi.mock("drizzle-orm", () => {
  const passthrough = (..._args: any[]) => ({ kind: "true" });
  const sqlTag: any = (..._args: any[]) => ({ kind: "true" });
  sqlTag.raw = passthrough;
  return {
    and: (...preds: Pred[]) => ({ kind: "and", preds }),
    eq: (col: ColRef, val: any) => ({ kind: "eq", col, val }),
    isNull: (col: ColRef) => ({ kind: "isNull", col }),
    inArray: (col: ColRef, arr: any[]) => ({ kind: "inArray", col, arr }),
    sql: sqlTag,
    desc: passthrough,
    gte: passthrough,
  };
});


const cookieFor = (s: object) => buildTestCookie(s);

const adminCookie = cookieFor({ userId: 1, role: "admin", vendorId: null, partnerId: null });
const vendorCookie = cookieFor({ userId: 2, role: "vendor", vendorId: 7, partnerId: null, membershipRole: "admin" });

let app: express.Express;

beforeEach(async () => {
  for (const k of Object.keys(fixtures)) fixtures[k] = [];

  fixtures.vendors.push({ id: 7, name: "Acme Roofing", logoUrl: null });
  fixtures.vendors.push({ id: 8, name: "Other Vendor", logoUrl: null });

  // A representative spread of rows so each test can rely on the same
  // fixture set: an active foreman, an inactive field employee, a
  // soft-deleted (also inactive) employee, an active office-only contact
  // (filtered out by vendor_role), and an active employee on a different
  // vendor (filtered out for vendor sessions).
  fixtures.fieldEmployees.push({
    id: 100, vendorId: 7, vendorRole: "foreman",
    firstName: "Alice", lastName: "Active",
    email: "alice@example.com", phone: null,
    isActive: true, deletedAt: null,
  });
  fixtures.fieldEmployees.push({
    id: 101, vendorId: 7, vendorRole: "field",
    firstName: "Bob", lastName: "Benched",
    email: "bob@example.com", phone: null,
    isActive: false, deletedAt: null,
  });
  fixtures.fieldEmployees.push({
    id: 102, vendorId: 7, vendorRole: "field",
    firstName: "Carol", lastName: "Cleared",
    email: "carol@example.com", phone: null,
    isActive: false, deletedAt: new Date("2025-01-01T00:00:00Z"),
    deletedBy: "admin:1",
  });
  fixtures.fieldEmployees.push({
    id: 103, vendorId: 7, vendorRole: "office",
    firstName: "Olivia", lastName: "Office",
    email: "olivia@example.com", phone: null,
    isActive: true, deletedAt: null,
  });
  fixtures.fieldEmployees.push({
    id: 104, vendorId: 8, vendorRole: "field",
    firstName: "Xavier", lastName: "Crossvendor",
    email: "x@example.com", phone: null,
    isActive: true, deletedAt: null,
  });

  vi.resetModules();
  const router = (await import("./fieldEmployees")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /field-employees — default active-only filter (Task #512)", () => {
  it("excludes is_active = false rows by default for admin sessions", async () => {
    const res = await request(app)
      .get("/api/field-employees")
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    const ids = (res.body as any[]).map((r) => r.id).sort();
    // Alice (active foreman) is in; Bob (inactive) and Carol (deleted +
    // inactive) are out; Olivia is filtered by vendor_role; Xavier is on
    // another vendor but allowed through for admin.
    expect(ids).toEqual([100, 104]);
  });

  it("excludes is_active = false rows by default for vendor sessions, scoped to own vendor", async () => {
    const res = await request(app)
      .get("/api/field-employees")
      .set("Cookie", vendorCookie);
    expectStatus(res, 200);
    const ids = (res.body as any[]).map((r) => r.id).sort();
    // Only Alice (active, vendor 7, foreman) survives. Xavier is vendor 8
    // and is excluded by the vendor-session tenancy guard.
    expect(ids).toEqual([100]);
  });

  it("includes inactive rows when includeInactive=true is passed (admin page opt-in)", async () => {
    const res = await request(app)
      .get("/api/field-employees?includeInactive=true")
      .set("Cookie", vendorCookie);
    expectStatus(res, 200);
    const ids = (res.body as any[]).map((r) => r.id).sort();
    // Now Bob (inactive, not deleted) shows up too. Carol stays out
    // because she is also soft-deleted and includeDeleted is admin-only.
    expect(ids).toEqual([100, 101]);
  });

  it("includeInactive=true alone does not surface soft-deleted rows", async () => {
    const res = await request(app)
      .get("/api/field-employees?includeInactive=true")
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    const ids = (res.body as any[]).map((r) => r.id).sort();
    // Carol is soft-deleted: still excluded without includeDeleted=true.
    expect(ids).toEqual([100, 101, 104]);
  });

  it("includeDeleted=true + includeInactive=true surfaces soft-deleted (also inactive) rows for admins", async () => {
    const res = await request(app)
      .get("/api/field-employees?includeDeleted=true&includeInactive=true")
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    const ids = (res.body as any[]).map((r) => r.id).sort();
    expect(ids).toEqual([100, 101, 102, 104]);
  });

  it("includeInactive=false (or omitted) keeps inactive rows out even for admins", async () => {
    const res = await request(app)
      .get("/api/field-employees?includeInactive=false")
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    const ids = (res.body as any[]).map((r) => r.id).sort();
    expect(ids).toEqual([100, 104]);
  });
});

describe("GET /field-employees — preferredLanguage column (#1248)", () => {
  it("surfaces users.preferred_language for the linked login and null otherwise", async () => {
    // Two seeded users: an English speaker linked to Alice, and a
    // Spanish speaker linked to Xavier (different vendor). Bob's
    // employee row has no userId so its preferredLanguage must be
    // null in the response regardless of any user fixture.
    fixtures.users.push({
      id: 900,
      suspendedAt: null,
      mustChangePassword: false,
      preferredLanguage: "en",
    });
    fixtures.users.push({
      id: 901,
      suspendedAt: null,
      mustChangePassword: false,
      preferredLanguage: "es",
    });
    // Re-link the existing fixtures so the LEFT JOIN finds them.
    const alice = fixtures.fieldEmployees.find((r) => r.id === 100)!;
    const xavier = fixtures.fieldEmployees.find((r) => r.id === 104)!;
    alice.userId = 900;
    xavier.userId = 901;

    const res = await request(app)
      .get("/api/field-employees")
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    const byId = new Map<number, any>(
      (res.body as any[]).map((r) => [r.id, r]),
    );
    expect(byId.get(100)?.preferredLanguage).toBe("en");
    expect(byId.get(104)?.preferredLanguage).toBe("es");
  });

  it("returns null preferredLanguage when the employee has no linked login", async () => {
    // Default fixtures all have userId=undefined → null, so without
    // any users seeded the response should still come back with
    // preferredLanguage === null on every row instead of being
    // missing/undefined (the OpenAPI schema marks the field nullable
    // but it must always be present).
    const res = await request(app)
      .get("/api/field-employees")
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    for (const row of res.body as any[]) {
      expect(row).toHaveProperty("preferredLanguage");
      expect(row.preferredLanguage).toBeNull();
    }
  });
});

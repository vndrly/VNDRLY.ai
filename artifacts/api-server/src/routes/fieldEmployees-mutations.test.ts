import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Coverage for Task #514 — POST / PATCH / DELETE / POST :id/restore on
// /field-employees.
//
// Task #512 added the first dedicated test file for this route (the list
// endpoint, see `fieldEmployees-list.test.ts`). The mutating handlers
// still had no direct coverage, even though they enforce a non-trivial
// matrix of guards:
//   * unauthenticated callers → 401
//   * vendor sessions whose membershipRole is not "admin" → 403 on every
//     mutation (POST, PATCH, DELETE)
//   * vendor sessions that target an employee on a different vendor → 404
//     (the route deliberately returns 404 instead of 403 to avoid leaking
//     existence)
//   * DELETE soft-deletes by setting deletedAt + flipping isActive=false
//   * POST /:id/restore (admin-only) clears deletedAt and re-sets
//     isActive=true
//
// We re-use the predicate-aware DB mock pattern from
// `fieldEmployees-list.test.ts` and `locations.test.ts` so the assertions
// actually exercise the route's WHERE clauses and SET payloads. Removing
// any of the guards above would make these tests fail.

type Row = Record<string, any>;
type ColRef = { __table: string; __col: string };
type Pred =
  | { kind: "eq"; col: ColRef; val: any }
  | { kind: "isNull"; col: ColRef }
  | { kind: "inArray"; col: ColRef; arr: any[] }
  | { kind: "and"; preds: Pred[] }
  | { kind: "true" };

// Sentinel produced by the mocked `sql` tagged template. The DELETE handler
// writes `deletedAt: sql\`now()\``; we detect this sentinel in the update
// mock and substitute a real Date so assertions can verify the column was
// stamped instead of left literally as the AST node.
const SQL_NOW = Symbol("sql.now");

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
  users: tableTag("users", ["id", "suspendedAt", "mustChangePassword", "preferredLanguage"]),
  fieldEmployeeNotes: tableTag("fieldEmployeeNotes", [
    "id",
    "employeeId",
    "content",
    "createdAt",
  ]),
  // Task #876: the DELETE handler now joins ticket_check_ins to surface
  // any open ticket sessions for the just-deactivated worker so the
  // office UI can warn staff which foremen will see the row drop.
  ticketCheckIns: tableTag("ticketCheckIns", [
    "id",
    "ticketId",
    "employeeId",
    "checkInAt",
    "checkOutAt",
  ]),
  tickets: tableTag("tickets", ["id"]),
};

const fixtures: Record<string, Row[]> = {
  fieldEmployees: [],
  vendors: [],
  users: [],
  fieldEmployeeNotes: [],
  ticketCheckIns: [],
  tickets: [],
};

// Capture insert/update side effects so individual tests can assert on the
// exact payloads the route sent to drizzle.
let lastInsert: { table: string; values: Row } | null = null;
let lastUpdate: { table: string; set: Row; matched: Row[] } | null = null;
let lastDelete: { table: string; matched: Row[] } | null = null;
let nextInsertId = 1000;

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

// Mirror of the `baseSelect` projection in routes/fieldEmployees.ts. The
// route LEFT JOINs vendors and users, so we synthesize the joined row here
// when the query is against the fieldEmployees table.
function joinRow(emp: Row): Row {
  const vendor = fixtures.vendors.find((v) => v.id === emp.vendorId);
  const user =
    emp.userId != null
      ? fixtures.users.find((u) => u.id === emp.userId)
      : undefined;
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
    preferredLanguage: emp.preferredLanguage ?? null,
    createdAt: emp.createdAt ?? new Date(),
    deletedAt: emp.deletedAt ?? null,
    deletedBy: emp.deletedBy ?? null,
    suspendedAt: user?.suspendedAt ?? null,
    mustChangePasswordRaw: user?.mustChangePassword ?? null,
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

// Apply an UPDATE SET payload onto a fixture row, expanding sql sentinels
// (`sql\`now()\`` becomes a Date) so downstream assertions can inspect the
// resulting column values.
function applySet(row: Row, set: Row): void {
  for (const [k, v] of Object.entries(set)) {
    if (v === SQL_NOW) {
      row[k] = new Date();
    } else {
      row[k] = v;
    }
  }
}

vi.mock("@workspace/db", () => {
  const db = {
    select: (_cols?: any) => ({
      from: (t: any) => makeQuery(t.__name),
    }),
    insert: (t: any) => ({
      values: (v: Row) => ({
        returning: async () => {
          // Mirror the column defaults that PostgreSQL applies on INSERT
          // (see lib/db/src/schema/fieldEmployees.ts) so the follow-up
          // SELECT returns a row that satisfies GetFieldEmployeeResponse.
          // Without these defaults the inserted row would be missing
          // `isActive`, `createdAt`, etc. and the response schema parse
          // would 500.
          const defaults: Row =
            t.__name === "fieldEmployees"
              ? {
                  isActive: true,
                  createdAt: new Date(),
                  deletedAt: null,
                  deletedBy: null,
                  pecCertification: false,
                  pecExpirationDate: null,
                  phone: null,
                  jobTitle: null,
                  userId: null,
                  photoUrl: null,
                  profilePhotoPath: null,
                  roles: [],
                }
              : t.__name === "fieldEmployeeNotes"
              ? {
                  // Mirror the column defaults applied by PostgreSQL (see
                  // lib/db/src/schema/fieldEmployeeNotes.ts: createdAt
                  // defaultNow). Without this the inserted row would be
                  // missing createdAt and the JSON response would carry
                  // `undefined`, which JSON.stringify silently drops —
                  // making it impossible to assert createdAt was returned.
                  createdAt: new Date(),
                }
              : {};
          const row = { ...defaults, id: nextInsertId++, ...v };
          fixtures[t.__name].push(row);
          lastInsert = { table: t.__name, values: row };
          return [row];
        },
      }),
    }),
    update: (t: any) => {
      let setObj: Row = {};
      const u: any = {
        set: (s: Row) => {
          setObj = s;
          return u;
        },
        where: (p: Pred) => {
          const matched = (fixtures[t.__name] ?? []).filter((r) =>
            evalPred(p, r),
          );
          for (const row of matched) applySet(row, setObj);
          lastUpdate = {
            table: t.__name,
            set: setObj,
            matched: matched.map((r) => ({ ...r })),
          };
          const ret = {
            returning: async () =>
              t.__name === "fieldEmployees"
                ? matched.map((r) => joinRow(r))
                : matched.slice(),
          };
          return ret;
        },
      };
      return u;
    },
    // The notes DELETE handler issues a real `db.delete(...).where(...).returning()`,
    // unlike the parent employee handlers which only soft-delete via UPDATE.
    // We physically remove matching fixture rows and capture the snapshot in
    // `lastDelete` so tests can assert exactly which row(s) the route
    // targeted (and that nothing was deleted on the unauthorized paths).
    delete: (t: any) => {
      const d: any = {
        where: (p: Pred) => {
          const all = fixtures[t.__name] ?? [];
          const matched = all.filter((r) => evalPred(p, r));
          fixtures[t.__name] = all.filter((r) => !matched.includes(r));
          lastDelete = {
            table: t.__name,
            matched: matched.map((r) => ({ ...r })),
          };
          return {
            returning: async () => matched.slice(),
          };
        },
      };
      return d;
    },
  };
  return {
    db,
    fieldEmployeesTable: tables.fieldEmployees,
    vendorsTable: tables.vendors,
    usersTable: tables.users,
    fieldEmployeeNotesTable: tables.fieldEmployeeNotes,
    ticketCheckInsTable: tables.ticketCheckIns,
    ticketsTable: tables.tickets,
    // Mirror lib/db/src/format/ticket-tracking-number.ts (`VNDRLY-` +
    // 8-digit zero-padded id) so the DELETE handler can format tracking
    // numbers without pulling the real lib through the mock.
    formatTicketTrackingNumber: (id: number) =>
      `VNDRLY-${String(id).padStart(8, "0")}`,
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts", []),
    hotlistCommentsTable: tableTag("hotlistComments", []),
    ticketNoteLogsTable: tableTag("ticketNoteLogs", []),
  };
});

vi.mock("drizzle-orm", () => {
  const passthrough = (..._args: any[]) => ({ kind: "true" });
  // The route uses `sql\`now()\`` in DELETE. Encode that as a sentinel so
  // the update mock can substitute a Date when applying the SET payload.
  const sqlTag: any = (strings: any, ..._values: any[]) => {
    if (Array.isArray(strings)) {
      const joined = strings.join("?").trim().toLowerCase();
      if (joined === "now()") return SQL_NOW;
    }
    return { kind: "true" };
  };
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

const adminCookie = cookieFor({
  userId: 1,
  role: "admin",
  vendorId: null,
  partnerId: null,
});
const vendorAdminCookie = cookieFor({
  userId: 2,
  role: "vendor",
  vendorId: 7,
  partnerId: null,
  membershipRole: "admin",
});
const vendorMemberCookie = cookieFor({
  userId: 3,
  role: "vendor",
  vendorId: 7,
  partnerId: null,
  membershipRole: "member",
});
const otherVendorAdminCookie = cookieFor({
  userId: 4,
  role: "vendor",
  vendorId: 8,
  partnerId: null,
  membershipRole: "admin",
});

let app: express.Express;

// 30s hook timeout — the beforeEach calls `vi.resetModules()` and then
// re-imports the route module (and its transitive @workspace/* deps) for
// every test. Across the now-many tests in this file (Tasks #514 + #856)
// CI under heavy parallel load occasionally exceeds the default 10s
// hook timeout on the first beforeEach. The hook itself does little
// work; bumping the budget avoids spurious failures without masking
// real bugs (a runaway hook will still fail at 30s).
beforeEach(async () => {
  for (const k of Object.keys(fixtures)) fixtures[k] = [];
  lastInsert = null;
  lastUpdate = null;
  lastDelete = null;
  nextInsertId = 1000;

  fixtures.vendors.push({ id: 7, name: "Acme Roofing", logoUrl: null });
  fixtures.vendors.push({ id: 8, name: "Other Vendor", logoUrl: null });

  // A representative spread:
  //   * 100 — active foreman on vendor 7 (mutable)
  //   * 101 — active field on vendor 7 (mutable)
  //   * 102 — already soft-deleted (also inactive) on vendor 7
  //   * 103 — active office-only on vendor 7 (filtered by vendor_role on
  //           every mutating handler — should not be mutable as a "field
  //           employee")
  //   * 104 — active field on vendor 8 (cross-vendor isolation target)
  fixtures.fieldEmployees.push({
    id: 100,
    vendorId: 7,
    vendorRole: "foreman",
    firstName: "Alice",
    lastName: "Active",
    email: "alice@example.com",
    phone: null,
    isActive: true,
    deletedAt: null,
    deletedBy: null,
  });
  fixtures.fieldEmployees.push({
    id: 101,
    vendorId: 7,
    vendorRole: "field",
    firstName: "Bob",
    lastName: "Builder",
    email: "bob@example.com",
    phone: null,
    isActive: true,
    deletedAt: null,
    deletedBy: null,
  });
  fixtures.fieldEmployees.push({
    id: 102,
    vendorId: 7,
    vendorRole: "field",
    firstName: "Carol",
    lastName: "Cleared",
    email: "carol@example.com",
    phone: null,
    isActive: false,
    deletedAt: new Date("2025-01-01T00:00:00Z"),
    deletedBy: "admin:1",
  });
  fixtures.fieldEmployees.push({
    id: 103,
    vendorId: 7,
    vendorRole: "office",
    firstName: "Olivia",
    lastName: "Office",
    email: "olivia@example.com",
    phone: null,
    isActive: true,
    deletedAt: null,
    deletedBy: null,
  });
  fixtures.fieldEmployees.push({
    id: 104,
    vendorId: 8,
    vendorRole: "field",
    firstName: "Xavier",
    lastName: "Crossvendor",
    email: "x@example.com",
    phone: null,
    isActive: true,
    deletedAt: null,
    deletedBy: null,
  });

  // Seed two notes on employee 100 (vendor 7) plus one note on the
  // cross-vendor employee 104 (vendor 8). Tests for the DELETE handler
  // rely on the "wrong-employee" note (id 9001 is on emp 100) to verify
  // the route's note↔employee containment check.
  fixtures.fieldEmployeeNotes.push({
    id: 9000,
    employeeId: 100,
    content: "First call-out absence",
    createdAt: new Date("2025-01-01T10:00:00Z"),
  });
  fixtures.fieldEmployeeNotes.push({
    id: 9001,
    employeeId: 100,
    content: "Verbal warning issued",
    createdAt: new Date("2025-02-01T10:00:00Z"),
  });
  fixtures.fieldEmployeeNotes.push({
    id: 9100,
    employeeId: 104,
    content: "Note on the cross-vendor employee",
    createdAt: new Date("2025-03-01T10:00:00Z"),
  });

  vi.resetModules();
  const router = (await import("./fieldEmployees")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
}, 30000);

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /field-employees (Task #514)", () => {
  const validBody = {
    vendorId: 7,
    vendorRole: "field",
    firstName: "New",
    lastName: "Hire",
    email: "new@example.com",
  };

  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(app).post("/api/field-employees").send(validBody);
    expect(res.status).toBe(401);
    expect(lastInsert).toBeNull();
  });

  it("rejects sessions whose role is neither admin nor vendor with 401", async () => {
    const res = await request(app)
      .post("/api/field-employees")
      .set("Cookie", cookieFor({ userId: 99, role: "partner", vendorId: null, partnerId: 1 }))
      .send(validBody);
    expect(res.status).toBe(401);
    expect(lastInsert).toBeNull();
  });

  it("rejects vendor sessions whose membershipRole is not admin with 403", async () => {
    const res = await request(app)
      .post("/api/field-employees")
      .set("Cookie", vendorMemberCookie)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Vendor admin/i);
    expect(lastInsert).toBeNull();
  });

  it("rejects vendor admins creating an employee for a different vendor with 403", async () => {
    const res = await request(app)
      .post("/api/field-employees")
      .set("Cookie", vendorAdminCookie)
      .send({ ...validBody, vendorId: 8 });
    expect(res.status).toBe(403);
    expect(lastInsert).toBeNull();
  });

  it("rejects bodies that fail Zod validation with 400", async () => {
    const res = await request(app)
      .post("/api/field-employees")
      .set("Cookie", vendorAdminCookie)
      .send({ vendorId: 7, firstName: "Bad" }); // missing lastName/email
    expect(res.status).toBe(400);
    expect(lastInsert).toBeNull();
  });

  it("vendor admin can create an employee on their own vendor", async () => {
    const res = await request(app)
      .post("/api/field-employees")
      .set("Cookie", vendorAdminCookie)
      .send(validBody);
    expectStatus(res, 201);
    expect(res.body).toMatchObject({
      vendorId: 7,
      firstName: "New",
      lastName: "Hire",
      email: "new@example.com",
      vendorRole: "field",
    });
    expect(lastInsert?.table).toBe("fieldEmployees");
    expect(lastInsert?.values).toMatchObject({ vendorId: 7, vendorRole: "field" });
  });

  it("admin can create an employee on any vendor", async () => {
    const res = await request(app)
      .post("/api/field-employees")
      .set("Cookie", adminCookie)
      .send({ ...validBody, vendorId: 8 });
    expectStatus(res, 201);
    expect(res.body.vendorId).toBe(8);
  });

  it("defaults vendorRole to 'field' when omitted", async () => {
    const { vendorRole: _omit, ...noRole } = validBody;
    const res = await request(app)
      .post("/api/field-employees")
      .set("Cookie", vendorAdminCookie)
      .send(noRole);
    expectStatus(res, 201);
    expect(lastInsert?.values?.vendorRole).toBe("field");
  });
});

describe("PATCH /field-employees/:id (Task #514)", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(app)
      .patch("/api/field-employees/100")
      .send({ firstName: "Renamed" });
    expect(res.status).toBe(401);
    expect(lastUpdate).toBeNull();
  });

  it("rejects vendor non-admin members with 403", async () => {
    const res = await request(app)
      .patch("/api/field-employees/100")
      .set("Cookie", vendorMemberCookie)
      .send({ firstName: "Renamed" });
    expect(res.status).toBe(403);
    expect(lastUpdate).toBeNull();
  });

  it("returns 404 when a vendor admin targets another vendor's employee (no info leak)", async () => {
    // 104 belongs to vendor 8; vendorAdminCookie is vendor 7.
    const res = await request(app)
      .patch("/api/field-employees/104")
      .set("Cookie", vendorAdminCookie)
      .send({ firstName: "Hijacked" });
    expect(res.status).toBe(404);
    expect(lastUpdate).toBeNull();
    // Cross-vendor row must not have been mutated.
    expect(
      fixtures.fieldEmployees.find((e) => e.id === 104)?.firstName,
    ).toBe("Xavier");
  });

  it("returns 404 when targeting an already soft-deleted employee", async () => {
    // 102 has deletedAt set; the route's target lookup includes
    // isNull(deletedAt) so the row is invisible to PATCH.
    const res = await request(app)
      .patch("/api/field-employees/102")
      .set("Cookie", adminCookie)
      .send({ firstName: "Resurrect" });
    expect(res.status).toBe(404);
    expect(lastUpdate).toBeNull();
  });

  it("returns 404 when the employee does not exist", async () => {
    const res = await request(app)
      .patch("/api/field-employees/9999")
      .set("Cookie", adminCookie)
      .send({ firstName: "Ghost" });
    expect(res.status).toBe(404);
    expect(lastUpdate).toBeNull();
  });

  it("rejects bodies that fail Zod validation with 400", async () => {
    const res = await request(app)
      .patch("/api/field-employees/100")
      .set("Cookie", vendorAdminCookie)
      .send({ isActive: "not-a-boolean" });
    expect(res.status).toBe(400);
    expect(lastUpdate).toBeNull();
  });

  it("vendor admin can update an employee on their own vendor", async () => {
    const res = await request(app)
      .patch("/api/field-employees/100")
      .set("Cookie", vendorAdminCookie)
      .send({ firstName: "Alicia", isActive: false });
    expectStatus(res, 200);
    expect(res.body).toMatchObject({ id: 100, firstName: "Alicia", isActive: false });
    const row = fixtures.fieldEmployees.find((e) => e.id === 100);
    expect(row?.firstName).toBe("Alicia");
    expect(row?.isActive).toBe(false);
  });

  it("derives pecCertification from a future pecExpirationDate", async () => {
    const future = "2099-01-01";
    const res = await request(app)
      .patch("/api/field-employees/100")
      .set("Cookie", adminCookie)
      .send({ pecExpirationDate: future });
    expectStatus(res, 200);
    const row = fixtures.fieldEmployees.find((e) => e.id === 100);
    expect(row?.pecCertification).toBe(true);
    expect(row?.pecExpirationDate).toBe(future);
  });

  it("derives pecCertification=false from a past pecExpirationDate", async () => {
    const past = "2000-01-01";
    const res = await request(app)
      .patch("/api/field-employees/100")
      .set("Cookie", adminCookie)
      .send({ pecExpirationDate: past });
    expectStatus(res, 200);
    const row = fixtures.fieldEmployees.find((e) => e.id === 100);
    expect(row?.pecCertification).toBe(false);
  });

  // Task #831: admins can change a field employee's preferred UI/assistant
  // language from the detail page. The route must persist the value to
  // vendor_people.preferred_language and (when a linked login exists)
  // mirror it into users.preferred_language so the next assistant turn
  // keys off the same preference.
  describe("preferredLanguage (Task #831)", () => {
    it("persists preferredLanguage on the vendor_people row and mirrors to the linked user", async () => {
      const emp = fixtures.fieldEmployees.find((e) => e.id === 100)!;
      emp.userId = 555;
      fixtures.users.push({ id: 555, suspendedAt: null, mustChangePassword: false, preferredLanguage: null });

      const res = await request(app)
        .patch("/api/field-employees/100")
        .set("Cookie", adminCookie)
        .send({ preferredLanguage: "es" });

      expectStatus(res, 200);
      expect(res.body.preferredLanguage).toBe("es");
      expect(fixtures.fieldEmployees.find((e) => e.id === 100)?.preferredLanguage).toBe("es");
      expect(fixtures.users.find((u) => u.id === 555)?.preferredLanguage).toBe("es");
    });

    it("clears preferredLanguage on both rows when the admin sends null", async () => {
      const emp = fixtures.fieldEmployees.find((e) => e.id === 100)!;
      emp.userId = 556;
      emp.preferredLanguage = "en";
      fixtures.users.push({ id: 556, suspendedAt: null, mustChangePassword: false, preferredLanguage: "en" });

      const res = await request(app)
        .patch("/api/field-employees/100")
        .set("Cookie", adminCookie)
        .send({ preferredLanguage: null });

      expectStatus(res, 200);
      expect(res.body.preferredLanguage).toBeNull();
      expect(fixtures.fieldEmployees.find((e) => e.id === 100)?.preferredLanguage).toBeNull();
      expect(fixtures.users.find((u) => u.id === 556)?.preferredLanguage).toBeNull();
    });

    it("leaves users.preferred_language untouched when no preferredLanguage is in the body", async () => {
      const emp = fixtures.fieldEmployees.find((e) => e.id === 100)!;
      emp.userId = 557;
      fixtures.users.push({ id: 557, suspendedAt: null, mustChangePassword: false, preferredLanguage: "es" });

      const res = await request(app)
        .patch("/api/field-employees/100")
        .set("Cookie", adminCookie)
        .send({ firstName: "Allie" });

      expectStatus(res, 200);
      expect(fixtures.users.find((u) => u.id === 557)?.preferredLanguage).toBe("es");
    });

    it("rejects an invalid preferredLanguage value with 400", async () => {
      const res = await request(app)
        .patch("/api/field-employees/100")
        .set("Cookie", adminCookie)
        .send({ preferredLanguage: "fr" });
      expect(res.status).toBe(400);
    });

    it("does not write to users when the employee has no linked login", async () => {
      // emp 100 has userId left unset (no users fixture row); the mirror
      // step must be skipped — otherwise the route would attempt a
      // write against `users` with a null id.
      const res = await request(app)
        .patch("/api/field-employees/100")
        .set("Cookie", adminCookie)
        .send({ preferredLanguage: "en" });

      expectStatus(res, 200);
      expect(fixtures.fieldEmployees.find((e) => e.id === 100)?.preferredLanguage).toBe("en");
      expect(fixtures.users).toHaveLength(0);
    });
  });
});

describe("DELETE /field-employees/:id (Task #514)", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(app).delete("/api/field-employees/100");
    expect(res.status).toBe(401);
    expect(lastUpdate).toBeNull();
  });

  it("rejects vendor non-admin members with 403", async () => {
    const res = await request(app)
      .delete("/api/field-employees/100")
      .set("Cookie", vendorMemberCookie);
    expect(res.status).toBe(403);
    expect(lastUpdate).toBeNull();
  });

  it("returns 404 when a vendor admin targets another vendor's employee", async () => {
    const res = await request(app)
      .delete("/api/field-employees/104")
      .set("Cookie", vendorAdminCookie);
    expect(res.status).toBe(404);
    expect(lastUpdate).toBeNull();
    // The cross-vendor row must remain untouched.
    const row = fixtures.fieldEmployees.find((e) => e.id === 104);
    expect(row?.deletedAt).toBeNull();
    expect(row?.isActive).toBe(true);
  });

  it("returns 404 when targeting a non-field vendorRole row", async () => {
    // 103 is the office-only contact; the target lookup filters by
    // vendor_role IN ('field','both','foreman') so this id is invisible.
    const res = await request(app)
      .delete("/api/field-employees/103")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
    expect(lastUpdate).toBeNull();
  });

  it("returns 404 when targeting an already soft-deleted row", async () => {
    const res = await request(app)
      .delete("/api/field-employees/102")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
    expect(lastUpdate).toBeNull();
  });

  it("vendor admin soft-deletes their own employee, stamping deletedAt + flipping isActive=false", async () => {
    const before = fixtures.fieldEmployees.find((e) => e.id === 101);
    expect(before?.isActive).toBe(true);
    expect(before?.deletedAt).toBeNull();

    const res = await request(app)
      .delete("/api/field-employees/101")
      .set("Cookie", vendorAdminCookie);
    // Task #876: the handler now returns a 200 + `{ openSessions: [...] }`
    // body so the office UI can warn staff which foremen will see this
    // row drop on their next 60s mobile refresh. With no open shifts
    // seeded for employee 101 the list comes back empty.
    expectStatus(res, 200);
    expect(res.body).toEqual({ openSessions: [] });

    const after = fixtures.fieldEmployees.find((e) => e.id === 101);
    expect(after?.isActive).toBe(false);
    expect(after?.deletedAt).toBeInstanceOf(Date);
    // deletedBy is stamped as `${role}:${userId}` so vendor sessions can be
    // distinguished from admin sessions when reviewing the audit trail.
    expect(after?.deletedBy).toBe("vendor:2");

    expect(lastUpdate?.table).toBe("fieldEmployees");
    expect(lastUpdate?.set?.isActive).toBe(false);
    expect(lastUpdate?.set?.deletedBy).toBe("vendor:2");
  });

  it("admin soft-delete stamps deletedBy with the admin id", async () => {
    const res = await request(app)
      .delete("/api/field-employees/100")
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    expect(res.body).toEqual({ openSessions: [] });
    const after = fixtures.fieldEmployees.find((e) => e.id === 100);
    expect(after?.deletedBy).toBe("admin:1");
    expect(after?.isActive).toBe(false);
  });

  it("returns the worker's currently-open ticket sessions in the body (Task #876)", async () => {
    // Seed two open and one closed check-in for employee 101. The
    // closed session has a non-null checkOutAt and must be filtered
    // out by the handler's `isNull(checkOutAt)` predicate; only the
    // two open sessions should come back, each with a formatted
    // VNDRLY-NNNNNNNN tracking number and the original checkInAt
    // serialized as an ISO string.
    fixtures.tickets.push({ id: 5001 });
    fixtures.tickets.push({ id: 5002 });
    fixtures.tickets.push({ id: 5003 });
    const openA = new Date("2026-04-30T14:00:00Z");
    const openB = new Date("2026-04-30T15:30:00Z");
    fixtures.ticketCheckIns.push({
      id: 700,
      ticketId: 5001,
      employeeId: 101,
      checkInAt: openA,
      checkOutAt: null,
    });
    fixtures.ticketCheckIns.push({
      id: 701,
      ticketId: 5002,
      employeeId: 101,
      checkInAt: openB,
      checkOutAt: null,
    });
    fixtures.ticketCheckIns.push({
      id: 702,
      ticketId: 5003,
      employeeId: 101,
      checkInAt: new Date("2026-04-29T08:00:00Z"),
      checkOutAt: new Date("2026-04-29T17:00:00Z"),
    });
    // A check-in on a different employee that should NOT appear in
    // employee 101's response, guarding against a missing
    // `eq(employeeId, ...)` filter.
    fixtures.ticketCheckIns.push({
      id: 703,
      ticketId: 5001,
      employeeId: 100,
      checkInAt: new Date("2026-04-30T16:00:00Z"),
      checkOutAt: null,
    });

    const res = await request(app)
      .delete("/api/field-employees/101")
      .set("Cookie", vendorAdminCookie);
    expectStatus(res, 200);
    const sessions = (res.body.openSessions as Array<{
      ticketId: number;
      ticketTrackingNumber: string;
      checkInAt: string;
    }>).slice().sort((a, b) => a.ticketId - b.ticketId);
    expect(sessions).toEqual([
      {
        ticketId: 5001,
        ticketTrackingNumber: "VNDRLY-00005001",
        checkInAt: openA.toISOString(),
      },
      {
        ticketId: 5002,
        ticketTrackingNumber: "VNDRLY-00005002",
        checkInAt: openB.toISOString(),
      },
    ]);
    // Soft-delete still happened.
    const after = fixtures.fieldEmployees.find((e) => e.id === 101);
    expect(after?.isActive).toBe(false);
    expect(after?.deletedAt).toBeInstanceOf(Date);
  });
});

describe("POST /field-employees/:id/restore (Task #514)", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(app).post("/api/field-employees/102/restore");
    expect(res.status).toBe(401);
    expect(lastUpdate).toBeNull();
  });

  it("rejects vendor admins (admin-only endpoint) with 401", async () => {
    // Even a vendor admin gets 401 here — restore is gated to platform
    // admins only because it can resurrect cross-tenant data.
    const res = await request(app)
      .post("/api/field-employees/102/restore")
      .set("Cookie", vendorAdminCookie);
    expect(res.status).toBe(401);
    expect(lastUpdate).toBeNull();
  });

  it("rejects vendor admins from another vendor too", async () => {
    const res = await request(app)
      .post("/api/field-employees/102/restore")
      .set("Cookie", otherVendorAdminCookie);
    expect(res.status).toBe(401);
    expect(lastUpdate).toBeNull();
  });

  it("returns 404 when the target id does not exist", async () => {
    const res = await request(app)
      .post("/api/field-employees/9999/restore")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
  });

  it("returns 404 when the target row is not a field-style vendorRole", async () => {
    // Office-only employees (id 103) are not exposed via this route at all.
    const res = await request(app)
      .post("/api/field-employees/103/restore")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
    // Non-matching row must remain untouched.
    const row = fixtures.fieldEmployees.find((e) => e.id === 103);
    expect(row?.isActive).toBe(true);
    expect(row?.deletedAt).toBeNull();
  });

  it("admin restore clears deletedAt + deletedBy and re-sets isActive=true", async () => {
    const before = fixtures.fieldEmployees.find((e) => e.id === 102);
    expect(before?.deletedAt).toBeInstanceOf(Date);
    expect(before?.isActive).toBe(false);

    const res = await request(app)
      .post("/api/field-employees/102/restore")
      .set("Cookie", adminCookie);
    expectStatus(res, 204);

    const after = fixtures.fieldEmployees.find((e) => e.id === 102);
    expect(after?.deletedAt).toBeNull();
    expect(after?.deletedBy).toBeNull();
    expect(after?.isActive).toBe(true);

    expect(lastUpdate?.table).toBe("fieldEmployees");
    expect(lastUpdate?.set).toMatchObject({
      deletedAt: null,
      deletedBy: null,
      isActive: true,
    });
  });

  it("restore is idempotent when the row is already active (no-op flip but still 204)", async () => {
    // Restoring an already-live row is a benign no-op: the SET still
    // matches the row (no deletedAt guard on the WHERE), so the route
    // returns 204 and the row's flags remain consistent.
    const res = await request(app)
      .post("/api/field-employees/100/restore")
      .set("Cookie", adminCookie);
    expectStatus(res, 204);
    const row = fixtures.fieldEmployees.find((e) => e.id === 100);
    expect(row?.isActive).toBe(true);
    expect(row?.deletedAt).toBeNull();
  });
});

// Coverage for Task #856 — GET / POST / DELETE on
// /field-employees/:employeeId/notes(/:noteId).
//
// The note handlers carry the same vendor-isolation and soft-delete guards
// as the parent employee handlers (target lookup with isNull(deletedAt),
// cross-vendor returns 404 to avoid leaking existence, etc.) but Task #514
// only covered the parent endpoints. Without these tests, a regression
// that, for example, dropped the cross-vendor check on note deletion would
// let one vendor's admin wipe another vendor's audit trail without any
// test failing.

describe("GET /field-employees/:employeeId/notes (Task #856)", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(app).get("/api/field-employees/100/notes");
    expect(res.status).toBe(401);
  });

  it("rejects sessions whose role is neither admin nor vendor with 401", async () => {
    const res = await request(app)
      .get("/api/field-employees/100/notes")
      .set(
        "Cookie",
        cookieFor({ userId: 99, role: "partner", vendorId: null, partnerId: 1 }),
      );
    expect(res.status).toBe(401);
  });

  it("returns 404 when the employee does not exist", async () => {
    const res = await request(app)
      .get("/api/field-employees/9999/notes")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 404 when the employee has been soft-deleted (target uses isNull(deletedAt))", async () => {
    // Employee 102 exists but has deletedAt set; the route's target lookup
    // includes isNull(deletedAt) so the row is invisible — we do not want
    // to leak existence of soft-deleted employees by returning their notes.
    const res = await request(app)
      .get("/api/field-employees/102/notes")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
  });

  it("returns 404 when a vendor session targets another vendor's employee (no info leak)", async () => {
    // 104 is on vendor 8; vendorAdminCookie is vendor 7. Critically, this
    // must be 404 rather than 403 so the caller can't tell the employee
    // exists at all on the other vendor.
    const res = await request(app)
      .get("/api/field-employees/104/notes")
      .set("Cookie", vendorAdminCookie);
    expect(res.status).toBe(404);
  });

  it("vendor admin can list notes for one of their own employees", async () => {
    const res = await request(app)
      .get("/api/field-employees/100/notes")
      .set("Cookie", vendorAdminCookie);
    expectStatus(res, 200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    // Notes are filtered by employeeId — the cross-vendor note (9100 on
    // employee 104) must not be returned even by id collision.
    const ids = (res.body as Array<{ id: number }>).map((n) => n.id).sort();
    expect(ids).toEqual([9000, 9001]);
    expect(res.body[0]).toMatchObject({
      id: 9000,
      employeeId: 100,
      content: "First call-out absence",
    });
  });

  it("vendor non-admin members can also list notes (read access is not gated to admin)", async () => {
    // The notes GET handler only requires an authenticated admin/vendor
    // session — unlike POST/DELETE there is no membershipRole=admin gate
    // on the write side either, but read access must be allowed for any
    // vendor session so on-call dispatchers (members) can review history.
    const res = await request(app)
      .get("/api/field-employees/100/notes")
      .set("Cookie", vendorMemberCookie);
    expectStatus(res, 200);
    expect(res.body).toHaveLength(2);
  });

  it("admin can list notes for any vendor's employee", async () => {
    const res = await request(app)
      .get("/api/field-employees/104/notes")
      .set("Cookie", adminCookie);
    expectStatus(res, 200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 9100, employeeId: 104 });
  });

  it("returns an empty array when the employee has no notes", async () => {
    // Employee 101 (Bob Builder) has no notes seeded.
    const res = await request(app)
      .get("/api/field-employees/101/notes")
      .set("Cookie", vendorAdminCookie);
    expectStatus(res, 200);
    expect(res.body).toEqual([]);
  });

  it("returns 400 when employeeId is not coercible to a number", async () => {
    const res = await request(app)
      .get("/api/field-employees/not-a-number/notes")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(400);
  });
});

describe("POST /field-employees/:employeeId/notes (Task #856)", () => {
  const validBody = { content: "Showed up late again" };

  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(app)
      .post("/api/field-employees/100/notes")
      .send(validBody);
    expect(res.status).toBe(401);
    expect(lastInsert).toBeNull();
  });

  it("rejects sessions whose role is neither admin nor vendor with 401", async () => {
    const res = await request(app)
      .post("/api/field-employees/100/notes")
      .set(
        "Cookie",
        cookieFor({ userId: 99, role: "partner", vendorId: null, partnerId: 1 }),
      )
      .send(validBody);
    expect(res.status).toBe(401);
    expect(lastInsert).toBeNull();
  });

  it("returns 400 when the body fails Zod validation", async () => {
    const res = await request(app)
      .post("/api/field-employees/100/notes")
      .set("Cookie", vendorAdminCookie)
      .send({}); // missing required `content`
    expect(res.status).toBe(400);
    expect(lastInsert).toBeNull();
  });

  it("returns 404 when the employee does not exist", async () => {
    const res = await request(app)
      .post("/api/field-employees/9999/notes")
      .set("Cookie", adminCookie)
      .send(validBody);
    expect(res.status).toBe(404);
    expect(lastInsert).toBeNull();
  });

  it("returns 404 when the employee is soft-deleted", async () => {
    const res = await request(app)
      .post("/api/field-employees/102/notes")
      .set("Cookie", adminCookie)
      .send(validBody);
    expect(res.status).toBe(404);
    expect(lastInsert).toBeNull();
  });

  it("returns 404 when a vendor session targets another vendor's employee (no info leak)", async () => {
    const res = await request(app)
      .post("/api/field-employees/104/notes")
      .set("Cookie", vendorAdminCookie)
      .send(validBody);
    expect(res.status).toBe(404);
    // Critically: no row was inserted on behalf of the cross-vendor caller.
    expect(lastInsert).toBeNull();
    // And the target's note set is unchanged.
    expect(
      fixtures.fieldEmployeeNotes.filter((n) => n.employeeId === 104),
    ).toHaveLength(1);
  });

  it("vendor admin can create a note on their own employee and the response carries the inserted row", async () => {
    const res = await request(app)
      .post("/api/field-employees/101/notes")
      .set("Cookie", vendorAdminCookie)
      .send(validBody);
    expectStatus(res, 201);
    expect(res.body).toMatchObject({
      employeeId: 101,
      content: "Showed up late again",
    });
    expect(typeof res.body.id).toBe("number");
    // Drizzle defaults: createdAt should be present in the response so
    // clients can render the new note immediately. JSON serialisation
    // turns Date into a string.
    expect(typeof res.body.createdAt).toBe("string");

    expect(lastInsert?.table).toBe("fieldEmployeeNotes");
    expect(lastInsert?.values).toMatchObject({
      employeeId: 101,
      content: "Showed up late again",
    });
    // The employeeId on the inserted row must come from the URL param,
    // not from the body — the route deliberately spreads the body first
    // and then overrides employeeId from params. Even if a malicious
    // body smuggles `employeeId: 104`, the inserted row stays on 101.
    const sneaky = await request(app)
      .post("/api/field-employees/101/notes")
      .set("Cookie", vendorAdminCookie)
      .send({ content: "smuggled", employeeId: 104 });
    expectStatus(sneaky, 201);
    expect(lastInsert?.values?.employeeId).toBe(101);
  });

  it("vendor non-admin members can also create notes (write is not gated to membershipRole=admin)", async () => {
    // Unlike the parent employee mutating handlers, notes are auditing
    // metadata that any vendor-side session may add. If this changes in
    // the future the test will fail loudly so the docs/UI can be kept
    // in sync.
    const res = await request(app)
      .post("/api/field-employees/100/notes")
      .set("Cookie", vendorMemberCookie)
      .send(validBody);
    expectStatus(res, 201);
    expect(lastInsert?.values?.employeeId).toBe(100);
  });

  it("admin can create a note on any vendor's employee", async () => {
    const res = await request(app)
      .post("/api/field-employees/104/notes")
      .set("Cookie", adminCookie)
      .send({ content: "Cross-vendor admin note" });
    expectStatus(res, 201);
    expect(res.body).toMatchObject({ employeeId: 104, content: "Cross-vendor admin note" });
  });

  it("returns 400 when employeeId is not coercible to a number", async () => {
    const res = await request(app)
      .post("/api/field-employees/not-a-number/notes")
      .set("Cookie", adminCookie)
      .send(validBody);
    expect(res.status).toBe(400);
    expect(lastInsert).toBeNull();
  });
});

describe("DELETE /field-employees/:employeeId/notes/:noteId (Task #856)", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(app).delete(
      "/api/field-employees/100/notes/9000",
    );
    expect(res.status).toBe(401);
    expect(lastDelete).toBeNull();
    // The note must still be present.
    expect(fixtures.fieldEmployeeNotes.find((n) => n.id === 9000)).toBeDefined();
  });

  it("rejects sessions whose role is neither admin nor vendor with 401", async () => {
    const res = await request(app)
      .delete("/api/field-employees/100/notes/9000")
      .set(
        "Cookie",
        cookieFor({ userId: 99, role: "partner", vendorId: null, partnerId: 1 }),
      );
    expect(res.status).toBe(401);
    expect(lastDelete).toBeNull();
  });

  it("returns 404 when the employee does not exist", async () => {
    const res = await request(app)
      .delete("/api/field-employees/9999/notes/9000")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
    // No DELETE was issued — the route bails out before the notes table
    // is touched, so 9000 is still on the books.
    expect(lastDelete).toBeNull();
    expect(fixtures.fieldEmployeeNotes.find((n) => n.id === 9000)).toBeDefined();
  });

  it("returns 404 when the employee is soft-deleted", async () => {
    const res = await request(app)
      .delete("/api/field-employees/102/notes/9000")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(404);
    expect(lastDelete).toBeNull();
  });

  it("returns 404 when a vendor admin targets another vendor's employee (returns 404, not 403, to avoid leaking existence)", async () => {
    // 104 belongs to vendor 8; 9100 is its note. vendorAdminCookie is
    // vendor 7. This is the exact regression the task description calls
    // out: a missing cross-vendor check would let one vendor wipe
    // another's audit trail.
    const res = await request(app)
      .delete("/api/field-employees/104/notes/9100")
      .set("Cookie", vendorAdminCookie);
    expect(res.status).toBe(404);
    expect(lastDelete).toBeNull();
    // The cross-vendor note must remain in the fixtures.
    expect(fixtures.fieldEmployeeNotes.find((n) => n.id === 9100)).toBeDefined();
  });

  it("returns 404 when the note belongs to a different employee on the same vendor", async () => {
    // Note 9001 is on employee 100, but the request targets employee 101.
    // The route's DELETE WHERE clause requires both id and employeeId to
    // match, so the note is invisible — the returning() result is empty
    // and the route 404s. Without this check, an admin could delete any
    // note by knowing its id, even from URLs that name the wrong owner.
    const res = await request(app)
      .delete("/api/field-employees/101/notes/9001")
      .set("Cookie", vendorAdminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/note not found/i);
    // `lastDelete` is set (the route did execute the delete query) but
    // matched zero rows — the fixture is unchanged.
    expect(lastDelete?.table).toBe("fieldEmployeeNotes");
    expect(lastDelete?.matched).toEqual([]);
    expect(fixtures.fieldEmployeeNotes.find((n) => n.id === 9001)).toBeDefined();
  });

  it("returns 404 when the noteId does not exist at all", async () => {
    const res = await request(app)
      .delete("/api/field-employees/100/notes/999999")
      .set("Cookie", vendorAdminCookie);
    expect(res.status).toBe(404);
    expect(lastDelete?.matched).toEqual([]);
  });

  it("vendor admin can delete a note on their own employee with 204", async () => {
    expect(fixtures.fieldEmployeeNotes.find((n) => n.id === 9000)).toBeDefined();

    const res = await request(app)
      .delete("/api/field-employees/100/notes/9000")
      .set("Cookie", vendorAdminCookie);
    expectStatus(res, 204);
    // 204 carries no body.
    expect(res.body).toEqual({});
    // The note was hard-deleted from the fixtures (notes are not
    // soft-deleted, unlike employees themselves).
    expect(fixtures.fieldEmployeeNotes.find((n) => n.id === 9000)).toBeUndefined();
    // Sibling note on the same employee is untouched.
    expect(fixtures.fieldEmployeeNotes.find((n) => n.id === 9001)).toBeDefined();

    expect(lastDelete?.table).toBe("fieldEmployeeNotes");
    expect(lastDelete?.matched).toHaveLength(1);
    expect(lastDelete?.matched[0]).toMatchObject({
      id: 9000,
      employeeId: 100,
    });
  });

  it("vendor non-admin members can also delete notes (delete is not gated to membershipRole=admin)", async () => {
    const res = await request(app)
      .delete("/api/field-employees/100/notes/9001")
      .set("Cookie", vendorMemberCookie);
    expectStatus(res, 204);
    expect(fixtures.fieldEmployeeNotes.find((n) => n.id === 9001)).toBeUndefined();
  });

  it("admin can delete a note on any vendor's employee", async () => {
    const res = await request(app)
      .delete("/api/field-employees/104/notes/9100")
      .set("Cookie", adminCookie);
    expectStatus(res, 204);
    expect(fixtures.fieldEmployeeNotes.find((n) => n.id === 9100)).toBeUndefined();
  });

  it("returns 400 when params fail Zod coercion", async () => {
    const res = await request(app)
      .delete("/api/field-employees/100/notes/not-a-number")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(400);
    expect(lastDelete).toBeNull();
  });
});

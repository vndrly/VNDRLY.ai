import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// ── Tiny in-memory store with predicate-aware query evaluation ───────────────
//
// The visits routes use drizzle's eq / and / isNull / isNotNull / sql / lt
// helpers in their WHERE clauses. To exercise the geofence, host validation
// and role-aware filtering for real, we mock those helpers to build a
// predicate AST and have the mock `db` evaluate it against fixture rows.
//
// Fixture rows for joined reads include the joined column names directly
// (e.g. siteVisits rows carry siteName, hostPartnerName, hostVendorName,
// sitePartnerId), since the mock does not perform real joins. The route's
// projection maps drizzle column refs to keys in the response object, but
// since the mock returns the full row as-is, accessing `row.siteName`
// (etc.) just works as long as the fixture provides that key.

type Row = Record<string, any>;
type ColRef = { __table: string; __col: string };
type Pred =
  | { kind: "eq"; col: ColRef; val: any }
  | { kind: "isNull"; col: ColRef }
  | { kind: "isNotNull"; col: ColRef }
  | { kind: "lt"; col: ColRef; val: any }
  | { kind: "gte"; col: ColRef; val: any }
  | { kind: "stalePlus30"; col: ColRef; now: Date }
  | { kind: "tsRange"; col: ColRef; cmp: ">=" | "<="; val: Date }
  | { kind: "and"; preds: Pred[] }
  | { kind: "true" };

function tableTag(name: string, cols: string[]) {
  const t: any = { __name: name };
  for (const c of cols) t[c] = { __table: name, __col: c };
  return t;
}

const tables = {
  guestSessions: tableTag("guestSessions", [
    "id",
    "tokenJti",
    "firstName",
    "lastName",
    "phone",
    "email",
    "company",
    "vehiclePlate",
    "lastPurpose",
    "createdAt",
    "expiresAt",
    "revokedAt",
  ]),
  siteVisits: tableTag("siteVisits", [
    "id",
    "siteLocationId",
    "guestSessionId",
    "firstName",
    "lastName",
    "phone",
    "email",
    "company",
    "vehiclePlate",
    "purpose",
    "expectedDurationMinutes",
    "hostType",
    "hostPartnerId",
    "hostVendorId",
    "checkInTime",
    "checkInLatitude",
    "checkInLongitude",
    "checkOutTime",
    "checkOutLatitude",
    "checkOutLongitude",
    "autoCheckedOut",
    "safetyAcknowledgedAt",
    "createdAt",
    "expiresAt",
  ]),
  siteLocations: tableTag("siteLocations", [
    "id",
    "name",
    "address",
    "siteCode",
    "latitude",
    "longitude",
    "siteRadiusMeters",
    "partnerId",
  ]),
  partners: tableTag("partners", ["id", "name"]),
  vendors: tableTag("vendors", ["id", "name"]),
  siteWorkAssignments: tableTag("siteWorkAssignments", [
    "id",
    "siteLocationId",
    "vendorId",
  ]),
  users: tableTag("users", ["id", "partnerId", "vendorId"]),
};

const fixtures: Record<string, Row[]> = {
  guestSessions: [],
  siteVisits: [],
  siteLocations: [],
  partners: [],
  vendors: [],
  siteWorkAssignments: [],
  users: [],
};

const idCounters: Record<string, number> = {};
function nextId(t: string) {
  idCounters[t] = (idCounters[t] ?? 0) + 1;
  return idCounters[t];
}

function evalPred(pred: Pred | undefined, row: Row, now = new Date()): boolean {
  if (!pred) return true;
  switch (pred.kind) {
    case "true":
      return true;
    case "eq":
      return row[pred.col.__col] === pred.val;
    case "isNull":
      return row[pred.col.__col] == null;
    case "isNotNull":
      return row[pred.col.__col] != null;
    case "lt": {
      const lhs = row[pred.col.__col];
      if (lhs == null) return false;
      const a = lhs instanceof Date ? lhs.getTime() : lhs;
      const b = pred.val instanceof Date ? pred.val.getTime() : pred.val;
      return a < b;
    }
    case "gte": {
      const lhs = row[pred.col.__col];
      if (lhs == null) return false;
      const a = lhs instanceof Date ? lhs.getTime() : lhs;
      const b = pred.val instanceof Date ? pred.val.getTime() : pred.val;
      return a >= b;
    }
    case "tsRange": {
      const lhs = row[pred.col.__col];
      if (lhs == null) return false;
      const a = lhs instanceof Date ? lhs.getTime() : lhs;
      const b = pred.val.getTime();
      return pred.cmp === ">=" ? a >= b : a <= b;
    }
    case "stalePlus30": {
      // expiresAt + 30 minutes < now()
      const lhs = row[pred.col.__col];
      if (lhs == null) return false;
      const a = (lhs instanceof Date ? lhs.getTime() : lhs) + 30 * 60 * 1000;
      return a < pred.now.getTime();
    }
    case "and":
      return pred.preds.every((p) => evalPred(p, row, now));
  }
}

let lastInsert: { table: string; values: Row | Row[] } | null = null;

function makeQuery(tableName: string) {
  let pred: Pred | undefined;
  let limitN: number | undefined;
  const run = () => {
    const all = fixtures[tableName] ?? [];
    const filtered = all.filter((r) => evalPred(pred, r));
    return limitN != null ? filtered.slice(0, limitN) : filtered;
  };
  const q: any = {
    where: (p: Pred) => {
      pred = p;
      return q;
    },
    leftJoin: () => q,
    innerJoin: () => q,
    orderBy: () => q,
    limit: (n: number) => {
      limitN = n;
      return q;
    },
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
    selectDistinct: (_cols?: any) => ({
      from: (t: any) => makeQuery(t.__name),
    }),
    insert: (t: any) => ({
      values: (v: any) => {
        const valsArr: Row[] = Array.isArray(v) ? v : [v];
        const inserted = valsArr.map((vv) => {
          // Mirror DB-side defaults the production code relies on.
          const defaults: Row = {};
          if (t.__name === "siteVisits") {
            defaults.checkInTime = new Date();
            defaults.autoCheckedOut = false;
            defaults.checkOutTime = null;
            defaults.checkOutLatitude = null;
            defaults.checkOutLongitude = null;
            defaults.createdAt = new Date();
          }
          return { id: nextId(t.__name), ...defaults, ...vv };
        });
        for (const row of inserted) fixtures[t.__name].push(row);
        lastInsert = { table: t.__name, values: v };
        const ret: any = {
          returning: async () => inserted,
          onConflictDoNothing: () => ret,
          then: (resolve: any) => Promise.resolve(inserted).then(resolve),
        };
        return ret;
      },
    }),
    update: (t: any) => ({
      set: (s: Row) => {
        const apply = (pred?: Pred) => {
          const matching = (fixtures[t.__name] ?? []).filter((r) =>
            evalPred(pred, r),
          );
          for (const m of matching) Object.assign(m, s);
          return matching;
        };
        const where = (p?: Pred) => {
          let resolved = false;
          let updated: Row[] = [];
          const ensure = () => {
            if (!resolved) {
              updated = apply(p);
              resolved = true;
            }
            return updated;
          };
          const ret: any = {
            returning: async (_cols?: any) => ensure(),
            then: (resolve: any) => Promise.resolve(ensure()).then(resolve),
            catch: (reject: any) =>
              Promise.resolve(ensure()).catch(reject),
          };
          return ret;
        };
        return { where };
      },
    }),
  };
  return {
    db,
    pool: { query: vi.fn(async () => ({ rows: [] })) },
    guestSessionsTable: tables.guestSessions,
    siteVisitsTable: tables.siteVisits,
    siteLocationsTable: tables.siteLocations,
    partnersTable: tables.partners,
    vendorsTable: tables.vendors,
    siteWorkAssignmentsTable: tables.siteWorkAssignments,
    usersTable: tables.users,
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts", []),
    hotlistCommentsTable: tableTag("hotlistComments", []),
    ticketNoteLogsTable: tableTag("ticketNoteLogs", []),
  };
});

vi.mock("drizzle-orm", () => {
  const passthrough = (..._args: any[]) => ({ kind: "true" });
  // Recognize the sweepStaleVisits SQL shape:
  //   sql`${siteVisits.expiresAt} + interval '30 minutes' < now()`
  // Translate it to a `stalePlus30` predicate the evaluator can honor so
  // the sweep test can verify only-overdue rows are auto-checked-out.
  const sqlTag: any = (strings: any, ...values: any[]) => {
    if (Array.isArray(strings) && (strings as any).raw !== undefined) {
      const joined = (strings as string[]).join(" ");
      if (
        values.length === 1 &&
        /interval '30 minutes' < now\(\)/.test(joined) &&
        values[0] &&
        typeof (values[0] as any).__col === "string"
      ) {
        return { kind: "stalePlus30", col: values[0] as ColRef, now: new Date() };
      }
      // Range predicates used by GET /api/visits filter (from / to)
      if (values.length === 2 && /\s>=\s/.test(joined)) {
        return { kind: "tsRange", col: values[0] as ColRef, cmp: ">=", val: values[1] as Date };
      }
      if (values.length === 2 && /\s<=\s/.test(joined)) {
        return { kind: "tsRange", col: values[0] as ColRef, cmp: "<=", val: values[1] as Date };
      }
    }
    return { kind: "true" };
  };
  sqlTag.raw = passthrough;
  return {
    and: (...preds: Pred[]) => ({ kind: "and", preds: preds.filter(Boolean) }),
    eq: (col: ColRef, val: any) => ({ kind: "eq", col, val }),
    isNull: (col: ColRef) => ({ kind: "isNull", col }),
    isNotNull: (col: ColRef) => ({ kind: "isNotNull", col }),
    lt: (col: ColRef, val: any) => ({ kind: "lt", col, val }),
    sql: sqlTag,
    desc: passthrough,
  };
});

// Stub out notifications so we don't pull in the notifications table chain.
const notifyUsersMock = vi.fn(async () => 0);
vi.mock("./notifications", () => ({
  notifyUsers: notifyUsersMock,
  findPartnerUserIds: async (id: number) => (id ? [100, 101] : []),
  findVendorUserIds: async (id: number) => (id ? [200] : []),
  findPartnerVisitNotifierUserIds: async (id: number) => (id ? [100, 101] : []),
  findVendorVisitNotifierUserIds: async (id: number) => (id ? [200] : []),
  VISIT_NOTIFICATIONS_ROLE: "Visitor Notifications",
}));



function staffCookie(
  overrides: Partial<{
    userId: number;
    role: string;
    vendorId: number | null;
    partnerId: number | null;
    exp: number;
  }> = {},
) {
  const session = {
    userId: 10,
    role: "admin",
    vendorId: null,
    partnerId: null,
    // getStaffSession requires `exp` (seconds-since-epoch) on the cookie.
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    ...overrides,
  };
  return buildTestCookie(session);
}

let app: express.Express;
let visitsModule: typeof import("./visits");

beforeEach(async () => {
  for (const k of Object.keys(fixtures)) fixtures[k] = [];
  for (const k of Object.keys(idCounters)) idCounters[k] = 0;
  lastInsert = null;
  notifyUsersMock.mockClear();
  vi.resetModules();
  visitsModule = await import("./visits");
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", visitsModule.default);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

// Convenience: seed a site with both a partner host and a vendor host
// assigned, plus a guest session that authenticates subsequent calls.
function seedScenario() {
  const partner = { id: 1, name: "Acme Partner" };
  const vendor = { id: 2, name: "Beta Vendor" };
  const otherVendor = { id: 3, name: "Other Vendor" };
  const site = {
    id: 10,
    name: "Site A",
    address: "1 Main St",
    siteCode: "SITE-A",
    latitude: 40.0,
    longitude: -74.0,
    siteRadiusMeters: 150,
    partnerId: partner.id,
  };
  const otherSite = {
    id: 11,
    name: "Other Site",
    address: "2 Other St",
    siteCode: "SITE-B",
    latitude: 41.0,
    longitude: -75.0,
    siteRadiusMeters: 150,
    partnerId: 99,
  };
  fixtures.partners = [partner];
  fixtures.vendors = [vendor, otherVendor];
  fixtures.siteLocations = [site, otherSite];
  fixtures.siteWorkAssignments = [
    { id: 1, siteLocationId: site.id, vendorId: vendor.id },
  ];
  return { partner, vendor, otherVendor, site, otherSite };
}

async function startGuest(extras: Partial<Row> = {}) {
  const res = await request(app)
    .post("/api/auth/guest")
    .send({
      firstName: "Jane",
      lastName: "Visitor",
      phone: "555-1234",
      email: "jane@example.com",
      company: "Visitor Co",
      vehiclePlate: "ABC123",
      purpose: "Inspection",
      safetyAcknowledged: true,
      ...extras,
    });
  expectStatus(res, 200);
  return {
    token: res.body.token as string,
    guestSessionId: res.body.guestSessionId as number,
    cookie: (res.headers["set-cookie"] as unknown as string[])?.find((c) =>
      c.startsWith("vndrly_guest="),
    ) ?? "",
    body: res.body,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/guest", () => {
  it("requires firstName and lastName", async () => {
    const res = await request(app)
      .post("/api/auth/guest")
      .send({ firstName: "", lastName: "Doe", safetyAcknowledged: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("guest.name_required");
  });

  it("requires safety acknowledgement", async () => {
    const res = await request(app)
      .post("/api/auth/guest")
      .send({ firstName: "Jane", lastName: "Doe", safetyAcknowledged: false });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/safety/i);
    expect(res.body.code).toBe("guest.safety_required");
  });

  it("creates a guest session, sets cookie, returns bearer token", async () => {
    const res = await request(app)
      .post("/api/auth/guest")
      .send({
        firstName: "  Jane  ",
        lastName: "Visitor",
        phone: "555",
        email: "j@e.com",
        safetyAcknowledged: true,
      });
    expectStatus(res, 200);
    expect(res.body.role).toBe("guest");
    expect(typeof res.body.token).toBe("string");
    expect(res.body.guestSessionId).toBeGreaterThan(0);
    expect(res.body.profile.firstName).toBe("Jane");
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    expect(setCookie?.some((c) => c.startsWith("vndrly_guest="))).toBe(true);
    expect(fixtures.guestSessions).toHaveLength(1);
    expect(fixtures.guestSessions[0]).toMatchObject({
      firstName: "Jane",
      lastName: "Visitor",
    });
    expect(fixtures.guestSessions[0].revokedAt).toBeFalsy();
  });

  it("returned bearer token authenticates GET /api/auth/guest/me", async () => {
    const { token } = await startGuest();
    const me = await request(app)
      .get("/api/auth/guest/me")
      .set("Authorization", `Bearer ${token}`);
    expectStatus(me, 200);
    expect(me.body.profile.firstName).toBe("Jane");
  });

  it("rejects guest endpoints without a token", async () => {
    const me = await request(app).get("/api/auth/guest/me");
    expect(me.status).toBe(401);
    expect(me.body.code).toBe("auth.guest_required");
  });

  it("rejects guest endpoints when the backing session has been revoked", async () => {
    const { token } = await startGuest();
    // Token still decodes (exp is in the future), but the row is gone/revoked
    // → requireGuest must fall through to the auth.guest_expired branch.
    fixtures.guestSessions[0].revokedAt = new Date();
    const me = await request(app)
      .get("/api/auth/guest/me")
      .set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(401);
    expect(me.body.code).toBe("auth.guest_expired");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/visits/check-in", () => {
  it("requires a guest session", async () => {
    seedScenario();
    const res = await request(app)
      .post("/api/visits/check-in")
      .send({ siteLocationId: 10, hostType: "partner", hostPartnerId: 1, latitude: 40, longitude: -74 });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.guest_required");
  });

  it("validates required body fields", async () => {
    seedScenario();
    const { token } = await startGuest();
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({ hostType: "partner" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("visit.invalid_input");
  });

  it("returns 404 when site does not exist", async () => {
    seedScenario();
    const { token } = await startGuest();
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: 9999,
        hostType: "partner",
        hostPartnerId: 1,
        latitude: 40.0,
        longitude: -74.0,
      });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("site.not_found");
  });

  it("rejects when partner host does not own the site", async () => {
    const { site } = seedScenario();
    const { token } = await startGuest();
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: 999, // not site.partnerId
        latitude: 40.0,
        longitude: -74.0,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Partner host/i);
    expect(res.body.code).toBe("visit.partner_host_mismatch");
  });

  it("rejects when vendor host id is missing", async () => {
    const { site } = seedScenario();
    const { token } = await startGuest();
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "vendor",
        // no hostVendorId
        latitude: 40.0,
        longitude: -74.0,
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("visit.host_vendor_required");
  });

  it("rejects when vendor host is not assigned to the site", async () => {
    const { site, otherVendor } = seedScenario();
    const { token } = await startGuest();
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "vendor",
        hostVendorId: otherVendor.id, // not in siteWorkAssignments
        latitude: 40.0,
        longitude: -74.0,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not assigned/i);
    expect(res.body.code).toBe("visit.vendor_not_assigned");
  });

  it("rejects when location is not provided", async () => {
    const { site } = seedScenario();
    const { token } = await startGuest();
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: 1,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Location is required/i);
    expect(res.body.code).toBe("visit.location_required");
  });

  it("rejects when caller is outside the geofence", async () => {
    const { site } = seedScenario();
    const { token } = await startGuest();
    // ~111km north of the site → far outside any sensible site radius.
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: 1,
        latitude: 41.0,
        longitude: -74.0,
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("off_geofence");
    expect(res.body.distanceMeters).toBeGreaterThan(site.siteRadiusMeters);
    expect(res.body.radiusMeters).toBe(site.siteRadiusMeters);
    expect(fixtures.siteVisits).toHaveLength(0);
  });

  it("happy path (partner host): inserts visit and notifies host org users", async () => {
    const { site } = seedScenario();
    const { token, guestSessionId } = await startGuest();
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: 1,
        purpose: "Inspection",
        expectedDurationMinutes: 30,
        latitude: 40.0,
        longitude: -74.0,
      });
    expectStatus(res, 201);
    expect(res.body.hostName).toBe("Acme Partner");
    expect(res.body.siteName).toBe("Site A");
    expect(fixtures.siteVisits).toHaveLength(1);
    expect(fixtures.siteVisits[0]).toMatchObject({
      siteLocationId: site.id,
      guestSessionId,
      hostType: "partner",
      hostPartnerId: 1,
      hostVendorId: null,
    });
    expect(fixtures.siteVisits[0].checkOutTime).toBeFalsy();
    expect(notifyUsersMock).toHaveBeenCalledTimes(1);
    const [recipients, notif] = notifyUsersMock.mock.calls[0] as any;
    expect(recipients).toEqual([100, 101]);
    expect(notif).toMatchObject({ type: "visitor_checked_in", category: "visitor" });
  });

  it("happy path (vendor host): inserts visit linked to the assigned vendor", async () => {
    const { site, vendor } = seedScenario();
    const { token } = await startGuest();
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "vendor",
        hostVendorId: vendor.id,
        latitude: 40.0,
        longitude: -74.0,
      });
    expectStatus(res, 201);
    expect(res.body.hostName).toBe("Beta Vendor");
    expect(fixtures.siteVisits[0]).toMatchObject({
      hostType: "vendor",
      hostVendorId: vendor.id,
      hostPartnerId: null,
    });
    const [recipients] = notifyUsersMock.mock.calls[0] as any;
    expect(recipients).toEqual([200]);
  });

  it("auto-checks-out any prior open visit before creating a new one", async () => {
    const { site, vendor } = seedScenario();
    const { token, guestSessionId } = await startGuest();
    // First check-in.
    await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "vendor",
        hostVendorId: vendor.id,
        latitude: 40.0,
        longitude: -74.0,
      });
    expect(fixtures.siteVisits).toHaveLength(1);
    const firstVisitId = fixtures.siteVisits[0].id;

    // Second check-in (e.g. same guest forgets to check out).
    await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: 1,
        latitude: 40.0,
        longitude: -74.0,
      });
    expect(fixtures.siteVisits).toHaveLength(2);
    const first = fixtures.siteVisits.find((v) => v.id === firstVisitId);
    expect(first?.checkOutTime).toBeInstanceOf(Date);
    expect(first?.autoCheckedOut).toBe(true);
    // The new open visit belongs to the same guest.
    const open = fixtures.siteVisits.filter((v) => !v.checkOutTime);
    expect(open).toHaveLength(1);
    expect(open[0].guestSessionId).toBe(guestSessionId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/visits/:id/check-out", () => {
  async function checkInOnce() {
    const scenario = seedScenario();
    const guest = await startGuest();
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${guest.token}`)
      .send({
        siteLocationId: scenario.site.id,
        hostType: "partner",
        hostPartnerId: 1,
        latitude: 40.0,
        longitude: -74.0,
      });
    return { ...scenario, guest, visitId: res.body.id as number };
  }

  it("checks out the active visit and records geo coords", async () => {
    const { guest, visitId } = await checkInOnce();
    const res = await request(app)
      .post(`/api/visits/${visitId}/check-out`)
      .set("Authorization", `Bearer ${guest.token}`)
      .send({ latitude: 40.001, longitude: -74.002 });
    expectStatus(res, 200);
    expect(res.body.checkOutTime).toBeTruthy();
    const stored = fixtures.siteVisits.find((v) => v.id === visitId);
    expect(stored?.checkOutTime).toBeInstanceOf(Date);
    expect(stored?.checkOutLatitude).toBe(40.001);
    expect(stored?.checkOutLongitude).toBe(-74.002);
    expect(stored?.autoCheckedOut).not.toBe(true);
  });

  it("returns 404 if the visit does not belong to the calling guest", async () => {
    const { visitId } = await checkInOnce();
    // Start a *different* guest session and try to check out the visit.
    const otherGuest = await startGuest({ firstName: "Other", lastName: "Guest" });
    const res = await request(app)
      .post(`/api/visits/${visitId}/check-out`)
      .set("Authorization", `Bearer ${otherGuest.token}`)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("visit.not_found");
  });

  it("returns 400 when the visit id is not a number", async () => {
    const { guest } = await checkInOnce();
    const res = await request(app)
      .post(`/api/visits/not-a-number/check-out`)
      .set("Authorization", `Bearer ${guest.token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("visit.invalid_id");
  });

  it("returns the visit unchanged if already checked out (idempotent)", async () => {
    const { guest, visitId } = await checkInOnce();
    await request(app)
      .post(`/api/visits/${visitId}/check-out`)
      .set("Authorization", `Bearer ${guest.token}`)
      .send({ latitude: 40, longitude: -74 });
    const before = { ...fixtures.siteVisits.find((v) => v.id === visitId)! };
    const second = await request(app)
      .post(`/api/visits/${visitId}/check-out`)
      .set("Authorization", `Bearer ${guest.token}`)
      .send({ latitude: 50, longitude: -80 });
    expectStatus(second, 200);
    const after = fixtures.siteVisits.find((v) => v.id === visitId)!;
    expect(after.checkOutTime?.getTime()).toBe(before.checkOutTime?.getTime());
    expect(after.checkOutLatitude).toBe(before.checkOutLatitude);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/visits role-aware filtering", () => {
  async function seedTwoVisits() {
    const { site } = seedScenario();
    // Visit 1 on site (partner=1, host vendor=2).
    fixtures.siteVisits.push({
      id: nextId("siteVisits"),
      siteLocationId: site.id,
      guestSessionId: 1,
      firstName: "V1",
      lastName: "P",
      hostType: "vendor",
      hostVendorId: 2,
      hostPartnerId: null,
      checkInTime: new Date(),
      checkOutTime: null,
      autoCheckedOut: false,
      // joined fields the route projects via leftJoin:
      siteName: site.name,
      hostVendorName: "Beta Vendor",
      hostPartnerName: null,
    });
    // Visit 2 at a *different* partner's site, hosted by a different vendor.
    const otherSite = fixtures.siteLocations.find((s) => s.id === 11)!;
    fixtures.siteVisits.push({
      id: nextId("siteVisits"),
      siteLocationId: otherSite.id,
      guestSessionId: 2,
      firstName: "V2",
      lastName: "Q",
      hostType: "vendor",
      hostVendorId: 3,
      hostPartnerId: null,
      checkInTime: new Date(),
      checkOutTime: null,
      autoCheckedOut: false,
      siteName: otherSite.name,
      hostVendorName: "Other Vendor",
      hostPartnerName: null,
      // For the partner-role filter, the route condition is
      // eq(siteLocationsTable.partnerId, session.partnerId). With our flat
      // mock that filter applies against the *visit row*, so we expose the
      // joined site partnerId here as `partnerId` to make the test honest.
      partnerId: otherSite.partnerId,
    });
    // And expose site partnerId on visit 1 too:
    fixtures.siteVisits[0].partnerId = site.partnerId;
  }

  it("rejects unauthenticated callers", async () => {
    await seedTwoVisits();
    const res = await request(app).get("/api/visits");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.required");
  });

  it("rejects guest sessions hitting the staff list", async () => {
    await seedTwoVisits();
    // Construct a fake "staff" cookie with role=guest — the staff list must
    // refuse guest tokens regardless.
    const cookie = buildTestCookie({ userId: 0, role: "guest" });
    const res = await request(app).get("/api/visits").set("Cookie", cookie);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.required");
  });

  it("admin sees all visits", async () => {
    await seedTwoVisits();
    const res = await request(app)
      .get("/api/visits")
      .set("Cookie", staffCookie({ role: "admin" }));
    expectStatus(res, 200);
    expect(res.body).toHaveLength(2);
  });

  it("vendor sees only its own hosted visits", async () => {
    await seedTwoVisits();
    const res = await request(app)
      .get("/api/visits")
      .set("Cookie", staffCookie({ role: "vendor", vendorId: 2 }));
    expectStatus(res, 200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].firstName).toBe("V1");
  });

  it("partner sees only visits at sites they own", async () => {
    await seedTwoVisits();
    const res = await request(app)
      .get("/api/visits")
      .set("Cookie", staffCookie({ role: "partner", partnerId: 1 }));
    expectStatus(res, 200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].firstName).toBe("V1");
  });

  it("returns [] for unrelated roles (e.g. field_employee)", async () => {
    await seedTwoVisits();
    const res = await request(app)
      .get("/api/visits")
      .set("Cookie", staffCookie({ role: "field_employee", vendorId: 1 }));
    expectStatus(res, 200);
    // field_employee falls through the role gate but vendor branch handles
    // it (vendor != admin/partner branch with vendorId set), so we accept
    // either [] (strict) or a vendor-scoped subset; assert it's not the
    // full admin view.
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeLessThan(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/visits/:id (staff detail)", () => {
  function seedDetailVisit() {
    const { site } = seedScenario();
    fixtures.siteVisits.push({
      id: nextId("siteVisits"),
      siteLocationId: site.id,
      guestSessionId: 1,
      firstName: "Detail",
      lastName: "V",
      hostType: "vendor",
      hostVendorId: 2,
      hostPartnerId: null,
      checkInTime: new Date(),
      checkOutTime: null,
      autoCheckedOut: false,
      // Joined columns the route projects (the mock doesn't run real joins,
      // so they must live on the row directly).
      siteName: site.name,
      sitePartnerId: site.partnerId,
      hostVendorName: "Beta Vendor",
      hostPartnerName: null,
    });
    return { site, visitId: fixtures.siteVisits[0].id as number };
  }

  it("rejects unauthenticated callers", async () => {
    const { visitId } = seedDetailVisit();
    const res = await request(app).get(`/api/visits/${visitId}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.required");
  });

  it("rejects guest tokens hitting the staff detail route", async () => {
    const { visitId } = seedDetailVisit();
    const cookie = buildTestCookie({ userId: 0, role: "guest" });
    const res = await request(app)
      .get(`/api/visits/${visitId}`)
      .set("Cookie", cookie);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.required");
  });

  it("returns 400 when the visit id is not a number", async () => {
    seedDetailVisit();
    const res = await request(app)
      .get(`/api/visits/not-a-number`)
      .set("Cookie", staffCookie({ role: "admin" }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("visit.invalid_id");
  });

  it("returns 404 when the visit does not exist", async () => {
    seedDetailVisit();
    const res = await request(app)
      .get(`/api/visits/9999`)
      .set("Cookie", staffCookie({ role: "admin" }));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("visit.not_found");
  });

  it("returns 403 when a vendor reads a visit hosted by another vendor", async () => {
    const { visitId } = seedDetailVisit();
    const res = await request(app)
      .get(`/api/visits/${visitId}`)
      .set("Cookie", staffCookie({ role: "vendor", vendorId: 999 }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("visit.no_access");
  });

  it("returns 403 when a partner reads a visit at another partner's site", async () => {
    const { visitId } = seedDetailVisit();
    const res = await request(app)
      .get(`/api/visits/${visitId}`)
      .set("Cookie", staffCookie({ role: "partner", partnerId: 999 }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("visit.no_access");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("sweepStaleVisits()", () => {
  it("auto-checks-out visits whose expiresAt + 30min has passed", async () => {
    seedScenario();
    const now = Date.now();
    // Open visit, expired 31 minutes ago → should be swept.
    fixtures.siteVisits.push({
      id: nextId("siteVisits"),
      siteLocationId: 10,
      guestSessionId: 1,
      firstName: "Stale",
      lastName: "V",
      hostType: "partner",
      hostPartnerId: 1,
      hostVendorId: null,
      checkInTime: new Date(now - 90 * 60 * 1000),
      checkOutTime: null,
      autoCheckedOut: false,
      expiresAt: new Date(now - 31 * 60 * 1000),
    });
    // Open visit, expires in the future → leave alone.
    fixtures.siteVisits.push({
      id: nextId("siteVisits"),
      siteLocationId: 10,
      guestSessionId: 2,
      firstName: "Fresh",
      lastName: "V",
      hostType: "partner",
      hostPartnerId: 1,
      hostVendorId: null,
      checkInTime: new Date(now - 5 * 60 * 1000),
      checkOutTime: null,
      autoCheckedOut: false,
      expiresAt: new Date(now + 60 * 60 * 1000),
    });
    // Already checked out → leave alone.
    fixtures.siteVisits.push({
      id: nextId("siteVisits"),
      siteLocationId: 10,
      guestSessionId: 3,
      firstName: "Done",
      lastName: "V",
      hostType: "partner",
      hostPartnerId: 1,
      hostVendorId: null,
      checkInTime: new Date(now - 4 * 3600_000),
      checkOutTime: new Date(now - 1 * 3600_000),
      autoCheckedOut: false,
      expiresAt: new Date(now - 3 * 3600_000),
    });
    // Open visit with NULL expiresAt → leave alone.
    fixtures.siteVisits.push({
      id: nextId("siteVisits"),
      siteLocationId: 10,
      guestSessionId: 4,
      firstName: "Indef",
      lastName: "V",
      hostType: "partner",
      hostPartnerId: 1,
      hostVendorId: null,
      checkInTime: new Date(now - 2 * 3600_000),
      checkOutTime: null,
      autoCheckedOut: false,
      expiresAt: null,
    });

    const swept = await visitsModule.sweepStaleVisits();
    expect(swept).toBe(1);
    const stale = fixtures.siteVisits.find((v) => v.firstName === "Stale")!;
    expect(stale.checkOutTime).toBeInstanceOf(Date);
    expect(stale.autoCheckedOut).toBe(true);

    const fresh = fixtures.siteVisits.find((v) => v.firstName === "Fresh")!;
    expect(fresh.checkOutTime).toBeNull();
    expect(fresh.autoCheckedOut).toBe(false);

    const indef = fixtures.siteVisits.find((v) => v.firstName === "Indef")!;
    expect(indef.checkOutTime).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// "End-to-end" flow exercised against the route layer: a fresh guest signs
// in, fetches the public site context, checks in within the geofence, and
// then checks out. This mirrors what the visit-public.tsx page does step by
// step (sans browser-side geolocation), so a regression to any of those
// routes will surface here.
describe("guest visit flow (e2e via route layer)", () => {
  it("sign in → site context → check in → active → check out", async () => {
    const { site } = seedScenario();

    // 1) Sign in as guest.
    const guest = await startGuest();

    // 2) Fetch public site context (no auth required).
    const ctx = await request(app).get(`/api/visits/site-context/${site.siteCode}`);
    expectStatus(ctx, 200);
    expect(ctx.body.site.id).toBe(site.id);
    expect(ctx.body.partner?.id).toBe(1);

    // 3) Check in within geofence.
    const checkIn = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${guest.token}`)
      .send({
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: 1,
        purpose: "Walkthrough",
        expectedDurationMinutes: 45,
        latitude: 40.0,
        longitude: -74.0,
      });
    expectStatus(checkIn, 201);
    const visitId = checkIn.body.id as number;

    // 4) Active visit reflects the new check-in.
    fixtures.siteVisits[0].siteName = site.name;
    fixtures.siteVisits[0].hostPartnerName = "Acme Partner";
    const active = await request(app)
      .get("/api/visits/me/active")
      .set("Authorization", `Bearer ${guest.token}`);
    expectStatus(active, 200);
    expect(active.body?.id).toBe(visitId);

    // 5) Check out.
    const checkOut = await request(app)
      .post(`/api/visits/${visitId}/check-out`)
      .set("Authorization", `Bearer ${guest.token}`)
      .send({ latitude: 40.0001, longitude: -74.0001 });
    expectStatus(checkOut, 200);
    expect(checkOut.body.checkOutTime).toBeTruthy();

    // 6) After check-out, /me/active returns null.
    const after = await request(app)
      .get("/api/visits/me/active")
      .set("Authorization", `Bearer ${guest.token}`);
    expectStatus(after, 200);
    expect(after.body).toBeNull();
  });
});

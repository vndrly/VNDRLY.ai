import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// ── Tiny in-memory store with predicate-aware query evaluation ───────────────
//
// The route under test uses drizzle's `eq` / `and` / `isNull` / `inArray`
// helpers in its WHERE clauses. To give real coverage of the consent /
// ownership filters we mock those helpers to build a predicate AST, mock the
// table objects so their columns are addressable, and have the mock `db`
// actually evaluate the predicate against fixture rows. That way removing a
// filter (e.g. dropping the deviceId match or the revokedAt IS NULL guard)
// would cause these tests to fail.

type Row = Record<string, any>;
type ColRef = { __table: string; __col: string };
type Pred =
  | { kind: "eq"; col: ColRef; val: any }
  | { kind: "isNull"; col: ColRef }
  | { kind: "inArray"; col: ColRef; arr: any[] }
  | { kind: "gte"; col: ColRef; val: any }
  | { kind: "lt"; col: ColRef; val: any }
  | { kind: "and"; preds: Pred[] }
  | { kind: "true" };

function tableTag(name: string, cols: string[]) {
  const t: any = { __name: name };
  for (const c of cols) t[c] = { __table: name, __col: c };
  return t;
}

const tables = {
  consents: tableTag("consents", [
    "id",
    "userId",
    "deviceId",
    "revokedAt",
    "acceptedAt",
  ]),
  employees: tableTag("employees", ["id", "userId", "vendorId"]),
  tickets: tableTag("tickets", [
    "id",
    "fieldEmployeeId",
    "lifecycleState",
    "vendorId",
    "siteLocationId",
  ]),
  gpsLogs: tableTag("gpsLogs", [
    "id",
    "ticketId",
    "latitude",
    "longitude",
    "eventType",
    "batteryLevel",
    "recordedAt",
  ]),
  sites: tableTag("sites", ["id", "name", "siteCode"]),
};

const fixtures: Record<string, Row[]> = {
  consents: [],
  employees: [],
  tickets: [],
  gpsLogs: [],
  sites: [],
};

let lastInsert: { table: string; values: Row } | null = null;
let lastSqlValues: any[] = [];

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
    case "gte": {
      const lhs = row[pred.col.__col];
      if (lhs == null) return false;
      const a = lhs instanceof Date ? lhs.getTime() : lhs;
      const b = pred.val instanceof Date ? pred.val.getTime() : pred.val;
      return a >= b;
    }
    case "lt": {
      const lhs = row[pred.col.__col];
      if (lhs == null) return false;
      const a = lhs instanceof Date ? lhs.getTime() : lhs;
      const b = pred.val instanceof Date ? pred.val.getTime() : pred.val;
      return a < b;
    }
    case "and":
      return pred.preds.every((p) => evalPred(p, row));
  }
}

function makeQuery(tableName: string) {
  let pred: Pred | undefined;
  let limitN: number | undefined;
  let orderSpec: { col: ColRef; dir: "asc" | "desc" } | undefined;
  const run = () => {
    const all = fixtures[tableName] ?? [];
    let filtered = all.filter((r) => evalPred(pred, r));
    if (orderSpec) {
      const { col, dir } = orderSpec;
      filtered = [...filtered].sort((a, b) => {
        const av = a[col.__col];
        const bv = b[col.__col];
        const aN = av instanceof Date ? av.getTime() : av;
        const bN = bv instanceof Date ? bv.getTime() : bv;
        if (aN === bN) return 0;
        const cmp = aN > bN ? 1 : -1;
        return dir === "desc" ? -cmp : cmp;
      });
    }
    return limitN != null ? filtered.slice(0, limitN) : filtered;
  };
  const q: any = {
    where: (p: Pred) => {
      pred = p;
      return q;
    },
    leftJoin: () => q,
    innerJoin: () => q,
    orderBy: (...args: any[]) => {
      // The route uses `orderBy(desc(col))` for the prev-ping lookup.
      // Capture the first ordering spec emitted by the mocked `desc()`
      // helper so `limit(1)` actually returns the most recent row,
      // which the low-battery transition test depends on.
      for (const a of args) {
        if (a && typeof a === "object" && a.__order && a.col) {
          orderSpec = { col: a.col as ColRef, dir: a.dir as "asc" | "desc" };
          break;
        }
      }
      return q;
    },
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
    insert: (t: any) => ({
      values: (v: any) => ({
        returning: async () => {
          lastInsert = { table: t.__name, values: v };
          const row = { id: 999, ...v };
          fixtures[t.__name].push(row);
          return [row];
        },
      }),
    }),
    update: (_t: any) => ({
      set: (_s: Row) => ({ where: async () => undefined }),
    }),
    execute: async () => {
      // Honest stand-in for the latest-live_ping-per-ticket SQL: read the
      // event type and freshness threshold captured by the `sql` tagged
      // template, then group fixtures.gpsLogs by ticketId, taking the row
      // with the highest id.
      const sinceTs = lastSqlValues.find((v: any) => v instanceof Date) as
        | Date
        | undefined;
      const eventType = lastSqlValues.find(
        (v: any) => typeof v === "string",
      ) as string | undefined;
      const matching = (fixtures.gpsLogs ?? []).filter(
        (g: any) =>
          g.eventType === (eventType ?? "live_ping") &&
          (!sinceTs || new Date(g.recordedAt) >= sinceTs),
      );
      const byTicket = new Map<number, any>();
      for (const g of matching) {
        const cur = byTicket.get(g.ticketId);
        if (!cur || g.id > cur.id) byTicket.set(g.ticketId, g);
      }
      return {
        rows: Array.from(byTicket.values()).map((g) => ({
          ticketId: g.ticketId,
          latitude: g.latitude,
          longitude: g.longitude,
          batteryLevel: g.batteryLevel,
          recordedAt: g.recordedAt,
        })),
      };
    },
  };
  return {
    db,
    locationConsentsTable: tables.consents,
    fieldEmployeesTable: tables.employees,
    ticketsTable: tables.tickets,
    gpsLogsTable: tables.gpsLogs,
    siteLocationsTable: tables.sites,
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts", []),
    hotlistCommentsTable: tableTag("hotlistComments", []),
    ticketNoteLogsTable: tableTag("ticketNoteLogs", []),
  };
});

vi.mock("drizzle-orm", () => {
  const passthrough = (..._args: any[]) => ({ kind: "true" });
  // `sql` is used as a tagged template literal in the route. Capture the
  // interpolated values so the mocked db.execute can honor the freshness
  // threshold and event-type filter the route encodes there.
  const sqlTag: any = (strings: any, ...values: any[]) => {
    if (Array.isArray(strings) && (strings as any).raw !== undefined) {
      lastSqlValues = values;
      // Detect the day-track upper-bound shape: sql`${col} < ${val}` →
      // strings = ["", " < ", ""]. Honor it as a real predicate so the
      // boundary tests can verify only-within-the-day filtering.
      if (
        values.length === 2 &&
        strings.length === 3 &&
        strings[0] === "" &&
        strings[2] === "" &&
        /^\s*<\s*$/.test(strings[1]) &&
        values[0] &&
        typeof (values[0] as any).__col === "string"
      ) {
        return { kind: "lt", col: values[0] as ColRef, val: values[1] };
      }
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
    // Tag the order direction + column so `makeQuery.orderBy()` can sort
    // its in-memory fixture rows. Without this the prev-ping lookup
    // would always return whatever happened to be inserted first, and
    // the low-battery transition test below couldn't tell "still low"
    // from "just dipped" between consecutive pings.
    desc: (col: ColRef) => ({ __order: true, col, dir: "desc" }),
    asc: (col: ColRef) => ({ __order: true, col, dir: "asc" }),
    gte: (col: ColRef, val: any) => ({ kind: "gte", col, val }),
  };
});

// Stub out the notifications module so we don't pull in the
// notification_preferences DB chain, and we can assert what the route
// asks the notification system to fan out for low-battery alerts.
const notifyUsersMock = vi.fn(async () => 1);
const findVendorUserIdsMock = vi.fn(async (_id: number) => [201, 202]);
vi.mock("./notifications", () => ({
  notifyUsers: notifyUsersMock,
  findVendorUserIds: findVendorUserIdsMock,
  findPartnerUserIds: async (_id: number) => [],
}));



let app: express.Express;

beforeEach(async () => {
  for (const k of Object.keys(fixtures)) fixtures[k] = [];
  lastInsert = null;
  lastSqlValues = [];
  vi.resetModules();
  const router = (await import("./locations")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

function authCookie(
  overrides: Partial<{
    userId: number;
    role: string;
    vendorId: number | null;
    partnerId: number | null;
  }> = {},
) {
  const session = {
    userId: 10,
    role: "field_employee",
    vendorId: 1,
    partnerId: null,
    ...overrides,
  };
  return buildTestCookie(session);
}

describe("POST /api/location-pings", () => {
  const validBody = {
    ticketId: 100,
    latitude: 40.0,
    longitude: -74.0,
    deviceId: "device-abc",
  };

  function seedHappyPath() {
    fixtures.consents = [
      {
        id: 1,
        userId: 10,
        deviceId: "device-abc",
        revokedAt: null,
        acceptedAt: new Date(),
      },
    ];
    fixtures.employees = [{ id: 50, userId: 10, vendorId: 1 }];
    fixtures.tickets = [
      { id: 100, fieldEmployeeId: 50, lifecycleState: "en_route", vendorId: 1 },
    ];
  }

  it("rejects when no auth cookie is present", async () => {
    const res = await request(app).post("/api/location-pings").send(validBody);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.unauthenticated");
    expect(res.body.error).toBe("unauthenticated");
  });

  it("rejects when caller is not a field_employee", async () => {
    const res = await request(app)
      .post("/api/location-pings")
      .set("Cookie", authCookie({ role: "vendor" }))
      .send(validBody);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.unauthenticated");
    expect(res.body.error).toBe("unauthenticated");
  });

  it("rejects requests missing deviceId", async () => {
    seedHappyPath();
    const { deviceId: _omit, ...noDevice } = validBody;
    const res = await request(app)
      .post("/api/location-pings")
      .set("Cookie", authCookie())
      .send(noDevice);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("visitor.device_id_required");
    expect(res.body.error).toBe("deviceId required");
  });

  it("rejects when the active consent belongs to a different device", async () => {
    // A consent exists for the user, but for a different device. The route's
    // WHERE clause filters by deviceId, so this row must not be returned.
    fixtures.consents = [
      {
        id: 2,
        userId: 10,
        deviceId: "some-other-device",
        revokedAt: null,
        acceptedAt: new Date(),
      },
    ];
    fixtures.employees = [{ id: 50, userId: 10, vendorId: 1 }];
    fixtures.tickets = [
      { id: 100, fieldEmployeeId: 50, lifecycleState: "en_route" },
    ];
    const res = await request(app)
      .post("/api/location-pings")
      .set("Cookie", authCookie())
      .send({ ...validBody, deviceId: "device-abc" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("visitor.no_active_consent");
    expect(res.body.error).toBe("no_active_consent");
  });

  it("rejects when the matching consent has been revoked", async () => {
    // Same user + same deviceId, but revokedAt is set. The route guards with
    // isNull(revokedAt), so this row must not satisfy the consent gate.
    fixtures.consents = [
      {
        id: 3,
        userId: 10,
        deviceId: "device-abc",
        revokedAt: new Date(),
        acceptedAt: new Date(Date.now() - 86400_000),
      },
    ];
    fixtures.employees = [{ id: 50, userId: 10, vendorId: 1 }];
    fixtures.tickets = [
      { id: 100, fieldEmployeeId: 50, lifecycleState: "en_route" },
    ];
    const res = await request(app)
      .post("/api/location-pings")
      .set("Cookie", authCookie())
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("visitor.no_active_consent");
    expect(res.body.error).toBe("no_active_consent");
  });

  it("rejects when consent belongs to a different user (session userId mismatch)", async () => {
    // Active consent for the same device but a *different* userId — protects
    // against ever pinging on behalf of another user's consent.
    fixtures.consents = [
      {
        id: 4,
        userId: 999,
        deviceId: "device-abc",
        revokedAt: null,
        acceptedAt: new Date(),
      },
    ];
    fixtures.employees = [{ id: 50, userId: 10, vendorId: 1 }];
    fixtures.tickets = [
      { id: 100, fieldEmployeeId: 50, lifecycleState: "en_route" },
    ];
    const res = await request(app)
      .post("/api/location-pings")
      .set("Cookie", authCookie())
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("visitor.no_active_consent");
    expect(res.body.error).toBe("no_active_consent");
  });

  it("rejects when the ticket is owned by a different employee", async () => {
    seedHappyPath();
    fixtures.tickets = [
      { id: 100, fieldEmployeeId: 999, lifecycleState: "en_route" },
    ];
    const res = await request(app)
      .post("/api/location-pings")
      .set("Cookie", authCookie())
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("visitor.not_ticket_owner");
    expect(res.body.error).toBe("not_ticket_owner");
  });

  it("rejects when the ticket is not in an on-shift lifecycle state", async () => {
    seedHappyPath();
    fixtures.tickets = [
      { id: 100, fieldEmployeeId: 50, lifecycleState: "completed" },
    ];
    const res = await request(app)
      .post("/api/location-pings")
      .set("Cookie", authCookie())
      .send(validBody);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("visitor.ticket_not_on_shift");
    expect(res.body.error).toBe("ticket_not_on_shift");
  });

  it("happy path: writes a live_ping row and returns 201", async () => {
    seedHappyPath();
    const res = await request(app)
      .post("/api/location-pings")
      .set("Cookie", authCookie())
      .send({ ...validBody, batteryLevel: 0.8 });
    expectStatus(res, 201);
    expect(lastInsert?.table).toBe("gpsLogs");
    expect(lastInsert?.values).toMatchObject({
      ticketId: 100,
      latitude: 40,
      longitude: -74,
      eventType: "live_ping",
      batteryLevel: 0.8,
    });
  });

  it("happy path also accepts on_site lifecycle state", async () => {
    seedHappyPath();
    fixtures.tickets = [
      { id: 100, fieldEmployeeId: 50, lifecycleState: "on_site" },
    ];
    const res = await request(app)
      .post("/api/location-pings")
      .set("Cookie", authCookie())
      .send(validBody);
    expectStatus(res, 201);
    expect(lastInsert?.values?.eventType).toBe("live_ping");
  });

  // ── Task #57 — dispatcher low-battery alert ──
  describe("low-battery dispatcher notification", () => {
    it("fires a low_battery notification when battery dips below the critical threshold for the first time", async () => {
      seedHappyPath();
      // No prior pings → first ping is the descent edge.
      const res = await request(app)
        .post("/api/location-pings")
        .set("Cookie", authCookie())
        .send({ ...validBody, batteryLevel: 0.05 });
      expectStatus(res, 201);
      expect(notifyUsersMock).toHaveBeenCalledTimes(1);
      const [recipients, notif] = notifyUsersMock.mock.calls[0] as any[];
      expect(recipients).toEqual([201, 202]);
      expect(notif).toMatchObject({
        type: "low_battery",
        category: "crew",
        link: "/crew-map",
        pushData: expect.objectContaining({
          employeeId: 50,
          ticketId: 100,
          type: "low_battery",
        }),
      });
      expect(typeof notif.dedupeKey).toBe("string");
      expect(notif.dedupeKey).toMatch(/^low_battery:50:/);
      expect(notif.body).toContain("5%");
    });

    it("does NOT re-fire a notification while the device stays in the critical range", async () => {
      seedHappyPath();
      // Seed a previous live_ping that's already in the critical range so
      // the next ping is "still low", not a fresh descent edge.
      fixtures.gpsLogs = [
        {
          id: 500,
          ticketId: 100,
          latitude: 40,
          longitude: -74,
          eventType: "live_ping",
          batteryLevel: 0.06,
          recordedAt: new Date(Date.now() - 60_000),
        },
      ];
      const res = await request(app)
        .post("/api/location-pings")
        .set("Cookie", authCookie())
        .send({ ...validBody, batteryLevel: 0.04 });
      expectStatus(res, 201);
      expect(notifyUsersMock).not.toHaveBeenCalled();
    });

    it("does NOT fire when battery is above the critical threshold", async () => {
      seedHappyPath();
      const res = await request(app)
        .post("/api/location-pings")
        .set("Cookie", authCookie())
        .send({ ...validBody, batteryLevel: 0.5 });
      expectStatus(res, 201);
      expect(notifyUsersMock).not.toHaveBeenCalled();
    });

    it("re-fires after the device charges back above the threshold and dips again", async () => {
      seedHappyPath();
      // Device previously recovered (last ping was at 60% battery), so the
      // next sub-threshold ping is a brand-new descent edge that should
      // trigger another dispatcher alert.
      fixtures.gpsLogs = [
        {
          id: 700,
          ticketId: 100,
          latitude: 40,
          longitude: -74,
          eventType: "live_ping",
          batteryLevel: 0.6,
          recordedAt: new Date(Date.now() - 30_000),
        },
      ];
      const res = await request(app)
        .post("/api/location-pings")
        .set("Cookie", authCookie())
        .send({ ...validBody, batteryLevel: 0.07 });
      expectStatus(res, 201);
      expect(notifyUsersMock).toHaveBeenCalledTimes(1);
    });

    it("does NOT fire when the ping has no battery reading at all", async () => {
      seedHappyPath();
      const res = await request(app)
        .post("/api/location-pings")
        .set("Cookie", authCookie())
        .send({ ...validBody, batteryLevel: null });
      expectStatus(res, 201);
      expect(notifyUsersMock).not.toHaveBeenCalled();
    });

    it("does NOT re-fire when an unresolved low episode is interrupted by a null-battery ping (low → null → low)", async () => {
      // Regression guard: a previous ping with `batteryLevel: null` must
      // NOT be treated as "above threshold" — otherwise a sequence like
      // low → null → low would emit a second notification inside one
      // unresolved episode, breaking the once-per-episode contract. The
      // immediately previous ping is the null-reading one, so nothing
      // should fire on the second sub-threshold ping.
      seedHappyPath();
      fixtures.gpsLogs = [
        {
          id: 800,
          ticketId: 100,
          latitude: 40,
          longitude: -74,
          eventType: "live_ping",
          batteryLevel: null,
          recordedAt: new Date(Date.now() - 30_000),
        },
      ];
      const res = await request(app)
        .post("/api/location-pings")
        .set("Cookie", authCookie())
        .send({ ...validBody, batteryLevel: 0.04 });
      expectStatus(res, 201);
      expect(notifyUsersMock).not.toHaveBeenCalled();
    });

    it("does NOT fire when the ticket has no vendor (no dispatchers to alert)", async () => {
      seedHappyPath();
      fixtures.tickets = [
        {
          id: 100,
          fieldEmployeeId: 50,
          lifecycleState: "en_route",
          vendorId: null,
        },
      ];
      const res = await request(app)
        .post("/api/location-pings")
        .set("Cookie", authCookie())
        .send({ ...validBody, batteryLevel: 0.05 });
      expectStatus(res, 201);
      expect(notifyUsersMock).not.toHaveBeenCalled();
      expect(findVendorUserIdsMock).not.toHaveBeenCalled();
    });
  });

  it("does not write a gps log when consent is missing/revoked", async () => {
    // Sanity check: confirms no insert happens on the rejection paths.
    fixtures.consents = [
      {
        id: 5,
        userId: 10,
        deviceId: "device-abc",
        revokedAt: new Date(),
        acceptedAt: new Date(),
      },
    ];
    fixtures.employees = [{ id: 50, userId: 10, vendorId: 1 }];
    fixtures.tickets = [
      { id: 100, fieldEmployeeId: 50, lifecycleState: "en_route" },
    ];
    await request(app)
      .post("/api/location-pings")
      .set("Cookie", authCookie())
      .send(validBody);
    expect(lastInsert).toBeNull();
    expect(fixtures.gpsLogs).toHaveLength(0);
  });
});

describe("GET /api/live-locations", () => {
  // Helpers — every ticket fixture row must include both the bare `id`
  // (which the route filters on via inArray) and the aliased columns the
  // route projects (vendorId, lifecycleState, fieldEmployeeId, empFirst,
  // empLast, siteName, siteCode). The mock's makeQuery returns rows as-is.
  function ticket(overrides: Partial<Row> = {}): Row {
    return {
      id: 100,
      ticketId: 100,
      vendorId: 1,
      lifecycleState: "en_route",
      fieldEmployeeId: 50,
      empFirst: "Alice",
      empLast: "Smith",
      siteName: "Site A",
      siteCode: "A-1",
      ...overrides,
    };
  }
  function ping(overrides: Partial<Row> = {}): Row {
    return {
      id: 1,
      ticketId: 100,
      latitude: 40,
      longitude: -74,
      eventType: "live_ping",
      batteryLevel: null,
      recordedAt: new Date(Date.now() - 60_000),
      ...overrides,
    };
  }

  it("rejects unauthenticated callers", async () => {
    const res = await request(app).get("/api/live-locations");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.unauthenticated");
    expect(res.body.error).toBe("unauthenticated");
  });

  it("forbids non-vendor / non-admin roles", async () => {
    const fe = await request(app)
      .get("/api/live-locations")
      .set("Cookie", authCookie({ role: "field_employee" }));
    expect(fe.status).toBe(403);
    expect(fe.body.code).toBe("visitor.forbidden");
    expect(fe.body.error).toBe("forbidden");

    const partner = await request(app)
      .get("/api/live-locations")
      .set("Cookie", authCookie({ role: "partner", vendorId: null }));
    expect(partner.status).toBe(403);
    expect(partner.body.code).toBe("visitor.forbidden");
    expect(partner.body.error).toBe("forbidden");
  });

  it("rejects vendor sessions without an attached vendorId", async () => {
    const res = await request(app)
      .get("/api/live-locations")
      .set("Cookie", authCookie({ role: "vendor", vendorId: null }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("visitor.no_vendor");
    expect(res.body.error).toBe("no_vendor");
  });

  it("vendors only see their own crews — never another vendor's", async () => {
    fixtures.tickets = [
      ticket({
        id: 100,
        ticketId: 100,
        vendorId: 1,
        fieldEmployeeId: 50,
        empFirst: "Alice",
        empLast: "Smith",
      }),
      ticket({
        id: 200,
        ticketId: 200,
        vendorId: 2,
        fieldEmployeeId: 60,
        empFirst: "Bob",
        empLast: "Jones",
        lifecycleState: "on_site",
      }),
    ];
    fixtures.gpsLogs = [
      ping({ id: 1, ticketId: 100, latitude: 40, longitude: -74 }),
      ping({ id: 2, ticketId: 200, latitude: 41, longitude: -75 }),
    ];

    const res = await request(app)
      .get("/api/live-locations")
      .set("Cookie", authCookie({ role: "vendor", vendorId: 1 }));
    expectStatus(res, 200);
    expect(res.body.locations).toHaveLength(1);
    expect(res.body.locations[0]).toMatchObject({
      employeeId: 50,
      vendorId: 1,
      employeeName: "Alice Smith",
      ticketId: 100,
      siteName: "Site A",
      siteCode: "A-1",
      latitude: 40,
      longitude: -74,
    });
  });

  it("rejects a vendor querying for a different vendor", async () => {
    const res = await request(app)
      .get("/api/live-locations?vendorId=2")
      .set("Cookie", authCookie({ role: "vendor", vendorId: 1 }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("visitor.wrong_vendor");
    expect(res.body.error).toBe("wrong_vendor");
  });

  it("admin sees all crews when no vendorId is specified", async () => {
    fixtures.tickets = [
      ticket({ id: 100, ticketId: 100, vendorId: 1, fieldEmployeeId: 50 }),
      ticket({
        id: 200,
        ticketId: 200,
        vendorId: 2,
        fieldEmployeeId: 60,
        empFirst: "Bob",
        empLast: "Jones",
        lifecycleState: "on_site",
      }),
    ];
    fixtures.gpsLogs = [
      ping({ id: 1, ticketId: 100 }),
      ping({ id: 2, ticketId: 200 }),
    ];

    const res = await request(app)
      .get("/api/live-locations")
      .set("Cookie", authCookie({ role: "admin", vendorId: null }));
    expectStatus(res, 200);
    const ids = res.body.locations
      .map((l: any) => l.employeeId)
      .sort((a: number, b: number) => a - b);
    expect(ids).toEqual([50, 60]);
  });

  it("admin can scope results to a single vendorId", async () => {
    fixtures.tickets = [
      ticket({ id: 100, ticketId: 100, vendorId: 1, fieldEmployeeId: 50 }),
      ticket({
        id: 200,
        ticketId: 200,
        vendorId: 2,
        fieldEmployeeId: 60,
        empFirst: "Bob",
        empLast: "Jones",
        lifecycleState: "on_site",
      }),
    ];
    fixtures.gpsLogs = [
      ping({ id: 1, ticketId: 100 }),
      ping({ id: 2, ticketId: 200 }),
    ];

    const res = await request(app)
      .get("/api/live-locations?vendorId=2")
      .set("Cookie", authCookie({ role: "admin", vendorId: null }));
    expectStatus(res, 200);
    expect(res.body.locations).toHaveLength(1);
    expect(res.body.locations[0]).toMatchObject({
      employeeId: 60,
      vendorId: 2,
    });
  });

  it("excludes pings older than the 15-minute freshness window", async () => {
    fixtures.tickets = [ticket({ id: 100 })];
    fixtures.gpsLogs = [
      // 30 minutes old — well beyond LIVE_PING_FRESH_MS.
      ping({
        id: 1,
        ticketId: 100,
        recordedAt: new Date(Date.now() - 30 * 60 * 1000),
      }),
    ];

    const res = await request(app)
      .get("/api/live-locations")
      .set("Cookie", authCookie({ role: "admin", vendorId: null }));
    expectStatus(res, 200);
    expect(res.body.locations).toEqual([]);
  });

  it("ignores non-live_ping events when computing latest pings", async () => {
    fixtures.tickets = [ticket({ id: 100 })];
    fixtures.gpsLogs = [
      // A more recent geofence_enter event must NOT be picked over the
      // older live_ping; only live_ping rows feed the live map.
      ping({
        id: 2,
        ticketId: 100,
        eventType: "geofence_enter",
        recordedAt: new Date(Date.now() - 30_000),
      }),
    ];

    const res = await request(app)
      .get("/api/live-locations")
      .set("Cookie", authCookie({ role: "admin", vendorId: null }));
    expectStatus(res, 200);
    expect(res.body.locations).toEqual([]);
  });

  it("excludes tickets that are no longer in an active lifecycle state", async () => {
    fixtures.tickets = [
      ticket({ id: 100, lifecycleState: "completed" }),
    ];
    fixtures.gpsLogs = [ping({ id: 1, ticketId: 100, recordedAt: new Date() })];

    const res = await request(app)
      .get("/api/live-locations")
      .set("Cookie", authCookie({ role: "admin", vendorId: null }));
    expectStatus(res, 200);
    expect(res.body.locations).toEqual([]);
  });

  it("returns one row per employee, choosing the most recent ping across active tickets", async () => {
    fixtures.tickets = [
      ticket({
        id: 100,
        ticketId: 100,
        fieldEmployeeId: 50,
        siteName: "Old Site",
        siteCode: "OS",
      }),
      ticket({
        id: 101,
        ticketId: 101,
        fieldEmployeeId: 50,
        lifecycleState: "on_site",
        siteName: "New Site",
        siteCode: "NS",
      }),
    ];
    fixtures.gpsLogs = [
      ping({
        id: 1,
        ticketId: 100,
        latitude: 40,
        longitude: -74,
        recordedAt: new Date(Date.now() - 5 * 60 * 1000),
      }),
      ping({
        id: 2,
        ticketId: 101,
        latitude: 41,
        longitude: -75,
        recordedAt: new Date(Date.now() - 1 * 60 * 1000),
      }),
    ];

    const res = await request(app)
      .get("/api/live-locations")
      .set("Cookie", authCookie({ role: "admin", vendorId: null }));
    expectStatus(res, 200);
    expect(res.body.locations).toHaveLength(1);
    expect(res.body.locations[0]).toMatchObject({
      employeeId: 50,
      ticketId: 101,
      siteName: "New Site",
      latitude: 41,
      longitude: -75,
    });
  });
});

describe("GET /api/field-employees/:id/day-track", () => {
  // The route inner-joins gpsLogs to tickets to scope by fieldEmployeeId.
  // Our query mock doesn't materialize joins; the predicate evaluator looks
  // up columns by name only. So we stamp `fieldEmployeeId` directly on each
  // gpsLog fixture row to stand in for the join's projection.
  function emp(overrides: Partial<Row> = {}): Row {
    return {
      id: 50,
      userId: 10,
      vendorId: 1,
      firstName: "Alice",
      lastName: "Smith",
      ...overrides,
    };
  }
  function ping(overrides: Partial<Row> = {}): Row {
    return {
      id: 1,
      ticketId: 100,
      fieldEmployeeId: 50,
      latitude: 40,
      longitude: -74,
      eventType: "live_ping",
      batteryLevel: null,
      recordedAt: new Date("2026-04-20T12:00:00.000Z"),
      ...overrides,
    };
  }

  it("rejects unauthenticated callers", async () => {
    const res = await request(app).get("/api/field-employees/50/day-track");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.unauthenticated");
    expect(res.body.error).toBe("unauthenticated");
  });

  it("returns 400 when the :id segment is not a finite number", async () => {
    const res = await request(app)
      .get("/api/field-employees/abc/day-track")
      .set("Cookie", authCookie({ role: "admin", vendorId: null }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("visitor.invalid_id");
    expect(res.body.error).toBe("invalid_id");
  });

  it("returns 400 when ?date is not a parseable ISO date", async () => {
    fixtures.employees = [emp()];
    const res = await request(app)
      .get("/api/field-employees/50/day-track?date=not-a-date")
      .set("Cookie", authCookie({ role: "admin", vendorId: null }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("visitor.invalid_date");
    expect(res.body.error).toBe("invalid_date");
  });

  it("returns 404 when the employee row does not exist", async () => {
    fixtures.employees = [];
    const res = await request(app)
      .get("/api/field-employees/50/day-track?date=2026-04-20")
      .set("Cookie", authCookie({ role: "admin", vendorId: null }));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("visitor.not_found");
    expect(res.body.error).toBe("not_found");
  });

  it("forbids non-vendor / non-admin roles even when the employee exists", async () => {
    fixtures.employees = [emp()];
    for (const role of ["field_employee", "partner"]) {
      const res = await request(app)
        .get("/api/field-employees/50/day-track?date=2026-04-20")
        .set("Cookie", authCookie({ role, vendorId: null }));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("visitor.forbidden");
      expect(res.body.error).toBe("forbidden");
    }
  });

  it("vendors cannot view another vendor's employee timeline", async () => {
    // Cross-tenant safety: vendor 1 must never see vendor 2's day playback.
    fixtures.employees = [emp({ vendorId: 2 })];
    fixtures.gpsLogs = [
      ping({ recordedAt: new Date("2026-04-20T12:00:00.000Z") }),
    ];
    const res = await request(app)
      .get("/api/field-employees/50/day-track?date=2026-04-20")
      .set("Cookie", authCookie({ role: "vendor", vendorId: 1 }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("visitor.wrong_vendor");
    expect(res.body.error).toBe("wrong_vendor");
    expect(res.body.pings).toBeUndefined();
  });

  it("vendors can view their own employee's timeline", async () => {
    fixtures.employees = [emp({ vendorId: 1 })];
    fixtures.gpsLogs = [
      ping({ id: 1, recordedAt: new Date("2026-04-20T08:30:00.000Z") }),
      ping({ id: 2, recordedAt: new Date("2026-04-20T16:45:00.000Z") }),
    ];
    const res = await request(app)
      .get("/api/field-employees/50/day-track?date=2026-04-20")
      .set("Cookie", authCookie({ role: "vendor", vendorId: 1 }));
    expectStatus(res, 200);
    expect(res.body.employee).toEqual({ id: 50, name: "Alice Smith" });
    expect(res.body.date).toBe("2026-04-20");
    expect(res.body.pings).toHaveLength(2);
  });

  it("admins can view any vendor's employee timeline", async () => {
    fixtures.employees = [emp({ vendorId: 99 })];
    fixtures.gpsLogs = [
      ping({ recordedAt: new Date("2026-04-20T10:00:00.000Z") }),
    ];
    const res = await request(app)
      .get("/api/field-employees/50/day-track?date=2026-04-20")
      .set("Cookie", authCookie({ role: "admin", vendorId: null }));
    expectStatus(res, 200);
    expect(res.body.pings).toHaveLength(1);
  });

  it("only returns pings within the requested UTC day (midnight boundary)", async () => {
    // The route filters with gte(recordedAt, start) AND recordedAt < end,
    // where start = `${date}T00:00:00.000Z` and end = start + 24h. So:
    //  - 23:59:59.999Z on the previous day → excluded
    //  - 00:00:00.000Z on the requested day → included (>= start)
    //  - 23:59:59.999Z on the requested day → included (< end)
    //  - 00:00:00.000Z on the next day → excluded (== end, not <)
    fixtures.employees = [emp({ vendorId: 1 })];
    fixtures.gpsLogs = [
      ping({ id: 1, recordedAt: new Date("2026-04-19T23:59:59.999Z") }),
      ping({ id: 2, recordedAt: new Date("2026-04-20T00:00:00.000Z") }),
      ping({ id: 3, recordedAt: new Date("2026-04-20T12:34:56.000Z") }),
      ping({ id: 4, recordedAt: new Date("2026-04-20T23:59:59.999Z") }),
      ping({ id: 5, recordedAt: new Date("2026-04-21T00:00:00.000Z") }),
    ];
    const res = await request(app)
      .get("/api/field-employees/50/day-track?date=2026-04-20")
      .set("Cookie", authCookie({ role: "admin", vendorId: null }));
    expectStatus(res, 200);
    const ids = res.body.pings.map((p: any) => p.id).sort();
    expect(ids).toEqual([2, 3, 4]);
  });

  it("does not leak pings belonging to a different employee", async () => {
    // The route's inner-join WHERE filters on tickets.fieldEmployeeId = :id.
    // A ping for employee 999 must not appear in employee 50's day.
    fixtures.employees = [emp({ id: 50, vendorId: 1 })];
    fixtures.gpsLogs = [
      ping({
        id: 1,
        fieldEmployeeId: 50,
        recordedAt: new Date("2026-04-20T12:00:00.000Z"),
      }),
      ping({
        id: 2,
        fieldEmployeeId: 999,
        recordedAt: new Date("2026-04-20T12:01:00.000Z"),
      }),
    ];
    const res = await request(app)
      .get("/api/field-employees/50/day-track?date=2026-04-20")
      .set("Cookie", authCookie({ role: "admin", vendorId: null }));
    expectStatus(res, 200);
    expect(res.body.pings.map((p: any) => p.id)).toEqual([1]);
  });
});

// ── Task #57 — CRITICAL_BATTERY_THRESHOLD env parsing ──
// Protects the configurability contract: ops should be able to override the
// threshold via env, but a typo or out-of-range value must fall back to the
// 10% default rather than disabling alerts (n<=0) or always-firing (n>1).
describe("parseCriticalBatteryThreshold", () => {
  it("returns the 10% default when the env var is unset or empty", async () => {
    const { parseCriticalBatteryThreshold } = await import("./locations");
    expect(parseCriticalBatteryThreshold(undefined)).toBe(0.1);
    expect(parseCriticalBatteryThreshold("")).toBe(0.1);
  });

  it("accepts valid fractional values in (0, 1]", async () => {
    const { parseCriticalBatteryThreshold } = await import("./locations");
    expect(parseCriticalBatteryThreshold("0.05")).toBe(0.05);
    expect(parseCriticalBatteryThreshold("0.25")).toBe(0.25);
    expect(parseCriticalBatteryThreshold("1")).toBe(1);
  });

  it("falls back to the default for non-numeric, NaN, zero, negative, or >1 values", async () => {
    const { parseCriticalBatteryThreshold } = await import("./locations");
    expect(parseCriticalBatteryThreshold("not-a-number")).toBe(0.1);
    expect(parseCriticalBatteryThreshold("NaN")).toBe(0.1);
    expect(parseCriticalBatteryThreshold("0")).toBe(0.1);
    expect(parseCriticalBatteryThreshold("-0.2")).toBe(0.1);
    expect(parseCriticalBatteryThreshold("1.5")).toBe(0.1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import request from "supertest";

// End-to-end coverage for the admin readout added in Task #696
// (`GET /api/admin/tickets-rate-limit-trips`). The endpoint is the
// operator-facing surface for the "recent rate-limit trips" panel
// on the operations dashboard — companion to the budgets card. We
// drive it through the request pipeline (so the requireAdmin
// middleware and JSON shape contract are both exercised) and
// check:
//   • non-admin and unauthenticated requests are 403'd, same
//     `auth.admin_required` shape used by the sibling budgets
//     endpoint, so a misplaced fetch never leaks trip data
//   • the response contains both windows (last 60 min / 24 h)
//     with totalTrips, uniqueKeys, and an empty byRole when no
//     trips have been recorded yet
//   • after recording trips through the limiter's `enforce`
//     (the same path the production tickets routes go through),
//     the response carries per-role aggregates with deduped
//     unique-key counts that the dashboard panel renders directly
//   • the buffer info (`size` / `capacity` / `oldestTrackedAt`)
//     is surfaced so the panel can warn when older trips were
//     evicted

const SESSION_SECRET = "test-secret";
const COOKIE_NAME = "vndrly_session";

function signSession(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
  const sig = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("hex");
  return `${body}.${sig}`;
}

function cookieFor(role: string, userId = 1): string {
  return `${COOKIE_NAME}=${signSession({
    userId,
    role,
    vendorId: null,
    partnerId: null,
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  })}`;
}

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy({ __name: name }, { get: (_t, k: string) => ({ __table: name, __col: k }) });
  return {
    db: {
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            where: () => Promise.resolve([]),
          }),
          where: () => Promise.resolve([]),
        }),
      }),
    },
    pool: { query: async () => ({ rows: [] }) },
    partnersTable: tableTag("partners"),
    vendorsTable: tableTag("vendors"),
    siteLocationsTable: tableTag("siteLocations"),
    ticketsTable: tableTag("tickets"),
    ticketCrewTable: tableTag("ticketCrew"),
    hotlistJobsTable: tableTag("hotlistJobs"),
    hotlistBidsTable: tableTag("hotlistBids"),
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts"),
    hotlistCommentsTable: tableTag("hotlistComments"),
    ticketNoteLogsTable: tableTag("ticketNoteLogs"),
  };
});

vi.mock("drizzle-orm", () => {
  const passthrough = (..._args: any[]) => ({ kind: "true" });
  const sqlTag: any = () => ({ kind: "true" });
  sqlTag.raw = passthrough;
  return {
    sql: sqlTag,
    eq: passthrough,
    desc: passthrough,
    and: passthrough,
  };
});

let app: express.Express;
let ticketsRateLimit: typeof import("../lib/tickets-rate-limit");

beforeEach(async () => {
  // Tighten the default budget so we can trip it with two
  // requests rather than the production 30. The endpoint reads
  // env live, so this also pins the response's resolved budget.
  process.env.TICKETS_RATE_LIMIT_MAX = "1";
  process.env.TICKETS_RATE_LIMIT_WINDOW_MS = "60000";
  vi.resetModules();
  const router = (await import("./dashboard")).default;
  ticketsRateLimit = await import("../lib/tickets-rate-limit");
  await ticketsRateLimit.__resetTicketsRateLimitStateForTests();
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
});

afterEach(async () => {
  vi.clearAllMocks();
  delete process.env.TICKETS_RATE_LIMIT_MAX;
  delete process.env.TICKETS_RATE_LIMIT_WINDOW_MS;
  if (ticketsRateLimit) {
    await ticketsRateLimit.__resetTicketsRateLimitStateForTests();
  }
});

// Drive a 429 trip through the limiter's enforce() — the same path
// the real `/api/tickets` route uses — so the test exercises the
// production recording path rather than poking at the buffer
// directly.
async function tripFor(role: string | null, userId: number) {
  const fakeReq = {
    path: "/api/tickets",
    method: "GET",
    headers: {},
    socket: { remoteAddress: `10.0.0.${userId}` },
    ip: `10.0.0.${userId}`,
  } as unknown as import("express").Request;
  const fakeRes = {
    setHeader() {},
    status() {
      return this;
    },
    json() {
      return this;
    },
  } as unknown as import("express").Response;
  const session = role ? { userId, role } : null;
  // First call passes (max=1), second call trips and records.
  await ticketsRateLimit.enforceTicketsRateLimit(fakeReq, fakeRes, session);
  await ticketsRateLimit.enforceTicketsRateLimit(fakeReq, fakeRes, session);
}

describe("GET /api/admin/tickets-rate-limit-trips (Task #696)", () => {
  it("returns 403 for unauth and non-admin callers, leaking nothing", async () => {
    const unauth = await request(app).get(
      "/api/admin/tickets-rate-limit-trips",
    );
    expect(unauth.status).toBe(403);
    expect(unauth.body.code).toBe("auth.admin_required");

    for (const role of ["partner", "vendor", "field_employee"]) {
      const r = await request(app)
        .get("/api/admin/tickets-rate-limit-trips")
        .set("Cookie", cookieFor(role));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("auth.admin_required");
      // Defensive: the body must not contain trip data.
      expect(r.body.windows).toBeUndefined();
    }
  });

  it("returns both windows with zeroed counts when no trips have happened", async () => {
    const r = await request(app)
      .get("/api/admin/tickets-rate-limit-trips")
      .set("Cookie", cookieFor("admin"));
    expect(r.status).toBe(200);
    expect(typeof r.body.generatedAt).toBe("string");
    const keys = r.body.windows.map((w: { key: string }) => w.key);
    expect(keys).toEqual(["lastHour", "last24Hours"]);
    for (const w of r.body.windows) {
      expect(w.totalTrips).toBe(0);
      expect(w.uniqueKeys).toBe(0);
      expect(w.byRole).toEqual([]);
      expect(typeof w.windowMs).toBe("number");
    }
    expect(r.body.buffer).toMatchObject({
      size: 0,
      oldestTrackedAt: null,
    });
    expect(typeof r.body.buffer.capacity).toBe("number");
    expect(typeof r.body.buffer.retentionMs).toBe("number");
    expect(r.body.note).toMatch(/in-process ring buffer/);
  });

  it("aggregates trips by role with deduped unique-key counts", async () => {
    // Three vendors each trip once (3 trips, 3 unique keys);
    // one admin trips twice (2 trips, 1 unique key).
    await tripFor("vendor", 1);
    await tripFor("vendor", 2);
    await tripFor("vendor", 3);
    await tripFor("admin", 99);
    // Admin trips a second time from the same key: only one
    // unique-key but two trips.
    const fakeReq = {
      path: "/api/tickets",
      method: "GET",
      headers: {},
      socket: { remoteAddress: "10.0.0.99" },
      ip: "10.0.0.99",
    } as unknown as import("express").Request;
    const fakeRes = {
      setHeader() {},
      status() {
        return this;
      },
      json() {
        return this;
      },
    } as unknown as import("express").Response;
    await ticketsRateLimit.enforceTicketsRateLimit(fakeReq, fakeRes, {
      userId: 99,
      role: "admin",
    });

    const r = await request(app)
      .get("/api/admin/tickets-rate-limit-trips")
      .set("Cookie", cookieFor("admin"));
    expect(r.status).toBe(200);
    const lastHour = r.body.windows.find(
      (w: { key: string }) => w.key === "lastHour",
    );
    expect(lastHour.totalTrips).toBe(5);
    expect(lastHour.uniqueKeys).toBe(4);
    // Sorted by trips desc — vendor (3) before admin (2).
    expect(lastHour.byRole).toEqual([
      { role: "vendor", trips: 3, uniqueKeys: 3 },
      { role: "admin", trips: 2, uniqueKeys: 1 },
    ]);
    // Buffer info reflects the recorded trips.
    expect(r.body.buffer.size).toBe(5);
    expect(typeof r.body.buffer.oldestTrackedAt).toBe("string");
  });

  it("groups unauthenticated trips under the 'unknown' role label", async () => {
    await tripFor(null, 1);
    const r = await request(app)
      .get("/api/admin/tickets-rate-limit-trips")
      .set("Cookie", cookieFor("admin"));
    expect(r.status).toBe(200);
    const lastHour = r.body.windows.find(
      (w: { key: string }) => w.key === "lastHour",
    );
    expect(lastHour.totalTrips).toBe(1);
    expect(lastHour.byRole).toEqual([
      { role: "unknown", trips: 1, uniqueKeys: 1 },
    ]);
  });
});

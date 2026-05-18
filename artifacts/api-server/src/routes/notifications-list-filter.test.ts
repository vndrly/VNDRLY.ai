import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Task #639 — GET /api/notifications now accepts an optional
// `?type=...` filter (comma-separated) plus `?limit=` and `?before=`
// for cursor-based pagination, so the new mobile "My Crew Changes"
// screen can pull only `crew_added,crew_removed` rows in pages of 25
// without scanning the bell's full 100-row payload.
//
// What we assert:
//   1. With no query params, the handler still runs the original
//      "all rows for me, desc(createdAt), limit 100" query — i.e.
//      the bell + inbox are unaffected.
//   2. `?type=crew_added,crew_removed` builds an `inArray(type, [...])`
//      condition with the parsed list. Bad/blank entries are dropped.
//   3. `?limit=25` clamps to [1, 100] and is plumbed to drizzle's
//      `limit()` call.
//   4. `?before=<iso>` builds a `lt(createdAt, Date)` condition;
//      a non-parseable value is silently dropped (no 400 — the
//      list endpoint stays forgiving for clients with stale
//      cursors).
//   5. The user_id condition always comes from the session, never
//      from the query string.

const cookieFor = (s: object) => buildTestCookie(s);

const userCookie = cookieFor({
  userId: 4242,
  role: "field_employee",
  vendorId: 11,
  partnerId: null,
});

type WhereCall = {
  conditions: ConditionCapture[];
  limit: number | null;
};

type ConditionCapture = {
  op: string;
  col?: string;
  value?: unknown;
  values?: unknown[];
};

let lastWhereCall: WhereCall | null = null;
let returnRows: unknown[] = [];

// Resetting via a helper preserves the variable's `WhereCall | null`
// type — direct `lastWhereCall = null` re-assignments cause TS to
// narrow it to `null` for the remainder of the function and lose
// the optional-chain shape we rely on later.
function resetWhereCall(): void {
  lastWhereCall = null;
}

vi.mock("drizzle-orm", () => {
  // Capture drizzle expression builders so the test can inspect the
  // shape of the WHERE that the route handler assembled.
  const eq = (col: { __col?: string }, value: unknown) =>
    ({ op: "eq", col: col?.__col, value }) as ConditionCapture;
  const lt = (col: { __col?: string }, value: unknown) =>
    ({ op: "lt", col: col?.__col, value }) as ConditionCapture;
  const inArray = (col: { __col?: string }, values: unknown[]) =>
    ({ op: "inArray", col: col?.__col, values }) as ConditionCapture;
  const desc = (col: { __col?: string }) =>
    ({ op: "desc", col: col?.__col }) as ConditionCapture;
  const and = (...conds: ConditionCapture[]) =>
    ({ op: "and", values: conds }) as ConditionCapture;
  const sql = Object.assign(
    (..._parts: unknown[]) => ({ op: "sql" }) as ConditionCapture,
    { raw: (s: string) => ({ op: "rawSql", value: s }) },
  );
  return { eq, lt, inArray, desc, and, sql };
});

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy(
      { __name: name },
      { get: (_t, k: string) => ({ __table: name, __col: k }) },
    );
  const db: any = {
    select: () => ({
      from: () => ({
        where: (cond: ConditionCapture) => {
          const conds =
            cond?.op === "and" && Array.isArray(cond.values)
              ? (cond.values as ConditionCapture[])
              : [cond];
          lastWhereCall = { conditions: conds, limit: null };
          return {
            orderBy: () => ({
              limit: (n: number) => {
                if (lastWhereCall) lastWhereCall.limit = n;
                return Promise.resolve(returnRows);
              },
            }),
          };
        },
      }),
    }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    }),
  };
  return {
    db,
    pool: { query: async () => ({ rows: [] }) },
    notificationsTable: tableTag("notifications"),
    notificationPreferencesTable: tableTag("notificationPreferences"),
    userOrgMembershipsTable: tableTag("userOrgMemberships"),
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts"),
    hotlistCommentsTable: tableTag("hotlistComments"),
    ticketNoteLogsTable: tableTag("ticketNoteLogs"),
  };
});

// Bypass the rate limiter — we're testing query construction here, not
// throttling. The dedicated rate-limit tests cover that path.
vi.mock("../lib/notifications-rate-limit", () => ({
  enforceNotificationsRateLimit: vi.fn(async () => true),
}));

let app: express.Express;

beforeEach(async () => {
  lastWhereCall = null;
  returnRows = [];
  vi.resetModules();
  const router = (await import("./notifications")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

function findCondition(op: string): ConditionCapture | undefined {
  return lastWhereCall?.conditions.find((c) => c.op === op);
}

describe("GET /api/notifications — Task #639 filter + pagination", () => {
  it("preserves the original behaviour with no query params (user-scoped, limit 100)", async () => {
    returnRows = [];
    const r = await request(app).get("/api/notifications").set("Cookie", userCookie);
    expectStatus(r, 200);
    const eqCond = findCondition("eq");
    expect(eqCond?.col).toBe("userId");
    expect(eqCond?.value).toBe(4242);
    // No type or before filters at all.
    expect(findCondition("inArray")).toBeUndefined();
    expect(findCondition("lt")).toBeUndefined();
    // Default limit is the legacy 100 the bell expects.
    expect(lastWhereCall?.limit).toBe(100);
  });

  it("filters by type when ?type=crew_added,crew_removed is supplied", async () => {
    const r = await request(app)
      .get("/api/notifications?type=crew_added,crew_removed")
      .set("Cookie", userCookie);
    expectStatus(r, 200);
    const inCond = findCondition("inArray");
    expect(inCond?.col).toBe("type");
    expect(inCond?.values).toEqual(["crew_added", "crew_removed"]);
  });

  it("drops blank/whitespace-only entries from the type filter", async () => {
    const r = await request(app)
      .get("/api/notifications?type=,crew_added, ,crew_removed,")
      .set("Cookie", userCookie);
    expectStatus(r, 200);
    const inCond = findCondition("inArray");
    expect(inCond?.values).toEqual(["crew_added", "crew_removed"]);
  });

  it("does not add a type condition when the param is empty", async () => {
    const r = await request(app)
      .get("/api/notifications?type=")
      .set("Cookie", userCookie);
    expectStatus(r, 200);
    expect(findCondition("inArray")).toBeUndefined();
  });

  it("clamps the limit to the [1, 100] range", async () => {
    await request(app)
      .get("/api/notifications?limit=25")
      .set("Cookie", userCookie);
    expect(lastWhereCall?.limit).toBe(25);

    resetWhereCall();
    await request(app)
      .get("/api/notifications?limit=999")
      .set("Cookie", userCookie);
    // Anything above 100 must clamp so a client can't ask the
    // database for an unbounded scan via the query string.
    expect(lastWhereCall?.limit).toBe(100);

    resetWhereCall();
    await request(app)
      .get("/api/notifications?limit=0")
      .set("Cookie", userCookie);
    // 0 / negatives clamp to 1 so a typo never returns an empty
    // array that looks like "all caught up".
    expect(lastWhereCall?.limit).toBe(1);
  });

  it("falls back to the default limit when ?limit is non-numeric", async () => {
    await request(app)
      .get("/api/notifications?limit=abc")
      .set("Cookie", userCookie);
    expect(lastWhereCall?.limit).toBe(100);
  });

  it("paginates with ?before=<iso> by adding lt(createdAt, Date)", async () => {
    const cursor = "2026-04-30T18:00:00.000Z";
    await request(app)
      .get(`/api/notifications?before=${encodeURIComponent(cursor)}`)
      .set("Cookie", userCookie);
    const ltCond = findCondition("lt");
    expect(ltCond?.col).toBe("createdAt");
    const v = ltCond?.value as Date;
    expect(v).toBeInstanceOf(Date);
    expect(v.toISOString()).toBe(cursor);
  });

  it("silently ignores an unparseable ?before cursor", async () => {
    // Stale clients sometimes send malformed timestamps; we'd rather
    // return the first page than reject with 400, since the screen
    // would otherwise look broken to the user.
    const r = await request(app)
      .get("/api/notifications?before=not-a-date")
      .set("Cookie", userCookie);
    expectStatus(r, 200);
    expect(findCondition("lt")).toBeUndefined();
  });

  it("requires a session — returns 401 without a cookie", async () => {
    // The user_id must always come from the session, never from the
    // query string. A missing session can never widen the result set.
    const r = await request(app).get("/api/notifications?type=crew_added");
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("auth.not_authenticated");
    expect(lastWhereCall).toBeNull();
  });
});

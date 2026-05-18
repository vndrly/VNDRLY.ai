import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import cookieParser from "cookie-parser";
import http from "http";
import { buildTestCookie } from "../test-utils/session";

// ---------------------------------------------------------------------------
// Tests for the GET /api/visits/events SSE handler in routes/visits.ts —
// specifically the `visit.hello` envelope it emits on every (re)connection
// and the `gap` flag derived from the `Last-Event-ID` header.
//
// The visit-events module is mocked so we can deterministically control the
// "current global seq" and avoid touching Postgres / the LISTEN client.
// ---------------------------------------------------------------------------

let mockCurrentSeq = 0;

vi.mock("../lib/visit-events", () => ({
  publishVisitEvent: vi.fn(),
  subscribeVisitEvents: (_fn: unknown) => () => undefined,
  getCurrentVisitEventSeq: vi.fn(async () => mockCurrentSeq),
}));

// Minimal stubs — the SSE handler itself doesn't query the DB, but importing
// routes/visits.ts evaluates its drizzle imports, so we provide harmless
// no-op mocks for `@workspace/db`, `drizzle-orm`, and `./notifications`.
vi.mock("@workspace/db", () => {
  const tbl = {} as unknown as Record<string, unknown>;
  return {
    db: {
      select: () => ({ from: () => Promise.resolve([]) }),
      insert: () => ({ values: () => ({ returning: async () => [] }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    },
    siteVisitsTable: tbl,
    guestSessionsTable: tbl,
    siteLocationsTable: tbl,
    partnersTable: tbl,
    vendorsTable: tbl,
    siteWorkAssignmentsTable: tbl,
    usersTable: tbl,
  };
});

vi.mock("drizzle-orm", () => {
  const passthrough = (..._args: unknown[]) => ({});
  const sqlTag = passthrough as ((...args: unknown[]) => unknown) & {
    raw: typeof passthrough;
  };
  sqlTag.raw = passthrough;
  return {
    and: passthrough,
    eq: passthrough,
    isNull: passthrough,
    isNotNull: passthrough,
    lt: passthrough,
    desc: passthrough,
    sql: sqlTag,
  };
});

vi.mock("./notifications", () => ({
  notifyUsers: async () => 0,
  findPartnerUserIds: async () => [],
  findVendorUserIds: async () => [],
  findPartnerVisitNotifierUserIds: async () => [],
  findVendorVisitNotifierUserIds: async () => [],
  VISIT_NOTIFICATIONS_ROLE: "Visitor Notifications",
}));


function staffCookie(): string {
  return buildTestCookie({
    userId: 10,
    role: "admin",
    vendorId: null,
    partnerId: null,
  });
}

let app: express.Express;
let server: http.Server;
let port: number;

beforeEach(async () => {
  mockCurrentSeq = 0;
  vi.resetModules();
  const visits = await import("./visits");
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", visits.default);
  attachTestErrorMiddleware(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected an AddressInfo object");
  }
  port = addr.port;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

type HelloEnvelope = {
  type: "visit.hello";
  currentSeq: number;
  lastSeenSeq: number | null;
  gap: boolean;
};

function fetchSseHello(
  headers: Record<string, string> = {},
  authed = true,
): Promise<{ statusCode: number; raw: string; hello: HelloEnvelope | null }> {
  return new Promise((resolve, reject) => {
    const reqHeaders: Record<string, string> = { ...headers };
    if (authed) reqHeaders.Cookie = staffCookie();
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/visits/events",
        method: "GET",
        headers: reqHeaders,
      },
      (res) => {
        let data = "";
        const finish = (hello: HelloEnvelope | null) => {
          try { req.destroy(); } catch { /* ignore */ }
          resolve({ statusCode: res.statusCode ?? 0, raw: data, hello });
        };
        if ((res.statusCode ?? 0) >= 400) {
          res.on("data", (c) => { data += c.toString(); });
          res.on("end", () => finish(null));
          return;
        }
        res.on("data", (chunk) => {
          data += chunk.toString();
          const m = data.match(/event: visit\.hello\ndata: (.+)\n\n/);
          if (m) {
            try {
              finish(JSON.parse(m[1]) as HelloEnvelope);
            } catch (err) {
              reject(err);
            }
          }
        });
        res.on("end", () => {
          if (!data.includes("visit.hello")) finish(null);
        });
        res.on("error", reject);
      },
    );
    req.on("error", (e) => {
      // ECONNRESET is expected when we destroy the request after reading the
      // first hello frame from a long-lived SSE response.
      if ((e as NodeJS.ErrnoException).code !== "ECONNRESET") reject(e);
    });
    req.end();
    setTimeout(() => {
      try { req.destroy(); } catch { /* ignore */ }
      reject(new Error("Timed out waiting for visit.hello"));
    }, 3000);
  });
}

describe("GET /api/visits/events SSE handler", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const result = await fetchSseHello({}, false);
    expect(result.statusCode).toBe(401);
  });

  it("emits a visit.hello envelope on initial connect with gap:false when no Last-Event-ID is sent", async () => {
    mockCurrentSeq = 5;
    const { hello } = await fetchSseHello();
    expect(hello).not.toBeNull();
    expect(hello!.type).toBe("visit.hello");
    expect(hello!.currentSeq).toBe(5);
    expect(hello!.lastSeenSeq).toBeNull();
    expect(hello!.gap).toBe(false);
  });

  it("emits a visit.hello envelope on initial connect with gap:false when no events have ever been issued", async () => {
    mockCurrentSeq = 0;
    const { hello } = await fetchSseHello();
    expect(hello).not.toBeNull();
    expect(hello!.currentSeq).toBe(0);
    expect(hello!.gap).toBe(false);
  });

  it("sets gap:true when Last-Event-ID lags the current global seq", async () => {
    mockCurrentSeq = 10;
    const { hello } = await fetchSseHello({ "Last-Event-ID": "7" });
    expect(hello).not.toBeNull();
    expect(hello!.gap).toBe(true);
    expect(hello!.lastSeenSeq).toBe(7);
    expect(hello!.currentSeq).toBe(10);
  });

  it("sets gap:false when Last-Event-ID matches the current global seq", async () => {
    mockCurrentSeq = 10;
    const { hello } = await fetchSseHello({ "Last-Event-ID": "10" });
    expect(hello).not.toBeNull();
    expect(hello!.gap).toBe(false);
    expect(hello!.lastSeenSeq).toBe(10);
  });

  it("sets gap:false when Last-Event-ID is ahead of the current global seq", async () => {
    // Defensive: clients should never legitimately have a higher id than the
    // server, but if they do (e.g. local seq counter advanced during a DB
    // outage on an old instance), don't spam them with a gap warning.
    mockCurrentSeq = 5;
    const { hello } = await fetchSseHello({ "Last-Event-ID": "9" });
    expect(hello).not.toBeNull();
    expect(hello!.gap).toBe(false);
    expect(hello!.lastSeenSeq).toBe(9);
  });

  it("treats an empty / non-numeric Last-Event-ID as 'no prior id' (gap:false)", async () => {
    mockCurrentSeq = 10;
    const { hello } = await fetchSseHello({ "Last-Event-ID": "not-a-number" });
    expect(hello).not.toBeNull();
    expect(hello!.gap).toBe(false);
    expect(hello!.lastSeenSeq).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import cookieParser from "cookie-parser";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { buildTestCookie } from "../test-utils/session";

// End-to-end SSE coverage for /api/live-locations/events.

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
  consents: tableTag("consents", ["id", "userId", "deviceId", "revokedAt", "acceptedAt"]),
  employees: tableTag("employees", ["id", "userId", "vendorId", "firstName", "lastName"]),
  tickets: tableTag("tickets", ["id", "fieldEmployeeId", "lifecycleState", "vendorId", "siteLocationId"]),
  ticketCrew: tableTag("ticketCrew", ["ticketId", "employeeId", "removedAt"]),
  gpsLogs: tableTag("gpsLogs", ["id", "ticketId", "latitude", "longitude", "eventType", "batteryLevel", "recordedAt"]),
  sites: tableTag("sites", ["id", "name", "siteCode", "partnerId"]),
};

const fixtures: Record<string, Row[]> = {
  consents: [],
  employees: [],
  tickets: [],
  gpsLogs: [],
  sites: [],
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
    then: (resolve: any, reject?: any) => Promise.resolve(run()).then(resolve, reject),
    catch: (reject: any) => Promise.resolve(run()).catch(reject),
  };
  return q;
}

let nextId = 1000;
vi.mock("@workspace/db", () => {
  const db = {
    select: (_cols?: any) => ({ from: (t: any) => makeQuery(t.__name) }),
    insert: (t: any) => ({
      values: (v: any) => ({
        returning: async () => {
          const row = { id: ++nextId, recordedAt: new Date(), ...v };
          fixtures[t.__name].push(row);
          return [row];
        },
      }),
    }),
    update: (_t: any) => ({ set: (_s: Row) => ({ where: async () => undefined }) }),
    execute: async () => ({ rows: [] }),
  };
  return {
    db,
    locationConsentsTable: tables.consents,
    fieldEmployeesTable: tables.employees,
    ticketsTable: tables.tickets,
  ticketCrewTable: tables.ticketCrew,
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


function cookieFor(role: string, opts: { userId?: number; vendorId?: number | null } = {}) {
  return buildTestCookie({
    userId: opts.userId ?? 10,
    role,
    vendorId: opts.vendorId === undefined ? null : opts.vendorId,
    partnerId: null,
  });
}

let server: http.Server;
let baseUrl: string;

beforeEach(async () => {
  for (const k of Object.keys(fixtures)) fixtures[k] = [];
  nextId = 1000;
  vi.resetModules();

  // Seed two field employees on different vendors with active tickets and
  // consents so each can post a live ping.
  fixtures.employees = [
    { id: 1, userId: 100, vendorId: 1, firstName: "Alice", lastName: "Vendor1" },
    { id: 2, userId: 200, vendorId: 2, firstName: "Bob", lastName: "Vendor2" },
  ];
  fixtures.tickets = [
    { id: 10, fieldEmployeeId: 1, lifecycleState: "en_route", vendorId: 1, siteLocationId: 50 },
    { id: 20, fieldEmployeeId: 2, lifecycleState: "en_route", vendorId: 2, siteLocationId: 60 },
  ];
  fixtures.consents = [
    { id: 1, userId: 100, deviceId: "dev-1", revokedAt: null, acceptedAt: new Date() },
    { id: 2, userId: 200, deviceId: "dev-2", revokedAt: null, acceptedAt: new Date() },
  ];
  fixtures.sites = [
    { id: 50, name: "Site A", siteCode: "A-1", partnerId: 7 },
    { id: 60, name: "Site B", siteCode: "B-1", partnerId: 8 },
  ];

  const router = (await import("./locations")).default;
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  vi.clearAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ── SSE client helper: opens a stream, accumulates "event:/data:" blocks,
//    and exposes a way to wait for the next matching event. ────────────────
function openSseClient(path: string, cookie: string) {
  const ac = new AbortController();
  const events: { event: string; data: any }[] = [];
  const waiters: Array<(e: { event: string; data: any }) => boolean> = [];
  const resolvers = new Map<(e: any) => boolean, (e: any) => void>();

  const dispatch = (block: string) => {
    const lines = block.split("\n").filter((l) => !l.startsWith(":"));
    let event = "message";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    let parsed: any;
    try { parsed = JSON.parse(data); } catch { parsed = data; }
    const evt = { event, data: parsed };
    events.push(evt);
    for (const pred of [...waiters]) {
      if (pred(evt)) {
        const r = resolvers.get(pred);
        if (r) r(evt);
        waiters.splice(waiters.indexOf(pred), 1);
        resolvers.delete(pred);
      }
    }
  };

  const ready = (async () => {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { cookie },
      signal: ac.signal,
    });
    if (res.status !== 200) {
      throw new Error(`SSE open failed: ${res.status}`);
    }
    if (!res.body) throw new Error("No SSE body");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            dispatch(buf.slice(0, idx));
            buf = buf.slice(idx + 2);
          }
        }
      } catch {
        /* aborted */
      }
    })();
  })();

  return {
    ready,
    events,
    waitFor: (pred: (e: { event: string; data: any }) => boolean, timeoutMs = 1000) =>
      new Promise<{ event: string; data: any }>((resolve, reject) => {
        const existing = events.find(pred);
        if (existing) return resolve(existing);
        waiters.push(pred);
        resolvers.set(pred, resolve);
        setTimeout(() => {
          if (resolvers.has(pred)) {
            resolvers.delete(pred);
            const i = waiters.indexOf(pred);
            if (i >= 0) waiters.splice(i, 1);
            reject(new Error("SSE waitFor timeout"));
          }
        }, timeoutMs);
      }),
    close: () => ac.abort(),
  };
}

async function postPing(
  cookie: string,
  body: { ticketId: number; latitude: number; longitude: number; deviceId: string; batteryLevel?: number },
) {
  const res = await fetch(`${baseUrl}/api/location-pings`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: res.status === 201 ? await res.json() : null };
}

describe("Crew Map live SSE pipeline", () => {
  it("rejects unauthenticated SSE subscribers", async () => {
    const res = await fetch(`${baseUrl}/api/live-locations/events`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("auth.unauthenticated");
  });

  it("rejects field_employee role and partner role from subscribing", async () => {
    const fe = await fetch(`${baseUrl}/api/live-locations/events`, {
      headers: { cookie: cookieFor("field_employee", { vendorId: 1 }) },
    });
    expect(fe.status).toBe(403);
    expect(((await fe.json()) as { code?: string }).code).toBe("visitor.forbidden");
    const partner = await fetch(`${baseUrl}/api/live-locations/events`, {
      headers: { cookie: cookieFor("partner", { vendorId: null }) },
    });
    expect(partner.status).toBe(403);
    expect(((await partner.json()) as { code?: string }).code).toBe("visitor.forbidden");
  });

  it("admin subscriber receives a ping after POST /api/location-pings, with the full payload shape", async () => {
    const admin = openSseClient("/api/live-locations/events", cookieFor("admin", { vendorId: null }));
    await admin.ready;

    const post = await postPing(cookieFor("field_employee", { userId: 100, vendorId: 1 }), {
      ticketId: 10,
      latitude: 31.5,
      longitude: -102.4,
      deviceId: "dev-1",
      batteryLevel: 0.42,
    });
    expectStatus(post, 201);

    const evt = await admin.waitFor((e) => e.event === "location.ping");
    expect(evt.data).toMatchObject({
      type: "location.ping",
      location: {
        employeeId: 1,
        employeeName: "Alice Vendor1",
        ticketId: 10,
        vendorId: 1,
        lifecycleState: "en_route",
        siteLocationId: 50,
        siteName: "Site A",
        siteCode: "A-1",
        sitePartnerId: 7,
        latitude: 31.5,
        longitude: -102.4,
        batteryLevel: 0.42,
      },
    });
    expect(typeof evt.data.location.recordedAt).toBe("string");

    admin.close();
  });

  it("vendor subscriber only sees pings for its own vendor — never another vendor's", async () => {
    const vendor1 = openSseClient(
      "/api/live-locations/events",
      cookieFor("vendor", { vendorId: 1 }),
    );
    await vendor1.ready;

    // Post a ping for vendor 2's employee. Vendor 1 must NOT receive this.
    const otherVendor = await postPing(
      cookieFor("field_employee", { userId: 200, vendorId: 2 }),
      { ticketId: 20, latitude: 30, longitude: -100, deviceId: "dev-2" },
    );
    expectStatus(otherVendor, 201);

    // Then post a ping for vendor 1's own employee. Vendor 1 must receive it.
    const ownVendor = await postPing(
      cookieFor("field_employee", { userId: 100, vendorId: 1 }),
      { ticketId: 10, latitude: 32, longitude: -103, deviceId: "dev-1" },
    );
    expectStatus(ownVendor, 201);

    const evt = await vendor1.waitFor((e) => e.event === "location.ping");
    expect(evt.data.location.vendorId).toBe(1);
    expect(evt.data.location.employeeId).toBe(1);

    // Give the bus a beat to confirm the vendor 2 event never arrived.
    await new Promise((r) => setTimeout(r, 50));
    const vendor2Events = vendor1.events.filter(
      (e) => e.event === "location.ping" && e.data.location.vendorId === 2,
    );
    expect(vendor2Events).toEqual([]);

    vendor1.close();
  });

  it("admin subscriber scoped via ?vendorId=N also filters out other vendors", async () => {
    const admin = openSseClient(
      "/api/live-locations/events?vendorId=2",
      cookieFor("admin", { vendorId: null }),
    );
    await admin.ready;

    await postPing(cookieFor("field_employee", { userId: 100, vendorId: 1 }), {
      ticketId: 10, latitude: 1, longitude: 1, deviceId: "dev-1",
    });
    const v2 = await postPing(cookieFor("field_employee", { userId: 200, vendorId: 2 }), {
      ticketId: 20, latitude: 2, longitude: 2, deviceId: "dev-2",
    });
    expectStatus(v2, 201);

    const evt = await admin.waitFor((e) => e.event === "location.ping");
    expect(evt.data.location.vendorId).toBe(2);
    await new Promise((r) => setTimeout(r, 50));
    const stray = admin.events.filter(
      (e) => e.event === "location.ping" && e.data.location.vendorId !== 2,
    );
    expect(stray).toEqual([]);

    admin.close();
  });

  it("subscriber scoped via ?siteLocationId=N drops events for other sites", async () => {
    const sub = openSseClient(
      "/api/live-locations/events?siteLocationId=60",
      cookieFor("admin", { vendorId: null }),
    );
    await sub.ready;

    // Vendor 1 / site 50 — must be filtered out.
    await postPing(cookieFor("field_employee", { userId: 100, vendorId: 1 }), {
      ticketId: 10, latitude: 1, longitude: 1, deviceId: "dev-1",
    });
    // Vendor 2 / site 60 — must arrive.
    await postPing(cookieFor("field_employee", { userId: 200, vendorId: 2 }), {
      ticketId: 20, latitude: 2, longitude: 2, deviceId: "dev-2",
    });

    const evt = await sub.waitFor((e) => e.event === "location.ping");
    expect(evt.data.location.siteLocationId).toBe(60);

    await new Promise((r) => setTimeout(r, 50));
    const stray = sub.events.filter(
      (e) => e.event === "location.ping" && e.data.location.siteLocationId !== 60,
    );
    expect(stray).toEqual([]);

    sub.close();
  });

  it("a vendor cannot subscribe to another vendor's stream via ?vendorId override", async () => {
    const res = await fetch(`${baseUrl}/api/live-locations/events?vendorId=2`, {
      headers: { cookie: cookieFor("vendor", { vendorId: 1 }) },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("visitor.wrong_vendor");
  });

  it("two consecutive pings on the same ticket both fan out (pin moves), in order", async () => {
    const admin = openSseClient("/api/live-locations/events", cookieFor("admin", { vendorId: null }));
    await admin.ready;

    await postPing(cookieFor("field_employee", { userId: 100, vendorId: 1 }), {
      ticketId: 10, latitude: 31.0, longitude: -102.0, deviceId: "dev-1",
    });
    await admin.waitFor(
      (e) => e.event === "location.ping" && e.data.location.latitude === 31.0,
    );

    await postPing(cookieFor("field_employee", { userId: 100, vendorId: 1 }), {
      ticketId: 10, latitude: 32.5, longitude: -103.5, deviceId: "dev-1",
    });
    await admin.waitFor(
      (e) => e.event === "location.ping" && e.data.location.latitude === 32.5,
    );

    const pings = admin.events
      .filter((e) => e.event === "location.ping")
      .map((e) => e.data.location);
    expect(pings).toHaveLength(2);
    expect(pings[0].latitude).toBe(31.0);
    expect(pings[1].latitude).toBe(32.5);
    expect(pings[0].employeeId).toBe(pings[1].employeeId);

    admin.close();
  });
});

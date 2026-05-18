import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import http from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { sql } from "drizzle-orm";
import { buildTestCookie } from "../test-utils/session";

// ---------------------------------------------------------------------------
// Task #644: end-to-end coverage for the /api/tickets/events SSE channel
// added in Task #622.
//
// The bus has three moving parts that the existing unit suites verify in
// isolation but never exercise together:
//
//   1. `publishTicketUnblocked()` allocates a global seq from a pg sequence
//      and `NOTIFY`s a JSON payload on the `ticket_events` channel.
//   2. The module-level pg LISTEN client receives that NOTIFY and re-emits
//      it on the in-process EventEmitter.
//   3. The `/api/tickets/events` SSE route subscribes to that EventEmitter
//      and writes role-scoped events back out to connected clients.
//
// A regression in any wiring above silently breaks real-time auto-clear of
// the assignment-removed banner on web. This test boots a real Postgres,
// the real bus, and a real SSE client, then performs the *actual*
// trigger — POST /api/site-locations/:siteId/assignments — that produces
// the unblock event and asserts:
//
//   • an admin SSE client receives the `ticket.unblocked` event for the
//     freshly-unblocked ticket within a short timeout, and
//   • role scoping works: a vendor SSE client only receives events for
//     its own vendor; an unrelated vendor does not see the event.
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL;
const haveRealDb = await checkDatabase();

async function checkDatabase(): Promise<boolean> {
  if (!DATABASE_URL) return false;
  // The unit-test setup writes a placeholder URL when no real DB exists.
  if (DATABASE_URL.includes("test:test@localhost")) return false;
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    return true;
  } catch {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    return false;
  }
}

// All seeded rows carry this marker so cleanup can target only what the
// suite created without touching pre-existing dev-DB data.
const MARKER = `task644-tix-events-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;


function cookieFor(role: string, opts: { userId?: number; vendorId?: number | null; partnerId?: number | null } = {}) {
  return buildTestCookie({
    userId: opts.userId ?? 1,
    role,
    vendorId: opts.vendorId === undefined ? null : opts.vendorId,
    partnerId: opts.partnerId === undefined ? null : opts.partnerId,
  });
}

type SeedIds = {
  partnerId: number;
  vendorOneId: number;
  vendorTwoId: number;
  workTypeId: number;
  siteLocationId: number;
  ticketId: number;
  vendorPersonId: number;
};

let seeded: SeedIds | null = null;
let server: http.Server | null = null;
let baseUrl = "";
let app: Express;
let dbModule: typeof import("@workspace/db");
let ticketEvents: typeof import("../lib/ticket-events");

async function seed(): Promise<SeedIds> {
  const {
    db,
    partnersTable,
    vendorsTable,
    workTypesTable,
    siteLocationsTable,
    vendorPeopleTable,
    ticketsTable,
    vendorWorkTypesTable,
  } = dbModule;

  const [partner] = await db
    .insert(partnersTable)
    .values({
      name: `${MARKER}-P`,
      contactName: "P Contact",
      contactEmail: `${MARKER}-p@example.com`,
    })
    .returning({ id: partnersTable.id });

  const [vendorOne] = await db
    .insert(vendorsTable)
    .values({
      name: `${MARKER}-V1`,
      contactName: "V1 Contact",
      contactEmail: `${MARKER}-v1@example.com`,
    })
    .returning({ id: vendorsTable.id });

  const [vendorTwo] = await db
    .insert(vendorsTable)
    .values({
      name: `${MARKER}-V2`,
      contactName: "V2 Contact",
      contactEmail: `${MARKER}-v2@example.com`,
    })
    .returning({ id: vendorsTable.id });

  const [workType] = await db
    .insert(workTypesTable)
    .values({
      name: `${MARKER}-WT`,
      category: "field",
    })
    .returning({ id: workTypesTable.id });

  // Task #727: POST /site-locations/:siteId/assignments now rejects with
  // 400 `work_type_not_in_vendor_catalog` unless the (vendor, work_type)
  // pair exists in the vendor catalog. Seed it so the unblock fan-out
  // POST proceeds to the publish/notify step under test.
  await db
    .insert(vendorWorkTypesTable)
    .values({
      vendorId: vendorOne.id,
      workTypeId: workType.id,
    });

  const [site] = await db
    .insert(siteLocationsTable)
    .values({
      partnerId: partner.id,
      name: `${MARKER}-Site`,
      address: "1 Pad Rd",
      latitude: 31.5,
      longitude: -102.4,
      siteCode: `${MARKER.slice(0, 24)}-SC`.slice(0, 40),
    })
    .returning({ id: siteLocationsTable.id });

  // Task #727: vendor catalog is the source of truth for site assignments.
  // The POST /site-locations/:siteId/assignments handler now rejects with
  // `work_type_not_in_vendor_catalog` (HTTP 400) if the (vendor, work_type)
  // pair is not in `vendor_work_types`. Seed the catalog row for vendor one
  // so the unblock fan-out is exercised end-to-end as before.
  await db.insert(vendorWorkTypesTable).values({
    vendorId: vendorOne.id,
    workTypeId: workType.id,
  });

  // Field employee (a.k.a. vendor_people row) to satisfy the unblock fan-out
  // requirement that at least one ticket has a lead — otherwise the helper's
  // `allPersonIds.length === 0` short-circuit returns BEFORE the per-ticket
  // publish loop, and no event would be emitted to the SSE channel.
  const [vp] = await db
    .insert(vendorPeopleTable)
    .values({
      vendorId: vendorOne.id,
      firstName: MARKER,
      lastName: "Lead",
      email: `${MARKER}-lead@example.com`,
    })
    .returning({ id: vendorPeopleTable.id });

  const [ticket] = await db
    .insert(ticketsTable)
    .values({
      siteLocationId: site.id,
      vendorId: vendorOne.id,
      workTypeId: workType.id,
      fieldEmployeeId: vp.id,
      // Default status is `initiated`, which is in TICKET_UNBLOCK_OPEN_STATUSES,
      // so this row will be selected by the unblock fan-out's tickets query.
    })
    .returning({ id: ticketsTable.id });

  return {
    partnerId: partner.id,
    vendorOneId: vendorOne.id,
    vendorTwoId: vendorTwo.id,
    workTypeId: workType.id,
    siteLocationId: site.id,
    ticketId: ticket.id,
    vendorPersonId: vp.id,
  };
}

async function cleanup(): Promise<void> {
  if (!dbModule) return;
  const { db } = dbModule;
  // Order matters because of FK constraints. Delete by marker so we never
  // touch unrelated rows even if other tests are running concurrently.
  await db.execute(
    sql`delete from site_work_assignments where vendor_id in (select id from vendors where name like ${MARKER + "-%"})`,
  );
  // Task #727 catalog row seeded above — delete before vendors/work_types
  // so the FKs from vendor_work_types are released first.
  await db.execute(
    sql`delete from vendor_work_types where vendor_id in (select id from vendors where name like ${MARKER + "-%"})`,
  );
  await db.execute(
    sql`delete from tickets where vendor_id in (select id from vendors where name like ${MARKER + "-%"})`,
  );
  // Task #727: catalog row seeded above so the unblock POST is allowed
  // through the new presence check; remove it before the FK-bearing rows
  // are deleted.
  await db.execute(
    sql`delete from vendor_work_types where vendor_id in (select id from vendors where name like ${MARKER + "-%"})`,
  );
  await db.execute(
    sql`delete from vendor_people where first_name = ${MARKER}`,
  );
  await db.execute(
    sql`delete from site_locations where name like ${MARKER + "-%"}`,
  );
  await db.execute(
    sql`delete from work_types where name like ${MARKER + "-%"}`,
  );
  await db.execute(
    sql`delete from vendors where name like ${MARKER + "-%"}`,
  );
  await db.execute(
    sql`delete from partners where name like ${MARKER + "-%"}`,
  );
  // Notifications inserted by the unblock fan-out are keyed by user_id;
  // since the seeded vendor_people row has no userId, no rows should have
  // been written. Belt-and-suspenders cleanup by dedupe key just in case.
  await db.execute(
    sql`delete from notifications where dedupe_key like ${"ticket_unblocked:%"} and dedupe_key in (select 'ticket_unblocked:' || id::text from tickets where vendor_id in (select id from vendors where name like ${MARKER + "-%"}))`,
  );
}

// Wait for the LISTEN client to be wired up by publishing a probe event
// and waiting for it to round-trip through Postgres NOTIFY → LISTEN →
// local EventEmitter. Mirrors the visit-events.test.ts probe loop.
async function waitForListenerReady(timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const probeTicketId = -1 * Math.floor(Math.random() * 1_000_000_000);
    const seen = new Promise<boolean>((resolve) => {
      const t = setTimeout(() => {
        unsub();
        resolve(false);
      }, 500);
      const unsub = ticketEvents.subscribeTicketEvents((ev) => {
        if (ev.type === "ticket.unblocked" && ev.ticketId === probeTicketId) {
          clearTimeout(t);
          unsub();
          resolve(true);
        }
      });
    });
    ticketEvents.publishTicketUnblocked({
      ticketId: probeTicketId,
      vendorId: null,
      partnerId: null,
    });
    if (await seen) return;
  }
  throw new Error("ticket_events listener did not become ready in time");
}

// ── SSE client helper: opens an EventSource-style stream over fetch,
//    accumulates `event:`/`data:` blocks, and exposes a `waitFor` matcher.
//    Lifted from routes/locations-sse.test.ts so the two SSE channels test
//    the same way. ──────────────────────────────────────────────────────
function openSseClient(
  path: string,
  cookie: string,
  opts: { lastEventId?: string | number } = {},
) {
  const ac = new AbortController();
  const events: { event: string; data: any; id?: string }[] = [];
  const waiters: Array<(e: { event: string; data: any; id?: string }) => boolean> = [];
  const resolvers = new Map<(e: any) => boolean, (e: any) => void>();

  const dispatch = (block: string) => {
    const lines = block.split("\n").filter((l) => !l.startsWith(":"));
    let event = "message";
    let data = "";
    let id: string | undefined;
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
      else if (line.startsWith("id:")) id = line.slice(3).trim();
    }
    if (!data) return;
    let parsed: any;
    try {
      parsed = JSON.parse(data);
    } catch {
      parsed = data;
    }
    const evt: { event: string; data: any; id?: string } = { event, data: parsed };
    if (id !== undefined) evt.id = id;
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
    const headers: Record<string, string> = { cookie };
    if (opts.lastEventId !== undefined) {
      headers["Last-Event-ID"] = String(opts.lastEventId);
    }
    const res = await fetch(`${baseUrl}${path}`, {
      headers,
      signal: ac.signal,
    });
    if (res.status !== 200) {
      throw new Error(`SSE open failed: ${res.status}`);
    }
    if (!res.body) throw new Error("No SSE body");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    void (async () => {
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
    // Wait for the one-shot `ticket.hello` so we know the subscription is
    // wired up on the server side before we trigger the publish below.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error("SSE never emitted ticket.hello")),
        5_000,
      );
      const check = () => {
        if (events.some((e) => e.event === "ticket.hello")) {
          clearTimeout(t);
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });
  })();

  return {
    ready,
    events,
    waitFor: (
      pred: (e: { event: string; data: any; id?: string }) => boolean,
      timeoutMs = 5_000,
    ) =>
      new Promise<{ event: string; data: any; id?: string }>((resolve, reject) => {
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

describe.runIf(haveRealDb)("/api/tickets/events end-to-end", () => {
  beforeAll(async () => {
    dbModule = await import("@workspace/db");
    ticketEvents = await import("../lib/ticket-events");
    seeded = await seed();

    // Mount only the routers we exercise. The full app brings in dozens of
    // unrelated routers and module-level workers; this keeps the test
    // surface small while still using the production handlers verbatim.
    const ticketsRouter = (await import("./tickets")).default;
    const siteLocationsRouter = (await import("./siteLocations")).default;
    app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use("/api", siteLocationsRouter);
    app.use("/api", ticketsRouter);
    attachTestErrorMiddleware(app);

    server = http.createServer(app);
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const addr = server!.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // Start the real LISTEN/NOTIFY bus and wait for the listener to be wired
    // up, otherwise the publish triggered by the assignment POST below could
    // race the bus startup and silently drop the event.
    ticketEvents.startTicketEventBus();
    await waitForListenerReady();
  }, 60_000);

  afterAll(async () => {
    try {
      if (server) {
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      }
    } finally {
      try {
        if (ticketEvents) await ticketEvents.stopTicketEventBus();
      } finally {
        try {
          await cleanup();
        } finally {
          seeded = null;
        }
      }
    }
  });

  it(
    "delivers ticket.unblocked to admin and same-vendor SSE clients, and skips other vendors",
    async () => {
      const ids = seeded!;
      const adminClient = openSseClient(
        "/api/tickets/events",
        cookieFor("admin"),
      );
      const vendorOneClient = openSseClient(
        "/api/tickets/events",
        cookieFor("vendor", { userId: 100, vendorId: ids.vendorOneId }),
      );
      const vendorTwoClient = openSseClient(
        "/api/tickets/events",
        cookieFor("vendor", { userId: 200, vendorId: ids.vendorTwoId }),
      );
      try {
        await Promise.all([
          adminClient.ready,
          vendorOneClient.ready,
          vendorTwoClient.ready,
        ]);

        // Trigger the production unblock fan-out by creating the missing
        // (vendor, site, work_type) assignment row. The handler runs the
        // notify+publish helper as fire-and-forget, so the SSE event arrives
        // asynchronously after the 201 response.
        const res = await fetch(
          `${baseUrl}/api/site-locations/${ids.siteLocationId}/assignments`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: cookieFor("admin"),
            },
            body: JSON.stringify({
              vendorId: ids.vendorOneId,
              workTypeId: ids.workTypeId,
            }),
          },
        );
        expectStatus(res, 201);

        const matchOurTicket = (e: { event: string; data: any }) =>
          e.event === "ticket.unblocked" && e.data?.ticketId === ids.ticketId;

        const adminEvent = await adminClient.waitFor(matchOurTicket);
        expect(adminEvent.data).toMatchObject({
          type: "ticket.unblocked",
          ticketId: ids.ticketId,
          vendorId: ids.vendorOneId,
          partnerId: ids.partnerId,
        });
        // `seq` is a server-allocated monotonic id; presence + numeric is
        // what we care about here, the actual value depends on prior runs.
        expect(typeof adminEvent.data.seq).toBe("number");

        const vendorOneEvent = await vendorOneClient.waitFor(matchOurTicket);
        expect(vendorOneEvent.data.ticketId).toBe(ids.ticketId);
        expect(vendorOneEvent.data.vendorId).toBe(ids.vendorOneId);

        // Give the bus an extra beat to confirm the unrelated-vendor client
        // never receives the event. We wait long enough that any in-flight
        // delivery would have arrived if visibility filtering had broken.
        await new Promise((r) => setTimeout(r, 250));
        const stray = vendorTwoClient.events.filter(matchOurTicket);
        expect(stray).toEqual([]);
      } finally {
        adminClient.close();
        vendorOneClient.close();
        vendorTwoClient.close();
      }
    },
    20_000,
  );

  // ── Task #662: Lock down the disconnect → missed event → reconnect →
  //    gap-flagged hello recovery contract end-to-end. The web client's
  //    vitest suite (Task #657) drives this with a fake EventSource and
  //    only checks that the right query keys are invalidated. That doesn't
  //    catch a server-side change to the sequence accounting that would
  //    silently drop the `gap: true` signal — i.e., the very thing that
  //    tells the client it must invalidate stale assignment-blocked state.
  //
  //    This test exercises the real path:
  //      1) Connect an admin SSE client.
  //      2) Trigger a publish, capture the assigned global `seq`.
  //      3) Disconnect.
  //      4) Trigger another publish while disconnected.
  //      5) Reconnect with `Last-Event-ID: <captured seq>`.
  //      6) Assert the resulting `ticket.hello` carries `gap: true`,
  //         echoes back our `lastSeenSeq`, and reports a `currentSeq`
  //         that has advanced past it.
  // ──────────────────────────────────────────────────────────────────
  it(
    "ticket.hello reports gap:true when a reconnect's Last-Event-ID lags the global seq",
    async () => {
      // Synthetic ticket ids — negative so they can't collide with real
      // rows. Admin role sees all events regardless of vendor/partner, so
      // these don't need to exist in the tickets table for the SSE
      // visibility check to pass.
      const firstTicketId = -1 * (1_000_000_000 + Math.floor(Math.random() * 1_000_000));
      const missedTicketId = firstTicketId - 1;

      // Step 1: connect, wait for the initial ticket.hello (no Last-Event-ID
      // yet, so gap should be false).
      const firstClient = openSseClient(
        "/api/tickets/events",
        cookieFor("admin"),
      );
      let capturedSeq: number;
      try {
        await firstClient.ready;
        const initialHello = firstClient.events.find(
          (e) => e.event === "ticket.hello",
        );
        expect(initialHello).toBeTruthy();
        expect(initialHello!.data.gap).toBe(false);
        expect(initialHello!.data.lastSeenSeq).toBeNull();

        // Step 2: publish a ticket.unblocked event and capture its seq from
        // the delivered payload (the SSE handler also writes `id: <seq>`,
        // which mirrors what an EventSource's Last-Event-ID will carry on
        // reconnect — see tickets.ts:618-619).
        ticketEvents.publishTicketUnblocked({
          ticketId: firstTicketId,
          vendorId: null,
          partnerId: null,
        });
        const firstEvent = await firstClient.waitFor(
          (e) =>
            e.event === "ticket.unblocked" &&
            e.data?.ticketId === firstTicketId,
        );
        expect(typeof firstEvent.data.seq).toBe("number");
        capturedSeq = firstEvent.data.seq;
      } finally {
        // Step 3: disconnect before the next publish so the second event is
        // genuinely missed by this connection.
        firstClient.close();
      }

      // Step 4: publish while disconnected. We piggy-back on a fresh local
      // subscription to deterministically wait until the NOTIFY round-trips
      // back through the LISTEN client, otherwise we'd race the bus and
      // possibly reconnect before the seq has actually advanced.
      const missedDelivered = new Promise<number>((resolve, reject) => {
        const t = setTimeout(
          () => {
            unsub();
            reject(new Error("missed-event publish never round-tripped"));
          },
          5_000,
        );
        const unsub = ticketEvents.subscribeTicketEvents((ev) => {
          if (
            ev.type === "ticket.unblocked" &&
            ev.ticketId === missedTicketId
          ) {
            clearTimeout(t);
            unsub();
            resolve(ev.seq);
          }
        });
      });
      ticketEvents.publishTicketUnblocked({
        ticketId: missedTicketId,
        vendorId: null,
        partnerId: null,
      });
      const missedSeq = await missedDelivered;
      // Sanity: the missed event must have a strictly greater seq than the
      // one our (now-disconnected) client last saw, otherwise the gap
      // detection we're about to assert would be vacuous.
      expect(missedSeq).toBeGreaterThan(capturedSeq);

      // Step 5: reconnect with Last-Event-ID set to the seq we captured
      // pre-disconnect. This is the exact header EventSource sends on
      // auto-reconnect after the client wrote `id:` lines, so this matches
      // production behavior.
      const reconnectClient = openSseClient(
        "/api/tickets/events",
        cookieFor("admin"),
        { lastEventId: capturedSeq },
      );
      try {
        await reconnectClient.ready;

        // Step 6: assert ticket.hello reflects the gap.
        const hello = reconnectClient.events.find(
          (e) => e.event === "ticket.hello",
        );
        expect(hello).toBeTruthy();
        expect(hello!.data).toMatchObject({
          type: "ticket.hello",
          gap: true,
          lastSeenSeq: capturedSeq,
        });
        expect(typeof hello!.data.currentSeq).toBe("number");
        expect(hello!.data.currentSeq).toBeGreaterThan(capturedSeq);
        expect(hello!.data.currentSeq).toBeGreaterThanOrEqual(missedSeq);
      } finally {
        reconnectClient.close();
      }
    },
    20_000,
  );

  // ── Task #658: Recover from a flaky pub/sub connection without restarting
  //    the server. The reconnect path in `lib/ticket-events.ts` is only
  //    covered by unit tests of its happy path; a regression there would
  //    silently break real-time auto-clear of the assignment-removed banner
  //    in any environment where the LISTEN connection is occasionally killed
  //    (managed Postgres failover, idle-timeout proxies, network blips).
  //
  //    This test forces the underlying `pg.Client` to end mid-session and
  //    asserts that, once the bus reconnects, a freshly published event
  //    still reaches a connected SSE subscriber and that both the in-process
  //    EventEmitter and the SSE `id:` sequence numbers remain monotonically
  //    increasing across the disconnect.
  // ──────────────────────────────────────────────────────────────────
  it(
    "delivers events published after a forced LISTEN disconnect, with monotonically increasing seq",
    async () => {
      // Synthetic ticket ids — negative so they can't collide with real
      // rows. Admin role bypasses the vendor/partner visibility check, so
      // these don't need to exist in the tickets table.
      const beforeTicketId =
        -1 * (3_000_000_000 + Math.floor(Math.random() * 1_000_000));
      const afterTicketId = beforeTicketId - 1;

      // Mirror the SSE deliveries on the in-process EventEmitter so we can
      // independently assert the local bus sees both events with the same
      // monotonic seq across the forced reconnect.
      const localBusSeqs: { ticketId: number; seq: number }[] = [];
      const unsubLocal = ticketEvents.subscribeTicketEvents((ev) => {
        if (
          ev.type === "ticket.unblocked" &&
          (ev.ticketId === beforeTicketId || ev.ticketId === afterTicketId)
        ) {
          localBusSeqs.push({ ticketId: ev.ticketId, seq: ev.seq });
        }
      });

      const client = openSseClient(
        "/api/tickets/events",
        cookieFor("admin"),
      );
      try {
        await client.ready;

        // Publish the pre-disconnect event and wait for it to arrive over
        // SSE. Capture both the data.seq and the raw `id:` line so we can
        // verify they agree and remain monotonic across the reconnect.
        ticketEvents.publishTicketUnblocked({
          ticketId: beforeTicketId,
          vendorId: null,
          partnerId: null,
        });
        const beforeEv = await client.waitFor(
          (e) =>
            e.event === "ticket.unblocked" &&
            e.data?.ticketId === beforeTicketId,
        );
        expect(typeof beforeEv.data.seq).toBe("number");
        expect(beforeEv.id).toBe(String(beforeEv.data.seq));
        const beforeSeq: number = beforeEv.data.seq;

        // Force the LISTEN client to end. This triggers the 'end' event
        // handler in ticket-events.ts, which schedules the reconnect timer
        // — exactly the production path we need to cover.
        const closed = ticketEvents.__forceCloseListenerForTests();
        expect(closed).toBe(true);

        // Wait for the bus to come back online. The probe in
        // waitForListenerReady publishes synthetic events on a tight loop
        // until one round-trips via NOTIFY → LISTEN → local EventEmitter,
        // so it succeeds only after the LISTEN client has re-attached.
        await waitForListenerReady();

        // Publish the post-reconnect event and verify it still reaches the
        // already-open SSE client. This is the core regression guard: a
        // broken reconnect would leave this event stranded in Postgres and
        // the SSE waitFor would time out.
        ticketEvents.publishTicketUnblocked({
          ticketId: afterTicketId,
          vendorId: null,
          partnerId: null,
        });
        const afterEv = await client.waitFor(
          (e) =>
            e.event === "ticket.unblocked" &&
            e.data?.ticketId === afterTicketId,
          15_000,
        );
        expect(typeof afterEv.data.seq).toBe("number");
        expect(afterEv.id).toBe(String(afterEv.data.seq));
        const afterSeq: number = afterEv.data.seq;

        // Sequence numbers must strictly increase across the reconnect on
        // both transports. The probe events fired by waitForListenerReady
        // also consume seqs, so afterSeq is typically beforeSeq + N rather
        // than beforeSeq + 1; only the strict ordering matters.
        expect(afterSeq).toBeGreaterThan(beforeSeq);

        // The in-process EventEmitter should have observed both events,
        // with the same seqs the SSE client saw, in the same order.
        const beforeOnBus = localBusSeqs.find(
          (e) => e.ticketId === beforeTicketId,
        );
        const afterOnBus = localBusSeqs.find(
          (e) => e.ticketId === afterTicketId,
        );
        expect(beforeOnBus).toBeTruthy();
        expect(afterOnBus).toBeTruthy();
        expect(beforeOnBus!.seq).toBe(beforeSeq);
        expect(afterOnBus!.seq).toBe(afterSeq);
        expect(localBusSeqs.indexOf(afterOnBus!)).toBeGreaterThan(
          localBusSeqs.indexOf(beforeOnBus!),
        );

        // SSE `id:` lines must also be monotonically increasing in the
        // order delivered, so an EventSource auto-reconnect would carry a
        // Last-Event-ID at or above the pre-disconnect seq.
        const sseIdsForOurEvents = client.events
          .filter(
            (e) =>
              e.event === "ticket.unblocked" &&
              (e.data?.ticketId === beforeTicketId ||
                e.data?.ticketId === afterTicketId),
          )
          .map((e) => Number(e.id));
        expect(sseIdsForOurEvents.length).toBe(2);
        expect(sseIdsForOurEvents[0]).toBe(beforeSeq);
        expect(sseIdsForOurEvents[1]).toBe(afterSeq);
        expect(sseIdsForOurEvents[1]).toBeGreaterThan(sseIdsForOurEvents[0]);
      } finally {
        unsubLocal();
        client.close();
      }
    },
    30_000,
  );
});

describe.skipIf(haveRealDb)("/api/tickets/events end-to-end", () => {
  it.skip("requires a real Postgres DATABASE_URL", () => {
    // Skipped when DATABASE_URL is unset or points at the placeholder used
    // by the unit-test setup; this suite seeds real rows and exercises the
    // production LISTEN/NOTIFY → SSE pipeline.
  });
});

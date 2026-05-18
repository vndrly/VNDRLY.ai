import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import cookieParser from "cookie-parser";
import http from "node:http";
import pg from "pg";
import { buildTestCookie } from "../test-utils/session";

// ---------------------------------------------------------------------------
// Task #664: end-to-end coverage for the disconnect → missed event →
// reconnect → gap-flagged hello recovery contract on the live-locations SSE
// channel (`GET /api/live-locations/events`). Mirrors the pattern locked
// down for tickets in Task #662 (see tickets-events-sse.test.ts).
//
// The live-locations SSE bus has three moving parts that locations-sse.test.ts
// only verifies with @workspace/db mocked, which means it can never catch a
// regression in the end-to-end seq accounting that ties the SSE handler to
// the real pg LISTEN/NOTIFY bus:
//
//   1. `publishLocationEvent()` allocates a global seq from the
//      `live_location_events_seq` pg sequence and `NOTIFY`s a JSON payload
//      on the `live_location_events` channel.
//   2. The module-level pg LISTEN client receives that NOTIFY and re-emits
//      it on the in-process EventEmitter.
//   3. The `/api/live-locations/events` SSE handler subscribes to that
//      EventEmitter, writes role-scoped events with `id: <seq>` lines, and
//      on connect sends a `location.hello` envelope whose `gap` flag
//      indicates whether the reconnecting client has missed any events
//      since its `Last-Event-ID`.
//
// A regression in (1)-(3) silently breaks dispatcher refresh of stale GPS
// state on reconnect — exactly the thing the `gap: true` signal exists to
// prevent — without any of the existing unit-suite assertions failing.
//
// This file boots the real bus against a real Postgres so the production
// publish path is exercised here. It does NOT use vi.mock at all;
// locations.ts, location-events.ts and @workspace/db all resolve to their
// real implementations.
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

function adminCookie(): string {
  // Admin without a vendor/site filter sees any event with an active
  // lifecycleState (see visible() in routes/locations.ts), so synthetic
  // employee ids work even though no matching field_employees row exists.
  return buildTestCookie({
    userId: 10,
    role: "admin",
    vendorId: null,
    partnerId: null,
  });
}

function makeSyntheticPing(employeeId: number) {
  return {
    type: "location.ping" as const,
    location: {
      employeeId,
      employeeName: `Probe ${employeeId}`,
      ticketId: -1 * Math.abs(employeeId),
      vendorId: null,
      // Active lifecycle so the SSE visible() check accepts the event for
      // an admin subscriber with no vendor / site filter.
      lifecycleState: "en_route",
      siteLocationId: null,
      sitePartnerId: null,
      siteName: null,
      siteCode: null,
      siteLatitude: null,
      siteLongitude: null,
      latitude: 0,
      longitude: 0,
      batteryLevel: null,
      heading: null,
      speedMps: null,
      recordedAt: new Date().toISOString(),
    },
  };
}

// ── Fetch-based SSE client helper. Lifted from tickets-events-sse.test.ts
//    so the channels test the gap-detection flow the same way. ────────────
function openRealSseClient(
  baseUrl: string,
  path: string,
  cookie: string,
  opts: { lastEventId?: string | number } = {},
) {
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
    try {
      parsed = JSON.parse(data);
    } catch {
      parsed = data;
    }
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
    const headers: Record<string, string> = { cookie };
    if (opts.lastEventId !== undefined) {
      headers["Last-Event-ID"] = String(opts.lastEventId);
    }
    const res = await fetch(`${baseUrl}${path}`, { headers, signal: ac.signal });
    if (res.status !== 200) throw new Error(`SSE open failed: ${res.status}`);
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
    // Wait for the one-shot location.hello so we know the subscription is
    // wired up on the server side before triggering subsequent publishes.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error("SSE never emitted location.hello")),
        5_000,
      );
      const check = () => {
        if (events.some((e) => e.event === "location.hello")) {
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
      pred: (e: { event: string; data: any }) => boolean,
      timeoutMs = 5_000,
    ) =>
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

// Wait for the LISTEN client to be wired up by publishing a probe event and
// waiting for it to round-trip through Postgres NOTIFY → LISTEN → local
// EventEmitter. Mirrors the visit-events.test.ts probe loop so the test
// never races the bus boot.
async function waitForLocationListenerReady(
  locationEvents: typeof import("../lib/location-events"),
  timeoutMs = 15_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const probeEmpId = -1 * Math.floor(Math.random() * 1_000_000_000);
    const seen = new Promise<boolean>((resolve) => {
      const t = setTimeout(() => {
        unsub();
        resolve(false);
      }, 500);
      const unsub = locationEvents.subscribeLocationEvents((ev) => {
        if (
          ev.type === "location.ping" &&
          ev.location.employeeId === probeEmpId
        ) {
          clearTimeout(t);
          unsub();
          resolve(true);
        }
      });
    });
    locationEvents.publishLocationEvent(makeSyntheticPing(probeEmpId));
    if (await seen) return;
  }
  throw new Error("live_location_events listener did not become ready in time");
}

describe.runIf(haveRealDb)(
  "/api/live-locations/events end-to-end (real DB gap detection)",
  () => {
    let realServer: http.Server;
    let realBaseUrl = "";
    let locationEvents: typeof import("../lib/location-events");

    beforeAll(async () => {
      locationEvents = await import("../lib/location-events");
      const locationsRouter = (await import("./locations")).default;
      const realApp = express();
      realApp.use(cookieParser());
      realApp.use(express.json());
      realApp.use("/api", locationsRouter);
      attachTestErrorMiddleware(realApp);

      realServer = http.createServer(realApp);
      await new Promise<void>((resolve) =>
        realServer.listen(0, "127.0.0.1", resolve),
      );
      const addr = realServer.address();
      if (!addr || typeof addr === "string") throw new Error("expected AddressInfo");
      realBaseUrl = `http://127.0.0.1:${addr.port}`;

      locationEvents.startLocationEventBus();
      await waitForLocationListenerReady(locationEvents);
    }, 60_000);

    afterAll(async () => {
      try {
        if (realServer) {
          await new Promise<void>((resolve) => realServer.close(() => resolve()));
        }
      } finally {
        if (locationEvents) await locationEvents.stopLocationEventBus();
      }
    });

    it(
      "location.hello reports gap:true when a reconnect's Last-Event-ID lags the global seq",
      async () => {
        // Synthetic employee ids — negative so they can't collide with real
        // rows. Admin without a vendor/site filter sees any event with an
        // active lifecycleState (see visible() in routes/locations.ts), so
        // the rows don't need to exist for the visibility check to pass.
        const firstEmpId =
          -1 * (1_000_000_000 + Math.floor(Math.random() * 1_000_000));
        const missedEmpId = firstEmpId - 1;

        // Step 1: connect; wait for the initial location.hello (no
        // Last-Event-ID sent, so gap should be false).
        const firstClient = openRealSseClient(
          realBaseUrl,
          "/api/live-locations/events",
          adminCookie(),
        );
        let capturedSeq: number;
        try {
          await firstClient.ready;
          const initialHello = firstClient.events.find(
            (e) => e.event === "location.hello",
          );
          expect(initialHello).toBeTruthy();
          expect(initialHello!.data.gap).toBe(false);
          expect(initialHello!.data.lastSeenSeq).toBeNull();

          // Step 2: publish a location.ping and capture its `seq` from the
          // delivered payload (the SSE handler also writes `id: <seq>`,
          // which mirrors what an EventSource's Last-Event-ID will carry on
          // reconnect — see locations.ts).
          locationEvents.publishLocationEvent(makeSyntheticPing(firstEmpId));
          const firstEvent = await firstClient.waitFor(
            (e) =>
              e.event === "location.ping" &&
              e.data?.location?.employeeId === firstEmpId,
          );
          expect(typeof firstEvent.data.seq).toBe("number");
          capturedSeq = firstEvent.data.seq;
        } finally {
          // Step 3: disconnect before publishing the missed event so the
          // second event is genuinely missed by this connection.
          firstClient.close();
        }

        // Step 4: publish while disconnected. Piggy-back on a fresh local
        // subscription to deterministically wait until the NOTIFY
        // round-trips back through the LISTEN client, otherwise we'd race
        // the bus and possibly reconnect before the seq has actually
        // advanced.
        const missedDelivered = new Promise<number>((resolve, reject) => {
          const t = setTimeout(() => {
            unsub();
            reject(new Error("missed-event publish never round-tripped"));
          }, 5_000);
          const unsub = locationEvents.subscribeLocationEvents((ev) => {
            if (
              ev.type === "location.ping" &&
              ev.location.employeeId === missedEmpId
            ) {
              clearTimeout(t);
              unsub();
              resolve(ev.seq);
            }
          });
        });
        locationEvents.publishLocationEvent(makeSyntheticPing(missedEmpId));
        const missedSeq = await missedDelivered;
        // Sanity: the missed event must have a strictly greater seq than
        // the one our (now-disconnected) client last saw, otherwise the
        // gap detection we're about to assert would be vacuous.
        expect(missedSeq).toBeGreaterThan(capturedSeq);

        // Step 5: reconnect with Last-Event-ID set to the seq we captured
        // pre-disconnect. This is the exact header EventSource sends on
        // auto-reconnect after the client wrote `id:` lines, so this
        // matches production behavior.
        const reconnectClient = openRealSseClient(
          realBaseUrl,
          "/api/live-locations/events",
          adminCookie(),
          { lastEventId: capturedSeq },
        );
        try {
          await reconnectClient.ready;

          // Step 6: assert location.hello reflects the gap.
          const hello = reconnectClient.events.find(
            (e) => e.event === "location.hello",
          );
          expect(hello).toBeTruthy();
          expect(hello!.data).toMatchObject({
            type: "location.hello",
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
  },
);

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import cookieParser from "cookie-parser";
import http from "node:http";
import pg from "pg";
import { buildTestCookie } from "../test-utils/session";

// ---------------------------------------------------------------------------
// Task #664: end-to-end coverage for the disconnect → missed event →
// reconnect → gap-flagged hello recovery contract on the visits SSE channel
// (`GET /api/visits/events`). Mirrors the pattern locked down for tickets in
// Task #662 (see tickets-events-sse.test.ts).
//
// The visits SSE bus has three moving parts that visits-sse.test.ts verifies
// only with the visit-events module mocked, which means it can never catch a
// regression in the end-to-end seq accounting that ties the SSE handler to
// the real pg LISTEN/NOTIFY bus:
//
//   1. `publishVisitEvent()` allocates a global seq from the
//      `visit_events_seq` pg sequence and `NOTIFY`s a JSON payload on the
//      `visit_events` channel.
//   2. The module-level pg LISTEN client receives that NOTIFY and re-emits
//      it on the in-process EventEmitter.
//   3. The `/api/visits/events` SSE handler subscribes to that EventEmitter,
//      writes role-scoped events with `id: <seq>` lines, and on connect
//      sends a `visit.hello` envelope whose `gap` flag indicates whether the
//      reconnecting client has missed any events since its `Last-Event-ID`.
//
// A regression in (1)-(3) silently breaks dispatcher refresh of stale visit
// state on reconnect — exactly the thing the `gap: true` signal exists to
// prevent — without any of the existing unit-suite assertions failing.
//
// This file boots the real bus against a real Postgres so the production
// publish path is exercised here. It does NOT use vi.mock at all; visits.ts,
// visit-events.ts and @workspace/db all resolve to their real
// implementations.
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

function staffCookie(): string {
  // Admin sees all visit events regardless of host scoping (visible() in
  // routes/visits.ts returns true for admin), so synthetic visit ids work
  // even though no matching site_visits row exists.
  return buildTestCookie({
    userId: 10,
    role: "admin",
    vendorId: null,
    partnerId: null,
  });
}

// ── Fetch-based SSE client helper. Lifted from tickets-events-sse.test.ts
//    so the two channels test the gap-detection flow the same way. ─────────
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
    // Wait for the one-shot visit.hello so we know the subscription is wired
    // up on the server side before triggering subsequent publishes.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error("SSE never emitted visit.hello")),
        5_000,
      );
      const check = () => {
        if (events.some((e) => e.event === "visit.hello")) {
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
async function waitForVisitListenerReady(
  visitEvents: typeof import("../lib/visit-events"),
  timeoutMs = 15_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const probeId = -1 * Math.floor(Math.random() * 1_000_000_000);
    const seen = new Promise<boolean>((resolve) => {
      const t = setTimeout(() => {
        unsub();
        resolve(false);
      }, 500);
      const unsub = visitEvents.subscribeVisitEvents((ev) => {
        if (ev.type === "visit.checked_out" && ev.visitId === probeId) {
          clearTimeout(t);
          unsub();
          resolve(true);
        }
      });
    });
    visitEvents.publishVisitEvent({
      type: "visit.checked_out",
      visitId: probeId,
      siteLocationId: -1,
      sitePartnerId: null,
      hostVendorId: null,
      checkOutTime: new Date().toISOString(),
      autoCheckedOut: false,
    });
    if (await seen) return;
  }
  throw new Error("visit_events listener did not become ready in time");
}

describe.runIf(haveRealDb)(
  "/api/visits/events end-to-end (real DB gap detection)",
  () => {
    let realServer: http.Server;
    let realBaseUrl = "";
    let visitEvents: typeof import("../lib/visit-events");

    beforeAll(async () => {
      visitEvents = await import("../lib/visit-events");
      const visitsRouter = (await import("./visits")).default;
      const realApp = express();
      realApp.use(cookieParser());
      realApp.use(express.json());
      realApp.use("/api", visitsRouter);
      attachTestErrorMiddleware(realApp);

      realServer = http.createServer(realApp);
      await new Promise<void>((resolve) =>
        realServer.listen(0, "127.0.0.1", resolve),
      );
      const addr = realServer.address();
      if (!addr || typeof addr === "string") throw new Error("expected AddressInfo");
      realBaseUrl = `http://127.0.0.1:${addr.port}`;

      visitEvents.startVisitEventBus();
      await waitForVisitListenerReady(visitEvents);
    }, 60_000);

    afterAll(async () => {
      try {
        if (realServer) {
          await new Promise<void>((resolve) => realServer.close(() => resolve()));
        }
      } finally {
        if (visitEvents) await visitEvents.stopVisitEventBus();
      }
    });

    it(
      "visit.hello reports gap:true when a reconnect's Last-Event-ID lags the global seq",
      async () => {
        // Synthetic visit ids — negative so they can't collide with real
        // rows. Admin sees all visit events regardless of host scoping
        // (visible() in routes/visits.ts returns true for admin), so the
        // rows don't need to exist in site_visits for the SSE visibility
        // check to pass.
        const firstVisitId =
          -1 * (1_000_000_000 + Math.floor(Math.random() * 1_000_000));
        const missedVisitId = firstVisitId - 1;

        // Step 1: connect; wait for the initial visit.hello (no
        // Last-Event-ID sent, so gap should be false).
        const firstClient = openRealSseClient(
          realBaseUrl,
          "/api/visits/events",
          staffCookie(),
        );
        let capturedSeq: number;
        try {
          await firstClient.ready;
          const initialHello = firstClient.events.find(
            (e) => e.event === "visit.hello",
          );
          expect(initialHello).toBeTruthy();
          expect(initialHello!.data.gap).toBe(false);
          expect(initialHello!.data.lastSeenSeq).toBeNull();

          // Step 2: publish a visit event and capture its `seq` from the
          // delivered payload (the SSE handler also writes `id: <seq>`,
          // which mirrors what an EventSource's Last-Event-ID will carry on
          // reconnect — see visits.ts).
          visitEvents.publishVisitEvent({
            type: "visit.checked_out",
            visitId: firstVisitId,
            siteLocationId: -1,
            sitePartnerId: null,
            hostVendorId: null,
            checkOutTime: new Date().toISOString(),
            autoCheckedOut: false,
          });
          const firstEvent = await firstClient.waitFor(
            (e) =>
              e.event === "visit.checked_out" &&
              e.data?.visitId === firstVisitId,
          );
          expect(typeof firstEvent.data.seq).toBe("number");
          capturedSeq = firstEvent.data.seq;
        } finally {
          // Step 3: disconnect before the next publish so the second event
          // is genuinely missed by this connection.
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
          const unsub = visitEvents.subscribeVisitEvents((ev) => {
            if (
              ev.type === "visit.checked_out" &&
              ev.visitId === missedVisitId
            ) {
              clearTimeout(t);
              unsub();
              resolve(ev.seq);
            }
          });
        });
        visitEvents.publishVisitEvent({
          type: "visit.checked_out",
          visitId: missedVisitId,
          siteLocationId: -1,
          sitePartnerId: null,
          hostVendorId: null,
          checkOutTime: new Date().toISOString(),
          autoCheckedOut: false,
        });
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
          "/api/visits/events",
          staffCookie(),
          { lastEventId: capturedSeq },
        );
        try {
          await reconnectClient.ready;

          // Step 6: assert visit.hello reflects the gap.
          const hello = reconnectClient.events.find(
            (e) => e.event === "visit.hello",
          );
          expect(hello).toBeTruthy();
          expect(hello!.data).toMatchObject({
            type: "visit.hello",
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

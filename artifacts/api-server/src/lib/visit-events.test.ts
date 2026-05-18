import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";

// ---------------------------------------------------------------------------
// Cross-instance live Crew Map updates regression test.
//
// The visit_events bus is backed by Postgres LISTEN/NOTIFY so that an event
// published on one API process is delivered to SSE clients connected to any
// other process sharing the same database. This test simulates two processes
// inside one vitest run by importing the visit-events module twice with
// vi.resetModules() between imports, so each copy has its own module-level
// listener client and local EventEmitter (i.e. independent in-process state,
// just like two real server instances would have).
//
// Both copies talk to the same DATABASE_URL. The test publishes an event from
// "instance A" and asserts the SSE-side subscriber on "instance B" receives
// it within a short timeout. If the bus ever silently regressed to a single
// in-process EventEmitter, instance B would never see the event and this
// test would fail.
// ---------------------------------------------------------------------------

type VisitEventsModule = typeof import("./visit-events");

const DATABASE_URL = process.env.DATABASE_URL;
const haveRealDb = await checkDatabase();

async function checkDatabase(): Promise<boolean> {
  if (!DATABASE_URL) return false;
  // Ignore the placeholder URL the test setup writes when no DB is available.
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

async function loadFreshModule(): Promise<VisitEventsModule> {
  vi.resetModules();
  return (await import("./visit-events")) as VisitEventsModule;
}

async function waitForBothListenersReady(
  a: VisitEventsModule,
  b: VisitEventsModule,
  timeoutMs = 10_000,
): Promise<void> {
  // Both listeners LISTEN asynchronously after startVisitEventBus() returns.
  // Rather than sleeping a fixed amount, poll by sending a probe event from
  // each instance and waiting until both subscribers observe it. This keeps
  // the test deterministic on slow CI runners.
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const probeId = -1 * Math.floor(Math.random() * 1_000_000_000);
    const seenOnA = new Promise<boolean>((resolve) => {
      const t = setTimeout(() => {
        unsub();
        resolve(false);
      }, 500);
      const unsub = a.subscribeVisitEvents((ev) => {
        if (ev.type === "visit.checked_out" && ev.visitId === probeId) {
          clearTimeout(t);
          unsub();
          resolve(true);
        }
      });
    });
    const seenOnB = new Promise<boolean>((resolve) => {
      const t = setTimeout(() => {
        unsub();
        resolve(false);
      }, 500);
      const unsub = b.subscribeVisitEvents((ev) => {
        if (ev.type === "visit.checked_out" && ev.visitId === probeId) {
          clearTimeout(t);
          unsub();
          resolve(true);
        }
      });
    });
    a.publishVisitEvent({
      type: "visit.checked_out",
      visitId: probeId,
      siteLocationId: 0,
      sitePartnerId: null,
      hostVendorId: null,
      checkOutTime: new Date().toISOString(),
      autoCheckedOut: false,
    });
    const [okA, okB] = await Promise.all([seenOnA, seenOnB]);
    if (okA && okB) return;
  }
  throw new Error("visit_events listeners did not become ready in time");
}

describe.runIf(haveRealDb)("visit_events cross-instance delivery", () => {
  let instanceA: VisitEventsModule;
  let instanceB: VisitEventsModule;

  beforeAll(async () => {
    instanceA = await loadFreshModule();
    instanceB = await loadFreshModule();
    instanceA.startVisitEventBus();
    instanceB.startVisitEventBus();
    await waitForBothListenersReady(instanceA, instanceB);
  }, 30_000);

  afterAll(async () => {
    await instanceA?.stopVisitEventBus();
    await instanceB?.stopVisitEventBus();
  });

  it("delivers a visit.checked_in published on instance A to a subscriber on instance B", async () => {
    const marker = `cross-instance-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

    const received = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(
          new Error(
            "Subscriber on instance B did not receive the event from instance A within timeout",
          ),
        );
      }, 5_000);
      const unsubscribe = instanceB.subscribeVisitEvents((ev) => {
        if (ev.type !== "visit.checked_in") return;
        if (ev.visit.company !== marker) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(ev);
      });
    });

    instanceA.publishVisitEvent({
      type: "visit.checked_in",
      visit: {
        id: 999_001,
        firstName: "Cross",
        lastName: "Instance",
        company: marker,
        purpose: "regression",
        hostType: "partner",
        hostPartnerId: 1,
        hostVendorId: null,
        hostPartnerName: "Acme Partner",
        hostVendorName: null,
        siteLocationId: 10,
        sitePartnerId: 1,
        siteName: "Site A",
        checkInTime: new Date().toISOString(),
        checkInLatitude: 40.0,
        checkInLongitude: -74.0,
      },
    });

    const ev = await received;
    expect(ev).toMatchObject({
      type: "visit.checked_in",
      visit: { company: marker, firstName: "Cross", lastName: "Instance" },
    });
  }, 10_000);

  it("delivers a visit.checked_out published on instance B to a subscriber on instance A", async () => {
    const visitId = 990_000 + Math.floor(Math.random() * 9999);

    const received = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(
          new Error(
            "Subscriber on instance A did not receive the event from instance B within timeout",
          ),
        );
      }, 5_000);
      const unsubscribe = instanceA.subscribeVisitEvents((ev) => {
        if (ev.type !== "visit.checked_out") return;
        if (ev.visitId !== visitId) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(ev);
      });
    });

    instanceB.publishVisitEvent({
      type: "visit.checked_out",
      visitId,
      siteLocationId: 10,
      sitePartnerId: 1,
      hostVendorId: null,
      checkOutTime: new Date().toISOString(),
      autoCheckedOut: false,
    });

    const ev = await received;
    expect(ev).toMatchObject({
      type: "visit.checked_out",
      visitId,
      autoCheckedOut: false,
    });
  }, 10_000);
});

describe.skipIf(haveRealDb)("visit_events cross-instance delivery", () => {
  it.skip("requires a real Postgres DATABASE_URL", () => {
    // Skipped when DATABASE_URL is unset or points at the placeholder used by
    // the unit-test setup; the test needs a reachable Postgres to exercise
    // LISTEN/NOTIFY end-to-end.
  });
});

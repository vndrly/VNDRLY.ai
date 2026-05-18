import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";

// ---------------------------------------------------------------------------
// Cross-instance live Crew Map location-ping regression test.
//
// The live_location_events bus is backed by Postgres LISTEN/NOTIFY (mirroring
// visit-events.ts) so a `location.ping` published on one API process is
// delivered to Crew Map SSE clients connected to any other process sharing
// the same database. This test simulates two processes inside one vitest run
// by importing the location-events module twice with vi.resetModules()
// between imports, so each copy has its own module-level listener client and
// local EventEmitter — the same independent state two real server instances
// would have.
//
// Both copies talk to the same DATABASE_URL. The test publishes a ping from
// "instance A" and asserts the SSE-side subscriber on "instance B" receives
// it within a short timeout (and vice versa). If the bus ever silently
// regressed to a single in-process EventEmitter, instance B would never see
// the event, the Crew Map gap warning would still appear to "work" on a
// single dev process, and this test would fail.
// ---------------------------------------------------------------------------

type LocationEventsModule = typeof import("./location-events");

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

async function loadFreshModule(): Promise<LocationEventsModule> {
  vi.resetModules();
  return (await import("./location-events")) as LocationEventsModule;
}

function makeProbePing(employeeId: number): Parameters<
  LocationEventsModule["publishLocationEvent"]
>[0] {
  return {
    type: "location.ping",
    location: {
      employeeId,
      employeeName: "Probe",
      ticketId: 0,
      vendorId: null,
      lifecycleState: null,
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

async function waitForBothListenersReady(
  a: LocationEventsModule,
  b: LocationEventsModule,
  timeoutMs = 10_000,
): Promise<void> {
  // Both listeners LISTEN asynchronously after startLocationEventBus() returns.
  // Rather than sleeping a fixed amount, poll by sending a probe ping from
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
      const unsub = a.subscribeLocationEvents((ev) => {
        if (ev.type === "location.ping" && ev.location.employeeId === probeId) {
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
      const unsub = b.subscribeLocationEvents((ev) => {
        if (ev.type === "location.ping" && ev.location.employeeId === probeId) {
          clearTimeout(t);
          unsub();
          resolve(true);
        }
      });
    });
    a.publishLocationEvent(makeProbePing(probeId));
    const [okA, okB] = await Promise.all([seenOnA, seenOnB]);
    if (okA && okB) return;
  }
  throw new Error("live_location_events listeners did not become ready in time");
}

describe.runIf(haveRealDb)("live_location_events cross-instance delivery", () => {
  let instanceA: LocationEventsModule;
  let instanceB: LocationEventsModule;

  beforeAll(async () => {
    instanceA = await loadFreshModule();
    instanceB = await loadFreshModule();
    instanceA.startLocationEventBus();
    instanceB.startLocationEventBus();
    await waitForBothListenersReady(instanceA, instanceB);
  }, 30_000);

  afterAll(async () => {
    await instanceA?.stopLocationEventBus();
    await instanceB?.stopLocationEventBus();
  });

  it("delivers a location.ping published on instance A to a subscriber on instance B", async () => {
    const employeeId = 990_000 + Math.floor(Math.random() * 9999);
    const marker = `cross-instance-A-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

    const received = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(
          new Error(
            "Subscriber on instance B did not receive the location.ping from instance A within timeout",
          ),
        );
      }, 5_000);
      const unsubscribe = instanceB.subscribeLocationEvents((ev) => {
        if (ev.type !== "location.ping") return;
        if (ev.location.employeeId !== employeeId) return;
        if (ev.location.employeeName !== marker) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(ev);
      });
    });

    instanceA.publishLocationEvent({
      type: "location.ping",
      location: {
        employeeId,
        employeeName: marker,
        ticketId: 12345,
        vendorId: 7,
        lifecycleState: "en_route",
        siteLocationId: 10,
        sitePartnerId: 1,
        siteName: "Site A",
        siteCode: "SA",
        siteLatitude: 40.0,
        siteLongitude: -74.0,
        latitude: 40.5,
        longitude: -74.5,
        batteryLevel: 0.8,
        heading: 90,
        speedMps: 12.3,
        recordedAt: new Date().toISOString(),
      },
    });

    const ev = await received;
    expect(ev).toMatchObject({
      type: "location.ping",
      location: {
        employeeId,
        employeeName: marker,
        ticketId: 12345,
        lifecycleState: "en_route",
      },
    });
  }, 10_000);

  it("delivers a location.ping published on instance B to a subscriber on instance A", async () => {
    const employeeId = 980_000 + Math.floor(Math.random() * 9999);
    const marker = `cross-instance-B-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

    const received = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(
          new Error(
            "Subscriber on instance A did not receive the location.ping from instance B within timeout",
          ),
        );
      }, 5_000);
      const unsubscribe = instanceA.subscribeLocationEvents((ev) => {
        if (ev.type !== "location.ping") return;
        if (ev.location.employeeId !== employeeId) return;
        if (ev.location.employeeName !== marker) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(ev);
      });
    });

    instanceB.publishLocationEvent({
      type: "location.ping",
      location: {
        employeeId,
        employeeName: marker,
        ticketId: 67890,
        vendorId: 3,
        lifecycleState: "on_site",
        siteLocationId: 20,
        sitePartnerId: 2,
        siteName: "Site B",
        siteCode: "SB",
        siteLatitude: 41.0,
        siteLongitude: -75.0,
        latitude: 41.5,
        longitude: -75.5,
        batteryLevel: 0.5,
        heading: null,
        speedMps: null,
        recordedAt: new Date().toISOString(),
      },
    });

    const ev = await received;
    expect(ev).toMatchObject({
      type: "location.ping",
      location: {
        employeeId,
        employeeName: marker,
        ticketId: 67890,
        lifecycleState: "on_site",
      },
    });
  }, 10_000);
});

describe.skipIf(haveRealDb)("live_location_events cross-instance delivery", () => {
  it.skip("requires a real Postgres DATABASE_URL", () => {
    // Skipped when DATABASE_URL is unset or points at the placeholder used by
    // the unit-test setup; the test needs a reachable Postgres to exercise
    // LISTEN/NOTIFY end-to-end.
  });
});

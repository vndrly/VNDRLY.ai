import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Tests for live_location_events sequence allocation in publishLocationEvent.
//
// The server allocates a global seq from a Postgres sequence
// (`live_location_events_seq`) for every published location ping and
// includes it in both the NOTIFY payload and the in-process EventEmitter.
// Web clients use this seq via SSE Last-Event-ID to detect dropped pings
// across reconnects — see the SSE handler in routes/locations.ts and the
// Crew Map gap warning in the web app.
//
// Mirrors visit-events-seq.test.ts. We mock @workspace/db so the test
// runs without a real Postgres dependency. The fake pool returns
// monotonically increasing nextval results and captures the JSON payloads
// passed to NOTIFY, so we can assert that:
//   1. each publish allocates a strictly increasing seq,
//   2. the seq round-trips into the NOTIFY payload, and
//   3. getCurrentLocationEventSeq() reports the most recently allocated seq.
// ---------------------------------------------------------------------------

let nextvalCounter = 0;
const notifyPayloads: string[] = [];

vi.mock("@workspace/db", () => {
  const pool = {
    query: async (sqlText: string) => {
      if (typeof sqlText !== "string") return { rows: [] };
      if (sqlText.includes("CREATE SEQUENCE")) return { rows: [] };
      if (sqlText.includes("nextval")) {
        nextvalCounter += 1;
        return { rows: [{ seq: String(nextvalCounter) }] };
      }
      if (sqlText.includes("last_value")) {
        return {
          rows: [
            {
              seq: String(nextvalCounter),
              called: nextvalCounter > 0,
            },
          ],
        };
      }
      if (sqlText.startsWith("NOTIFY")) {
        const m = sqlText.match(/^NOTIFY \w+, '([\s\S]*)'$/);
        if (m) {
          const payload = m[1].replace(/''/g, "'");
          notifyPayloads.push(payload);
        }
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  return { pool };
});

async function waitFor(
  cond: () => boolean,
  timeoutMs = 2000,
  intervalMs = 5,
): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  if (!cond()) throw new Error("waitFor: condition not met within timeout");
}

function makePing(employeeId: number) {
  return {
    type: "location.ping" as const,
    location: {
      employeeId,
      employeeName: `Employee ${employeeId}`,
      ticketId: 1000 + employeeId,
      vendorId: null,
      lifecycleState: "on_site",
      siteLocationId: null,
      sitePartnerId: null,
      siteName: null,
      siteCode: null,
      siteLatitude: null,
      siteLongitude: null,
      latitude: 40,
      longitude: -74,
      batteryLevel: null,
      heading: null,
      speedMps: null,
      recordedAt: new Date().toISOString(),
    },
  };
}

describe("live_location_events sequence allocation", () => {
  let mod: typeof import("./location-events");

  beforeEach(async () => {
    nextvalCounter = 0;
    notifyPayloads.length = 0;
    vi.resetModules();
    // Empty DATABASE_URL prevents the LISTEN client from attempting to
    // connect to a real Postgres during these unit tests; publishes still
    // go through ensureSequence + publishViaPool, which we mock above.
    process.env.DATABASE_URL = "";
    mod = (await import("./location-events")) as typeof import("./location-events");
  });

  afterEach(async () => {
    await mod.stopLocationEventBus();
  });

  it("allocates a strictly increasing seq for each published event", async () => {
    for (let i = 0; i < 5; i++) {
      mod.publishLocationEvent(makePing(i + 1));
      // Yield to the microtask queue so each publish's async chain starts
      // before the next call. publishLocationEvent fires its background
      // promise without a return value; without yielding here a tight
      // synchronous loop on some Node versions doesn't interleave the
      // awaits as expected, leaving later publishes stalled in the queue.
      await new Promise((r) => setTimeout(r, 0));
    }
    await waitFor(() => notifyPayloads.length === 5);
    const seqs = notifyPayloads.map(
      (p) => (JSON.parse(p) as { seq: number }).seq,
    );
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
    // Each NOTIFY payload must round-trip the original event fields too.
    const first = JSON.parse(notifyPayloads[0]) as {
      type: string;
      seq: number;
      location: { employeeId: number; ticketId: number };
    };
    expect(first.type).toBe("location.ping");
    expect(first.location.employeeId).toBe(1);
    expect(first.location.ticketId).toBe(1001);
  });

  it("getCurrentLocationEventSeq() reflects the most recently allocated seq", async () => {
    expect(await mod.getCurrentLocationEventSeq()).toBe(0);
    mod.publishLocationEvent(makePing(1));
    await waitFor(() => notifyPayloads.length === 1);
    expect(await mod.getCurrentLocationEventSeq()).toBe(1);
    mod.publishLocationEvent(makePing(2));
    await waitFor(() => notifyPayloads.length === 2);
    expect(await mod.getCurrentLocationEventSeq()).toBe(2);
  });
});

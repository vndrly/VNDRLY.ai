import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Tests for visit_events sequence allocation in publishVisitEvent.
//
// The server allocates a global seq from a Postgres sequence (visit_events_seq)
// for every published visit event and includes it in both the NOTIFY payload
// and the in-process EventEmitter. Clients use this seq via SSE Last-Event-ID
// to detect dropped events on reconnect — see the SSE handler in
// routes/visits.ts and the Crew Map gap warning in the web app.
//
// We mock @workspace/db so the test runs with no real Postgres dependency.
// The fake pool returns monotonically increasing nextval results and captures
// the JSON payloads passed to NOTIFY, so we can assert that:
//   1. each publish allocates a strictly increasing seq, and
//   2. getCurrentVisitEventSeq() reports the most recently allocated seq.
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

describe("visit_events sequence allocation", () => {
  let mod: typeof import("./visit-events");

  beforeEach(async () => {
    nextvalCounter = 0;
    notifyPayloads.length = 0;
    vi.resetModules();
    // Empty DATABASE_URL prevents the LISTEN client from attempting to
    // connect to a real Postgres during these unit tests; publishes still go
    // through ensureSequence + publishViaPool, which we mock above.
    process.env.DATABASE_URL = "";
    mod = (await import("./visit-events")) as typeof import("./visit-events");
  });

  afterEach(async () => {
    await mod.stopVisitEventBus();
  });

  it("allocates a strictly increasing seq for each published event", async () => {
    for (let i = 0; i < 5; i++) {
      mod.publishVisitEvent({
        type: "visit.checked_out",
        visitId: 1000 + i,
        siteLocationId: 1,
        sitePartnerId: null,
        hostVendorId: null,
        checkOutTime: new Date().toISOString(),
        autoCheckedOut: false,
      });
      // Yield to the microtask queue so each publish's async chain starts
      // before the next call. The publishVisitEvent function fires its
      // background promise without a return value; without yielding here a
      // tight synchronous loop on some Node versions doesn't interleave the
      // awaits as expected, leaving later publishes stalled in the queue.
      await new Promise((r) => setTimeout(r, 0));
    }
    await waitFor(() => notifyPayloads.length === 5);
    const seqs = notifyPayloads.map((p) => (JSON.parse(p) as { seq: number }).seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
    // Each NOTIFY payload must round-trip the original event fields too.
    const first = JSON.parse(notifyPayloads[0]) as {
      type: string;
      visitId: number;
      seq: number;
    };
    expect(first.type).toBe("visit.checked_out");
    expect(first.visitId).toBe(1000);
  });

  it("attaches a numeric seq to visit.checked_in events", async () => {
    mod.publishVisitEvent({
      type: "visit.checked_in",
      visit: {
        id: 42,
        firstName: "Test",
        lastName: "Visitor",
        company: null,
        purpose: null,
        hostType: "partner",
        hostPartnerId: 1,
        hostVendorId: null,
        hostPartnerName: "Acme",
        hostVendorName: null,
        siteLocationId: 10,
        sitePartnerId: 1,
        siteName: "Site A",
        checkInTime: new Date().toISOString(),
        checkInLatitude: 40,
        checkInLongitude: -74,
      },
    });
    await waitFor(() => notifyPayloads.length === 1);
    const ev = JSON.parse(notifyPayloads[0]) as {
      type: string;
      seq: number;
      visit: { id: number };
    };
    expect(ev.type).toBe("visit.checked_in");
    expect(ev.seq).toBe(1);
    expect(ev.visit.id).toBe(42);
  });

  it("getCurrentVisitEventSeq() reflects the most recently allocated seq", async () => {
    expect(await mod.getCurrentVisitEventSeq()).toBe(0);
    mod.publishVisitEvent({
      type: "visit.checked_out",
      visitId: 1,
      siteLocationId: 1,
      sitePartnerId: null,
      hostVendorId: null,
      checkOutTime: new Date().toISOString(),
      autoCheckedOut: false,
    });
    await waitFor(() => notifyPayloads.length === 1);
    expect(await mod.getCurrentVisitEventSeq()).toBe(1);
    mod.publishVisitEvent({
      type: "visit.checked_out",
      visitId: 2,
      siteLocationId: 1,
      sitePartnerId: null,
      hostVendorId: null,
      checkOutTime: new Date().toISOString(),
      autoCheckedOut: false,
    });
    await waitFor(() => notifyPayloads.length === 2);
    expect(await mod.getCurrentVisitEventSeq()).toBe(2);
  });
});

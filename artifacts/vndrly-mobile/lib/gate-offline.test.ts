import { describe, expect, it } from "vitest";
import { offlinePeople, parseOfflineGateSnapshot, type OfflineGateSnapshot } from "./gate-offline";
import type { JournalEntry } from "./native-operation-journal";
const snapshot: OfflineGateSnapshot = { siteId: 1, siteName: "Synthetic site", stationId: "00000000-0000-4000-8000-000000000001", stationName: "Synthetic gate", capturedAt: 1000, visits: [
  { id: 7, siteLocationId: 1, firstName: "Existing", lastName: "Visitor", company: "Synthetic", vehiclePlate: "TEST7", plateState: "TX", checkInTime: "2026-11-15T12:00:00Z" },
] };
const entry: JournalEntry = { operationId: "00000000-0000-4000-8000-000000000002", domain: "gate", capturedAt: "2026-11-15T13:00:00Z", state: "pending", attempts: 0,
  payload: { siteLocationId: 1, direction: "entry", reportedVisitor: { firstName: "Offline", lastName: "Visitor" }, plate: "TEST8" } };
describe("offline gate roster", () => {
  it("includes pre-outage visitors and entries recorded during the outage", () => {
    expect(offlinePeople(snapshot, [entry]).map(p => p.firstName)).toEqual(["Existing", "Offline"]);
  });
  it("removes exact cached and local exits without matching similar names or plates", () => {
    expect(offlinePeople(snapshot, [entry, { ...entry, operationId: "exit1", payload: { direction: "exit", siteLocationId: 1, originalVisitId: 7 } },
      { ...entry, operationId: "exit2", payload: { direction: "exit", siteLocationId: 1, entryOperationId: entry.operationId } }])).toEqual([]);
  });
  it("does not double count an uploaded entry, and keeps its exact exit link", () => {
    const synced = { ...entry, state: "synced" as const, receipt: { id: 7 }, syncedAt: "2026-11-15T14:00:00Z" };
    expect(offlinePeople(snapshot, [synced])).toMatchObject([{ firstName: "Offline", entryOperationId: entry.operationId }]);
  });
  it("does not lose an acknowledged entry because the snapshot predates upload", () => {
    const synced = { ...entry, state: "synced" as const, receipt: { id: 8 }, syncedAt: "2026-11-15T14:00:00Z" };
    expect(offlinePeople({ ...snapshot, capturedAt: Date.parse("2026-11-15T13:30:00Z") }, [synced])).toHaveLength(2);
    expect(offlinePeople({ ...snapshot, complete: true, capturedAt: Date.parse("2026-11-15T14:30:00Z") }, [synced])).toHaveLength(1);
    expect(offlinePeople({ ...snapshot, capturedAt: Date.parse("2026-11-15T14:30:00Z") }, [synced])).toHaveLength(2);
  });
  it("rejects cross-site rows and invalid context from the bridge", () => {
    expect(parseOfflineGateSnapshot(snapshot)).not.toBeNull();
    expect(parseOfflineGateSnapshot({ ...snapshot, visits: [{ ...snapshot.visits[0], siteLocationId: 2 }] })).toBeNull();
    expect(parseOfflineGateSnapshot({ ...snapshot, stationId: "wrong" })).toBeNull();
  });
});

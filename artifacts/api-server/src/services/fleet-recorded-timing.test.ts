import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FleetRunSchema, type FleetRun } from "@workspace/api-zod";
import { summarizeRecordedFleetTiming } from "./fleet-recorded-timing";

function run(events: [string, string][], schedule?: FleetRun["schedule"]) {
  return FleetRunSchema.parse({ id: randomUUID(), companyId: 7, fleetId: randomUUID(), title: "Synthetic timing",
    driverUserId: 2, vehicleAssetId: randomUUID(), trailerAssetId: null, siteIds: [9], status: "completed",
    phase: null, version: 10, stops: [{ id: randomUUID(), siteId: 9, kind: "pickup", sequence: 0 }],
    loads: [], inspections: [], currentStopId: null, visitedStopIds: [], linkedTicketId: null, allowedActions: [], schedule,
    events: events.map(([type, recordedAt]) => ({ id: randomUUID(), operationId: randomUUID(), type,
      recordedAt, actorUserId: 2, capturedAt: "2000-01-01T00:00:00Z", source: "user_report" })),
  });
}
const at = (minute: number) => new Date(Date.UTC(2026, 9, 7, 8, minute)).toISOString();
describe("saved Fleet timing, separate from physical or billable proof", () => {
  it("subtracts repeated pauses using accepted times, ignores supplied capture times, and compares the saved plan", () => {
    const result = summarizeRecordedFleetTiming([run([
      ["start", at(5)], ["pause", at(15)], ["resume", at(25)], ["pause", at(30)], ["resume", at(35)], ["submit_closeout", at(65)],
    ], { plannedStartAt: at(0), plannedEndAt: at(60), timezone: "America/Chicago" })]);
    expect(result).toMatchObject({ eligibleRunCount: 1, elapsedMinutes: 60, pausedMinutes: 15, activeMinutes: 45,
      plannedStartCount: 1, lateStartCount: 1, startOffsetTotalMinutes: 5,
      plannedFinishCount: 1, lateFinishCount: 1, finishOffsetTotalMinutes: 5,
      physicalPresenceVerified: false, contractualTimelinessVerified: false });
  });
  it("does not turn an unfinished or cancelled pre-start run into elapsed work", () => {
    expect(summarizeRecordedFleetTiming([run([["created", at(0)], ["cancel", at(20)]]), run([["start", at(0)], ["pause", at(10)]])]))
      .toMatchObject({ eligibleRunCount: 0, elapsedMinutes: 0, plannedStartCount: 0 });
  });
  it("excludes malformed ordering and unmatched resumes without corrupting the valid cohort", () => {
    const result = summarizeRecordedFleetTiming([
      run([["start", at(10)], ["pause", at(5)], ["submit_closeout", at(20)]]),
      run([["start", at(0)], ["resume", at(10)], ["submit_closeout", at(20)]]),
      run([["start", at(0)], ["pause", at(5)], ["pause", at(10)], ["submit_closeout", at(20)]]),
      run([["start", at(0)], ["submit_closeout", at(20)]]),
    ]);
    expect(result).toMatchObject({ invalidSequenceCount: 3, eligibleRunCount: 1, elapsedMinutes: 20, activeMinutes: 20 });
  });
  it("keeps signed early-plan offsets and does not count them as late", () => {
    const result = summarizeRecordedFleetTiming([run([["start", at(0)], ["submit_closeout", at(30)]],
      { plannedStartAt: at(5), plannedEndAt: at(40), timezone: "UTC" })]);
    expect(result).toMatchObject({ lateStartCount: 0, startOffsetTotalMinutes: -5, lateFinishCount: 0, finishOffsetTotalMinutes: -10 });
  });
  it("bounds an unrestarted final pause to the recorded closeout, without using the current clock", () => {
    expect(summarizeRecordedFleetTiming([run([["start", at(0)], ["pause", at(10)], ["submit_closeout", at(30)]])]))
      .toMatchObject({ elapsedMinutes: 30, pausedMinutes: 20, activeMinutes: 10 });
  });
});

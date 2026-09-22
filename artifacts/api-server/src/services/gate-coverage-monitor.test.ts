import { describe, expect, it, vi } from "vitest";
import {
  evaluateGateCoverage,
  type GateCoverageDependencies,
  type GateCoverageRecord,
} from "./gate-coverage-monitor";

const at = (time: string) => new Date(`2026-09-22T${time}:00.000Z`);

describe("Gate coverage monitoring", () => {
  it("alerts after ten minutes, repeats every ten, and sends restoration", async () => {
    let actualCount = 0;
    let state: GateCoverageRecord | null = null;
    const delivered: Array<{ kind: string; recipients: number[] }> = [];
    const deps: GateCoverageDependencies = {
      loadCandidates: vi.fn(async () => [{
        shiftId: "shift-1",
        stationId: "gate-1",
        stationName: "Main gate",
        title: "Day shift",
        startsAt: at("08:00"),
        endsAt: at("20:00"),
        requiredCount: 1,
        actualCount,
        assignedUserIds: [10],
        recipientUserIds: [10, 20, 30],
        coverageMode: "active" as const,
      }]),
      getRecord: vi.fn(async () => state),
      saveRecord: vi.fn(async (next) => {
        state = {
          shiftId: next.shiftId,
          state: next.state,
          lastReminderAt: next.lastReminderAt,
          requiredCount: next.requiredCount,
          actualCount: next.actualCount,
        };
      }),
      createAttendanceException: vi.fn(async () => undefined),
      deliver: vi.fn(async (notice) => { delivered.push({ kind: notice.kind, recipients: notice.recipientUserIds }); }),
    };

    await evaluateGateCoverage(at("08:09"), deps);
    expect(delivered).toHaveLength(0);
    await evaluateGateCoverage(at("08:10"), deps);
    expect(delivered).toEqual([{ kind: "uncovered", recipients: [10, 20, 30] }]);
    await evaluateGateCoverage(at("08:19"), deps);
    expect(delivered).toHaveLength(1);
    await evaluateGateCoverage(at("08:20"), deps);
    expect(delivered).toHaveLength(2);
    actualCount = 1;
    await evaluateGateCoverage(at("08:21"), deps);
    expect(delivered.at(-1)?.kind).toBe("restored");
  });

  it("reports understaffing separately and suppresses paused gates", async () => {
    const delivered: string[] = [];
    const base = {
      shiftId: "shift-2",
      stationId: "gate-2",
      stationName: "South gate",
      title: "Night shift",
      startsAt: at("08:00"),
      endsAt: at("20:00"),
      requiredCount: 2,
      actualCount: 1,
      assignedUserIds: [10, 11],
      recipientUserIds: [10, 11, 20],
      coverageMode: "active" as const,
    };
    const deps: GateCoverageDependencies = {
      loadCandidates: vi.fn(async () => [base]),
      getRecord: vi.fn(async () => null),
      saveRecord: vi.fn(async () => undefined),
      createAttendanceException: vi.fn(async () => undefined),
      deliver: vi.fn(async (notice) => { delivered.push(notice.kind); }),
    };
    await evaluateGateCoverage(at("08:10"), deps);
    expect(delivered).toEqual(["understaffed"]);
    deps.loadCandidates = vi.fn(async () => [{ ...base, coverageMode: "paused_indefinitely" as const }]);
    await evaluateGateCoverage(at("08:20"), deps);
    expect(delivered).toEqual(["understaffed"]);
  });

  it("reactivates a timed pause and deduplicates concurrent reminder slots", async () => {
    let record: GateCoverageRecord | null = null;
    const delivered: string[] = [];
    const candidate = {
      shiftId: "shift-3",
      stationId: "gate-3",
      stationName: "West gate",
      title: "Day shift",
      startsAt: at("08:00"),
      endsAt: at("20:00"),
      requiredCount: 1,
      actualCount: 0,
      activeUserIds: [],
      assignedUserIds: [12],
      recipientUserIds: [12, 20],
      coverageMode: "paused_until" as const,
      pausedUntil: at("08:15"),
    };
    const deps: GateCoverageDependencies = {
      loadCandidates: vi.fn(async () => [candidate]),
      getRecord: vi.fn(async () => record),
      saveRecord: vi.fn(async (next) => {
        record = {
          shiftId: next.shiftId,
          state: next.state,
          lastReminderAt: next.lastReminderAt,
          requiredCount: next.requiredCount,
          actualCount: next.actualCount,
        };
      }),
      createAttendanceException: vi.fn(async () => undefined),
      deliver: vi.fn(async (notice) => { delivered.push(notice.kind); }),
    };

    await evaluateGateCoverage(at("08:14"), deps);
    expect(delivered).toEqual([]);
    await evaluateGateCoverage(at("08:15"), deps);
    await evaluateGateCoverage(at("08:15"), deps);
    expect(delivered).toEqual(["uncovered"]);
  });

  it("leaves attendance unresolved when another worker restores coverage", async () => {
    let actualCount = 0;
    let record: GateCoverageRecord | null = null;
    const createException = vi.fn(async () => undefined);
    const deps: GateCoverageDependencies = {
      loadCandidates: vi.fn(async () => [{
        shiftId: "shift-4",
        stationId: "gate-4",
        stationName: "North gate",
        title: "Day shift",
        startsAt: at("08:00"),
        endsAt: at("20:00"),
        requiredCount: 1,
        actualCount,
        activeUserIds: actualCount ? [99] : [],
        assignedUserIds: [14],
        recipientUserIds: [14, 20],
        coverageMode: "active" as const,
      }]),
      getRecord: vi.fn(async () => record),
      saveRecord: vi.fn(async (next) => {
        record = {
          shiftId: next.shiftId,
          state: next.state,
          lastReminderAt: next.lastReminderAt,
          requiredCount: next.requiredCount,
          actualCount: next.actualCount,
        };
      }),
      createAttendanceException: createException,
      deliver: vi.fn(async () => undefined),
    };

    await evaluateGateCoverage(at("08:10"), deps);
    actualCount = 1;
    await evaluateGateCoverage(at("08:11"), deps);
    expect(createException).toHaveBeenCalledTimes(1);
  });
});

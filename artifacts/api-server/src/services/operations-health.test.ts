import { describe, expect, it, vi } from "vitest";
import {
  buildOperationsHealth,
  processRecordingRetention,
  type OperationsHealthCounts,
  type RecordingRetentionCandidate,
} from "./operations-health";

const healthyCounts: OperationsHealthCounts = {
  offlineBacklog: 0,
  terminalConflicts: 0,
  permissionDenials: 0,
  staleLocations: 0,
  failedAlerts: 0,
  unhealthyDisplays: 0,
  supervisorExceptions: 0,
  missingSafetyChain: false,
  transcriptionAvailable: true,
};

describe("operations health", () => {
  it("reports a healthy owner when every operating boundary is clear", () => {
    expect(buildOperationsHealth(healthyCounts, new Date("2026-09-14T12:00:00Z"))).toEqual({
      status: "healthy",
      checkedAt: "2026-09-14T12:00:00.000Z",
      signals: healthyCounts,
      attention: [],
    });
  });

  it("names each boundary that needs attention without relying on color", () => {
    const result = buildOperationsHealth({
      ...healthyCounts,
      offlineBacklog: 3,
      terminalConflicts: 1,
      staleLocations: 2,
      supervisorExceptions: 2,
      missingSafetyChain: true,
      transcriptionAvailable: false,
    }, new Date("2026-09-14T12:00:00Z"));
    expect(result.status).toBe("attention_required");
    expect(result.attention).toEqual([
      "offline_backlog",
      "terminal_conflicts",
      "stale_locations",
      "transcription_unavailable",
      "supervisor_exceptions",
      "missing_safety_chain",
    ]);
  });
});

const expired: RecordingRetentionCandidate = {
  retentionId: "retention-1",
  rawMediaExpiresAt: new Date("2026-08-01T00:00:00Z"),
  rawMediaDeletedAt: null,
  activeHoldCount: 0,
  storageKeys: ["/objects/meetings/one/replay/a", "/objects/meetings/one/replay/b"],
};

describe("recording retention", () => {
  it("preserves raw media while a record-specific hold is active", async () => {
    const deleteObject = vi.fn();
    const markDeleted = vi.fn();
    const result = await processRecordingRetention({ ...expired, activeHoldCount: 1 }, {
      now: new Date("2026-09-14T12:00:00Z"), deleteObject, markDeleted,
    });
    expect(result).toMatchObject({ deleted: false, reason: "active_hold", transcriptRetained: true, summaryRetained: true });
    expect(deleteObject).not.toHaveBeenCalled();
    expect(markDeleted).not.toHaveBeenCalled();
  });

  it("keeps raw media until its retention clock expires", async () => {
    const deleteObject = vi.fn();
    const markDeleted = vi.fn();
    const result = await processRecordingRetention({ ...expired, rawMediaExpiresAt: new Date("2026-10-01T00:00:00Z") }, {
      now: new Date("2026-09-14T12:00:00Z"), deleteObject, markDeleted,
    });
    expect(result.reason).toBe("not_expired");
    expect(deleteObject).not.toHaveBeenCalled();
    expect(markDeleted).not.toHaveBeenCalled();
  });

  it("deletes only expired raw media and retains transcript and summary records", async () => {
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    const markDeleted = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-09-14T12:00:00Z");
    const result = await processRecordingRetention(expired, { now, deleteObject, markDeleted });
    expect(deleteObject.mock.calls.map(([key]) => key)).toEqual(expired.storageKeys);
    expect(markDeleted).toHaveBeenCalledWith(expired.retentionId, now);
    expect(result).toEqual({ deleted: true, reason: "expired", deletedObjectCount: 2, transcriptRetained: true, summaryRetained: true });
  });

  it("is idempotent after media has already been deleted", async () => {
    const deleteObject = vi.fn();
    const markDeleted = vi.fn();
    const result = await processRecordingRetention({ ...expired, rawMediaDeletedAt: new Date("2026-09-01T00:00:00Z") }, {
      now: new Date("2026-09-14T12:00:00Z"), deleteObject, markDeleted,
    });
    expect(result.reason).toBe("already_deleted");
    expect(deleteObject).not.toHaveBeenCalled();
  });
});

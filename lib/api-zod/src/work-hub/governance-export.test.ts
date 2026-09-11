import { describe, expect, it } from "vitest";
import {
  RETENTION_CLASSES,
  createOperationalMetric,
  createOperationalMetricEvent,
  operationalMetricReadQuerySchema,
  operationalMetricReadoutSchema,
  exportRequestSchema,
  retentionPlanClassAggregatesSchema,
  retentionPlanErrorCodesSchema,
  retentionRulesSchema,
  serializeCsv,
  serializeExportManifest,
  serializeIcsCalendar,
  validateOrganizationRetentionRules,
} from "./governance-export";

const allRetentionRules = Object.fromEntries(
  RETENTION_CLASSES.map((retentionClass) => [retentionClass, 365]),
);

describe("Work Hub governed export contracts", () => {
  it("accepts a bounded selector-only export request", () => {
    const result = exportRequestSchema.safeParse({
      dataset: "meeting_transcript",
      format: "csv",
      scope: {
        selectors: { meetingOccurrenceIds: ["60fb5c6d-4164-4b3f-baa1-1d7095426633"] },
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-09-10T23:59:59.000Z",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown datasets, formats, reversed dates, storage paths and oversized selector sets", () => {
    const base = {
      dataset: "tasks",
      format: "csv",
      scope: { selectors: { taskIds: ["task-1"] } },
    };
    expect(exportRequestSchema.safeParse({ ...base, dataset: "private_threads" }).success).toBe(false);
    expect(exportRequestSchema.safeParse({ ...base, format: "xlsx" }).success).toBe(false);
    expect(exportRequestSchema.safeParse({ ...base, scope: { ...base.scope, storagePath: "/objects/private" } }).success).toBe(false);
    expect(exportRequestSchema.safeParse({
      ...base,
      scope: { selectors: {}, from: "2026-09-10T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" },
    }).success).toBe(false);
    expect(exportRequestSchema.safeParse({
      ...base,
      scope: { selectors: { taskIds: Array.from({ length: 501 }, (_, index) => `task-${index}`) } },
    }).success).toBe(false);
  });

  it("enforces the approved dataset and format matrix", () => {
    for (const [dataset, format] of [["tasks", "ics"], ["calendar", "pdf"], ["meeting_recording", "csv"], ["meeting_recording", "zip"]]) {
      expect(exportRequestSchema.safeParse({ dataset, format, scope: { selectors: {} } }).success).toBe(false);
    }
    for (const [dataset, format] of [["tasks", "pdf"], ["calendar", "ics"], ["gate_records", "csv"], ["meeting_transcript", "pdf"]]) {
      expect(exportRequestSchema.safeParse({ dataset, format, scope: { selectors: {} } }).success).toBe(true);
    }
  });

  it("measures the scope cap in serialized UTF-8 bytes", () => {
    const nonAsciiIds = Array.from({ length: 28 }, (_, index) => `${"界".repeat(100)}-${index}`);
    expect(JSON.stringify({ selectors: { taskIds: nonAsciiIds } }).length).toBeLessThan(8_192);
    expect(exportRequestSchema.safeParse({ dataset: "tasks", format: "csv", scope: { selectors: { taskIds: nonAsciiIds } } }).success).toBe(false);
  });

  it("rejects every nonempty selector that does not belong to the selected dataset", () => {
    const selectorKeys = ["channelIds", "noteIds", "taskIds", "formIds", "announcementIds", "shiftIds", "meetingOccurrenceIds", "siteLocationIds"] as const;
    const cases = [
      ["channels", "csv", "channelIds"], ["notes", "csv", "noteIds"], ["tasks", "csv", "taskIds"],
      ["forms", "csv", "formIds"], ["announcements", "csv", "announcementIds"], ["shifts", "csv", "shiftIds"],
      ["calendar", "ics", "shiftIds"], ["gate_records", "csv", "siteLocationIds"],
      ["meeting_recap", "csv", "meetingOccurrenceIds"], ["meeting_transcript", "csv", "meetingOccurrenceIds"],
      ["meeting_attendance", "csv", "meetingOccurrenceIds"],
    ] as const;
    for (const [dataset, format, allowed] of cases) {
      expect(exportRequestSchema.safeParse({ dataset, format, scope: { selectors: { [allowed]: ["00000000-0000-4000-8000-000000000001"] } } }).success).toBe(true);
      for (const key of selectorKeys.filter((candidate) => candidate !== allowed)) {
        expect(exportRequestSchema.safeParse({ dataset, format, scope: { selectors: { [key]: ["00000000-0000-4000-8000-000000000001"] } } }).success, `${dataset} accepted ${key}`).toBe(false);
      }
    }
  });
});

describe("Work Hub retention contracts", () => {
  it("requires the complete canonical retention vocabulary and safe whole-day values", () => {
    expect(retentionRulesSchema.safeParse(allRetentionRules).success).toBe(true);
    const { audit_logs: _removed, ...missingClass } = allRetentionRules;
    expect(retentionRulesSchema.safeParse(missingClass).success).toBe(false);
    expect(retentionRulesSchema.safeParse({ ...allRetentionRules, mystery: 30 }).success).toBe(false);
    expect(retentionRulesSchema.safeParse({ ...allRetentionRules, messages: 1.5 }).success).toBe(false);
    expect(retentionRulesSchema.safeParse({ ...allRetentionRules, messages: 0 }).success).toBe(false);
    expect(retentionRulesSchema.safeParse({ ...allRetentionRules, messages: 365_001 }).success).toBe(false);
  });

  it("fails closed without active minimums and rejects every organization rule below its minimum", () => {
    expect(() => validateOrganizationRetentionRules(allRetentionRules, undefined)).toThrow(/minimum/i);
    expect(() => validateOrganizationRetentionRules(
      { ...allRetentionRules, transcripts: 89 },
      { ...allRetentionRules, transcripts: 90 },
    )).toThrow(/transcripts/i);
    expect(validateOrganizationRetentionRules(allRetentionRules, allRetentionRules)).toEqual(allRetentionRules);
  });

  it("stores complete aggregate-only plan evidence and allowlisted errors", () => {
    const aggregate = { eligibleCount: 1, eligibleBytes: 10, heldCount: 2, heldBytes: 20, referenceBlockedCount: 3, referenceBlockedBytes: 30 };
    const complete = Object.fromEntries(RETENTION_CLASSES.map((key) => [key, aggregate]));
    expect(retentionPlanClassAggregatesSchema.safeParse(complete).success).toBe(true);
    const { attendance: _removed, ...missingClass } = complete;
    expect(retentionPlanClassAggregatesSchema.safeParse(missingClass).success).toBe(false);
    expect(retentionPlanClassAggregatesSchema.safeParse({ ...complete, messages: { ...aggregate, subjectId: "private-42" } }).success).toBe(false);
    expect(retentionPlanClassAggregatesSchema.safeParse({ ...complete, transcripts: { ...aggregate, heldBytes: -1 } }).success).toBe(false);
    expect(retentionPlanErrorCodesSchema.safeParse(["policy_unavailable", "reference_unresolved"]).success).toBe(true);
    expect(retentionPlanErrorCodesSchema.safeParse(["raw database error with transcript text"]).success).toBe(false);
  });
});

describe("Work Hub operational metric contracts", () => {
  it("accepts only fixed metrics, allowlisted dimensions and finite non-negative numeric aggregates", () => {
    expect(createOperationalMetric({
      metric: "export.duration_ms",
      dimensions: { dataset: "tasks", format: "csv", phase: "generate", source: "worker", status: "completed" },
      count: 1,
      sum: 42.5,
      max: 42.5,
    })).toEqual({
      metric: "export.duration_ms",
      dimensions: { dataset: "tasks", format: "csv", phase: "generate", source: "worker", status: "completed" },
      count: 1,
      sum: 42.5,
      max: 42.5,
    });
    for (const invalid of [
      { metric: "export.raw", dimensions: {}, count: 1, sum: 1, max: 1 },
      { metric: "export.failed", dimensions: { userId: "42" }, count: 1, sum: 1, max: 1 },
      { metric: "export.failed", dimensions: { errorCode: "database said transcript body" }, count: 1, sum: 1, max: 1 },
      { metric: "export.failed", dimensions: { status: { nested: true } }, count: 1, sum: 1, max: 1 },
      { metric: "export.failed", dimensions: {}, count: -1, sum: 1, max: 1 },
      { metric: "export.failed", dimensions: {}, count: 1, sum: Number.POSITIVE_INFINITY, max: 1 },
    ]) {
      expect(() => createOperationalMetric(invalid)).toThrow();
    }
  });

  it("constructs only identifier-free internal events and bounded admin read queries", () => {
    expect(createOperationalMetricEvent({ owner: { type: "vendor", id: 41 }, metric: "export.completed", dimensions: { dataset: "tasks", format: "csv", phase: "generate", source: "worker", status: "completed" }, value: 1, observedAt: "2026-09-10T20:15:00.000Z" })).toEqual(expect.objectContaining({ metric: "export.completed", value: 1 }));
    for (const invalid of [
      { owner: { type: "vendor", id: 41 }, metric: "export.completed", dimensions: { userId: "22" }, value: 1, observedAt: "2026-09-10T20:15:00.000Z" },
      { owner: { type: "vendor", id: 41 }, metric: "export.failed", dimensions: { subjectId: "private-row" }, value: 1, observedAt: "2026-09-10T20:15:00.000Z" },
      { owner: { type: "vendor", id: 41 }, metric: "export.failed", dimensions: { errorCode: "raw database failure" }, value: 1, observedAt: "2026-09-10T20:15:00.000Z" },
      { owner: { type: "vendor", id: 41 }, metric: "export.byte_count", dimensions: {}, value: Number.MAX_SAFE_INTEGER + 1, observedAt: "2026-09-10T20:15:00.000Z" },
    ]) expect(() => createOperationalMetricEvent(invalid)).toThrow();
    const query = operationalMetricReadQuerySchema.parse({ from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" });
    expect(query.from).toBe("2026-09-01T00:00:00.000Z");
    expect(() => operationalMetricReadQuerySchema.parse({ from: "2026-08-30T23:59:59.999Z", to: "2026-10-01T00:00:00.000Z" })).toThrow(/31 days/i);
    expect(() => operationalMetricReadQuerySchema.parse({ from: "2026-09-11T00:00:00.000Z", to: "2026-09-10T00:00:00.000Z" })).toThrow(/after/i);
    expect(() => operationalMetricReadQuerySchema.parse({ from: "2026-09-10T20:30:00.000Z", to: "2026-09-10T22:00:00.000Z" })).toThrow(/hour/i);
    expect(() => operationalMetricReadQuerySchema.parse({ from: "2026-09-10T20:00:00.000Z", to: "2026-09-10T22:00:01.000Z" })).toThrow(/hour/i);
  });

  it("projects aggregate metric buckets without owner or scope identifiers", () => {
    const readout = operationalMetricReadoutSchema.parse({ from: "2026-09-10T20:00:00.000Z", to: "2026-09-10T21:00:00.000Z", buckets: [{ metric: "export.row_count", intervalStart: "2026-09-10T20:00:00.000Z", dimensions: { dataset: "tasks", phase: "generate", source: "worker", status: "completed" }, count: 2, sum: 25, max: 15 }] });
    expect(readout.buckets[0]).not.toHaveProperty("ownerOrgId");
    expect(() => operationalMetricReadoutSchema.parse({ ...readout, buckets: [{ ...readout.buckets[0], ownerOrgId: 41 }] })).toThrow();
  });
});

describe("Work Hub pure export serializers", () => {
  it("emits RFC-4180 CSV and neutralizes spreadsheet formulas", () => {
    expect(serializeCsv([
      ["name", "note"],
      ["Bob", "=HYPERLINK(\"https://bad\")"],
      ["Sue, Jr.", "line one\nline two"],
      ["Mike", "  +SUM(1,2)"],
    ])).toBe("name,note\r\nBob,\"'=HYPERLINK(\"\"https://bad\"\")\"\r\n\"Sue, Jr.\",\"line one\nline two\"\r\nMike,\"'  +SUM(1,2)\"\r\n");
  });

  it("escapes, UTC-normalizes and folds ICS values", () => {
    const calendar = serializeIcsCalendar({
      productId: "-//VNDRLY//Work Hub//EN",
      events: [{
        uid: "meeting-1@vndrly.ai",
        start: "2026-09-10T15:30:00-05:00",
        end: "2026-09-10T16:30:00-05:00",
        summary: "Safety, schedule; and \\ review",
        description: `Line one\n${"x".repeat(90)}`,
      }],
    });
    expect(calendar).toContain("DTSTART:20260910T203000Z\r\n");
    expect(calendar).toContain("DTEND:20260910T213000Z\r\n");
    expect(calendar).toContain("SUMMARY:Safety\\, schedule\\; and \\\\ review\r\n");
    expect(calendar).toContain("DESCRIPTION:Line one\\n");
    expect(calendar).toMatch(/\r\n /);
    for (const line of calendar.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("rejects ICS events whose end is not after their start", () => {
    const base = { productId: "-//VNDRLY//Work Hub//EN", events: [{ uid: "meeting-1@vndrly.ai", start: "2026-09-10T20:30:00.000Z", end: "2026-09-10T20:30:00.000Z", summary: "Safety" }] };
    expect(() => serializeIcsCalendar(base)).toThrow(/end/i);
    expect(() => serializeIcsCalendar({ ...base, events: [{ ...base.events[0], end: "2026-09-10T20:29:59.000Z" }] })).toThrow(/end/i);
  });

  it("serializes a deterministic manifest with immutable watermark fields", () => {
    const input = {
      version: 1 as const,
      jobId: "60fb5c6d-4164-4b3f-baa1-1d7095426633",
      dataset: "tasks" as const,
      format: "csv" as const,
      requester: { id: "user-42", display: "S. Example" },
      generatedAt: "2026-09-10T20:00:00.000Z",
      snapshotAt: "2026-09-10T19:59:00.000Z",
      rowCount: 2,
      byteCount: 118,
      sha256: "a".repeat(64),
    };
    const serialized = serializeExportManifest(input);
    expect(serialized).toBe(`${JSON.stringify(input)}\n`);
    expect(serializeExportManifest({ ...input })).toBe(serialized);
    expect(() => serializeExportManifest({ ...input, storageKey: "/objects/private" } as never)).toThrow();
  });

  it("rejects unsupported dataset and format pairs in manifests", () => {
    const base = {
      version: 1 as const,
      jobId: "60fb5c6d-4164-4b3f-baa1-1d7095426633",
      dataset: "tasks" as const,
      format: "csv" as const,
      requester: { id: "user-42", display: "S. Example" },
      generatedAt: "2026-09-10T20:00:00.000Z",
      snapshotAt: "2026-09-10T19:59:00.000Z",
      rowCount: 2,
      byteCount: 118,
      sha256: "a".repeat(64),
    };
    expect(() => serializeExportManifest({ ...base, format: "ics" })).toThrow(/not supported/i);
    expect(() => serializeExportManifest({ ...base, dataset: "meeting_recording", format: "zip" })).toThrow(/not supported/i);
  });
});

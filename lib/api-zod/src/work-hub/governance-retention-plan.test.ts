import { describe, expect, it } from "vitest";
import { RETENTION_CLASSES } from "./governance-export";
import { retentionPlanCreateSchema, retentionPlanViewSchema } from "./governance-retention-plan";

const aggregates = Object.fromEntries(RETENTION_CLASSES.map((key) => [key, {
  eligibleCount: 0, eligibleBytes: 0, heldCount: 0, heldBytes: 0,
  referenceBlockedCount: 0, referenceBlockedBytes: 0,
}]));

describe("retention plan public contracts", () => {
  it("accepts only an operation id and bounded owner for creation", () => {
    expect(retentionPlanCreateSchema.parse({ operationId: "11111111-1111-4111-8111-111111111111", owner: { type: "vendor", id: 41 } })).toEqual({ operationId: "11111111-1111-4111-8111-111111111111", owner: { type: "vendor", id: 41 } });
    expect(() => retentionPlanCreateSchema.parse({ operationId: "11111111-1111-4111-8111-111111111111", owner: { type: "vendor", id: 41 }, candidateIds: ["private"] })).toThrow();
  });

  it("rejects identifiers, free text, and non-allowlisted errors from evidence", () => {
    const base = {
      id: "22222222-2222-4222-8222-222222222222", owner: { type: "vendor" as const, id: 41 },
      status: "completed" as const, policyVersion: 4, minimumPolicyVersion: 2,
      snapshotAt: "2026-09-10T12:00:00.000Z", classAggregates: aggregates,
      errorCodes: [], createdAt: "2026-09-10T12:00:00.000Z",
      startedAt: "2026-09-10T12:00:00.000Z", finishedAt: "2026-09-10T12:00:01.000Z",
    };
    expect(retentionPlanViewSchema.safeParse(base).success).toBe(true);
    expect(retentionPlanViewSchema.safeParse({ ...base, subjectIds: ["private"] }).success).toBe(false);
    expect(retentionPlanViewSchema.safeParse({ ...base, errorCodes: ["raw postgres error"] }).success).toBe(false);
  });
});

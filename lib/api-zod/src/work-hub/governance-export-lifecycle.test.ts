import { describe, expect, it } from "vitest";
import {
  workHubExportCreateSchema,
  workHubExportStatusSchema,
} from "./governance-export";

describe("Work Hub export lifecycle contracts", () => {
  const request = {
    operationId: "11111111-1111-4111-8111-111111111111",
    owner: { type: "vendor", id: 41 },
    export: { dataset: "tasks", format: "csv", scope: { selectors: {} } },
    expiresAt: "2026-10-01T12:00:00.000Z",
  };

  it("requires an explicit expiry on every asynchronous export request", () => {
    expect(workHubExportCreateSchema.safeParse(request).success).toBe(true);
    expect(workHubExportCreateSchema.safeParse({ ...request, expiresAt: undefined }).success).toBe(false);
    expect(workHubExportCreateSchema.safeParse({ ...request, expiresAt: "not-an-instant" }).success).toBe(false);
  });

  it("returns only safe lifecycle fields and rejects storage/error internals", () => {
    const safe = {
      id: request.operationId,
      dataset: "tasks",
      format: "csv",
      status: "completed",
      createdAt: "2026-09-10T12:00:00.000Z",
      updatedAt: "2026-09-10T12:01:00.000Z",
      rowCount: 3,
      byteCount: 120,
      expiresAt: request.expiresAt,
      fileName: "vndrly-work-hub-tasks.csv",
      errorCode: null,
    };
    expect(workHubExportStatusSchema.safeParse(safe).success).toBe(true);
    expect(workHubExportStatusSchema.safeParse({ ...safe, artifactStorageKey: "/objects/secret" }).success).toBe(false);
    expect(workHubExportStatusSchema.safeParse({ ...safe, failureDetail: "raw failure" }).success).toBe(false);
  });
});

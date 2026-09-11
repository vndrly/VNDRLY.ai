import { describe, expect, it, vi } from "vitest";
import { createOperationalMetricRecorder, createOperationalMetricsService } from "./governance-operational-metrics";
const owner = { type: "vendor" as const, id: 41 };
const observedAt = new Date("2026-09-10T20:15:32.000Z");
describe("Work Hub operational metrics", () => {
  it("writes a deterministic identifier-free hourly aggregate", async () => {
    const upsert = vi.fn(async (_input: unknown) => undefined);
    const record = createOperationalMetricRecorder({ upsert });
    await record({ owner, metric: "export.completed", dimensions: { status: "completed", source: "worker", phase: "generate", format: "csv", dataset: "tasks" }, value: 1, observedAt });
    expect(upsert).toHaveBeenCalledWith({ owner, metric: "export.completed", intervalStart: new Date("2026-09-10T20:00:00.000Z"), dimensions: { dataset: "tasks", format: "csv", phase: "generate", source: "worker", status: "completed" }, dimensionHash: "760b9b2ff9b03f468ad4832e69104619cd120129f61e6203accfd66fd09c7203", count: 1, sum: 1, max: 1, observedAt });
    expect(JSON.stringify(upsert.mock.calls[0][0])).not.toMatch(/userId|subjectId|ownerOrgId|operationId|fileName|storageKey|transcript|body/i);
  });
  it("reauthorizes owner and platform reads and returns aggregate-only projections", async () => {
    const authorizeOwnerAdmin = vi.fn(async () => undefined), authorizePlatformAdmin = vi.fn(async () => undefined);
    const rows = [{ ownerOrgType: "vendor", ownerOrgId: 41, metricName: "export.failed", intervalStart: new Date("2026-09-10T20:00:00.000Z"), dimensions: { phase: "generate", status: "failed", errorCode: "internal_failure" }, dimensionHash: "secret", count: 2, sum: 2, max: 1 }];
    const readOwner = vi.fn(async () => rows), readPlatform = vi.fn(async () => rows);
    const service = createOperationalMetricsService({ authorizeOwnerAdmin, authorizePlatformAdmin, readOwner, readPlatform });
    const query = { from: "2026-09-10T20:00:00.000Z", to: "2026-09-10T21:00:00.000Z" };
    const ownerResult = await service.readOwner({ actorUserId: 22, owner, query });
    expect(authorizeOwnerAdmin).toHaveBeenCalledWith(22, owner);
    expect(readOwner).toHaveBeenCalledWith({ owner, from: new Date(query.from), to: new Date(query.to) });
    expect(ownerResult.buckets[0]).toEqual({ metric: "export.failed", intervalStart: query.from, dimensions: { phase: "generate", status: "failed", errorCode: "internal_failure" }, count: 2, sum: 2, max: 1 });
    expect(JSON.stringify(ownerResult)).not.toMatch(/ownerOrg|dimensionHash|secret/);
    const platformResult = await service.readPlatform({ actorUserId: 1, query });
    expect(authorizePlatformAdmin).toHaveBeenCalledWith(1);
    expect(readPlatform).toHaveBeenCalledWith({ from: new Date(query.from), to: new Date(query.to) });
    expect(JSON.stringify(platformResult)).not.toMatch(/ownerOrg|dimensionHash|secret/);
  });
  it("rejects oversized repository results rather than returning a partial dashboard", async () => {
    const row = { metricName: "export.completed", intervalStart: new Date("2026-09-10T20:00:00.000Z"), dimensions: {}, count: 1, sum: 1, max: 1 };
    const service = createOperationalMetricsService({ authorizeOwnerAdmin: vi.fn(async () => undefined), authorizePlatformAdmin: vi.fn(async () => undefined), readOwner: vi.fn(async () => Array.from({ length: 10_001 }, () => row)), readPlatform: vi.fn(async () => []) });
    await expect(service.readOwner({ actorUserId: 22, owner, query: { from: "2026-09-10T20:00:00.000Z", to: "2026-09-10T21:00:00.000Z" } })).rejects.toThrow(/too many/i);
  });
  it("rejects non-hour-aligned windows before authorization or repository reads", async () => {
    const authorizeOwnerAdmin = vi.fn(async () => undefined), readOwner = vi.fn(async () => []);
    const service = createOperationalMetricsService({ authorizeOwnerAdmin, authorizePlatformAdmin: vi.fn(async () => undefined), readOwner, readPlatform: vi.fn(async () => []) });
    await expect(service.readOwner({ actorUserId: 22, owner, query: { from: "2026-09-10T20:30:00.000Z", to: "2026-09-10T22:00:00.000Z" } })).rejects.toThrow(/hour/i);
    expect(authorizeOwnerAdmin).not.toHaveBeenCalled();
    expect(readOwner).not.toHaveBeenCalled();
  });
});

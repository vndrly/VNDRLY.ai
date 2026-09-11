import { describe, expect, it, vi } from "vitest";
import { createExportWorkerDrain, emitStaleRecoveryMetrics, staleRecoveryTransition } from "./governance-export-runtime";

describe("Work Hub export worker drain", () => {
  it("plans retry and terminal stale transitions without inventing another attempt", () => {
    const now = new Date("2026-09-10T12:00:00.000Z");
    expect(staleRecoveryTransition(2, 3, now)).toEqual({ retrying: true, status: "pending", finishedAt: null });
    expect(staleRecoveryTransition(3, 3, now)).toEqual({ retrying: false, status: "failed", finishedAt: now });
  });

  it("emits allowlisted lease-expired retry metrics without identifiers", async () => {
    const metric = vi.fn().mockRejectedValueOnce(new Error("telemetry unavailable")).mockResolvedValue(undefined);
    await expect(emitStaleRecoveryMetrics(metric, [{ owner: { type: "vendor", id: 41 }, dataset: "tasks", format: "csv", retrying: true }], new Date("2026-09-10T12:00:00.000Z"))).resolves.toBeUndefined();
    expect(metric).toHaveBeenCalledWith({ owner: { type: "vendor", id: 41 }, metric: "export.failed", dimensions: { dataset: "tasks", format: "csv", phase: "generate", source: "worker", status: "pending", errorCode: "lease_expired" }, value: 1, observedAt: new Date("2026-09-10T12:00:00.000Z") });
    expect(metric).toHaveBeenCalledWith({ owner: { type: "vendor", id: 41 }, metric: "export.retry_count", dimensions: { dataset: "tasks", format: "csv", phase: "generate", source: "worker", status: "pending", errorCode: "lease_expired" }, value: 1, observedAt: new Date("2026-09-10T12:00:00.000Z") });
    expect(JSON.stringify(metric.mock.calls)).not.toMatch(/jobId|operationId|requester|scope|raw|detail/i);
  });

  it("emits only terminal lease-expired failure and isolates telemetry failures", async () => {
    const metric = vi.fn(async () => { throw new Error("telemetry unavailable"); });
    await expect(emitStaleRecoveryMetrics(metric, [{ owner: { type: "partner", id: 9 }, dataset: "calendar", format: "ics", retrying: false }], new Date("2026-09-10T12:00:00.000Z"))).resolves.toBeUndefined();
    expect(metric).toHaveBeenCalledWith({ owner: { type: "partner", id: 9 }, metric: "export.failed", dimensions: { dataset: "calendar", format: "ics", phase: "generate", source: "worker", status: "failed", errorCode: "lease_expired" }, value: 1, observedAt: new Date("2026-09-10T12:00:00.000Z") });
    expect(metric).not.toHaveBeenCalledWith(expect.objectContaining({ metric: "export.retry_count" }));
  });

  it("takes its running guard before awaiting the feature flag", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const enabled = vi.fn(async () => { await gate; return true; });
    const runOne = vi.fn(async () => false);
    const worker = createExportWorkerDrain({ enabled, runOne, onError: vi.fn() });
    worker.start();
    const first = worker.drain();
    const second = worker.drain();
    release();
    await Promise.all([first, second]);
    expect(enabled).toHaveBeenCalledOnce();
    expect(runOne).toHaveBeenCalledOnce();
  });

  it("contains a rejected flag lookup and can run again", async () => {
    const enabled = vi.fn().mockRejectedValueOnce(new Error("flag failed")).mockResolvedValue(false);
    const onError = vi.fn();
    const worker = createExportWorkerDrain({ enabled, runOne: vi.fn(async () => false), onError });
    worker.start();
    await expect(worker.drain()).resolves.toBeUndefined();
    await expect(worker.drain()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    expect(enabled).toHaveBeenCalledTimes(2);
  });

  it("rechecks the flag before each claim and stops when disabled between jobs", async () => {
    const enabled = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const runOne = vi.fn(async () => true);
    const worker = createExportWorkerDrain({ enabled, runOne, onError: vi.fn() });
    worker.start();
    await worker.drain();
    expect(runOne).toHaveBeenCalledOnce();
    expect(enabled).toHaveBeenCalledTimes(2);
  });

  it("stops an active drain between jobs", async () => {
    const enabled = vi.fn(async () => true);
    let worker!: ReturnType<typeof createExportWorkerDrain>;
    const runOne = vi.fn(async () => { worker.stop(); return true; });
    worker = createExportWorkerDrain({ enabled, runOne, onError: vi.fn() });
    worker.start();
    await worker.drain();
    expect(runOne).toHaveBeenCalledOnce();
    expect(enabled).toHaveBeenCalledOnce();
  });
});

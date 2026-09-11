import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createExportLifecycle,
  exportObjectPath,
  type ExportJobRecord,
} from "./governance-export-lifecycle";

const now = new Date("2026-09-10T12:00:00.000Z");
const later = "2026-09-11T12:00:00.000Z";
const baseLease = new Date(now.getTime() + 60_000);
const baseJob: ExportJobRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerOrgType: "vendor", ownerOrgId: 41, requesterUserId: 22,
  requesterIdSnapshot: "22", requesterDisplaySnapshot: "Casey",
  requestSource: "web", operationId: "22222222-2222-4222-8222-222222222222",
  dataset: "tasks", format: "csv", scope: { selectors: {} }, snapshotAt: now,
  status: "pending", attemptCount: 0, availableAt: now, leaseExpiresAt: null,
  startedAt: null, finishedAt: null, artifactStorageKey: null, artifactFileName: null,
  artifactContentType: null, artifactSha256: null, rowCount: null, byteCount: null,
  generatedAt: null, expiresAt: new Date(later), errorCode: null, failureDetail: null,
  createdAt: now, updatedAt: now,
};

function harness(initial: ExportJobRecord = baseJob, nowFn: () => Date = () => now) {
  let job = structuredClone(initial);
  const objects = new Map<string, { body: Buffer; contentType: string; acl: { owner: string; visibility: "private" } }>();
  const authorize = vi.fn(async () => ({ owner: { type: "vendor" as const, id: 41 }, context: { kind: "organization" as const, id: 41 }, capabilities: new Set(["policy.manage" as const]), visibilityRevision: "current" }));
  const repository = {
    create: vi.fn(async () => ({ job, replayed: false })),
    findForRequester: vi.fn(async () => job),
    claimNext: vi.fn(async () => job.status === "pending" ? (job = { ...job, status: "running", attemptCount: job.attemptCount + 1, leaseExpiresAt: new Date(now.getTime() + 60_000) }) : null),
    complete: vi.fn(async (_job: ExportJobRecord, lease: Date, artifact: any) => {
      if (job.status !== "running" || job.leaseExpiresAt?.getTime() !== lease.getTime() || lease <= artifact.generatedAt || !job.expiresAt || job.expiresAt <= artifact.generatedAt) return false;
      job = { ...job, ...artifact, status: "completed", finishedAt: now, updatedAt: now };
      return true;
    }),
    fail: vi.fn(async (_job: ExportJobRecord, lease: Date, failure: any) => {
      if (job.status !== "running" || job.leaseExpiresAt?.getTime() !== lease.getTime() || lease <= failure.observedAt || !job.expiresAt || job.expiresAt <= failure.observedAt) return false;
      job = { ...job, status: failure.status, availableAt: failure.availableAt, errorCode: failure.errorCode, failureDetail: failure.failureDetail };
      return true;
    }),
    recoverStale: vi.fn(async () => 0),
  };
  const storage = {
    putObject: vi.fn(async (key: string, contentType: string, body: Buffer, acl: any) => { objects.set(key, { contentType, body, acl }); }),
    getObject: vi.fn(async (key: string) => objects.get(key) ?? null),
    deleteObject: vi.fn(async (key: string) => { objects.delete(key); }),
  };
  const audit = vi.fn(async () => undefined);
  const metric = vi.fn(async () => undefined);
  const lifecycle = createExportLifecycle({
    now: nowFn, repository, storage, authorize, audit, metric,
    readRows: async () => [{ cursorAt: now.toISOString(), cursorId: "task:1", fields: { title: "Inspect" } }],
    buildArtifact: async () => { const body = Buffer.from("safe-export"); return { bytes: body, contentType: "text/csv; charset=utf-8", fileName: "vndrly-work-hub-tasks.csv", sha256: createHash("sha256").update(body).digest("hex"), manifest: {} as any }; },
  });
  return { lifecycle, repository, storage, audit, metric, authorize, get job() { return job; } };
}

describe("governed asynchronous export lifecycle", () => {
  it("encodes every attempt-key segment without traversal characters", () => {
    const key = exportObjectPath({ ...baseJob, id: "../../other/object", attemptCount: 1 }, baseLease);
    expect(key).not.toContain("..");
    expect(key).not.toContain("%");
    expect(key).toMatch(/^\/objects\/work-hub\/exports\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/attempt-[A-Za-z0-9_-]+-[A-Za-z0-9_-]+$/);
  });

  it("fails closed when expiry is missing, elapsed, or implausibly far away", async () => {
    const { lifecycle } = harness();
    const request: any = { operationId: baseJob.operationId, owner: { type: "vendor", id: 41 }, export: { dataset: "tasks", format: "csv", scope: { selectors: {} } } };
    await expect(lifecycle.request({ requester: { userId: 22, displayName: "Casey", source: "web" }, body: request })).rejects.toMatchObject({ code: "export.expiry_required" });
    await expect(lifecycle.request({ requester: { userId: 22, displayName: "Casey", source: "web" }, body: { ...request, expiresAt: now.toISOString() } })).rejects.toMatchObject({ code: "export.expiry_invalid" });
  });

  it("uses a sentinel-owned private path and publishes only after stored integrity verifies", async () => {
    const h = harness();
    expect(await h.lifecycle.runOne()).toBe(true);
    expect(h.storage.putObject).toHaveBeenCalledWith(exportObjectPath({ ...baseJob, attemptCount: 1 }, baseLease), "text/csv; charset=utf-8", Buffer.from("safe-export"), { owner: `work-hub-export:${baseJob.id}`, visibility: "private" });
    expect(h.repository.complete).toHaveBeenCalledOnce();
    expect(h.job.status).toBe("completed");
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("passes one generation timestamp through the artifact and atomic publication boundary", async () => {
    const h = harness();
    const buildArtifact = vi.fn(async ({ generatedAt }: { generatedAt: Date }) => {
      const body = Buffer.from("safe-export");
      expect(generatedAt).toEqual(now);
      return { bytes: body, contentType: "text/csv; charset=utf-8", fileName: "vndrly.csv", sha256: createHash("sha256").update(body).digest("hex"), manifest: {} };
    });
    const lifecycle = createExportLifecycle({
      now: () => now, repository: h.repository, storage: h.storage, authorize: h.authorize, audit: h.audit,
      readRows: async () => [{ cursorAt: now.toISOString(), cursorId: "task:1", fields: {} }],
      buildArtifact,
    });
    await lifecycle.runOne();
    expect(buildArtifact).toHaveBeenCalledWith(expect.objectContaining({ generatedAt: now }));
    expect(h.repository.complete).toHaveBeenCalledWith(expect.objectContaining({ id: baseJob.id }), expect.any(Date), expect.objectContaining({ generatedAt: now }));
  });

  it("classifies storage write failures and delegates failure auditing to the atomic repository transition", async () => {
    const h = harness();
    h.storage.putObject.mockRejectedValueOnce(new Error("secret storage detail"));
    await h.lifecycle.runOne();
    expect(h.repository.fail).toHaveBeenCalledWith(expect.objectContaining({ id: baseJob.id }), expect.any(Date), expect.objectContaining({ errorCode: "storage_write_failed" }));
    expect(h.audit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "export.failed" }));
  });

  it.each([
    ["lease", { expiresAt: new Date(later) }, new Date(now.getTime() + 60_001)],
    ["job", { expiresAt: new Date(now.getTime() + 1) }, new Date(now.getTime() + 2)],
  ])("does not publish or fail after %s expiry and removes the just-written orphan", async (_boundary, overrides, generatedAt) => {
    const h = harness({ ...baseJob, ...overrides });
    const times = [now, generatedAt];
    const lifecycle = createExportLifecycle({
      now: () => times.shift() ?? generatedAt,
      repository: h.repository,
      storage: h.storage,
      authorize: h.authorize,
      audit: h.audit,
      readRows: async () => [{ cursorAt: now.toISOString(), cursorId: "task:1", fields: {} }],
      buildArtifact: async () => { const body = Buffer.from("safe-export"); return { bytes: body, contentType: "text/csv", fileName: "vndrly.csv", sha256: createHash("sha256").update(body).digest("hex"), manifest: {} }; },
    });
    await lifecycle.runOne();
    expect(h.repository.complete).toHaveBeenCalledOnce();
    expect(h.repository.fail).not.toHaveBeenCalled();
    expect(h.storage.deleteObject).toHaveBeenCalledWith(exportObjectPath({ ...baseJob, attemptCount: 1 }, baseLease));
  });

  it("leaves an expired worker untouched when generation fails after its lease", async () => {
    const h = harness();
    h.storage.putObject.mockRejectedValueOnce(new Error("storage unavailable"));
    const afterLease = new Date(now.getTime() + 60_001);
    const times = [now, now, afterLease];
    const lifecycle = createExportLifecycle({
      now: () => times.shift() ?? afterLease,
      repository: h.repository,
      storage: h.storage,
      authorize: h.authorize,
      audit: h.audit,
      readRows: async () => [{ cursorAt: now.toISOString(), cursorId: "task:1", fields: {} }],
      buildArtifact: async () => { const body = Buffer.from("safe-export"); return { bytes: body, contentType: "text/csv", fileName: "vndrly.csv", sha256: createHash("sha256").update(body).digest("hex"), manifest: {} }; },
    });
    await lifecycle.runOne();
    expect(h.job.status).toBe("running");
    expect(h.repository.fail).toHaveBeenCalledWith(expect.anything(), expect.any(Date), expect.objectContaining({ observedAt: afterLease }));
  });

  it("does not read bytes after expiry or current-access revocation", async () => {
    const completed = { ...baseJob, status: "completed" as const, artifactStorageKey: exportObjectPath({ ...baseJob, attemptCount: 1 }, baseLease), artifactFileName: "vndrly.csv", artifactContentType: "text/csv", artifactSha256: "a".repeat(64), byteCount: 1 };
    const expired = harness({ ...completed, expiresAt: new Date(now.getTime() - 1) });
    await expect(expired.lifecycle.download({ jobId: completed.id, requesterUserId: 22 })).rejects.toMatchObject({ code: "export.expired" });
    expect(expired.storage.getObject).not.toHaveBeenCalled();
    const revoked = harness(completed);
    revoked.authorize.mockRejectedValueOnce(Object.assign(new Error("revoked"), { code: "work_hub.forbidden" }));
    await expect(revoked.lifecycle.download({ jobId: completed.id, requesterUserId: 22 })).rejects.toThrow("revoked");
    expect(revoked.storage.getObject).not.toHaveBeenCalled();
  });

  it("rejects corrupted bytes and never exposes storage keys or failure detail in status", async () => {
    const completed = { ...baseJob, status: "completed" as const, artifactStorageKey: exportObjectPath({ ...baseJob, attemptCount: 1 }, baseLease), artifactFileName: "vndrly.csv", artifactContentType: "text/csv", artifactSha256: createHash("sha256").update("expected").digest("hex"), byteCount: 8 };
    const h = harness(completed);
    h.storage.getObject.mockResolvedValueOnce({ body: Buffer.from("wrong"), contentType: "text/csv", acl: { owner: `work-hub-export:${completed.id}`, visibility: "private" } });
    await expect(h.lifecycle.download({ jobId: completed.id, requesterUserId: 22 })).rejects.toMatchObject({ code: "export.checksum_mismatch" });
    const status = await h.lifecycle.status({ jobId: completed.id, requesterUserId: 22 });
    expect(status).not.toHaveProperty("artifactStorageKey");
    expect(status).not.toHaveProperty("failureDetail");
  });

  it("keeps the winning attempt downloadable when a stale attempt cleans up afterward", async () => {
    const leaseA = new Date("2026-09-10T12:01:00.000Z");
    const leaseB = new Date("2026-09-10T12:03:00.000Z");
    const jobA = { ...baseJob, status: "running" as const, attemptCount: 1, leaseExpiresAt: leaseA };
    const jobB = { ...baseJob, status: "running" as const, attemptCount: 2, leaseExpiresAt: leaseB };
    const claims = [jobA, jobB];
    let current: ExportJobRecord = jobA;
    let releaseA!: () => void;
    let reachedA!: () => void;
    const allowA = new Promise<void>((resolve) => { releaseA = resolve; });
    const aAtPublication = new Promise<void>((resolve) => { reachedA = resolve; });
    const objects = new Map<string, { body: Buffer; contentType: string; acl: { owner: string; visibility: "private" } }>();
    const repository = {
      create: vi.fn(), findForRequester: vi.fn(async () => current),
      claimNext: vi.fn(async () => claims.shift() ?? null),
      complete: vi.fn(async (job: ExportJobRecord, _lease: Date, artifact: any) => {
        if (job.attemptCount === 1) { reachedA(); await allowA; return false; }
        current = { ...job, ...artifact, status: "completed", leaseExpiresAt: null, finishedAt: artifact.generatedAt };
        return true;
      }),
      fail: vi.fn(), recoverStale: vi.fn(),
    };
    const storage = {
      putObject: vi.fn(async (key: string, contentType: string, body: Buffer, acl: any) => { objects.set(key, { body, contentType, acl }); }),
      getObject: vi.fn(async (key: string) => objects.get(key) ?? null),
      deleteObject: vi.fn(async (key: string) => { objects.delete(key); }),
    };
    const lifecycle = createExportLifecycle({
      now: vi.fn().mockReturnValueOnce(new Date("2026-09-10T12:00:00.000Z")).mockReturnValueOnce(new Date("2026-09-10T12:00:30.000Z")).mockReturnValue(new Date("2026-09-10T12:01:30.000Z")),
      repository, storage,
      authorize: async () => ({ owner: { type: "vendor", id: 41 }, context: { kind: "organization", id: 41 }, capabilities: new Set(["policy.manage"]), visibilityRevision: "current" }) as any,
      readRows: async () => [{ cursorAt: now.toISOString(), cursorId: "task:1", fields: {} }],
      buildArtifact: async ({ job }) => { const body = Buffer.from(`attempt-${job.attemptCount}`); return { bytes: body, contentType: "text/csv", fileName: "vndrly.csv", sha256: createHash("sha256").update(body).digest("hex"), manifest: {} }; },
      audit: vi.fn(),
    });
    const workerA = lifecycle.runOne();
    await aAtPublication;
    await lifecycle.runOne();
    releaseA();
    await workerA;
    const keyA = exportObjectPath(jobA, leaseA);
    const keyB = exportObjectPath(jobB, leaseB);
    expect(keyA).not.toBe(keyB);
    expect(storage.deleteObject).toHaveBeenCalledWith(keyA);
    expect(storage.deleteObject).not.toHaveBeenCalledWith(keyB);
    expect(objects.get(keyB)?.body.toString()).toBe("attempt-2");
    const downloaded = await lifecycle.download({ jobId: current.id, requesterUserId: 22 });
    expect(downloaded.body.toString()).toBe("attempt-2");
  });

  it("records only aggregate request, generation, row, byte and completion signals", async () => {
    const h = harness();
    await h.lifecycle.request({ requester: { userId: 22, displayName: "Casey", source: "web" }, body: { operationId: baseJob.operationId, owner: { type: "vendor", id: 41 }, export: { dataset: "tasks", format: "csv", scope: { selectors: {} } }, expiresAt: later } });
    await h.lifecycle.runOne();
    await h.lifecycle.download({ jobId: baseJob.id, requesterUserId: 22 });
    expect(h.metric).toHaveBeenCalledWith({ owner: { type: "vendor", id: 41 }, metric: "export.duration_ms", dimensions: { dataset: "tasks", format: "csv", phase: "request", source: "web", status: "completed" }, value: 0, observedAt: now });
    for (const [metric, value] of [["export.duration_ms", 0], ["export.row_count", 1], ["export.byte_count", 11], ["export.completed", 1]] as const) {
      expect(h.metric).toHaveBeenCalledWith({ owner: { type: "vendor", id: 41 }, metric, dimensions: { dataset: "tasks", format: "csv", phase: "generate", source: "worker", status: "completed" }, value, observedAt: now });
    }
    expect(h.metric).toHaveBeenCalledWith({ owner: { type: "vendor", id: 41 }, metric: "export.duration_ms", dimensions: { dataset: "tasks", format: "csv", phase: "download", source: "web", status: "completed" }, value: 0, observedAt: now });
    expect(JSON.stringify(h.metric.mock.calls)).not.toMatch(/userId|subjectId|operationId|fileName|storageKey|transcript|body/i);
  });

  it("measures generation through successful repository publication", async () => {
    const generatedAt = new Date("2026-09-10T12:00:01.000Z");
    const completedAt = new Date("2026-09-10T12:00:09.000Z");
    const clock = vi.fn<() => Date>()
      .mockReturnValueOnce(now)
      .mockReturnValueOnce(generatedAt)
      .mockReturnValueOnce(completedAt);
    const h = harness(baseJob, clock);
    await h.lifecycle.runOne();
    expect(h.repository.complete).toHaveBeenCalledWith(expect.anything(), expect.any(Date), expect.objectContaining({ generatedAt }));
    expect(h.metric).toHaveBeenCalledWith({ owner: { type: "vendor", id: 41 }, metric: "export.duration_ms", dimensions: { dataset: "tasks", format: "csv", phase: "generate", source: "worker", status: "completed" }, value: 9_000, observedAt: completedAt });
  });

  it("records retry and terminal failure without raw errors", async () => {
    const h = harness();
    h.storage.putObject.mockRejectedValueOnce(new Error("private transcript content"));
    await h.lifecycle.runOne();
    expect(h.metric).toHaveBeenCalledWith({ owner: { type: "vendor", id: 41 }, metric: "export.failed", dimensions: { dataset: "tasks", format: "csv", phase: "generate", source: "worker", status: "pending", errorCode: "storage_write_failed" }, value: 1, observedAt: now });
    expect(h.metric).toHaveBeenCalledWith({ owner: { type: "vendor", id: 41 }, metric: "export.retry_count", dimensions: { dataset: "tasks", format: "csv", phase: "generate", source: "worker", status: "pending", errorCode: "storage_write_failed" }, value: 1, observedAt: now });
    expect(JSON.stringify(h.metric.mock.calls)).not.toContain("private transcript content");
    const terminal = harness({ ...baseJob, attemptCount: 2 });
    terminal.storage.putObject.mockRejectedValueOnce(new Error("private terminal detail"));
    await terminal.lifecycle.runOne();
    expect(terminal.metric).toHaveBeenCalledWith({ owner: { type: "vendor", id: 41 }, metric: "export.failed", dimensions: { dataset: "tasks", format: "csv", phase: "generate", source: "worker", status: "failed", errorCode: "storage_write_failed" }, value: 1, observedAt: now });
    expect(terminal.metric).not.toHaveBeenCalledWith(expect.objectContaining({ metric: "export.retry_count" }));
  });

  it("records expiration and authorization denial without reading bytes", async () => {
    const completed = { ...baseJob, status: "completed" as const, artifactStorageKey: "private-key", artifactFileName: "private-name.csv", artifactContentType: "text/csv", artifactSha256: "a".repeat(64), byteCount: 1 };
    const expired = harness({ ...completed, expiresAt: new Date(now.getTime() - 1) });
    await expect(expired.lifecycle.download({ jobId: completed.id, requesterUserId: 22 })).rejects.toMatchObject({ code: "export.expired" });
    expect(expired.metric).toHaveBeenCalledWith({ owner: { type: "vendor", id: 41 }, metric: "export.expired", dimensions: { dataset: "tasks", format: "csv", phase: "download", source: "web", status: "expired" }, value: 1, observedAt: now });
    const denied = harness(completed);
    denied.authorize.mockRejectedValueOnce(Object.assign(new Error("private denial"), { code: "work_hub.forbidden" }));
    await expect(denied.lifecycle.download({ jobId: completed.id, requesterUserId: 22 })).rejects.toThrow("private denial");
    expect(denied.metric).toHaveBeenCalledWith({ owner: { type: "vendor", id: 41 }, metric: "authorization.denied", dimensions: { dataset: "tasks", format: "csv", phase: "download", source: "web", status: "failed", errorCode: "access_denied" }, value: 1, observedAt: now });
    expect(denied.storage.getObject).not.toHaveBeenCalled();
  });

  it("does not fail an authorized operation when metric persistence is unavailable", async () => {
    const h = harness();
    h.metric.mockRejectedValue(new Error("metrics unavailable"));
    await expect(h.lifecycle.request({ requester: { userId: 22, displayName: "Casey", source: "web" }, body: { operationId: baseJob.operationId, owner: { type: "vendor", id: 41 }, export: { dataset: "tasks", format: "csv", scope: { selectors: {} } }, expiresAt: later } })).resolves.toMatchObject({ replayed: false });
  });

  it("classifies impossible owner context mismatches without persisting raw identifiers", async () => {
    const h = harness();
    h.authorize.mockRejectedValueOnce(Object.assign(new Error("foreign owner 999"), { code: "owner_context_mismatch" }));
    await expect(h.lifecycle.request({ requester: { userId: 22, displayName: "Casey", source: "ios" }, body: { operationId: baseJob.operationId, owner: { type: "vendor", id: 41 }, export: { dataset: "tasks", format: "csv", scope: { selectors: {} } }, expiresAt: later } })).rejects.toThrow("foreign owner 999");
    expect(h.metric).toHaveBeenCalledWith({ owner: { type: "vendor", id: 41 }, metric: "owner_context.mismatch", dimensions: { dataset: "tasks", format: "csv", phase: "request", source: "ios", status: "failed", errorCode: "owner_context_mismatch" }, value: 1, observedAt: now });
    expect(JSON.stringify(h.metric.mock.calls)).not.toContain("999");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./governance-export-runtime.ts", import.meta.url), "utf8");

describe("export repository transaction boundaries", () => {
  it("requires both lease and job expiry after generatedAt when publishing", () => {
    expect(source).toContain("gt(workHubExportJobsTable.leaseExpiresAt, artifact.generatedAt)");
    expect(source).toContain("gt(workHubExportJobsTable.expiresAt, artifact.generatedAt)");
  });

  it("prevents an expired worker from mutating failure state", () => {
    expect(source).toContain("gt(workHubExportJobsTable.leaseExpiresAt, observedAt)");
    expect(source).toContain("gt(workHubExportJobsTable.expiresAt, observedAt)");
  });

  it("connects process stop to the active drain cancellation state", () => {
    expect(source).toContain("exportWorker.stop()");
    expect(source).toContain("const startGeneration = exportWorker.start()");
  });

  it("recovers stale leases under a row lock and writes export.failed audit in the same transaction", () => {
    const recovery = source.slice(source.indexOf("async recoverStale"), source.indexOf("\n};", source.indexOf("async recoverStale")));
    expect(recovery).toContain("db.transaction");
    expect(recovery).toContain("FOR UPDATE SKIP LOCKED");
    expect(recovery).toContain("action: EXPORT_AUDIT.failed");
    expect(recovery).toContain("{ retrying, status, finishedAt }");
    expect(recovery).toContain("errorCode: \"lease_expired\", retrying");
    expect(recovery).toContain("metrics.push");
    expect(recovery).toContain("await emitStaleRecoveryMetrics(recordWorkHubOperationalMetric, result.metrics, now)");
  });
});

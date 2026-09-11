import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { createWorkHubEventBus } from "./events";
import { buildWorkHubExportArtifact, type WorkHubExportRow } from "./governance-export-reader";

const owner = { type: "vendor" as const, id: 41 };
const generatedAt = "2026-09-11T05:00:00.000Z";

describe("Work Hub representative load boundaries", () => {
  it("fans out ten rounds to 500 recipients without cross-recipient delivery", () => {
    const bus = createWorkHubEventBus();
    const deliveries = Array.from({ length: 500 }, () => 0);
    deliveries.forEach((_count, index) => bus.subscribe(index + 1, (event) => {
      expect(event.recipientUserId).toBe(index + 1);
      deliveries[index] += 1;
    }));

    const started = performance.now();
    for (let round = 0; round < 10; round += 1) {
      for (let userId = 1; userId <= deliveries.length; userId += 1) {
        bus.publish({
          type: "work_hub.notification.created",
          owner,
          context: { kind: "organization", id: owner.id },
          subject: { type: "load_probe", id: `${round}:${userId}` },
          recipientUserId: userId,
        });
      }
    }
    const elapsedMs = performance.now() - started;

    expect(deliveries.every((count) => count === 10)).toBe(true);
    expect(bus.currentSequence()).toBe(5_000);
    expect(elapsedMs).toBeLessThan(5_000);
  });

  it("builds a complete deterministic 10,000-row CSV artifact within the release budget", async () => {
    const rows: WorkHubExportRow[] = Array.from({ length: 10_000 }, (_, index) => ({
      cursorAt: generatedAt,
      cursorId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      fields: { title: `Task ${index}`, status: index % 2 === 0 ? "open" : "completed" },
    }));
    const input = {
      jobId: "00000000-0000-4000-8000-000000000001",
      request: { dataset: "tasks" as const, format: "csv" as const, scope: { selectors: {} } },
      requester: { id: "22", display: "Release load probe" },
      generatedAt,
      snapshotAt: generatedAt,
      rows,
    };

    const started = performance.now();
    const first = await buildWorkHubExportArtifact(input);
    const elapsedMs = performance.now() - started;
    const second = await buildWorkHubExportArtifact(input);

    expect(first.manifest.rowCount).toBe(10_000);
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.sha256).toBe(second.sha256);
    expect(first.bytes.toString("utf8")).toContain("Task 9999");
    expect(elapsedMs).toBeLessThan(5_000);
  });
});

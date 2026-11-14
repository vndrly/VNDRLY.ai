import { describe, expect, it } from "vitest";
import type { ChangeOverState } from "@workspace/gate-booth";
import { aggregateGateSnapshots } from "./aggregate-gate-snapshots";

const state = (siteId: number, ids: string[], groupId?: string): ChangeOverState => ({
  site: { id: siteId, name: `Site ${siteId}` },
  snapshot: {
    generatedAt: "2026-11-14T02:00:00Z",
    linkedScope: groupId ? { groupId, siteIds: [1, 2], name: "Linked gates" } : undefined,
    metrics: { checkIns: ids.length }, metricRecordIds: { checkIns: ids },
    records: ids.map(id => ({ id })), outstanding: [], exceptions: [],
  },
}) as ChangeOverState;

describe("all gate totals", () => {
  it("counts linked snapshots and overlapping records only once", () => {
    const result = aggregateGateSnapshots([state(1, ["a", "b"], "linked"), state(2, ["a", "b"], "linked"), state(3, ["b", "c"])]);
    expect(result?.metrics.checkIns).toBe(3);
    expect(result?.records?.map(row => row.id)).toEqual(["a", "b", "c"]);
  });
  it("does not publish partial totals when a snapshot is unavailable", () => {
    expect(aggregateGateSnapshots([state(1, ["a"]), { ...state(2, []), snapshot: null }])).toBeNull();
    expect(aggregateGateSnapshots([])).toBeNull();
  });
});

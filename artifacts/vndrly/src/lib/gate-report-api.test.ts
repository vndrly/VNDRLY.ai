import { afterEach, describe, expect, it, vi } from "vitest";
import { loadGateReport } from "./gate-report-api";
const page = (ids: string[], total: number, nextOffset: number | null, snapshotId = "snapshot-one") => ({ snapshotId, totals: { entries: total }, rows: ids.map(id => ({ id })), nextOffset });
afterEach(() => vi.unstubAllGlobals());
describe("complete Gate Log report download", () => {
  it("collects every immutable page before enabling a complete report", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => page(["visit:1", "checkin:1"], 3, 2) }).mockResolvedValueOnce({ ok: true, json: async () => page(["visit:2"], 3, null) });
    vi.stubGlobal("fetch", fetch);
    const result = await loadGateReport({ recordKind: "visitor" }, new AbortController().signal);
    expect(result.rows.map(row => row.id)).toEqual(["visit:1", "checkin:1", "visit:2"]);
    expect(fetch.mock.calls[0][0]).toContain("recordKind=visitor");
    expect(fetch.mock.calls[1][0]).toContain("snapshotId=snapshot-one&offset=2");
  });
  it("rejects incomplete totals instead of printing partial results", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => page(["visit:1"], 3000, null) }));
    await expect(loadGateReport({}, new AbortController().signal)).rejects.toThrow("incomplete");
  });
  it("rejects duplicate records across pages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => page(["visit:1", "visit:1"], 2, null) }));
    await expect(loadGateReport({}, new AbortController().signal)).rejects.toThrow("incomplete");
  });
  it("surfaces explicit expired or oversized report errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 413, json: async () => ({ message: "Report exceeds 25,000 entries; narrow the range" }) }));
    await expect(loadGateReport({}, new AbortController().signal)).rejects.toThrow("narrow the range");
  });
});

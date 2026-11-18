import { expect, it, vi } from "vitest";
import { pool } from "@workspace/db";
import { parseGateReportFilters, databaseGateReportDependencies } from "./gate-reports";
const stationId = "11111111-1111-4111-8111-111111111111";
it("queries the requested Gate and exact time window instead of falling back to the current shift", async () => {
  const filters = parseGateReportFilters({ siteId: 10, stationId, range: "custom", from: "2026-11-17T20:00:00-06:00", to: "2026-11-17T21:00:00-06:00", recordType: "all" } as any);
  expect(filters).toMatchObject({ from: "2026-11-18T02:00:00.000Z", to: "2026-11-18T03:00:00.000Z" });
  const query = vi.spyOn(pool, "query").mockImplementation(async (sql: any) => ({ rows: String(sql).startsWith("SELECT id FROM gate_stations") ? [{ id: stationId }] : [] }) as never);
  try {
    await databaseGateReportDependencies.queryRows(filters, { kind: "full_site" }, "history");
    expect(query.mock.calls.at(-1)?.[1]).toEqual([[10], new Date("2026-11-18T02:00:00Z"), new Date("2026-11-18T03:00:00Z"), null, stationId]);
  } finally { query.mockRestore(); }
});
it("rejects incomplete and reversed custom windows rather than showing unrelated records", () => {
  expect(() => parseGateReportFilters({ siteId: 10, range: "custom", from: "2026-11-18T03:00:00Z" } as any)).toThrow();
  expect(() => parseGateReportFilters({ siteId: 10, range: "custom", from: "2026-11-18T03:00:00Z", to: "2026-11-18T02:00:00Z" } as any)).toThrow();
});
it("shows crossing events in the requested hour, excluding people merely present throughout", async () => {
  const filters = parseGateReportFilters({ siteId: 10, stationId, range: "custom", from: "2026-11-17T16:00:00-06:00", to: "2026-11-17T17:00:00-06:00", recordType: "all" } as any);
  const rows = [
    { id: "present", gateStationId: stationId, checkInTime: "2026-11-17T21:00:00Z", checkOutTime: "2026-11-18T00:00:00Z" },
    { id: "entered", gateStationId: stationId, checkInTime: "2026-11-17T22:15:00Z" },
    { id: "left", gateStationId: stationId, checkInTime: "2026-11-17T21:00:00Z", checkOutTime: "2026-11-17T22:45:00Z" },
    { id: "next-hour", gateStationId: stationId, checkInTime: "2026-11-17T23:00:00Z" },
  ];
  const query = vi.spyOn(pool, "query").mockImplementation(async (sql: any) => ({ rows: String(sql).startsWith("SELECT id FROM gate_stations") ? [{ id: stationId }] : rows }) as never);
  try {
    expect((await databaseGateReportDependencies.queryRows(filters, { kind: "full_site" }, "history")).map(row => row.id)).toEqual(["entered", "left"]);
    expect((await databaseGateReportDependencies.queryRows({ ...filters, recordType: "check_ins" }, { kind: "full_site" }, "history")).map(row => row.id)).toEqual(["entered"]);
    expect((await databaseGateReportDependencies.queryRows({ ...filters, recordType: "check_outs" }, { kind: "full_site" }, "history")).map(row => row.id)).toEqual(["left"]);
  } finally { query.mockRestore(); }
});

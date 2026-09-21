import { describe, expect, it } from "vitest";
import {
  assembleShiftSnapshot,
  groundedSummary,
} from "./gate-change-over-snapshot";

const at = new Date("2026-09-20T19:00:00Z");
const start = "2026-09-20T07:00:00Z";
const visit = (id: number, extra = {}) => ({
  id: `visit:${id}`,
  kind: "visitor" as const,
  name: "Alex Smith",
  company: "Vendor",
  plate: "TX:ABC123",
  checkIn: "2026-09-20T08:00:00Z",
  checkOut: null,
  admission: "approved",
  expectedMinutes: 60,
  reconciliation: "not_required",
  notes: null,
  ...extra,
});
describe("Change Over factual snapshot", () => {
  it("counts shift events separately from occupancy carried from earlier shifts", () => {
    const s = assembleShiftSnapshot(
      [
        visit(1, { checkIn: "2026-09-19T23:00:00Z" }),
        visit(2, { checkOut: "2026-09-20T09:00:00Z" }),
        visit(3, { admission: "pending" }),
      ],
      [],
      start,
      at,
    );
    expect(s.metrics).toMatchObject({
      checkIns: 1,
      checkOuts: 1,
      onSiteVisitorRecords: 1,
      onSiteVehicles: 1,
      pendingAdmission: 1,
    });
    expect(s.outstanding.map((r) => r.id)).toEqual(["visit:1"]);
  });
  it("keeps employee records separate to avoid invented unique head counts", () => {
    const s = assembleShiftSnapshot(
      [visit(1), visit(2, { kind: "employee", plate: null })],
      [],
      start,
      at,
    );
    expect(s.metrics).toMatchObject({
      onSiteVisitorRecords: 1,
      onSiteEmployeeRecords: 1,
      onSiteVehicles: 1,
    });
    expect(s.coverage).toContain("site-wide");
  });
  it("detects missing identity, long visits and reconciliation exceptions", () => {
    const s = assembleShiftSnapshot(
      [visit(1, { name: "", reconciliation: "conflict" })],
      [],
      start,
      at,
    );
    expect(s.exceptions.map((e) => e.code)).toEqual(
      expect.arrayContaining(["missing_identity", "overdue", "reconciliation"]),
    );
  });
  it("revision changes on corrections and item resolution but not row order or elapsed clock time", () => {
    const rows = [visit(1), visit(2)];
    const s = assembleShiftSnapshot(rows, [], start, at);
    expect(
      assembleShiftSnapshot(
        [...rows].reverse(),
        [],
        start,
        new Date(at.getTime() + 1000),
      ).revision,
    ).toBe(s.revision);
    expect(
      assembleShiftSnapshot(
        [visit(1, { notes: "corrected" }), visit(2)],
        [],
        start,
        at,
      ).revision,
    ).not.toBe(s.revision);
    expect(
      assembleShiftSnapshot(
        rows,
        [{ id: "item", text: "Inspect barrier", status: "open" }],
        start,
        at,
      ).revision,
    ).not.toBe(s.revision);
  });
  it("reconstructs AI selections from facts and rejects invented source IDs", () => {
    const s = assembleShiftSnapshot([visit(1)], [], start, at);
    expect(groundedSummary(s.facts, ["invented"])).toBeNull();
    expect(groundedSummary(s.facts, [s.facts[0]!.id])).toEqual([s.facts[0]]);
  });
});

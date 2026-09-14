import { describe, expect, it } from "vitest";
import { buildImplementationAExport } from "./implementation-a-exports";

describe("Implementation A exports", () => {
  it("exports managed-company hours without compensation unless separately permitted", () => {
    const result = buildImplementationAExport({
      dataset: "payroll",
      scope: { ownerOrgId: 10, managedOrganizationId: "newtek" },
      rows: [
        { ownerOrgId: 10, managedOrganizationId: "newtek", worker: "Alex", employer: "NewTek", sponsor: "MidCon", site: "Founding Site", hours: 42, payRate: 35 },
        { ownerOrgId: 10, managedOrganizationId: "other", worker: "Hidden", employer: "Other", sponsor: "MidCon", site: "Other", hours: 9, payRate: 50 },
      ],
    });
    expect(result.headers).toEqual(["worker", "employer", "sponsor", "site", "hours"]);
    expect(result.csv).toContain("Alex,NewTek,MidCon,Founding Site,42");
    expect(result.csv).not.toContain("35");
    expect(result.csv).not.toContain("Hidden");
  });

  it("retains sponsor-owned assignment history after a managed company is claimed", () => {
    const result = buildImplementationAExport({
      dataset: "staffing",
      scope: { ownerOrgId: 10 },
      rows: [{ ownerOrgId: 10, assignmentId: "shift-1", worker: "Alex", employer: "NewTek", sponsor: "MidCon", site: "A", startsAt: "2026-09-14T12:00:00Z", endsAt: "2026-09-14T20:00:00Z", status: "completed" }],
    });
    expect(result.csv).toContain("shift-1,Alex,NewTek,MidCon,A");
  });

  it("includes custody and condition while excluding hidden incident details", () => {
    const result = buildImplementationAExport({
      dataset: "assets",
      scope: { ownerOrgId: 10 },
      rows: [{ ownerOrgId: 10, assetId: "truck-1", name: "Truck 1", category: "vehicle", status: "held", holder: "Alex", condition: "damaged", incidentDetail: "private medical detail" }],
    });
    expect(result.headers).toEqual(["assetId", "name", "category", "status", "holder", "condition"]);
    expect(result.csv).toContain("truck-1,Truck 1,vehicle,held,Alex,damaged");
    expect(result.csv).not.toContain("medical");
  });

  it("produces a deterministic audit summary and escaped CSV", () => {
    const input = { dataset: "safety" as const, scope: { ownerOrgId: 10, siteIds: [2] }, rows: [{ ownerOrgId: 10, siteId: 2, eventId: "i-1", reportedAt: "2026-09-14T12:00:00Z", severity: "urgent", status: "open", acknowledgement: "Supervisor, notified" }] };
    const first = buildImplementationAExport(input);
    const second = buildImplementationAExport(input);
    expect(first.sha256).toBe(second.sha256);
    expect(first.csv).toContain('"Supervisor, notified"');
    expect(first.audit).toMatchObject({ dataset: "safety", rowCount: 1, scope: input.scope, result: "completed" });
  });

  it("neutralizes spreadsheet formulas in user-entered fields", () => {
    const result = buildImplementationAExport({ dataset: "payroll", scope: { ownerOrgId: 10 }, rows: [{ ownerOrgId: 10, worker: "=SUM(A1:A2)", employer: "NewTek", sponsor: "MidCon", site: "A", hours: 1 }] });
    expect(result.csv).toContain("'=SUM(A1:A2)");
  });});

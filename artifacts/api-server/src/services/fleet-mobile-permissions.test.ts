import { describe, expect, it, vi } from "vitest";
import type { FleetCapability } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { legacyFleetCapabilities, mayPerformFleetMobileAction, projectFleetMobileActions, readFleetCapabilities, resolveFleetCapabilities, saveFleetCapabilities } from "./fleet-mobile-permissions";

const companyId = 19;
const fleetId = "e81f62e2-9600-4be4-8f56-41140c0139ea";
const grant = { companyId, fleetIds: [fleetId], siteIds: [7], roles: ["driver"] as const, safetyRelease: false, financeRead: false };
const target = { companyId, fleetId, siteId: 7, driverUserId: 42, assignedToUserId: 42 };
function actor(capabilities: FleetCapability[]) {
  return { userId: 42, companyId, capabilities: new Set(capabilities), grant };
}

describe("composable Fleet authority", () => {
  it.each([
    [["admin"], ["configure", "office_review", "dispatch", "yard_work", "view_live_map", "view_compliance"]],
    [["office"], ["office_review", "view_compliance"]],
    [["dispatch"], ["dispatch", "view_live_map", "view_compliance"]],
    [["yard"], ["yard_work"]],
    [["driver"], ["perform_run"]],
    [["driver", "yard"], ["yard_work", "perform_run"]],
    [["driver", "self_dispatch"], ["perform_run", "self_dispatch"]],
  ] as const)("allows exactly the actions of %j", (capabilities, allowed) => {
    const all = ["configure", "office_review", "dispatch", "yard_work", "perform_run", "self_dispatch", "view_live_map", "view_compliance"] as const;
    expect(all.filter(action => mayPerformFleetMobileAction(actor([...capabilities]), target, action))).toEqual(allowed);
  });

  it("collapses an independent operator's handoff to one authority", () => {
    const all: FleetCapability[] = ["admin", "office", "dispatch", "yard", "driver", "self_dispatch"];
    expect(projectFleetMobileActions(actor(all), target)).toEqual([
      "configure", "office_review", "dispatch", "yard_work", "perform_run", "self_dispatch", "view_live_map", "view_compliance",
    ]);
  });

  it("denies cross-company, out-of-fleet, out-of-site, and unassigned work", () => {
    const a = actor(["admin", "yard", "driver"]);
    expect(mayPerformFleetMobileAction(a, { ...target, companyId: 20 }, "configure")).toBe(false);
    expect(mayPerformFleetMobileAction(a, { ...target, fleetId: "other" }, "configure")).toBe(false);
    expect(mayPerformFleetMobileAction(a, { ...target, siteId: 8 }, "yard_work")).toBe(false);
    expect(mayPerformFleetMobileAction(a, { ...target, driverUserId: 43 }, "perform_run")).toBe(false);
    expect(mayPerformFleetMobileAction({ ...a, grant: null }, target, "configure")).toBe(false);
  });
  it("allows assigned driver and Yard work with a normalized driver grant only at trusted current sites", () => {
    const normalized = { ...grant, siteIds: [] };
    const driverYard = { ...actor(["driver", "yard", "self_dispatch"]), grant: normalized, currentSiteIds: [7] };
    expect(mayPerformFleetMobileAction(driverYard, target, "perform_run")).toBe(true);
    expect(mayPerformFleetMobileAction(driverYard, target, "yard_work")).toBe(true);
    expect(mayPerformFleetMobileAction(driverYard, target, "self_dispatch")).toBe(true);
    expect(mayPerformFleetMobileAction(driverYard, { ...target, siteId: 8 }, "perform_run")).toBe(false);
    expect(mayPerformFleetMobileAction(driverYard, { ...target, assignedToUserId: 43 }, "yard_work")).toBe(false);
    expect(mayPerformFleetMobileAction(driverYard, { ...target, driverUserId: 43 }, "perform_run")).toBe(false);
    expect(mayPerformFleetMobileAction({ ...driverYard, currentSiteIds: [] }, target, "perform_run")).toBe(false);
  });

  it("maps only the three legacy Fleet roles", () => {
    expect([...legacyFleetCapabilities(["fleet_manager"])]).toEqual(["admin", "dispatch"]);
    expect([...legacyFleetCapabilities(["dispatcher"])]).toEqual(["dispatch"]);
    expect([...legacyFleetCapabilities(["driver"])]).toEqual(["driver"]);
    expect([...legacyFleetCapabilities(["driver", "dispatcher"])]).toEqual(["dispatch", "driver"]);
    expect([...legacyFleetCapabilities(["unknown"])]).toEqual([]);
  });
  it("reads self capabilities and version from the same stored revision", async () => {
    const state = { version: 1, enabled: true, fleets: [{ id: fleetId, name: "Synthetic", siteIds: [], requiredCertifications: [], equipmentAssetIds: [] }], grants: [{ userId: 42, fleetIds: [fleetId], siteIds: [], roles: ["driver"], safetyRelease: false, financeRead: false }], supportGrants: [], runs: [], preferences: [], operations: [] };
    let capabilityReads = 0;
    const query = vi.spyOn(pool, "query").mockImplementation(async (sql: any) => {
      const text = String(sql);
      if (text.includes("FROM user_org_memberships")) return { rows: [{ id: 3 }] } as any;
      if (text.includes("FROM vendors")) return { rows: [{ fleet_ops_state: state }] } as any;
      if (text.includes("FROM fleet_person_capabilities")) return { rows: [++capabilityReads === 1 ? { capabilities: ["driver"], version: 1 } : { capabilities: ["office"], version: 2 }] } as any;
      throw new Error(`Unexpected read: ${text}`);
    });
    try {
      expect(await readFleetCapabilities({ userId: 42, companyId, role: "vendor", membershipRole: "member", activeMembershipId: 3, sv: 1 })).toMatchObject({ capabilities: ["driver"], version: 1, source: "stored" });
    } finally { query.mockRestore(); }
  });
  it("rejects stale or removed membership before reading grants", async () => {
    const query = vi.spyOn(pool, "query").mockResolvedValue({ rows: [] } as any);
    try {
      await expect(resolveFleetCapabilities({ userId: 42, companyId, role: "vendor", membershipRole: "member", activeMembershipId: 3, sv: 1 }, companyId)).rejects.toMatchObject({ code: "fleet.membership_required" });
    } finally { query.mockRestore(); }
  });
  it("rejects an inactive field person even with a current membership", async () => {
    const query = vi.spyOn(pool, "query").mockImplementation(async (sql: any) => ({ rows: String(sql).includes("FROM user_org_memberships") ? [{ id: 3 }] : [] } as any));
    try {
      await expect(resolveFleetCapabilities({ userId: 42, companyId, role: "field_employee", membershipRole: "field_employee", activeMembershipId: 3, vendorPeopleId: 5, sv: 1 }, companyId)).rejects.toMatchObject({ code: "fleet.current_person_required" });
    } finally { query.mockRestore(); }
  });
  it("denies a read-only capability update before any database write", async () => {
    const assignment = { companyId, userId: 42, version: 1, capabilities: ["driver"] };
    const scope = { owner: { type: "vendor", id: companyId }, userId: 41, membershipId: 3, sessionVersion: 1 };
    await expect(saveFleetCapabilities({ userId: 41, companyId, role: "vendor", membershipRole: "admin", activeMembershipId: 3, sv: 1, readOnly: true }, 42, { operationId: fleetId, expectedVersion: 0, scope, assignment })).rejects.toMatchObject({ code: "fleet.read_only" });
  });
});

import { describe, expect, it } from "vitest";
import { deriveWorkHubCapabilities, WorkHubAccessError } from "./context-access";
import { resolveWorkHubCapabilities } from "./capabilities";

const owner = { type: "vendor", id: 12 } as const;

describe("Work Hub role capability matrix", () => {
  it("projects the gatekeeper, supervisor, and administrator grants for the home response", () => {
    const gatekeeper = resolveWorkHubCapabilities({ userId: 31, role: "field_employee", vendorId: 12, vendorRole: "gatekeeper" }, 12);
    expect(gatekeeper).toMatchObject({
      canUploadFile: true,
      canCreateNote: true,
      canCreateAsset: false,
      canCheckOutAsset: true,
      canViewExports: false,
      allowedExportDatasets: [],
      canManageGateLocations: false,
    });
    const supervisor = resolveWorkHubCapabilities({ userId: 32, role: "field_employee", vendorId: 12, vendorRole: "gate_supervisor" }, 12);
    expect(supervisor.allowedExportDatasets).toEqual(["staffing"]);
    const admin = resolveWorkHubCapabilities({ userId: 33, role: "vendor", vendorId: 12, membershipRole: "admin" }, 12);
    expect(admin.allowedExportDatasets).toEqual([
      "payroll-hours", "quickbooks-time", "inventory-custody", "staffing", "safety-response",
    ]);
  });

  it("does not project capabilities for an unrelated owner", () => {
    expect(() => resolveWorkHubCapabilities({ userId: 31, role: "vendor", vendorId: 99, membershipRole: "admin" }, 12))
      .toThrowError(WorkHubAccessError);
  });

  it("does not project gate custody rights after all managed site grants are removed", () => {
    expect(() => resolveWorkHubCapabilities({
      userId: 34,
      role: "field_employee",
      vendorId: 12,
      managedSubcontractor: { siteGrants: [] },
    }, 12)).toThrowError(WorkHubAccessError);
  });

  it("lets a gatekeeper work with files, notes, and asset custody without office authority", () => {
    const capabilities = deriveWorkHubCapabilities({
      session: { userId: 31, role: "field_employee", vendorId: 12, vendorRole: "gatekeeper" },
      owner,
      context: { kind: "gate", id: 44 },
      participant: true,
    });

    expect(capabilities).toEqual(expect.arrayContaining(["file.upload", "note.create", "asset.checkout"]));
    expect(capabilities).not.toEqual(expect.arrayContaining(["asset.create", "export.staffing", "gate.location.manage"]));
  });

  it("limits a gate supervisor to the staffing export", () => {
    const capabilities = deriveWorkHubCapabilities({
      session: { userId: 32, role: "field_employee", vendorId: 12, vendorRole: "gate_supervisor" },
      owner,
      context: { kind: "gate", id: 44 },
      participant: true,
    });

    expect(capabilities).toContain("export.staffing");
    expect(capabilities).not.toContain("export.payroll-hours");
    expect(capabilities).not.toContain("gate.location.manage");
  });

  it("grants an organization administrator all five export datasets and management", () => {
    const capabilities = deriveWorkHubCapabilities({
      session: { userId: 33, role: "vendor", vendorId: 12, membershipRole: "admin" },
      owner,
      context: { kind: "organization", id: 12 },
      participant: true,
    });

    expect(capabilities).toEqual(expect.arrayContaining([
      "asset.create", "asset.manage", "asset.verify-issued", "gate.location.manage",
      "export.payroll-hours", "export.quickbooks-time", "export.inventory-custody",
      "export.staffing", "export.safety-response",
    ]));
  });
});

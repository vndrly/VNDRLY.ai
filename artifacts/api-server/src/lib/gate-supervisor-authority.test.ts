import { describe, expect, it } from "vitest";
import { hasGateSupervisorAuthority } from "./gate-supervisor-authority";

describe("Gate supervisor authority", () => {
  it("does not retain a stale supervisor claim after downgrade", () => {
    expect(hasGateSupervisorAuthority({ userId: 12, role: "field_employee", vendorId: 41,
      vendorRole: "gate_supervisor", gateSupervisorAccess: false }, 22)).toBe(false);
  });
  it("uses the managed site's role instead of aggregated supervisor authority", () => {
    const session = { userId: 12, role: "field_employee", vendorId: 41,
      vendorRole: "gate_supervisor", gateSupervisorAccess: true,
      managedSubcontractor: { siteGrants: [
        { siteId: 22, role: "gate_supervisor" as const },
        { siteId: 23, role: "gatekeeper" as const },
      ] } };
    expect(hasGateSupervisorAuthority(session, 22)).toBe(true);
    expect(hasGateSupervisorAuthority(session, 23)).toBe(false);
    expect(hasGateSupervisorAuthority(session, 24)).toBe(false);
  });
});

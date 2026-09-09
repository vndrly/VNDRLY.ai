import { describe, expect, it } from "vitest";
import { deriveWorkHubCapabilities, WorkHubAccessError } from "./context-access";

const vendorOwner = { type: "vendor", id: 12 } as const;
const partnerOwner = { type: "partner", id: 21 } as const;

describe("deriveWorkHubCapabilities", () => {
  it("gives a vendor administrator full management in its own organization", () => {
    const capabilities = deriveWorkHubCapabilities({
      session: { userId: 7, role: "vendor", vendorId: 12, membershipRole: "admin" },
      owner: vendorOwner,
      context: { kind: "organization", id: "12" },
      participant: true,
    });
    expect(capabilities).toContain("channel.manage");
    expect(capabilities).toContain("meeting.record");
    expect(capabilities).toContain("connector.manage");
  });

  it("gives partner administrators parity in a partner-owned context", () => {
    const capabilities = deriveWorkHubCapabilities({
      session: { userId: 8, role: "partner", partnerId: 21, membershipRole: "admin" },
      owner: partnerOwner,
      context: { kind: "site", id: "90" },
      participant: true,
    });
    expect(capabilities).toContain("channel.manage");
    expect(capabilities).toContain("announcement.publish");
  });

  it("limits an authorized field employee to participant capabilities", () => {
    const capabilities = deriveWorkHubCapabilities({
      session: { userId: 9, role: "field_employee", vendorId: 12, membershipRole: "field_employee" },
      owner: vendorOwner,
      context: { kind: "ticket", id: "481" },
      participant: true,
    });
    expect(capabilities).toEqual(expect.arrayContaining(["channel.read", "channel.write", "file.download"]));
    expect(capabilities).not.toContain("channel.manage");
  });

  it("lets a gate supervisor schedule gate work without organization admin authority", () => {
    const capabilities = deriveWorkHubCapabilities({
      session: { userId: 11, role: "field_employee", vendorId: 12, membershipRole: "field_employee", vendorRole: "gate_supervisor" },
      owner: vendorOwner,
      context: { kind: "organization", id: "12" },
      participant: true,
    });
    expect(capabilities).toEqual(expect.arrayContaining(["task.assign", "shift.manage"]));
    expect(capabilities).not.toContain("channel.manage");
    expect(capabilities).not.toContain("policy.manage");
  });

  it("hides cross-tenant contexts", () => {
    expect(() => deriveWorkHubCapabilities({
      session: { userId: 10, role: "vendor", vendorId: 99, membershipRole: "admin" },
      owner: vendorOwner,
      context: { kind: "organization", id: "12" },
      participant: false,
    })).toThrowError(WorkHubAccessError);
  });

  it("lets a platform admin support visible contexts but audits exports separately", () => {
    const capabilities = deriveWorkHubCapabilities({
      session: { userId: 1, role: "admin" }, owner: vendorOwner,
      context: { kind: "ticket", id: "481" }, participant: true,
    });
    expect(capabilities).toContain("policy.manage");
  });
});

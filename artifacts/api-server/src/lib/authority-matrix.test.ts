import { describe, expect, it } from "vitest";
import { authorizeCapability, type AuthorityContext } from "./authority-matrix";

const base: AuthorityContext = {
  actor: {
    userId: 10,
    kind: "managed_worker",
    activeOwner: { type: "vendor", id: 20 },
    sponsorVendorId: 20,
    roles: ["gatekeeper"],
    siteIds: [30],
    crewIds: ["00000000-0000-4000-8000-000000000040"],
    explicitInvitations: [],
  },
};

describe("Implementation A authority matrix", () => {
  it.each([
    [
      "newtek worker",
      { ...base, resource: { type: "directory", id: "flywheel", owner: { type: "partner", id: 50 } } },
      "directory.read",
      false,
    ],
    [
      "newtek worker with an explicit meeting invitation",
      {
        actor: {
          ...base.actor,
          explicitInvitations: [{ resourceType: "meeting", resourceId: "meeting-1" }],
        },
        resource: { type: "meeting", id: "meeting-1", owner: { type: "partner", id: 50 } },
      },
      "meeting.join",
      true,
    ],
    [
      "gate supervisor",
      { ...base, actor: { ...base.actor, roles: ["gate_supervisor"] }, resource: { type: "schedule", id: "shift-1", owner: { type: "vendor", id: 20 }, siteId: 30 } },
      "schedule.manage",
      true,
    ],
    [
      "gate supervisor reading pay rates",
      { ...base, actor: { ...base.actor, roles: ["gate_supervisor"] }, resource: { type: "pay_rates", id: "worker-1", owner: { type: "vendor", id: 20 }, siteId: 30 } },
      "pay_rates.read",
      false,
    ],
    [
      "operations display changing a schedule",
      { ...base, actor: { ...base.actor, kind: "operations_display", roles: [] }, resource: { type: "schedule", id: "shift-1", owner: { type: "vendor", id: 20 }, siteId: 30 } },
      "schedule.manage",
      false,
    ],
  ] satisfies Array<[string, AuthorityContext, Parameters<typeof authorizeCapability>[1], boolean]>)
    ("evaluates %s", async (_label, context, capability, allowed) => {
      expect((await authorizeCapability(context, capability)).allowed).toBe(allowed);
    });

  it("limits a sponsored supervisor export to operational fields", async () => {
    const decision = await authorizeCapability(
      {
        ...base,
        actor: { ...base.actor, roles: ["gate_supervisor"] },
        resource: { type: "hours", id: "site-30", owner: { type: "vendor", id: 20 }, siteId: 30 },
      },
      "export.read",
    );
    expect(decision).toMatchObject({
      allowed: true,
      confirmation: "none",
      visibleFields: expect.arrayContaining(["workerName", "hours", "approvalStatus"]),
    });
    expect(decision.visibleFields).not.toContain("payRate");
  });

  it("grants an explicit cross-company invitation only to the referenced item", async () => {
    const actor = {
      ...base.actor,
      explicitInvitations: [{ resourceType: "meeting", resourceId: "meeting-1" }],
    };
    expect((await authorizeCapability({ actor, resource: { type: "meeting", id: "meeting-1", owner: { type: "partner", id: 50 } } }, "meeting.join")).allowed).toBe(true);
    expect(await authorizeCapability({ actor, resource: { type: "meeting", id: "meeting-2", owner: { type: "partner", id: 50 } } }, "meeting.join")).toMatchObject({ allowed: false, reasonCode: "authority.downstream_relationship_denied" });
  });
});
